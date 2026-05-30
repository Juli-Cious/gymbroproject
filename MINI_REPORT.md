# WIF3009 Group Project 10: Gym Bro Form Check

**Conversational Biomechanical Coaching**

## 1. Project Background

Kinematic analysis of human movement is historically restricted to laboratory environments. Applying computer vision to standard RGB video democratizes biomechanical feedback. 

Our spatial-temporal analysis project tracks anatomical landmarks during resistance training. A virtual coaching agent computes joint angles to classify movement deviations, extracting stable coordinate data from video and applying geometric thresholds. The integrated AI agent interprets these metrics and provides continuous, conversational feedback regarding execution quality.

## 2. Vision-Spatial Matrix Location (Stage 1 & 2)

The application utilizes **Google MediaPipe Pose Landmarker** to extract 33 3D anatomical landmarks from a standard 2D RGB video feed (webcam or MP4 file) in real-time. 

- The system enforces a **Camera Alignment Gatekeeper** that validates the presence and confidence thresholds of required coordinate landmarks before tracking initiates, ensuring the user is fully in-frame.
- We bypass clean static datasets by processing live, noisy spatial matrices from standard web browsers.

## 3. Mathematical Models & Signal Processing

### Coordinate Extraction

Joint angles are calculated dynamically in 3D space using the dot product of two vectors originating at the hinge joint.
The trigonometric function used is:
$$\theta = \arccos\left(\frac{\vec{u} \cdot \vec{v}}{\|\vec{u}\| \|\vec{v}\|}\right)$$

### Savitzky-Golay Signal Smoothing

Because live webcam predictions contain jitter, the raw angle arrays are passed through a **Savitzky-Golay filter** (`scipy.signal.savgol_filter`) with a 2nd-order polynomial. This isolates the underlying biomechanical movement curve from the high-frequency computer vision noise.

### Dynamic Time Warping (DTW)

To evaluate the user's tempo and cadence against a "Golden Standard" perfect rep, the system employs **Fast Dynamic Time Warping**. This algorithm intelligently stretches or compresses the perfect rep's temporal timeline to map against the user's execution speed, yielding a time-independent similarity cost (Error Score).

## 4. XAI & Forensics / Classification Report (Stage 4)

The application avoids opaque black-box AI feedback by mathematically justifying all scores through an **Explainable AI (XAI) & Forensics Dashboard**:

- **Statistical Similarity Coefficients**: The DTW path is used to calculate the Root-Mean-Square Error (RMSE) and Cosine Similarity, measuring the exact structural deviation between the user and the standard.
- **Pearson Correlation ($r$)**: Evaluates the timing and rhythm synchronization.
- **Classification Accuracy & Form Deviations**: A heuristic classifier evaluates the depth of each rep against the golden standard, specifically classifying form breakdowns such as *Shallow Depth / Incomplete ROM* or *Excessive ROM / Over-extension*. The overall classification accuracy validates the spatial metrics and is rendered on the post-workout dashboard.

## 5. Production Deployment (Stage 3)

The entire application (FastAPI backend + React/Vite frontend) is fully containerized using **Docker**. The architecture ensures reliable execution across environments by isolating required Linux graphics rendering libraries (e.g., `libgles2`, `libegl1`) needed for MediaPipe headless execution.

## 6. Agentic Biomechanical Coach

The final biomechanical metrics (DTW score, Classification Accuracy, Rep Consistency, Tempo) are ingested by an **Agentic AI Coach** powered by Groq's Llama 3 models. The LLM interprets the mathematical arrays and provides personalized, contextual, conversational feedback on the user's performance, effectively acting as an automated biomechanical expert.

- **Backend Resiliency**: The agent architecture implements lazy-loading and graceful error handling. If the external LLM API is unavailable (e.g., missing API keys or network failure), the server degrades gracefully—continuing to deliver real-time computer vision and XAI forensics without crashing the tracking loop.
- **Autonomous Tool Use (Dynamic Difficulty Scaling)**: To support adaptive coaching, the AI coach has autonomous tool-use capabilities. If the user's computed form score falls below `5/10` for two consecutive sets on the same exercise, the LLM autonomously invokes the `adjust_exercise_difficulty` tool. This dynamically modifies the FSM's target range of motion (ROM) threshold (e.g. from `100°` to `115°`) to make the goal more achievable.

## 7. Persistent Gamification & History Timeline

To track physical progression over time, the application incorporates a local tracking database.
- **Local Data Persistence**: Summaries of completed sets (including date, exercise name, reps completed, form score, and calories burned) are saved to a structured JSON file (`backend/data/user_stats.json`).
- **Interactive Lifetime Dashboard**: The React homepage displays an interactive lifetime dashboard that aggregates overall stats (average score, total reps, total workouts, calories) and displays a scrollable, color-coded timeline feed of past workouts.

## 8. Architectural Deviations & Justifications

In alignment with the curriculum's flexible guidelines, we opted for two superior architectural alternatives to maximize real-time performance:
1. **Groq Llama 3 vs. Ollama**: WebSockets require ultra-low latency inference to maintain the illusion of a live conversational coach. We elected to use Groq's Llama 3 cloud inference over a local Ollama instance, as Groq's specialized LPU architecture provides near-instantaneous token generation that a local machine cannot match.
2. **Algorithmic Kinematics vs. Kinetics-700 Datasets**: Rather than training a heavy, opaque Deep Learning action-recognition model on the Kinetics-700 dataset, we adopted a purely mathematical approach. By combining trigonometric coordinate extraction with Fast Dynamic Time Warping (DTW) mapped against manually curated CSV reference clips, we achieved a transparent, zero-shot assessment engine that mathematically justifies its classifications without the massive compute overhead of a CNN.
