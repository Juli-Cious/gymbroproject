import json
import os
from services.vision import extract_kinematics
from services.analyzer import evaluate_rep

# Load exercise configuration
def load_config(exercise_key):
    """Read JSON rulebook and returns specifc exercise rules."""
    with open('configs/exercises.json', 'r') as f:
        config = json.load(f)

    if exercise_key not in config:
        print(f"Error: '{exercise_key}' not found in config. Check your JSON file.")
        exit()

    return config[exercise_key]

def main():
    print("=== HERCULES AI ===")
    
    # 1. Ask the user what they want to test
    exercise_key = input("What exercise are we testing? (e.g., squat): ").strip().lower()
    
    # 2. Load the specific rules for that exercise
    rules = load_config(exercise_key)
    
    # 3. Dynamically set the file paths based on the user's input!
    USER_VIDEO = f'data/testing_videos/user_{exercise_key}.mp4'
    USER_CSV = f'data/user_{exercise_key}_angles.csv'
    TEMPLATE_CSV = rules["template_csv"]

    # Safety check: Did you actually put the video in the folder?
    if not os.path.exists(USER_VIDEO):
        print(f"❌ Error: Could not find user video at {USER_VIDEO}")
        print(f"Please rename your video to 'user_{exercise_key}.mp4' and put it in data/testing_videos/")
        return

    print(f"\n💪 Loading rules for: {rules['name']}")
    
    # --- The Pipeline ---
    # (Notice how we don't hardcode anything anymore!)
    extract_kinematics(USER_VIDEO, USER_CSV, rules)
    evaluate_rep(USER_CSV, TEMPLATE_CSV, rules)

if __name__ == "__main__":
    main()