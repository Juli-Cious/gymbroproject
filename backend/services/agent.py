import os
from groq import Groq
from dotenv import load_dotenv

# Load the environment variables from the .env file automatically
load_dotenv()

# The system reads the API key from your computer's environment variables (SAFE!)
client = Groq(
    api_key=os.environ.get("GROQ_API_KEY"),
)

import json
import re

WORKOUT_MEMORY = []

def generate_coach_feedback(exercise_name, reps_completed, lowest_angle, target_angle, score, tempo=None, consistency=None, dtw_score=None):
    """
    Sends the user's biomechanical FSM data to Groq (Llama 3) for real-time feedback.
    Features Autonomous Analysis, Memory, and Tool Use.
    """
    print(f"Sending {exercise_name} data to Groq Llama 3...")
    
    # The System Prompt: Strict rules for how Hercules talks and when to use tools.
    system_prompt = """You are Hercules AI, an elite, intense strength coach.
    RULE 1: NEVER mention specific numbers, degrees, or angles in your response. 
    RULE 2: Keep it to 2 punchy, highly motivating sentences. Speak directly to the user (e.g., 'Bro', 'Man').
    RULE 3: Analyze the provided math data autonomously. If their score is low, tell them exactly what physical cue to change.
    RULE 4: If the user scores below 5/10 for TWO CONSECUTIVE SETS on the same exercise, YOU MUST call the 'adjust_exercise_difficulty' tool to make the target angle easier (add or subtract 10-15 degrees to make it require less flexibility).
    RULE 5: If a DTW Cadence Error is provided and is greater than 15, their tempo/cadence is out of sync with a mathematically perfect rep! Instruct them to fix their pacing."""

    # Format memory for context
    memory_context = "No previous sets in this session."
    if WORKOUT_MEMORY:
        recent_sets = WORKOUT_MEMORY[-3:]
        memory_context = json.dumps(recent_sets, indent=2)

    user_prompt = f"""
    Exercise: {exercise_name}
    Math Data for Current Set:
    - Target Angle: {target_angle}
    - Extreme Angle Achieved: {lowest_angle}
    - Calculated Score: {score}/10
    - Reps: {reps_completed}
    - Tempo: {tempo}s
    - Consistency: {consistency}
    - DTW Cadence Error: {dtw_score}
    
    Past Workout Memory:
    {memory_context}
    
    Give the user their coaching feedback now based on this analysis. Always mention their score in your hype.
    """

    tools = [
        {
            "type": "function",
            "function": {
                "name": "adjust_exercise_difficulty",
                "description": "Adjust the target angle for an exercise to make it easier for the user if they are struggling (e.g. score < 5 for multiple sets).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "new_target_angle": {
                            "type": "integer",
                            "description": "The new target angle in degrees."
                        }
                    },
                    "required": ["new_target_angle"]
                }
            }
        }
    ]

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]

    tool_action = None

    try:
        chat_completion = client.chat.completions.create(
            messages=messages,
            model="llama-3.3-70b-versatile",
            temperature=0.7,
            max_tokens=250,
            tools=tools,
            tool_choice="auto"
        )
        
        response_message = chat_completion.choices[0].message
        
        if response_message.tool_calls:
            for tool_call in response_message.tool_calls:
                if tool_call.function.name == "adjust_exercise_difficulty":
                    args = json.loads(tool_call.function.arguments)
                    tool_action = {"new_target_angle": args.get("new_target_angle")}
                    
            messages.append(response_message)
            messages.append({
                "role": "tool",
                "tool_call_id": response_message.tool_calls[0].id,
                "name": "adjust_exercise_difficulty",
                "content": json.dumps({"status": "success", "message": "Target angle updated in session memory."})
            })
            
            final_completion = client.chat.completions.create(
                messages=messages,
                model="llama-3.3-70b-versatile",
                temperature=0.7,
                max_tokens=150
            )
            feedback = final_completion.choices[0].message.content
        else:
            feedback = response_message.content
            # Fallback for Groq tool hallucination where it outputs the tool as text
            match = re.search(r"<function=adjust_exercise_difficulty>(.*?)</function>", feedback)
            if match:
                try:
                    args = json.loads(match.group(1))
                    tool_action = {"new_target_angle": args.get("new_target_angle")}
                    feedback = re.sub(r"<function=adjust_exercise_difficulty>.*?</function>", "", feedback).strip()
                except Exception:
                    pass

        # Save to memory
        WORKOUT_MEMORY.append({
            "exercise": exercise_name,
            "score": score,
            "target_angle": target_angle,
            "extreme_angle": lowest_angle
        })

        return feedback, tool_action

    except Exception as e:
        return f"Error contacting Hercules AI Brain: {e}", None

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
