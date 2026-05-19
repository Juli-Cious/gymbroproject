class HerculesFSM:
    def __init__(self, exercise_rules):
        self.rules = exercise_rules['fsm_rules']
        self.start_thresh = self.rules['start_threshold']
        self.target_thresh = self.rules['target_threshold']
        
        # --- THE GRAVITY AUTO-DETECTOR ---
        # If start is higher than target, we go down first (Squat). Otherwise, up first (Deadlift).
        self.flexion_first = self.start_thresh > self.target_thresh
        
        self.current_state = "RESTING"
        self.hit_depth = False
        self.rep_data = []

    def update(self, angle, frame_data):
        rep_finished = False
        self.rep_data.append(frame_data)
        
        # --- PATH A: SQUATS, PUSH-UPS, CURLS (Start High -> Target Low -> Start High) ---
        if self.flexion_first:
            if self.current_state == "RESTING":
                if angle < (self.start_thresh - 10):
                    self.current_state = "ACTIVE"
                    self.rep_data = self.rep_data[-10:]  # Keep only the start of the movement
            elif self.current_state == "ACTIVE":
                if angle <= self.target_thresh:
                    self.hit_depth = True
                
                # Return to start
                if angle >= self.start_thresh:
                    if self.hit_depth:
                        rep_finished = True
                    self.current_state = "RESTING"
                    self.hit_depth = False
                    
        # --- PATH B: DEADLIFTS, PULL-UPS (Start Low -> Target High -> Start Low) ---
        else:
            if self.current_state == "RESTING":
                if angle > (self.start_thresh + 10):
                    self.current_state = "ACTIVE"
                    self.rep_data = self.rep_data[-10:]  # Keep only the start of the movement
            elif self.current_state == "ACTIVE":
                if angle >= self.target_thresh:
                    self.hit_depth = True
                
                # Return to start
                if angle <= self.start_thresh:
                    if self.hit_depth:
                        rep_finished = True
                    self.current_state = "RESTING"
                    self.hit_depth = False

        if rep_finished:
            captured_rep = self.rep_data.copy()
            self.rep_data = []
            return True, captured_rep
            
        # Prevent memory leaks while resting
        if self.current_state == "RESTING":
            self.rep_data = self.rep_data[-10:]
            
        return False, []