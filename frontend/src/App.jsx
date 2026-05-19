import { useState, useRef, useEffect } from 'react'
import './App.css'

function App() {
  const [exercise, setExercise] = useState('squat')
  const [videoUrl, setVideoUrl] = useState(null)
  
  const [showSkeleton, setShowSkeleton] = useState(true)
  const [currentState, setCurrentState] = useState("Resting")
  const [reps, setReps] = useState(0)
  const [isLive, setIsLive] = useState(false)

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
      }
    }
  }

  const startWebcam = async (e) => {
    e.preventDefault()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      streamRef.current = stream
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
    setIsLive(false)
    if (wsRef.current) {
      wsRef.current.close()
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
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
    setCurrentState("Resting")

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

    if (showSkeleton && frameData && frameData.length > 0) {
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

  return (
    <div className="container">
      <header>
        <h1>⚡ Hercules AI Live</h1>
        <p>Real-time computer vision processing through WebSockets.</p>
      </header>

      <main>
        {!isLive && (
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
                <button onClick={startWebcam} className="submit-btn" style={{flex: 1, backgroundColor: streamRef.current ? '#444' : '#007BFF'}}>
                  {streamRef.current ? "Webcam Active" : "Use Webcam"}
                </button>
                <input type="file" accept="video/mp4,video/quicktime" onChange={handleFileChange} style={{flex: 1}}/>
              </div>
            </div>

            <button onClick={startTracking} disabled={!videoUrl && !streamRef.current} className="submit-btn">
              Start Live Tracking
            </button>
          </form>
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
                  color: currentState === 'Resting' ? '#ff4444' : '#00ff00',
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
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={() => setShowSkeleton(!showSkeleton)} className="submit-btn" style={{ flex: 1, backgroundColor: '#333' }}>
                  {showSkeleton ? 'Hide Skeleton' : 'Show Skeleton'}
                </button>
                <button onClick={stopTracking} className="submit-btn" style={{ flex: 1, backgroundColor: '#ff4444' }}>Stop Tracking</button>
              </div>
            </div>

            <div className="stats-column">
              <div className="results-card">
                <h2>Live Tracking</h2>

                <div className="stats-grid">
                  <div className="stat-box" style={{ gridColumn: 'span 2' }}>
                    <span className="stat-label">Live Rep Counter</span>
                    <span className="stat-value highlight-score" style={{fontSize: '3.5rem'}}>{reps}</span>
                  </div>
                </div>

                <div className="feedback-box">
                  <h3>🦾 Coach Hercules Says:</h3>
                  <p>
                    {currentState === "Resting" ? "Ready when you are. Get in position." : 
                    (currentState === "ACTIVE" ? "⚠️ HOLD AND GO LOWER!" : "🔥 FORM LOOKS GOOD!")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Invisible canvas for capturing base64 frames to send to Python */}
        <canvas ref={hiddenCanvasRef} style={{ display: 'none' }} />
      </main>
    </div>
  )
}

export default App;
