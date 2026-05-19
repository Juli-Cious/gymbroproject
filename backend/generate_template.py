import os
import json
from services.vision import extract_kinematics

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
    print("--- BUILDING THE GOLDEN STANDARD ---")
    # Ask the user which exercise they want to create a template for
    exercise_key = input("Which exercise do you want to create a template for? (e.g., squat): ").strip().lower()
    
    # Load the specific rules for that exercise
    rules = load_config(exercise_key)
    
    # Set the template video and CSV paths based on the exercise key
    TEMPLATE_VIDEO = rules["template_video"]
    TEMPLATE_CSV = rules["template_csv"]

    # We call our modular function, passing in the template paths!
    extract_kinematics(TEMPLATE_VIDEO, TEMPLATE_CSV, rules)
    print("\n✅ Template CSV successfully generated and saved to data/templates/")

if __name__ == "__main__":
    main()