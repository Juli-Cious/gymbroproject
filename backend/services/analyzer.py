import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from fastdtw import fastdtw

def evaluate_rep(user_csv, template_csv, rules, threshold=15.0):
    try:
        df_template = pd.read_csv(template_csv)
        df_user = pd.read_csv(user_csv)
    except FileNotFoundError:
        print("Error: Could not find CSV files.")
        return

    exercise_name = rules.get('name', 'EXERCISE').upper()
    print(f"\n=== HERCULES AI: {exercise_name} ANALYSIS ===")

    total_error = 0
    hinge_results = {}

    for hinge_name in rules['hinges'].keys():
        col_name = f"{hinge_name}_angle_smooth"
        
        if col_name not in df_template.columns or col_name not in df_user.columns:
            print(f"Warning: {col_name} missing from CSV files. Skipping.")
            continue
            
        h_template = df_template[col_name].dropna().values
        h_user = df_user[col_name].dropna().values

        if len(h_user) == 0 or len(h_template) == 0:
            print(f"Warning: No valid data for {hinge_name}. Skipping.")
            continue

        # Calculate DTW
        dist, path = fastdtw(h_user, h_template, dist=lambda a, b: abs(a - b))
        score = dist / len(path)
        total_error += score
        
        hinge_results[hinge_name] = {
            'template': h_template,
            'user': h_user,
            'score': score,
            'path': path
        }
        
        print(f"{hinge_name.replace('_', ' ').title()} Error Score:  {score:.2f}")

    if not hinge_results:
        print("Error: No valid hinges analyzed.")
        return

    total_score = total_error / len(hinge_results)
    print(f"Total Form Score:  {total_score:.2f}")

    # Heuristics & Specific Feedback
    issues_found = False
    for hinge_name, data in hinge_results.items():
        min_template = np.min(data['template'])
        min_user = np.min(data['user'])
        
        # Check for depth/collapse using a generic heuristic
        if min_user > (min_template + 15):
            print(f"\n❌ Verdict: BAD FORM! (Issue detected on {hinge_name.replace('_', ' ')})")
            print(f"Feedback: You are cutting it short. You only hit {min_user:.0f}°, but the template hit {min_template:.0f}°.")
            issues_found = True
        elif min_user < (min_template - 15):
            print(f"\n❌ Verdict: BAD FORM! (Issue detected on {hinge_name.replace('_', ' ')})")
            print(f"Feedback: You over-extended or collapsed. You hit {min_user:.0f}°, but the golden standard stayed at {min_template:.0f}°.")
            issues_found = True

    if not issues_found:
        if total_score > threshold:
            print("\n❌ Verdict: BAD FORM! Overall form breakdown/wobbles detected.")
        else:
            print("\n✅ Verdict: PERFECT FORM! Excellent execution.")

    # --- Visual Proof ---
    fig, axes = plt.subplots(len(hinge_results), 1, figsize=(10, 4 * len(hinge_results)))
    # Ensure axes is iterable even if there's only 1 subplot
    if len(hinge_results) == 1:
        axes = [axes]

    for ax, (hinge_name, data) in zip(axes, hinge_results.items()):
        h_template = data['template']
        h_user = data['user']
        path = data['path']

        # Draw light grey lines connecting the DTW matched points!
        # Step by a fraction of the path length so the graph doesn't become a solid gray block
        step = max(1, len(path) // 40)
        for u_idx, t_idx in path[::step]:
            ax.plot([t_idx, u_idx], [h_template[t_idx], h_user[u_idx]], color='gray', linestyle='-', alpha=0.4)

        ax.plot(h_template, label='Golden Standard', color='blue', linewidth=3)
        ax.plot(h_user, label='Gym Bro', color='red', linestyle='--', linewidth=3)
        
        ax.set_title(f"{hinge_name.replace('_', ' ').title()} DTW Alignment (Error: {data['score']:.2f})")
        ax.set_xlabel("Frames (Time)")
        ax.set_ylabel("Angle (Degrees)")
        ax.legend()
        ax.grid(True)

    plt.tight_layout()
    plt.show()