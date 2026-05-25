import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import pandas as pd
from scipy.signal import savgol_filter

# Import the pure math from your core folder
from core.math_utils import calculate_3d_angle
from core.fsm import HerculesFSM

# --- 1. EXPANDED LANDMARK DICTIONARY ---
LANDMARK_MAP = {
    "right_shoulder": 12, "left_shoulder": 11,
    "right_elbow": 14, "left_elbow": 13,
    "right_wrist": 16, "left_wrist": 15,
    "right_hip": 24, "left_hip": 23,
    "right_knee": 26, "left_knee": 25,
    "right_ankle": 28, "left_ankle": 27,
    # Defaults just in case your JSON doesn't specify left/right
    "shoulder": 12, "elbow": 14, "wrist": 16,
    "hip": 24, "knee": 26, "ankle": 28
}

class LiveTracker:
    def __init__(self, exercise_rules, model_path='data/models/pose_landmarker.task'):
        self.exercise_rules = exercise_rules
        self.fsm = HerculesFSM(exercise_rules)
        self.reps_completed = 0
        self.all_reps_data = []
        self.data_log = []
        
        base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.VIDEO
        )
        self.detector = vision.PoseLandmarker.create_from_options(options)

    def process_frame(self, frame, timestamp_ms):
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        
        detection_result = self.detector.detect_for_video(mp_image, timestamp_ms)

        frame_skeleton = []
        state = self.fsm.current_state

        if detection_result.pose_landmarks:
            landmarks = detection_result.pose_landmarks[0]
            world_landmarks = detection_result.pose_world_landmarks[0]
            
            frame_data = {'timestamp_ms': timestamp_ms}
            
            for hinge_name, joints in self.exercise_rules['hinges'].items():
                idx1, idx2, idx3 = LANDMARK_MAP[joints[0]], LANDMARK_MAP[joints[1]], LANDMARK_MAP[joints[2]]
                
                frame_skeleton.append([
                    {"x": landmarks[idx1].x, "y": landmarks[idx1].y},
                    {"x": landmarks[idx2].x, "y": landmarks[idx2].y},
                    {"x": landmarks[idx3].x, "y": landmarks[idx3].y}
                ])

                p1 = [world_landmarks[idx1].x, world_landmarks[idx1].y, world_landmarks[idx1].z]
                p2 = [world_landmarks[idx2].x, world_landmarks[idx2].y, world_landmarks[idx2].z]
                p3 = [world_landmarks[idx3].x, world_landmarks[idx3].y, world_landmarks[idx3].z]
                angle = calculate_3d_angle(p1, p2, p3)
                
                frame_data[f"{hinge_name}_angle"] = angle

            trigger_key = self.exercise_rules['fsm_rules']['primary_trigger']
            trigger_angle = frame_data[f"{trigger_key}_angle"]
            
            frame_data['fsm_state'] = self.fsm.current_state 
            
            rep_finished, rep_data = self.fsm.update(trigger_angle, frame_data)
            
            if rep_finished:
                self.reps_completed += 1
                self.all_reps_data.append(rep_data)
                
            state = self.fsm.current_state
            self.data_log.append(frame_data)
            
            return frame_skeleton, state, self.reps_completed, self.all_reps_data
            
        return frame_skeleton, state, self.reps_completed, self.all_reps_data


def extract_kinematics(video_path, output_csv, exercise_rules, model_path='data/models/pose_landmarker.task', display_video=True):
    print(f"Extracting 3D Kinematics from {video_path}...")

    fsm = HerculesFSM(exercise_rules)
    
    # Joints and indices are now loaded dynamically per frame inside the loop

    base_options = python.BaseOptions(model_asset_path=model_path)
    options = vision.PoseLandmarkerOptions(
        base_options=base_options,
        running_mode=vision.RunningMode.VIDEO
    )
    detector = vision.PoseLandmarker.create_from_options(options)

    cap = cv2.VideoCapture(video_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    delay = int(1000 / fps) if fps > 0 else 33

    data_log = []
    skeleton_data = []
    all_reps_data = []
    reps_completed = 0

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        frame_timestamp_ms = int(cap.get(cv2.CAP_PROP_POS_MSEC))
        
        detection_result = detector.detect_for_video(mp_image, frame_timestamp_ms)

        if detection_result.pose_landmarks:
            landmarks = detection_result.pose_landmarks[0]
            world_landmarks = detection_result.pose_world_landmarks[0]
            
            # --- DYNAMIC 3D MATH & DRAWING ---
            frame_data = {'timestamp_ms': frame_timestamp_ms}
            frame_skeleton = []
            
            # Loop through however many hinges are defined in the JSON!
            for hinge_name, joints in exercise_rules['hinges'].items():
                
                # 1. Look up the MediaPipe IDs
                idx1, idx2, idx3 = LANDMARK_MAP[joints[0]], LANDMARK_MAP[joints[1]], LANDMARK_MAP[joints[2]]
                
                # 2. Draw them on the screen (Dynamic lines for everything!)
                if display_video:
                    h, w, _ = frame.shape
                    p1_2d = (int(landmarks[idx1].x * w), int(landmarks[idx1].y * h))
                    p2_2d = (int(landmarks[idx2].x * w), int(landmarks[idx2].y * h))
                    p3_2d = (int(landmarks[idx3].x * w), int(landmarks[idx3].y * h))
                    cv2.line(frame, p1_2d, p2_2d, (255, 255, 0), 3)
                    cv2.line(frame, p2_2d, p3_2d, (255, 255, 0), 3)
                    cv2.circle(frame, p1_2d, 5, (0, 255, 0), -1)
                    cv2.circle(frame, p2_2d, 5, (0, 255, 0), -1)
                    cv2.circle(frame, p3_2d, 5, (0, 255, 0), -1)

                # Save normalized coordinates for React frontend canvas
                frame_skeleton.append([
                    {"x": landmarks[idx1].x, "y": landmarks[idx1].y},
                    {"x": landmarks[idx2].x, "y": landmarks[idx2].y},
                    {"x": landmarks[idx3].x, "y": landmarks[idx3].y}
                ])

                # 3. Calculate 3D Math
                p1 = [world_landmarks[idx1].x, world_landmarks[idx1].y, world_landmarks[idx1].z]
                p2 = [world_landmarks[idx2].x, world_landmarks[idx2].y, world_landmarks[idx2].z]
                p3 = [world_landmarks[idx3].x, world_landmarks[idx3].y, world_landmarks[idx3].z]
                angle = calculate_3d_angle(p1, p2, p3)
                
                # 4. Save it dynamically to the dictionary (e.g. 'right_knee_angle')
                frame_data[f"{hinge_name}_angle"] = angle

            # --- THE FSM HOOK ---
            # Ask the JSON which angle is the trigger (e.g. "right_knee")
            trigger_key = exercise_rules['fsm_rules']['primary_trigger']
            trigger_angle = frame_data[f"{trigger_key}_angle"]
            
            frame_data['fsm_state'] = fsm.current_state 
            
            # Feed the FSM the specific angle it needs to count reps
            rep_finished, rep_data = fsm.update(trigger_angle, frame_data)
            
            if rep_finished:
                reps_completed += 1
                all_reps_data.append(rep_data)
                print(f"🔥 REP {reps_completed} COMPLETED! (Captured {len(rep_data)} frames)")

            data_log.append(frame_data)
            skeleton_data.append({
                "hinges": frame_skeleton,
                "state": fsm.current_state
            })
        else:
            skeleton_data.append({
                "hinges": [],
                "state": "Resting" # fallback
            })

        # Setup display frame if needed
        if display_video:
            orig_h, orig_w, _ = frame.shape
            target_height = 800 
            target_width = int(orig_w * (target_height / orig_h))
            display_frame = cv2.resize(frame, (target_width, target_height))

            # HUD overlays
            cv2.putText(display_frame, f"State: {fsm.current_state}", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            cv2.putText(display_frame, f"Reps: {reps_completed}", (20, 90), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
        
            y_pos = 130
            if data_log:
                latest_data = data_log[-1]
                for hinge_name in exercise_rules['hinges'].keys():
                    angle_val = latest_data.get(f"{hinge_name}_angle", 0)
                    cv2.putText(display_frame, f"{hinge_name.replace('_', ' ').title()}: {int(angle_val)}", (20, y_pos), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 0), 2)
                    y_pos += 40
            else:
                y_pos += 80

            cv2.putText(display_frame, "Press 'P' to Pause/Step | 'Q' to Quit", (20, y_pos + 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

        if display_video:
            cv2.imshow('Hercules AI - Tracker', display_frame)
            
            key = cv2.waitKey(delay) & 0xFF
            if key == ord('q'): 
                break
            elif key == ord('p'): 
                cv2.waitKey(-1)

    cap.release()
    cv2.destroyAllWindows()

    # --- Data Saving ---
    df = pd.DataFrame(data_log)
    if not df.empty:
        # Loop through whatever hinges we tracked and smooth them all!
        for hinge_name in exercise_rules['hinges'].keys():
            col_name = f"{hinge_name}_angle"
            df[f"{col_name}_smooth"] = savgol_filter(df[col_name], 11, 3)
            
        df.to_csv(output_csv, index=False)
        print(f"Saved smoothed data to {output_csv}")
        
        # Find global lowest angle for the primary trigger
        trigger_key = exercise_rules['fsm_rules']['primary_trigger']
        col_name = f"{trigger_key}_angle_smooth"
        
        if col_name in df.columns:
            lowest_angle = df[col_name].min()
        else:
            lowest_angle = df[f"{trigger_key}_angle"].min()
            
        return reps_completed, float(lowest_angle), skeleton_data, fps, all_reps_data
    else:
        print("Error: No landmarks detected.")
        return 0, 0.0, [], fps, []