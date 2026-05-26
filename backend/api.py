from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import shutil
import os
import json
import base64
import cv2
import numpy as np
import copy
from fastapi.middleware.cors import CORSMiddleware

# Import your custom functions!
from services.vision import extract_kinematics, LiveTracker
from services.agent import generate_coach_feedback
from services.analyzer import evaluate_rep, build_multi_rep_dtw
import pandas as pd
from scipy.signal import savgol_filter

app = FastAPI(title="Hercules AI Engine")

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Load exercise rules
with open("configs/exercises.json", "r") as f:
    exercises_db = json.load(f)

# Store modified target angles for the current session
session_overrides = {}

STATS_FILE = "data/user_stats.json"

def load_stats():
    if not os.path.exists(STATS_FILE):
        return {"workouts": 0, "total_reps": 0, "average_score": 0.0, "calories": 0.0, "history": []}
    try:
        with open(STATS_FILE, "r") as f:
            stats = json.load(f)
            if "history" not in stats:
                stats["history"] = []
            return stats
    except:
        return {"workouts": 0, "total_reps": 0, "average_score": 0.0, "calories": 0.0, "history": []}

def save_stats(exercise_name, reps, score):
    if reps == 0: return # Don't log 0 rep workouts
    stats = load_stats()
    stats["workouts"] += 1
    stats["total_reps"] += reps
    old_total_score = stats["average_score"] * (stats["workouts"] - 1)
    stats["average_score"] = round((old_total_score + score) / stats["workouts"], 1)
    stats["calories"] = round(stats["calories"] + (reps * 0.5), 1)
    
    import datetime
    now = datetime.datetime.now().strftime("%b %d, %Y - %I:%M %p")
    
    stats["history"].insert(0, {
        "date": now,
        "exercise": exercise_name.replace('_', ' ').title(),
        "reps": reps,
        "score": score
    })
    
    stats["history"] = stats["history"][:50]
    
    with open(STATS_FILE, "w") as f:
        json.dump(stats, f)

# This allows your React frontend to talk to this Python backend without security errors
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws/track")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    # We will initialize the tracker when the first message comes in with the exercise name
    tracker = None
    
    try:
        while True:
            # Receive data from React
            data = await websocket.receive_json()
            
            if "command" in data and data["command"] == "stop":
                if tracker:
                    # Calculate final stats from tracker
                    rules = tracker.exercise_rules
                    target_angle = rules['fsm_rules']['target_threshold']
                    start_angle = rules['fsm_rules']['start_threshold']
                    trigger_key = rules['fsm_rules']['primary_trigger']
                    angle_key = f"{trigger_key}_angle"
                    
                    extreme_angle = start_angle # Fallback
                    if tracker.data_log:
                        angles = [f.get(angle_key, start_angle) for f in tracker.data_log if angle_key in f]
                        if target_angle > start_angle:
                            extreme_angle = max(angles)
                        else:
                            extreme_angle = min(angles)
                        
                    # Calculate penalty
                    is_overshoot = (target_angle < start_angle and extreme_angle < target_angle) or (target_angle > start_angle and extreme_angle > target_angle)
                    degrees_off = abs(extreme_angle - target_angle)
                    
                    if is_overshoot:
                        # Lenient penalty for going "too deep" (e.g. deep squat)
                        penalty = degrees_off / 15
                    else:
                        # Strict penalty for quarter-reps
                        penalty = degrees_off / 5
                        
                    score = max(0, min(10, 10 - penalty)) 
                    score_rounded = round(score, 1)

                    total_possible_degrees = abs(start_angle - target_angle)
                    degrees_moved = abs(start_angle - extreme_angle)
                    rom_percentage = 0
                    if total_possible_degrees > 0:
                        rom = (degrees_moved / total_possible_degrees) * 100
                        rom_percentage = round(min(100, rom))

                    avg_rep_time = 0
                    if tracker.all_reps_data and len(tracker.all_reps_data) > 0:
                        total_time_ms = 0
                        for rep_data in tracker.all_reps_data:
                            if len(rep_data) > 0:
                                rep_start_ms = rep_data[0]['timestamp_ms']
                                rep_end_ms = rep_data[-1]['timestamp_ms']
                                total_time_ms += (rep_end_ms - rep_start_ms)
                        avg_rep_time = round((total_time_ms / len(tracker.all_reps_data)) / 1000.0, 1)

                    rep_consistency = "N/A"
                    if len(tracker.all_reps_data) >= 2:
                        try:
                            first_rep_lowest = min([f.get(angle_key, 0) for f in tracker.all_reps_data[0] if angle_key in f])
                            last_rep_lowest = min([f.get(angle_key, 0) for f in tracker.all_reps_data[-1] if angle_key in f])
                            diff = abs(first_rep_lowest - last_rep_lowest)
                            
                            if diff < 5:
                                rep_consistency = "Consistent form maintained."
                            else:
                                rep_consistency = f"Form shifted by {round(diff)}° on final rep."
                        except Exception:
                            pass

                    # --- LIVE DTW EVALUATION ---
                    dtw_score, graph_data = build_multi_rep_dtw(
                        tracker.data_log, tracker.all_reps_data, rules, rules.get('template_csv')
                    )

                    # Generate AI Feedback
                    feedback, tool_action = generate_coach_feedback(
                        exercise_name=rules["name"],
                        reps_completed=tracker.reps_completed,
                        lowest_angle=extreme_angle,
                        target_angle=target_angle,
                        score=score_rounded,
                        tempo=avg_rep_time,
                        consistency=rep_consistency,
                        dtw_score=round(dtw_score, 1) if type(dtw_score) == float else dtw_score
                    )
                    
                    if tool_action:
                        session_overrides[tracker.exercise_key] = tool_action["new_target_angle"]

                    # Save persistent stats
                    save_stats(rules["name"], tracker.reps_completed, score_rounded)

                    await websocket.send_json({
                        "type": "summary",
                        "stats": {
                            "reps": tracker.reps_completed,
                            "score": score_rounded,
                            "rom": f"{rom_percentage}%",
                            "tempo": f"{avg_rep_time}s",
                            "consistency": rep_consistency,
                            "coach_feedback": feedback,
                            "graph_data": graph_data,
                            "target_angle": target_angle
                        }
                    })
                break
                
            if "setup" in data:
                exercise_name = data["exercise"]
                rules = copy.deepcopy(exercises_db.get(exercise_name))
                if rules:
                    if exercise_name in session_overrides:
                        rules['fsm_rules']['target_threshold'] = session_overrides[exercise_name]
                    tracker = LiveTracker(exercise_rules=rules)
                    tracker.exercise_key = exercise_name
                    await websocket.send_json({"status": "ready"})
                else:
                    await websocket.send_json({"error": "Exercise not found"})
                continue
                
            if not tracker:
                continue

            # Process the image frame
            frame_data = data["frame"]
            timestamp_ms = data.get("timestamp_ms", 0)
            
            encoded_data = frame_data.split(',')[1]
            nparr = np.frombuffer(base64.b64decode(encoded_data), np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

            skeleton_coords, current_state, rep_count, all_reps_data = tracker.process_frame(frame, timestamp_ms)

            # Send live stats immediately back
            await websocket.send_json({
                "coordinates": skeleton_coords,
                "rep_count": rep_count,
                "state": current_state
            })

    except WebSocketDisconnect:
        print("WebSocket disconnected. User finished the set or closed the camera.")


@app.websocket("/ws/haruhi")
async def websocket_haruhi_endpoint(websocket: WebSocket):
    await websocket.accept()
    tracker = None
    rules = exercises_db.get("haruhi")
    
    if rules:
        from services.haruhi import DanceTracker
        tracker = DanceTracker(rules)
    else:
        await websocket.close()
        return

    try:
        while True:
            data = await websocket.receive_json()
            
            if "command" in data and data["command"] == "stop":
                final_score_to_send = 0.0
                if tracker and tracker.data_log:
                    import pandas as pd
                    from services.analyzer import evaluate_rep_df
                    from scipy.signal import savgol_filter
                    
                    df = pd.DataFrame(tracker.data_log)
                    template_csv = rules.get('template_csv')
                    df_template = None
                    if template_csv and os.path.exists(template_csv):
                        df_template = pd.read_csv(template_csv)
                        
                    dtw_scores = []
                    
                    if df_template is not None and len(df) >= 3:
                        for hinge_name in rules['hinges'].keys():
                            col_name = f"{hinge_name}_angle"
                            if col_name in df.columns:
                                try:
                                    window = min(15, len(df))
                                    if window > 3 and window % 2 == 0: window -= 1
                                    if window > 3:
                                        df[col_name + "_smooth"] = savgol_filter(df[col_name], window_length=window, polyorder=2)
                                    else:
                                        df[col_name + "_smooth"] = df[col_name]
                                except:
                                    df[col_name + "_smooth"] = df[col_name]
                        
                        rep_score, _ = evaluate_rep_df(df, df_template, rules, generate_graph=False)
                        if rep_score > 0:
                            dtw_scores.append(rep_score)
                            
                    final_score = 0
                    if dtw_scores:
                        final_score = sum(dtw_scores) / len(dtw_scores)
                        
                    # Calculate a final score out of 100
                    accuracy_percentage = max(0, min(100, 100 - (final_score * 4)))
                    final_score_to_send = round(accuracy_percentage, 1)
                
                await websocket.send_json({
                    "type": "summary",
                    "score": final_score_to_send
                })
                break
                
            if "command" in data and data["command"] == "start_recording":
                if tracker:
                    tracker.is_recording = True
                continue
                
            frame_b64 = data.get("frame")
            timestamp_ms = data.get("timestamp_ms", 0)
            
            if frame_b64 and tracker:
                skeleton_coords, current_state = tracker.process_frame(frame_b64, timestamp_ms)
                
                await websocket.send_json({
                    "type": "update",
                    "skeleton": skeleton_coords,
                    "state": current_state
                })
                
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WS Haruhi Error: {e}")


@app.get("/stats")
def get_stats():
    return load_stats()

@app.post("/clear_stats")
def clear_stats():
    stats = {"workouts": 0, "total_reps": 0, "average_score": 0.0, "calories": 0.0}
    with open(STATS_FILE, "w") as f:
        json.dump(stats, f)
    return {"status": "cleared"}

@app.post("/analyze")
async def analyze_video(
    video: UploadFile = File(...), 
    exercise_name: str = Form(...)
):
    print(f"Received video for {exercise_name}")
    
    # 1. Save the uploaded video temporarily
    temp_video_path = f"static/temp_{video.filename}"
    file_name_no_ext = os.path.splitext(video.filename)[0]
    output_csv_path = f"static/temp_{file_name_no_ext}.csv"
    
    with open(temp_video_path, "wb") as buffer:
        shutil.copyfileobj(video.file, buffer)

    try:
        rules = copy.deepcopy(exercises_db.get(exercise_name))
        if not rules:
            raise ValueError(f"Exercise '{exercise_name}' not found in configs/exercises.json")
            
        if exercise_name in session_overrides:
            rules['fsm_rules']['target_threshold'] = session_overrides[exercise_name]

        # 2. Run Vision & FSM Math
        reps_completed, lowest_angle, skeleton_data, fps, all_reps_data = extract_kinematics(
            video_path=temp_video_path,
            output_csv=output_csv_path,
            exercise_rules=rules,
            model_path='data/models/pose_landmarker.task',
            display_video=False
        )
        
        target_angle = rules['fsm_rules']['target_threshold']
        start_angle = rules['fsm_rules']['start_threshold']
        
        # --- NEW: DTW EVALUATION ---
        df_full = pd.read_csv(output_csv_path)
        data_log_full = df_full.to_dict('records')
        dtw_score, graph_data = build_multi_rep_dtw(
            data_log_full, all_reps_data, rules, rules.get('template_csv')
        )
        
        rep_consistency = "N/A"
        # Gamification: Calculate score out of 10
        degrees_off = abs(lowest_angle - target_angle)
        penalty = degrees_off / 5
        score = max(0, min(10, 10 - penalty)) 
        score_rounded = round(score, 1)

        # Stat A: ROM Percentage
        total_possible_degrees = abs(start_angle - target_angle)
        degrees_moved = abs(start_angle - lowest_angle)
        rom_percentage = 0
        if total_possible_degrees > 0:
            rom = (degrees_moved / total_possible_degrees) * 100
            rom_percentage = round(min(100, rom))

        # Stat B: Time Under Tension (Avg Rep Time)
        avg_rep_time = 0
        if all_reps_data and len(all_reps_data) > 0:
            total_time_ms = 0
            for rep_data in all_reps_data:
                if len(rep_data) > 0:
                    rep_start_ms = rep_data[0]['timestamp_ms']
                    rep_end_ms = rep_data[-1]['timestamp_ms']
                    total_time_ms += (rep_end_ms - rep_start_ms)
            avg_rep_time = round((total_time_ms / len(all_reps_data)) / 1000.0, 1)
            
        trigger_key = rules['fsm_rules']['primary_trigger']
        angle_key = f"{trigger_key}_angle"
        
        if len(all_reps_data) >= 2:
            try:
                first_rep_lowest = min([f.get(angle_key, 0) for f in all_reps_data[0] if angle_key in f])
                last_rep_lowest = min([f.get(angle_key, 0) for f in all_reps_data[-1] if angle_key in f])
                diff = abs(first_rep_lowest - last_rep_lowest)
                
                if diff < 5:
                    rep_consistency = "Consistent form maintained."
                else:
                    rep_consistency = f"Form shifted by {round(diff)}° on final rep."
            except Exception:
                pass
        
        # 3. Ask Groq for the feedback
        feedback, tool_action = generate_coach_feedback(
            exercise_name=rules["name"],
            reps_completed=reps_completed,
            lowest_angle=lowest_angle,
            target_angle=target_angle,
            score=score_rounded,
            tempo=avg_rep_time,
            consistency=rep_consistency,
            dtw_score=round(dtw_score, 1) if type(dtw_score) == float else dtw_score
        )
        
        if tool_action:
            session_overrides[exercise_name] = tool_action["new_target_angle"]

        # Save persistent stats for uploaded videos too
        save_stats(rules["name"], reps_completed, score_rounded)

        # 4. Clean up the temp video
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)

        # 5. Send the JSON response back to React!
        return {
            "status": "success",
            "exercise": rules["name"],
            "reps": reps_completed,
            "lowest_angle": lowest_angle,
            "score": score_rounded,
            "rom": f"{rom_percentage}%",
            "tempo": f"{avg_rep_time}s",
            "consistency": rep_consistency,
            "coach_feedback": feedback,
            "skeleton_data": skeleton_data,
            "fps": fps,
            "graph_data": graph_data,
            "target_angle": target_angle
        }

    except Exception as e:
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        return {"status": "error", "message": str(e)}
