import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from fastdtw import fastdtw

def evaluate_rep(user_csv, template_csv, rules, threshold=15.0, generate_graph=True):
    try:
        df_template = pd.read_csv(template_csv)
        df_user = pd.read_csv(user_csv)
    except FileNotFoundError:
        print("Error: Could not find CSV files.")
        return 0.0, {}
    
    return evaluate_rep_df(df_user, df_template, rules, generate_graph=generate_graph)

def evaluate_rep_df(df_user, df_template, rules, generate_graph=True, threshold=15.0):
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
        return 0.0, {}

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

    if not generate_graph:
        return total_score, hinge_results

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
    if generate_graph:
        plt.show()
        
    return total_score, hinge_results

def build_multi_rep_dtw(data_log_full, all_reps_data, rules, template_csv):
    from scipy.signal import savgol_filter
    import os
    
    df_template = None
    if template_csv and os.path.exists(template_csv):
        df_template = pd.read_csv(template_csv)
        
    trigger_key = rules['fsm_rules']['primary_trigger']
    angle_key = f"{trigger_key}_angle"
    
    dtw_scores = []
    graph_data = []
    
    if data_log_full:
        start_time = data_log_full[0].get("timestamp_ms", 0)
        for f in data_log_full:
            if angle_key in f:
                graph_data.append({
                    "time": round((f["timestamp_ms"] - start_time) / 1000.0, 1),
                    "angle": round(f[angle_key], 1),
                    "template_angle": None,
                    "timestamp_ms": f["timestamp_ms"]
                })
                
    if df_template is not None and all_reps_data:
        for rep_frames in all_reps_data:
            if len(rep_frames) < 3: continue
            
            df_rep = pd.DataFrame(rep_frames)
            for hinge_name in rules['hinges'].keys():
                col_name = f"{hinge_name}_angle"
                if col_name in df_rep.columns:
                    try:
                        window = min(15, len(df_rep))
                        if window > 3 and window % 2 == 0: window -= 1
                        if window > 3:
                            df_rep[col_name + "_smooth"] = savgol_filter(df_rep[col_name], window_length=window, polyorder=2)
                        else:
                            df_rep[col_name + "_smooth"] = df_rep[col_name]
                    except:
                        df_rep[col_name + "_smooth"] = df_rep[col_name]
            
            rep_score, hinge_results = evaluate_rep_df(df_rep, df_template, rules, generate_graph=False)
            if rep_score > 0:
                dtw_scores.append(rep_score)
            
            if trigger_key in hinge_results:
                hr = hinge_results[trigger_key]
                user_angles = hr['user']
                template_angles = hr['template']
                path = hr['path']
                
                aligned_template = [None] * len(user_angles)
                for u_idx, t_idx in path:
                    if aligned_template[u_idx] is None:
                        aligned_template[u_idx] = template_angles[t_idx]
                
                for i, u_angle in enumerate(user_angles):
                    frame_ts = df_rep.iloc[i]['timestamp_ms']
                    for p in graph_data:
                        if p.get("timestamp_ms") == frame_ts:
                            if aligned_template[i] is not None:
                                p["template_angle"] = round(aligned_template[i], 1)
                            break
                            
    for p in graph_data:
        if "timestamp_ms" in p:
            del p["timestamp_ms"]
            
    final_score = 0.0
    if dtw_scores:
        final_score = sum(dtw_scores) / len(dtw_scores)
        
    return final_score, graph_data