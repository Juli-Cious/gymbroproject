import os
from groq import Groq
from dotenv import load_dotenv

# Load the environment variables from the .env file automatically
load_dotenv()

# The system reads the API key from your computer's environment variables (SAFE!)
client = Groq(
    api_key=os.environ.get("GROQ_API_KEY"),
)

def generate_coach_feedback(exercise_name, reps_completed, lowest_angle, target_angle, score):
    """
    Sends the user's biomechanical FSM data to Groq (Llama 3) for real-time feedback.
    """
    print(f"Sending {exercise_name} data to Groq Llama 3...")
    
    # The System Prompt: Strict rules for how Hercules talks.
    system_prompt = """You are Hercules AI, an elite, intense strength coach.
    RULE 1: NEVER mention specific numbers, degrees, or angles in your response. 
    RULE 2: Translate the math into actionable physical cues (e.g., 'Touch your chest to the floor', 'Lock out your elbows at the top', 'Drop your hips').
    RULE 3: Keep it to 2 punchy, highly motivating sentences. Speak directly to the user (e.g., 'Bro', 'Man')."""

    # Evaluate math here to generate a human-readable flaw description
    flaw = "Perfect form."
    if lowest_angle > target_angle + 15:
        flaw = "Quarter-reping. They are not going low enough at the bottom of the movement."
    elif lowest_angle > target_angle + 5:
        flaw = "Slightly high. They need to drop just a few inches deeper."
    elif lowest_angle < target_angle - 10:
        flaw = "Going too deep or over-extending slightly, losing tightness."

    # The User Prompt: We do the math translation for the AI!
    user_prompt = f"""
    Exercise: {exercise_name}
    Form Analysis: {flaw}
    Calculated Score: {score}/10
    
    Give the user their coaching feedback now based on this analysis. Always mention their score in your hype.
    """

    try:
        chat_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            model="llama-3.3-70b-versatile", # Using the latest supported Groq model
            temperature=0.7,
            max_tokens=150
        )
        return chat_completion.choices[0].message.content
    except Exception as e:
        return f"Error contacting Hercules AI Brain: {e}"

# --- QUICK TEST RUN ---
if __name__ == "__main__":
    feedback = generate_coach_feedback(
        exercise_name="Single-Arm Dumbbell Curl",
        reps_completed=1,
        lowest_angle=81.2,
        target_angle=60,
        score=5.8
    )
    print(f"\nHERCULES AI SAYS:\n{feedback}")
