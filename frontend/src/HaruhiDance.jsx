import React, { useRef, useState, useEffect } from 'react';

function HaruhiDance({ onBack, activeStream }) {
  const videoRef = useRef(null);
  const danceVideoRef = useRef(null);
  const hiddenCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const wsRef = useRef(null);
  const animationFrameRef = useRef(null);

  const [dancePhase, setDancePhase] = useState('ALIGNING'); // ALIGNING, COUNTDOWN, DANCING, FINISHED
  const dancePhaseRef = useRef('ALIGNING');
  const [countdown, setCountdown] = useState(5);
  const [score, setScore] = useState(null);
  
  // To handle countdown interval safely
  const countdownIntervalRef = useRef(null);

  const [localStream, setLocalStream] = useState(null);

  useEffect(() => {
    // Reset state and ref to starting values on effect mount/remount
    setDancePhase('ALIGNING');
    dancePhaseRef.current = 'ALIGNING';
    setScore(null);
    setCountdown(5);

    if (!activeStream && !localStream) {
      navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } })
        .then(stream => {
          setLocalStream(stream);
        })
        .catch(e => console.error("Error accessing webcam", e));
      return;
    }

    const streamToUse = activeStream || localStream;

    if (streamToUse) {
      videoRef.current.srcObject = streamToUse;
      videoRef.current.play().catch(e => console.error("Error playing stream", e));

      wsRef.current = new WebSocket("ws://localhost:8000/ws/haruhi");

      wsRef.current.onopen = () => {
        danceVideoRef.current.currentTime = 0;
        animationFrameRef.current = requestAnimationFrame(processFrame);
      };

      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log("Haruhi WS Message received:", data);
        if (data.type === 'update') {
          console.log("Drawing skeleton with", data.skeleton ? data.skeleton.length : 0, "hinges.");
          drawSkeleton(data.skeleton);
          
          setDancePhase((prevPhase) => {
            if (prevPhase === 'ALIGNING' && data.state === 'DANCING') {
              console.log("Aligned! Transitioning from ALIGNING to POSITIONED");
              dancePhaseRef.current = 'POSITIONED';
              return 'POSITIONED';
            }
            if (prevPhase === 'POSITIONED' && data.state === 'ALIGNING') {
              console.log("Lost alignment during POSITIONED phase! Resetting to ALIGNING");
              dancePhaseRef.current = 'ALIGNING';
              return 'ALIGNING';
            }
            if (prevPhase === 'COUNTDOWN' && data.state === 'ALIGNING') {
              console.log("Lost alignment during countdown! Transitioning from COUNTDOWN to ALIGNING");
              dancePhaseRef.current = 'ALIGNING';
              return 'ALIGNING';
            }
            dancePhaseRef.current = prevPhase;
            return prevPhase;
          });

          if (dancePhaseRef.current !== 'FINISHED') {
            console.log("Scheduling next processFrame callback. Phase:", dancePhaseRef.current);
            animationFrameRef.current = requestAnimationFrame(processFrame);
          }
        } else if (data.type === 'summary') {
          console.log("Dance finished, summary score received:", data.score);
          setScore(data.score);
          stopDance(false);
        }
      };
    }

    return () => {
      stopDance(false);
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [activeStream, localStream]);

  // When phase changes to COUNTDOWN, start the 5 second interval
  useEffect(() => {
    if (dancePhase === 'COUNTDOWN') {
      setCountdown(5);
      countdownIntervalRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownIntervalRef.current);
            startPlayingVideo();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    }
  }, [dancePhase]);

  // Handle transition from POSITIONED to COUNTDOWN phase
  useEffect(() => {
    if (dancePhase === 'POSITIONED') {
      const timer = setTimeout(() => {
        setDancePhase((prev) => {
          if (prev === 'POSITIONED') {
            console.log("Timeout done! Transitioning from POSITIONED to COUNTDOWN");
            dancePhaseRef.current = 'COUNTDOWN';
            return 'COUNTDOWN';
          }
          return prev;
        });
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [dancePhase]);

  // removed setupDance

  const startPlayingVideo = () => {
    setDancePhase('DANCING');
    dancePhaseRef.current = 'DANCING';
    wsRef.current.send(JSON.stringify({ command: 'start_recording' }));
    danceVideoRef.current.play();
  };

  const stopDance = (sendMsg = true) => {
    setDancePhase('FINISHED');
    dancePhaseRef.current = 'FINISHED';
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    
    if (danceVideoRef.current) {
      danceVideoRef.current.pause();
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    // We NO LONGER STOP the stream tracks here!
    // App.jsx owns the activeStream, so we leave it alone when unmounting/stopping.
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (sendMsg) {
        wsRef.current.send(JSON.stringify({ command: 'stop' }));
      } else {
        wsRef.current.close();
      }
    }
  };

  const processFrame = () => {
    console.log("processFrame execution started. readyState:", wsRef.current ? wsRef.current.readyState : "no socket");
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("processFrame blocked: WebSocket not open.");
      return;
    }

    const video = videoRef.current;
    const hiddenCanvas = hiddenCanvasRef.current;

    if (!video || !hiddenCanvas || video.videoWidth === 0) {
      console.log("processFrame waiting: video or canvas not ready.", {
        videoExists: !!video,
        canvasExists: !!hiddenCanvas,
        videoWidth: video ? video.videoWidth : 0
      });
      animationFrameRef.current = requestAnimationFrame(processFrame);
      return;
    }

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

    const frameBase64 = hiddenCanvas.toDataURL('image/jpeg', 0.5);
    const timestamp_ms = Date.now();

    console.log("processFrame: sending frame to WebSocket, timestamp:", timestamp_ms);
    wsRef.current.send(JSON.stringify({
      frame: frameBase64,
      timestamp_ms: timestamp_ms
    }));
  }

  const drawSkeleton = (frameData) => {
    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!canvas || !video) {
      console.warn("drawSkeleton blocked: Canvas or video ref missing.");
      return;
    }

    const ctx = canvas.getContext('2d');

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      console.log("Resizing canvas for skeleton drawing to video resolution:", video.videoWidth, "x", video.videoHeight);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw diagnostic red rectangle (top-left of native canvas, shows in top-right of mirrored screen)
    ctx.fillStyle = 'rgba(255, 0, 0, 0.6)';
    ctx.fillRect(20, 20, 150, 150);

    if (frameData && frameData.length > 0) {
      console.log("Drawing skeleton points. First hinge coords:", frameData[0]);
      frameData.forEach(points => {
        if (points.length === 3) {
          ctx.beginPath();
          ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
          ctx.lineTo(points[1].x * canvas.width, points[1].y * canvas.height);
          ctx.lineTo(points[2].x * canvas.width, points[2].y * canvas.height);
          ctx.strokeStyle = '#ff00ff';
          ctx.lineWidth = 4;
          ctx.stroke();

          points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 6, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffaa00';
            ctx.fill();
          });
        }
      });
    }
  };

  return (
    <div className="container" style={{ maxWidth: '1200px' }}>
      <header>
        <h1 style={{ color: '#ff00ff' }}>🌸 Haruhi Dance 🌸</h1>
        <p>Synchronize your movements with the Golden Standard!</p>
        <button onClick={onBack} className="submit-btn" style={{ backgroundColor: '#555', marginTop: '10px', width: 'auto' }}>
          Back to Gym
        </button>
      </header>

      <main>
        {score !== null && (
          <div className="results-card" style={{ textAlign: 'center', marginBottom: '20px', backgroundColor: '#2a112a', border: '2px solid #ff00ff' }}>
            <h2>Dance Complete!</h2>
            <div className="score-circle" style={{ margin: '0 auto', borderColor: '#ff00ff', color: '#ff00ff' }}>
              <span>{score}%</span>
            </div>
            <p>Synchronization Rating</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* Card 1: Webcam (Always mounted, dynamically sized) */}
          <div 
            className="video-card" 
            style={{ 
              flex: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? 'none' : '1', 
              width: '100%',
              maxWidth: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? '800px' : 'none', 
              minWidth: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? 'auto' : '400px',
              backgroundColor: '#111', 
              margin: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? '0 auto' : '0',
              transition: 'all 0.5s ease-in-out'
            }}
          >
            <h3 style={{ textAlign: 'center', color: '#ff00ff' }}>
              {(dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? "Position Yourself" : "You"}
            </h3>
            <div className="video-wrapper">
              <div style={{ position: 'relative', width: '100%' }}>
                {/* Mirrored Video & Canvas Container */}
                <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: '12px', transform: 'scaleX(-1)' }}>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    style={{ width: '100%', display: 'block' }}
                  />
                  <canvas
                    ref={overlayCanvasRef}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                      zIndex: 5
                    }}
                  />
                </div>

                {/* Status Badges Overlay (Placed outside mirrored container so text is readable) */}
                {dancePhase === 'ALIGNING' && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: 'rgba(255, 0, 255, 0.85)',
                    color: 'white',
                    padding: '16px 28px',
                    borderRadius: '12px',
                    fontWeight: 'bold',
                    fontSize: '1.4rem',
                    textAlign: 'center',
                    boxShadow: '0 0 20px rgba(255,0,255,0.4)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 10,
                    letterSpacing: '1px',
                  }} className="pulse-animation">
                    🌸 STEP INTO FRAME! 🌸
                    <span style={{ display: 'block', fontSize: '0.9rem', fontWeight: 'normal', marginTop: '6px', color: '#ffccff' }}>
                      Position your full body so we can see you.
                    </span>
                  </div>
                )}

                {dancePhase === 'POSITIONED' && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: 'rgba(0, 180, 0, 0.9)',
                    color: 'white',
                    padding: '20px 40px',
                    borderRadius: '16px',
                    fontWeight: 'bold',
                    fontSize: '1.8rem',
                    textAlign: 'center',
                    boxShadow: '0 0 30px rgba(0,255,0,0.5)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 10,
                    letterSpacing: '1px',
                  }}>
                    ✅ Positioned!
                    <span style={{ display: 'block', fontSize: '1.05rem', fontWeight: 'normal', marginTop: '6px', color: '#e0ffe0' }}>
                      Get ready to dance...
                    </span>
                  </div>
                )}

                {dancePhase === 'COUNTDOWN' && (
                  <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                    border: '3px solid #ffaa00',
                    color: '#ffaa00',
                    width: '120px',
                    height: '120px',
                    borderRadius: '50%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    boxShadow: '0 0 30px rgba(255,170,0,0.4)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 10
                  }}>
                    <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#aaa' }}>Start in</span>
                    <span style={{ fontSize: '3rem', fontWeight: 'bold', lineHeight: '1' }}>{countdown}</span>
                  </div>
                )}

                {dancePhase === 'DANCING' && (
                  <div style={{
                    position: 'absolute',
                    top: '15px',
                    left: '15px',
                    backgroundColor: 'rgba(255, 0, 255, 0.9)',
                    color: 'white',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontWeight: 'bold',
                    fontSize: '0.9rem',
                    boxShadow: '0 0 10px rgba(255,0,255,0.3)',
                    zIndex: 10,
                    letterSpacing: '1px',
                    textTransform: 'uppercase'
                  }}>
                    💃 DANCING 🕺
                  </div>
                )}
              </div>
              <canvas ref={hiddenCanvasRef} style={{ display: 'none' }} />
            </div>
          </div>

          {/* Card 2: Anime Video (Always mounted, hidden conditionally) */}
          <div 
            className="video-card" 
            style={{ 
              flex: '1', 
              minWidth: '400px', 
              backgroundColor: '#111', 
              display: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? 'none' : 'block' 
            }}
          >
            <h3 style={{ textAlign: 'center', color: '#ffaa00' }}>Anime</h3>
            <div className="video-wrapper">
              <video
                ref={danceVideoRef}
                src="/haruhi_dance.webm"
                controls={false}
                style={{ width: '100%', borderRadius: '12px' }}
                onEnded={() => stopDance(true)}
              />
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '30px' }}>
          {dancePhase === 'FINISHED' && (
            <button onClick={onBack} className="submit-btn" style={{ backgroundColor: '#555', fontSize: '1.2rem', padding: '15px 40px', width: 'auto', fontWeight: 'bold' }}>
              RETURN TO DASHBOARD
            </button>
          )}
          {dancePhase !== 'FINISHED' && (
            <button onClick={() => stopDance(true)} className="submit-btn" style={{ backgroundColor: '#ff4444', fontSize: '1.2rem', padding: '15px 40px', width: 'auto', fontWeight: 'bold' }}>
              ABORT DANCE
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

export default HaruhiDance;
