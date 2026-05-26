import mediapipe as mp
import cv2
import numpy as np
import base64

from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from services.vision import LANDMARK_MAP, calculate_3d_angle

class DanceTracker:
    def __init__(self, exercise_rules, model_path='data/models/pose_landmarker.task'):
        self.rules = exercise_rules
        
        base_options = python.BaseOptions(model_asset_path=model_path)
        options = vision.PoseLandmarkerOptions(
            base_options=base_options,
            running_mode=vision.RunningMode.VIDEO
        )
        self.detector = vision.PoseLandmarker.create_from_options(options)
        self.data_log = []
        self.is_recording = False

    def process_frame(self, frame_b64, timestamp_ms):
        try:
            header, encoded = frame_b64.split(",", 1)
            data = base64.b64decode(encoded)
            np_arr = np.frombuffer(data, np.uint8)
            img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            
            rgb_frame = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
            
            detection_result = self.detector.detect_for_video(mp_image, int(timestamp_ms))
            
            frame_skeleton = []
            is_aligned = True
            
            if detection_result.pose_landmarks:
                landmarks = detection_result.pose_landmarks[0]
                world_landmarks = detection_result.pose_world_landmarks[0]
                
                frame_data = {'timestamp_ms': int(timestamp_ms)}
                
                for hinge_name, joints in self.rules['hinges'].items():
                    idx1, idx2, idx3 = LANDMARK_MAP[joints[0]], LANDMARK_MAP[joints[1]], LANDMARK_MAP[joints[2]]
                    
                    for idx in (idx1, idx2, idx3):
                        lm = landmarks[idx]
                        if lm.x < 0.01 or lm.x > 0.99 or lm.y < 0.01 or lm.y > 0.99:
                            is_aligned = False
                            
                    pt1, pt2, pt3 = world_landmarks[idx1], world_landmarks[idx2], world_landmarks[idx3]
                    angle = calculate_3d_angle(
                        (pt1.x, pt1.y, pt1.z),
                        (pt2.x, pt2.y, pt2.z),
                        (pt3.x, pt3.y, pt3.z)
                    )
                    
                    frame_data[f"{hinge_name}_angle"] = angle
                    
                    lm1, lm2, lm3 = landmarks[idx1], landmarks[idx2], landmarks[idx3]
                    frame_skeleton.append([
                        {'x': lm1.x, 'y': lm1.y, 'z': lm1.z},
                        {'x': lm2.x, 'y': lm2.y, 'z': lm2.z},
                        {'x': lm3.x, 'y': lm3.y, 'z': lm3.z}
                    ])
                    
                frame_data['is_aligned'] = is_aligned
                if self.is_recording:
                    self.data_log.append(frame_data)
                
                return frame_skeleton, "DANCING" if is_aligned else "ALIGNING"
        except Exception as e:
            print(f"Error processing frame: {e}")
            
        return [], "ALIGNING"
