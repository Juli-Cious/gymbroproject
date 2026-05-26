import React, { useRef, useState, useEffect } from 'react';

// Confetti Particle Class
class ConfettiParticle {
  constructor(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.x = Math.random() * canvasWidth;
    this.y = Math.random() * -canvasHeight - 20;
    this.size = Math.random() * 8 + 6;
    this.speed = Math.random() * 4 + 2;
    this.angle = Math.random() * 360;
    this.spin = Math.random() * 4 - 2;
    this.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
  }

  update() {
    this.y += this.speed;
    this.x += Math.sin(this.y / 30) * 1.5;
    this.angle += this.spin;

    // Reset particle if it falls off screen
    if (this.y > this.canvasHeight) {
      this.y = -20;
      this.x = Math.random() * this.canvasWidth;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x + this.size / 2, this.y + this.size / 2);
    ctx.rotate((this.angle * Math.PI) / 180);
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    ctx.restore();
  }
}

// Confetti Canvas Component
function ConfettiCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let animationFrameId;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    const particles = Array.from({ length: 120 }, () => new ConfettiParticle(canvas.width, canvas.height));

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.update();
        p.draw(ctx);
      });
      animationFrameId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 99999,
      }}
    />
  );
}

// Rhythm game score grade evaluator
const getGradeDetails = (percentage) => {
  if (percentage >= 95) {
    return { 
      grade: 'SS', 
      textColor: '#ffeb3b',
      textShadow: '0 0 25px rgba(255, 235, 59, 0.9), 0 0 50px rgba(255, 0, 255, 0.5)',
      glowColor: 'rgba(255, 0, 255, 0.6)',
      desc: 'PERFECT PERFECT PERFECT!' 
    };
  }
  if (percentage >= 90) {
    return { 
      grade: 'S', 
      textColor: '#ffaa00',
      textShadow: '0 0 20px rgba(255, 170, 0, 0.8)',
      glowColor: 'rgba(255, 170, 0, 0.45)',
      desc: 'Marvelous Performance!' 
    };
  }
  if (percentage >= 80) {
    return { 
      grade: 'A', 
      textColor: '#4ade80',
      textShadow: '0 0 15px rgba(74, 222, 128, 0.7)',
      glowColor: 'rgba(74, 222, 128, 0.35)',
      desc: 'Great job, Keep it up!' 
    };
  }
  if (percentage >= 70) {
    return { 
      grade: 'B', 
      textColor: '#3b82f6',
      textShadow: '0 0 12px rgba(59, 130, 246, 0.6)',
      glowColor: 'rgba(59, 130, 246, 0.25)',
      desc: 'Good effort, you got this!' 
    };
  }
  if (percentage >= 60) {
    return { 
      grade: 'C', 
      textColor: '#a855f7',
      textShadow: '0 0 10px rgba(168, 85, 247, 0.5)',
      glowColor: 'rgba(168, 85, 247, 0.2)',
      desc: 'Decent, but needs practice.' 
    };
  }
  if (percentage >= 50) {
    return { 
      grade: 'D', 
      textColor: '#f97316',
      textShadow: '0 0 10px rgba(249, 115, 22, 0.5)',
      glowColor: 'rgba(249, 115, 22, 0.2)',
      desc: 'Getting there, work on timing!' 
    };
  }
  return { 
    grade: 'F', 
    textColor: '#ef4444',
    textShadow: '0 0 12px rgba(239, 68, 68, 0.7)',
    glowColor: 'rgba(239, 68, 68, 0.25)',
    desc: 'Practice makes perfect!' 
  };
};

function HaruhiDance({ onBack, activeStream }) {
  const videoRef = useRef(null);
  const danceVideoRef = useRef(null);
  const hiddenCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const wsRef = useRef(null);
  const animationFrameRef = useRef(null);
  const cheerAudioRef = useRef(null);

  const playCheer = () => {
    try {
      const audio = new Audio('/cheering.mp3');
      audio.volume = 0.5;
      cheerAudioRef.current = audio;
      audio.play().catch(e => console.warn("Cheering audio play blocked/missing:", e));
    } catch (err) {
      console.warn("Audio context not ready or file missing:", err);
    }
  };

  const handleExit = () => {
    const audio = cheerAudioRef.current;
    if (audio) {
      // Fade out volume over 500ms
      let vol = audio.volume;
      const interval = setInterval(() => {
        vol -= 0.05;
        if (vol <= 0) {
          clearInterval(interval);
          audio.pause();
          cheerAudioRef.current = null;
        } else {
          audio.volume = Math.max(0, vol);
        }
      }, 50);
    }
    onBack();
  };

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
          playCheer();
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

    if (frameData && frameData.length > 0) {
      console.log("Drawing skeleton points. First hinge coords:", frameData[0]);
      frameData.forEach(points => {
        if (points.length === 3) {
          ctx.beginPath();
          ctx.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
          ctx.lineTo(points[1].x * canvas.width, points[1].y * canvas.height);
          ctx.lineTo(points[2].x * canvas.width, points[2].y * canvas.height);
          ctx.strokeStyle = '#ff00ff';
          ctx.lineWidth = 8;
          ctx.stroke();

          points.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x * canvas.width, p.y * canvas.height, 8, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffaa00';
            ctx.fill();
          });
        }
      });
    }
  };

  return (
    <div className="container" style={{ maxWidth: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? '1200px' : '1400px', transition: 'max-width 0.5s ease-in-out' }}>
      <header>
        <h1 style={{ color: '#ff00ff' }}>🌸 Haruhi Dance 🌸</h1>
        <p>Synchronize your movements with the Golden Standard!</p>
        <button onClick={handleExit} className="submit-btn" style={{ backgroundColor: '#555', marginTop: '10px', width: 'auto' }}>
          Back to Gym
        </button>
      </header>

      <main style={{ padding: '0 10px' }}>
        {score !== null && (() => {
          const gradeDetails = getGradeDetails(score);
          return (
            <>
              <ConfettiCanvas />
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                backgroundColor: 'rgba(10, 5, 10, 0.85)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 99999,
                backdropFilter: 'blur(8px)',
              }}>
                <div 
                  className="results-card pop-in-animation" 
                  style={{
                    width: '90%',
                    maxWidth: '460px',
                    textAlign: 'center',
                    backgroundColor: '#1b0e1b',
                    border: `3px solid ${gradeDetails.textColor}`,
                    boxShadow: `0 0 40px ${gradeDetails.glowColor}`,
                    borderRadius: '24px',
                    padding: '30px 20px',
                    boxSizing: 'border-box'
                  }}
                >
                  <h2 style={{ color: '#ff00ff', margin: '0', fontSize: '1.6rem', letterSpacing: '1px' }}>
                    🌸 DANCE COMPLETE! 🌸
                  </h2>
                  
                  <div style={{ margin: '20px 0 10px 0', height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span 
                      className="beat-animation" 
                      style={{
                        fontSize: '7rem',
                        fontWeight: '900',
                        color: gradeDetails.textColor,
                        textShadow: gradeDetails.textShadow,
                        lineHeight: '1',
                        margin: '0',
                      }}
                    >
                      {gradeDetails.grade}
                    </span>
                  </div>

                  <div style={{ fontSize: '1.2rem', color: '#ccc', marginTop: '10px' }}>
                    Synchronization Rating: <strong style={{ color: '#00ffff' }}>{score}%</strong>
                  </div>

                  <p style={{ fontStyle: 'italic', color: '#aaa', fontSize: '1rem', marginTop: '15px', marginBottom: '25px', padding: '0 10px' }}>
                    "{gradeDetails.desc}"
                  </p>

                  <button 
                    onClick={handleExit} 
                    className="submit-btn" 
                    style={{ 
                      backgroundColor: '#ff00ff', 
                      fontSize: '1.1rem', 
                      padding: '12px 30px', 
                      fontWeight: 'bold',
                      boxShadow: '0 0 15px rgba(255, 0, 255, 0.4)',
                      transition: 'all 0.2s ease',
                      borderRadius: '10px',
                      width: 'auto'
                    }}
                    onMouseOver={(e) => e.target.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
                  >
                    RETURN TO DASHBOARD
                  </button>
                </div>
              </div>
            </>
          );
        })()}

        {/* Page-wide Countdown Overlay */}
        {dancePhase === 'COUNTDOWN' && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999,
          }}>
            <div style={{
              backgroundColor: 'rgba(15, 15, 15, 0.9)',
              border: '3px solid #ffaa00',
              color: '#ffaa00',
              width: '160px',
              height: '160px',
              borderRadius: '50%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              boxShadow: '0 0 40px rgba(255,170,0,0.5)',
              backdropFilter: 'blur(8px)',
            }}>
              <span style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px', color: '#aaa' }}>Start in</span>
              <span style={{ fontSize: '4rem', fontWeight: 'bold', lineHeight: '1', marginTop: '5px' }}>{countdown}</span>
            </div>
          </div>
        )}

        {/* Relative layout wrapper for Video and Side Column */}
        <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', width: '100%' }}>
          {/* Card 2: Anime Video (Always mounted, hidden conditionally) */}
          <div 
            className="video-card" 
            style={{ 
              flex: '3', 
              minWidth: '500px',
              maxWidth: '1000px',
              backgroundColor: '#111', 
              padding: '10px',
              margin: '0',
              boxSizing: 'border-box',
              display: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? 'none' : 'block' 
            }}
          >
            <h3 style={{ textAlign: 'center', color: '#ffaa00', marginTop: '0', marginBottom: '8px', fontSize: '1.1rem' }}>Anime Standard</h3>
            <div className="video-wrapper" style={{ padding: '0', boxShadow: 'none' }}>
              <video
                ref={danceVideoRef}
                src="/haruhi_dance.webm"
                controls={false}
                style={{ width: '100%', borderRadius: '8px', display: 'block' }}
                onEnded={() => stopDance(true)}
              />
            </div>
          </div>

          {/* Right Column Container (Contains Webcam Card and Skeleton Card) */}
          <div 
            style={
              (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') 
              ? {
                  width: '100%',
                  maxWidth: '800px',
                  margin: '0 auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '20px'
                }
              : {
                  width: '300px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  margin: '0'
                }
            }
          >
            {/* Webcam Card */}
            <div 
              className="video-card"
              style={{
                width: '100%',
                backgroundColor: '#111',
                padding: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? '2rem' : '8px',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                margin: '0',
                boxSizing: 'border-box'
              }}
            >
              <h3 style={{ textAlign: 'center', color: '#ff00ff', marginTop: '0', marginBottom: '8px', fontSize: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? '1.5rem' : '0.9rem' }}>
                {(dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? "Position Yourself" : "Webcam Feed"}
              </h3>
              <div className="video-wrapper" style={{ padding: '0', borderRadius: '8px', overflow: 'hidden', boxShadow: 'none' }}>
                <div style={{ position: 'relative', width: '100%' }}>
                  {/* Mirrored Video Container */}
                  <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: '8px', transform: 'scaleX(-1)' }}>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{ width: '100%', display: 'block' }}
                    />
                  </div>

                  {/* Status Badges Overlay (Outside mirrored container) */}
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

                  {dancePhase === 'DANCING' && (
                    <div style={{
                      position: 'absolute',
                      top: '8px',
                      left: '8px',
                      backgroundColor: 'rgba(255, 0, 255, 0.9)',
                      color: 'white',
                      padding: '4px 8px',
                      borderRadius: '4px',
                      fontWeight: 'bold',
                      fontSize: '0.75rem',
                      boxShadow: '0 0 10px rgba(255,0,255,0.3)',
                      zIndex: 10,
                      letterSpacing: '1px',
                      textTransform: 'uppercase'
                    }}>
                      💃 DANCING
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Skeleton Card (Separate Area) */}
            <div 
              className="video-card"
              style={{
                width: '100%',
                backgroundColor: '#111',
                padding: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? '2rem' : '8px',
                borderRadius: '12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                margin: '0',
                boxSizing: 'border-box'
              }}
            >
              <h3 style={{ textAlign: 'center', color: '#ffaa00', marginTop: '0', marginBottom: '8px', fontSize: (dancePhase === 'ALIGNING' || dancePhase === 'POSITIONED') ? '1.5rem' : '0.9rem' }}>
                Motion Tracking
              </h3>
              <div className="video-wrapper" style={{ padding: '0', borderRadius: '8px', overflow: 'hidden', boxShadow: 'none' }}>
                <div style={{ position: 'relative', width: '100%', overflow: 'hidden', borderRadius: '8px', transform: 'scaleX(-1)', backgroundColor: '#080808', aspectRatio: '16/9' }}>
                  <canvas
                    ref={overlayCanvasRef}
                    style={{
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                  />
                </div>
              </div>
              <canvas ref={hiddenCanvasRef} style={{ display: 'none' }} />
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '30px' }}>
          {dancePhase === 'FINISHED' && (
            <button onClick={handleExit} className="submit-btn" style={{ backgroundColor: '#555', fontSize: '1.2rem', padding: '15px 40px', width: 'auto', fontWeight: 'bold' }}>
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
