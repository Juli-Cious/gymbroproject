import { useState, useRef, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import HaruhiDance from './HaruhiDance';
import './App.css'

function App() {
  const [exercise, setExercise] = useState('squat')
  const [videoUrl, setVideoUrl] = useState(null)

  const [showSkeleton, setShowSkeleton] = useState(true)
  const showSkeletonRef = useRef(true)

  const toggleSkeleton = () => {
    setShowSkeleton(!showSkeleton)
    showSkeletonRef.current = !showSkeleton
  }

  const [currentState, setCurrentState] = useState("ALIGNING")
  const [reps, setReps] = useState(0)
  const [isLive, setIsLive] = useState(false)
  const [isWebcamActive, setIsWebcamActive] = useState(false)

  const [showHaruhi, setShowHaruhi] = useState(false);
  const [summaryData, setSummaryData] = useState(null)
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [userStats, setUserStats] = useState({ workouts: 0, total_reps: 0, average_score: 0.0, calories: 0.0 })

  const fetchStats = async () => {
    try {
      const response = await fetch('http://localhost:8000/stats')
      const data = await response.json()
      setUserStats(data)
    } catch (e) {
      console.error("Failed to fetch stats", e)
    }
  }

  const clearStats = async () => {
    if (!window.confirm("Are you sure you want to wipe your persistent workout data?")) return;
    try {
      await fetch('http://localhost:8000/clear_stats', { method: 'POST' })
      fetchStats()
    } catch (e) {
      console.error("Failed to clear stats", e)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  const videoRef = useRef(null)
  const overlayCanvasRef = useRef(null)
  const hiddenCanvasRef = useRef(null)
  const wsRef = useRef(null)
  const streamRef = useRef(null)
  const animationFrameRef = useRef(null)

  const handleFileChange = (e) => {
    if (e.target.files[0]) {
      setVideoUrl(URL.createObjectURL(e.target.files[0]))
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
        setIsWebcamActive(false)
      }
    }
  }

  const startWebcam = async (e) => {
    e.preventDefault()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
      streamRef.current = stream
      setIsWebcamActive(true)
      setVideoUrl(null)
      alert("Webcam connected!")
    } catch (err) {
      alert("Could not access webcam")
    }
  }

  // Hook stream up to video element when it mounts
  useEffect(() => {
    if (isLive && streamRef.current && videoRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isLive])

  const stopTracking = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'stop' }));
      setIsGeneratingReport(true);
      return;
    }
    finishTrackingCleanup();
  }

  const finishTrackingCleanup = () => {
    setIsLive(false)
    setIsGeneratingReport(false)
    if (wsRef.current) {
      wsRef.current.close()
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
      setIsWebcamActive(false)
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
      videoRef.current.pause()
    }
  }

  const startTracking = (e) => {
    e.preventDefault()
    if (!videoUrl && !streamRef.current) {
      return alert("Please upload a video or start webcam first!")
    }

    setIsLive(true)
    setReps(0)
    setCurrentState("ALIGNING")

    // Open WebSocket
    wsRef.current = new WebSocket('ws://localhost:8000/ws/track')

    wsRef.current.onopen = () => {
      wsRef.current.send(JSON.stringify({ setup: true, exercise }))
    }

    wsRef.current.onmessage = (event) => {
      const data = JSON.parse(event.data)

      if (data.status === "ready") {
        if (videoRef.current && !streamRef.current) {
          videoRef.current.play()
        }
        // FIRE FIRST FRAME to start the loop
        processFrame()
      } else if (data.type === "summary") {
        setSummaryData(data.stats);
        finishTrackingCleanup();
      } else if (data.coordinates) {
        setCurrentState(prev => prev !== data.state ? data.state : prev)
        setReps(prev => prev !== data.rep_count ? data.rep_count : prev)
        drawSkeleton(data.coordinates)

        // PING PONG: Send next frame only after backend finished the last one!
        animationFrameRef.current = requestAnimationFrame(processFrame)
      }
    }
  }

  const processFrame = () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

    const video = videoRef.current;
    const hiddenCanvas = hiddenCanvasRef.current;

    // Check if video is ready to be drawn
    if (!video || !hiddenCanvas || video.videoWidth === 0) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    if (video.paused && !streamRef.current) {
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

    // Aggressive Canvas Compression: Resize to a smaller footprint
    const MAX_WIDTH = 640;
    const scale = Math.min(MAX_WIDTH / video.videoWidth, 1.0);
    const targetWidth = video.videoWidth * scale;
    const targetHeight = video.videoHeight * scale;

    if (hiddenCanvas.width !== targetWidth || hiddenCanvas.height !== targetHeight) {
      hiddenCanvas.width = targetWidth;
      hiddenCanvas.height = targetHeight;
    }

    const ctx = hiddenCanvas.getContext('2d');
    ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

    // Compress heavily for WebSocket speed
    const frameBase64 = hiddenCanvas.toDataURL('image/jpeg', 0.5);

    const timestamp_ms = streamRef.current ? Date.now() : Math.floor(video.currentTime * 1000);

    wsRef.current.send(JSON.stringify({
      frame: frameBase64,
      timestamp_ms: timestamp_ms
    }));
  }

  const drawSkeleton = (frameData) => {
    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');

    if (canvas.width !== video.clientWidth || canvas.height !== video.clientHeight) {
      canvas.width = video.clientWidth;
      canvas.height = video.clientHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showSkeletonRef.current && frameData && frameData.length > 0) {
      frameData.forEach(points => {
        if (points.length === 3) {
          ctx.beginPath();
          ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
          ctx.lineTo(points[1].x * canvas.width, points[1].y * canvas.height);
          ctx.lineTo(points[2].x * canvas.width, points[2].y * canvas.height);
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 4;
          ctx.stroke();

          points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#00ffff';
            ctx.fill();
          });
        }
      });
    }
  }

  if (showHaruhi) {
    return <HaruhiDance onBack={() => setShowHaruhi(false)} activeStream={streamRef.current} />;
  }

  return (
    <div className="container">
      <header>
        <h1>⚡ Hercules AI Live</h1>
        <p>Real-time computer vision processing through WebSockets.</p>
      </header>

      <main>
        {!isLive && !summaryData && (
          <>
            <div className="results-card" style={{ marginBottom: '30px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, textAlign: 'left' }}>Lifetime Dashboard</h2>
                <button onClick={clearStats} className="submit-btn" style={{ padding: '8px 12px', fontSize: '0.8rem', backgroundColor: '#ff4444', width: 'auto', margin: 0 }}>
                  Clear Data
                </button>
              </div>
              <div className="workout-feed" style={{ marginTop: '20px', maxHeight: '350px', overflowY: 'auto', backgroundColor: '#1a1a1a', borderRadius: '12px', border: '1px solid #333' }}>
                {userStats.history && userStats.history.length > 0 ? (
                  userStats.history.map((workout, idx) => (
                    <div key={idx} style={{ padding: '15px 20px', borderBottom: idx !== userStats.history.length - 1 ? '1px solid #333' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ textAlign: 'left' }}>
                        <strong style={{ color: '#00ffff', fontSize: '1.1rem', letterSpacing: '0.5px' }}>{workout.exercise}</strong>
                        <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '5px' }}>{workout.date}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ color: '#fff', fontWeight: 'bold', fontSize: '1.05rem' }}>{workout.reps} Reps</div>
                        <div style={{ fontSize: '0.9rem', color: workout.score >= 8 ? '#00ff00' : workout.score >= 5 ? '#ffaa00' : '#ff4444', marginTop: '3px', fontWeight: '500' }}>
                          Score: {workout.score}/10
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: '#888' }}>
                    <p style={{ margin: 0, fontSize: '1.1rem' }}>No workouts yet.</p>
                    <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem' }}>Upload a video or step in front of the webcam to start!</p>
                  </div>
                )}
              </div>
            </div>

            <form className="upload-card">
              <div className="input-group">
                <label>Select Exercise:</label>
                <select value={exercise} onChange={(e) => setExercise(e.target.value)}>
                  <option value="squat">Bodyweight Squat</option>
                  <option value="push_up">Standard Push-Up</option>
                  <option value="bicep_curl">Bicep Curl</option>
                  <option value="sit_up">Sit-Up</option>
                  <option value="deadlift">Barbell Deadlift</option>
                </select>
              </div>

              <div className="input-group">
                <label>Input Source:</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={startWebcam} className="submit-btn" style={{ flex: 1, backgroundColor: isWebcamActive ? '#444' : '#007BFF' }}>
                    {isWebcamActive ? "Webcam Active" : "Use Webcam"}
                  </button>
                  <input type="file" accept="video/mp4,video/quicktime" onChange={handleFileChange} style={{ flex: 1 }} />
                </div>
              </div>

              <button onClick={startTracking} disabled={!videoUrl && !isWebcamActive} className="submit-btn">
                Start Live Tracking
              </button>
              <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <button
                  type="button"
                  disabled={!isWebcamActive}
                  onClick={() => setShowHaruhi(true)}
                  className="submit-btn"
                  style={{
                    backgroundColor: isWebcamActive ? '#2a112a' : '#1a1a1a',
                    border: isWebcamActive ? '1px solid #ff00ff' : '1px solid #333',
                    color: isWebcamActive ? '#ff00ff' : '#555',
                    fontSize: '0.9rem',
                    width: 'auto',
                    cursor: isWebcamActive ? 'pointer' : 'not-allowed',
                    opacity: isWebcamActive ? 1 : 0.6,
                    transition: 'all 0.3s ease'
                  }}
                >
                  🌸 Haruhi (Dangerous)
                </button>
                {!isWebcamActive && (
                  <p style={{ color: '#888', fontSize: '0.8rem', marginTop: '8px' }}>
                    * Activate your webcam *
                  </p>
                )}
              </div>
            </form>
          </>
        )}

        {isLive && (
          <div className="dashboard-grid">
            <div className="video-column">
              <div className="video-wrapper" style={{ position: 'relative' }}>
                <video
                  src={videoUrl || undefined}
                  autoPlay
                  playsInline
                  muted={!!streamRef.current} // Always mute webcam
                  className="annotated-video"
                  ref={videoRef}
                />
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none'
                  }}
                />
                <div style={{
                  position: 'absolute',
                  top: '15px',
                  left: '15px',
                  backgroundColor: 'rgba(0,0,0,0.8)',
                  color: currentState === 'Resting' ? '#ff4444' : (currentState === 'ALIGNING' ? '#ffff00' : '#00ff00'),
                  padding: '8px 12px',
                  borderRadius: '6px',
                  fontWeight: 'bold',
                  fontSize: '14px',
                  zIndex: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '1px'
                }}>
                  State: {currentState}
                </div>
                {currentState === 'ALIGNING' && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: 'rgba(255, 0, 0, 0.9)',
                    color: 'white',
                    padding: '20px 30px',
                    borderRadius: '10px',
                    fontWeight: 'bold',
                    fontSize: '1.5rem',
                    textAlign: 'center',
                    zIndex: 20
                  }}>
                    ⚠️ ALIGNING CAMERA<br />
                    <span style={{ fontSize: '1rem' }}>Step back! Ensure your full body is in the frame.</span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={toggleSkeleton} className="submit-btn" style={{ flex: 1, backgroundColor: '#333' }}>
                  {showSkeleton ? 'Hide Skeleton' : 'Show Skeleton'}
                </button>
                <button onClick={stopTracking} disabled={isGeneratingReport} className="submit-btn" style={{ flex: 1, backgroundColor: '#ff4444' }}>
                  {isGeneratingReport ? 'Generating Report...' : 'Stop Tracking'}
                </button>
              </div>
            </div>

            <div className="stats-column">
              <div className="results-card">
                <h2>Live Tracking</h2>

                <div className="stats-grid">
                  <div className="stat-box" style={{ gridColumn: 'span 2' }}>
                    <span className="stat-label">Live Rep Counter</span>
                    <span className="stat-value highlight-score" style={{ fontSize: '3.5rem' }}>{reps}</span>
                  </div>
                </div>

                <div className="feedback-box">
                  <h3>🦾 Coach Hercules Says:</h3>
                  <p>
                    {currentState === "ALIGNING" ? "I can't see you properly. Step back and show your full body." :
                      (currentState === "Resting" ? "Ready when you are. Get in position." :
                        (currentState === "ACTIVE" ? "⚠️ HOLD AND GO LOWER!" : "🔥 FORM LOOKS GOOD!"))}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {summaryData && !isLive && (
          <div className="results-card" style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'left' }}>
            <h2>Post-Workout Analysis</h2>

            <div className="stats-grid" style={{ marginBottom: '20px' }}>
              <div className="stat-box">
                <span className="stat-label">Score</span>
                <span className="stat-value highlight-score">{summaryData.score}/10</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Reps Completed</span>
                <span className="stat-value">{summaryData.reps}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Range of Motion</span>
                <span className="stat-value">{summaryData.rom}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">Avg Tempo</span>
                <span className="stat-value">{summaryData.tempo}</span>
              </div>
            </div>

            <div className="feedback-box" style={{ marginBottom: '20px' }}>
              <h3>🦾 Coach Hercules Says:</h3>
              <p>{summaryData.coach_feedback}</p>
            </div>

            <div className="chart-container" style={{ height: '300px', backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '12px', marginBottom: '20px' }}>
              <h3 style={{ marginBottom: '15px', color: '#fff', fontSize: '1rem' }}>Movement Angle vs Golden Standard</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summaryData.graph_data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#aaa" label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -5, fill: '#aaa' }} tickFormatter={(val) => val.toFixed(1)} />
                  <YAxis stroke="#aaa" domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: '#222', border: '1px solid #444', color: '#fff' }} />
                  <ReferenceLine y={summaryData.target_angle} label={{ position: 'insideTopLeft', value: 'Target Angle', fill: '#ff4444' }} stroke="#ff4444" strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="template_angle" name="Golden Standard" stroke="#ffff00" strokeWidth={3} strokeDasharray="5 5" dot={false} isAnimationActive={true} />
                  <Line type="monotone" dataKey="angle" name="Your Form" stroke="#00ffff" strokeWidth={3} dot={false} isAnimationActive={true} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {summaryData.xai_metrics && (
              <div className="xai-report" style={{ backgroundColor: '#1e1e1e', padding: '20px', borderRadius: '12px', marginTop: '20px', textAlign: 'left' }}>
                <h3 style={{ color: '#00ffff', marginBottom: '15px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>XAI & Forensics Report</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                  <div>
                    <h4 style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '10px' }}>Mathematical Justification</h4>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: '#fff', fontSize: '0.95rem' }}>
                      <li style={{ marginBottom: '10px' }}><strong>RMSE:</strong> {summaryData.xai_metrics.rmse}° <span style={{fontSize: '0.8rem', color: '#888'}}>(Lower is better)</span><br/><span style={{fontSize: '0.85rem', color: '#aaa'}}>Measures average joint deviation from perfect form.</span></li>
                      <li style={{ marginBottom: '10px' }}><strong>Cosine Similarity:</strong> {summaryData.xai_metrics.cosine_similarity} <span style={{fontSize: '0.8rem', color: '#888'}}>(Closer to 1 is better)</span><br/><span style={{fontSize: '0.85rem', color: '#aaa'}}>Measures overall movement shape and trajectory match.</span></li>
                      <li style={{ marginBottom: '10px' }}><strong>Pearson Correlation (r):</strong> {summaryData.xai_metrics.pearson_r} <span style={{fontSize: '0.8rem', color: '#888'}}>(Closer to 1 is better)</span><br/><span style={{fontSize: '0.85rem', color: '#aaa'}}>Measures pacing consistency and timing alignment.</span></li>
                    </ul>
                  </div>
                  
                  <div>
                    <h4 style={{ color: '#aaa', fontSize: '0.9rem', marginBottom: '10px' }}>Classification Report</h4>
                    <div style={{ marginBottom: '10px' }}>
                      <strong style={{ color: '#fff' }}>Accuracy: </strong> 
                      <span style={{ color: summaryData.xai_metrics.classification_accuracy >= 80 ? '#00ff00' : (summaryData.xai_metrics.classification_accuracy >= 50 ? '#ffff00' : '#ff4444'), fontWeight: 'bold' }}>
                        {summaryData.xai_metrics.classification_accuracy}%
                      </span>
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, color: '#fff', fontSize: '0.95rem' }}>
                      {Object.entries(summaryData.xai_metrics.deviation_breakdown || {}).map(([key, value]) => (
                        <li key={key} style={{ marginBottom: '5px', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{key}</span>
                          <span style={{ backgroundColor: '#333', padding: '2px 8px', borderRadius: '4px' }}>{value} reps</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <button onClick={() => { setSummaryData(null); fetchStats(); }} className="submit-btn" style={{ marginTop: '30px' }}>
              Back to Main Menu
            </button>
          </div>
        )}

        {/* Invisible canvas for capturing base64 frames to send to Python */}
        <canvas ref={hiddenCanvasRef} style={{ display: 'none' }} />
      </main>
    </div>
  )
}

export default App;
