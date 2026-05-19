from fastapi import FastAPI, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import shutil
import os
import json
import base64
import cv2
import numpy as np
from fastapi.middleware.cors import CORSMiddleware

# Import your custom functions!
from services.vision import extract_kinematics, LiveTracker
from services.agent import generate_coach_feedback

app = FastAPI(title="Hercules AI Engine")

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Load exercise rules
with open("configs/exercises.json", "r") as f:
    exercises_db = json.load(f)

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
            
            if "setup" in data:
                exercise_name = data["exercise"]
                rules = exercises_db.get(exercise_name)
                if rules:
                    tracker = LiveTracker(exercise_rules=rules)
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
        # We could send final stats to Groq here if we wanted to process it post-set


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
        rules = exercises_db.get(exercise_name)
        if not rules:
            raise ValueError(f"Exercise '{exercise_name}' not found in configs/exercises.json")

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

        # Stat C: Rep Consistency
        trigger_key = rules['fsm_rules']['primary_trigger']
        angle_key = f"{trigger_key}_angle"
        
        rep_consistency = "N/A"
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
        feedback = generate_coach_feedback(
            exercise_name=rules["name"],
            reps_completed=reps_completed,
            lowest_angle=lowest_angle,
            target_angle=target_angle,
            score=score_rounded
        )

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
            "fps": fps
        }

    except Exception as e:
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        return {"status": "error", "message": str(e)}
