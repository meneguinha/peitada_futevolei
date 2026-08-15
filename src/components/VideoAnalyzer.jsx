import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, RotateCcw, Eye, EyeOff, Volume2, VolumeX, Loader, Activity, RefreshCw, Sparkles, CheckCircle2, ChevronRight, Ruler } from 'lucide-react';
import PoseCanvasOverlay from './PoseCanvasOverlay';
import { initPoseDetector, detectPose, isDetectorReady } from '../utils/poseDetector';
import { createPeitadaDetector } from '../utils/peitadaDetector';
import { createBallTracker } from '../utils/ballTracker';
import { SIGMA, ANGLE_STEP, MIN_REPS_FOR_SCORE, roundTo } from '../utils/measurementUncertainty';

export default function VideoAnalyzer({ videoData }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const animFrameRef = useRef(null);
  const peitadaDetectorRef = useRef(null);
  const ballTrackerRef = useRef(null);
  const ballSeqRef = useRef(null);
  const aspectRef = useRef(720 / 1280);
  const cancelAnalysisRef = useRef(false);
  const analysisRunningRef = useRef(false);
  const timelinePosesRef = useRef([]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showOverlay, setShowOverlay] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [videoDims, setVideoDims] = useState({ w: 720, h: 1280, vertical: true });

  const [athleteHeight, setAthleteHeight] = useState(() => {
    const saved = localStorage.getItem('peitada_athlete_height_m');
    return saved ? parseFloat(saved) : 1.80;
  });

  // Analysis workflow states: 'idle' (needs analysis) | 'analyzing' | 'ready' (analyzed)
  const [analysisStatus, setAnalysisStatus] = useState('idle');
  const [detectorStatus, setDetectorStatus] = useState('loading'); // loading | ready | error
  const [currentPose, setCurrentPose] = useState(null);
  const [debug, setDebug] = useState(null);
  const [peitadaState, setPeitadaState] = useState('idle');
  const [peitadas, setPeitadas] = useState([]);
  const [currentScore, setCurrentScore] = useState(null);
  const [session, setSession] = useState({ score: 0, margin: 0, n: 0, reliable: false });
  const [analysis, setAnalysis] = useState({ running: false, progress: 0 });
  const [activePeitadaIndex, setActivePeitadaIndex] = useState(null);
  const [selectedPeitadaIndex, setSelectedPeitadaIndex] = useState(null);

  const videoUrl = videoData?.url || null;

  // Initialize MediaPipe + peitada detector
  useEffect(() => {
    peitadaDetectorRef.current = createPeitadaDetector(athleteHeight);
    ballTrackerRef.current = createBallTracker(athleteHeight);

    initPoseDetector()
      .then(() => setDetectorStatus('ready'))
      .catch((err) => {
        console.error('[VideoAnalyzer] Pose detector failed:', err);
        setDetectorStatus('error');
      });

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  // Reset analysis when video source changes
  useEffect(() => {
    setAnalysisStatus('idle');
    setPeitadas([]);
    setSession({ score: 0, margin: 0, n: 0, reliable: false });
    setCurrentScore(null);
    setActivePeitadaIndex(null);
    setSelectedPeitadaIndex(null);
    setCurrentPose(null);
    setDebug(null);
    timelinePosesRef.current = [];
    peitadaDetectorRef.current?.reset();
    ballTrackerRef.current?.reset();
  }, [videoUrl]);

  // When video metadata loads
  const onMetadata = () => {
    const v = videoRef.current;
    if (v) {
      const vert = v.videoHeight > v.videoWidth;
      setVideoDims({ w: v.videoWidth, h: v.videoHeight, vertical: vert });
      aspectRef.current = v.videoWidth / v.videoHeight;
      peitadaDetectorRef.current?.setVideoAspect(aspectRef.current);
    }
  };

  /** Helper to accurately seek video frame */
  const seekTo = (video, seconds) => new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done);
    video.currentTime = seconds;
    setTimeout(done, 350);
  });

  // Single sample step interval for offline analysis (40ms = 25 FPS)
  const SAMPLE_STEP_S = 0.04;

  /**
   * Run full offline analysis across the entire video.
   * This guarantees 100% deterministic detection and independence from playback speed.
   */
  const runFullAnalysis = useCallback(async () => {
    const video = videoRef.current;
    const detector = peitadaDetectorRef.current;
    const ballTracker = ballTrackerRef.current;
    if (!video || !detector || !isDetectorReady() || !video.duration) return;

    cancelAnalysisRef.current = false;
    analysisRunningRef.current = true;
    setAnalysisStatus('analyzing');
    setAnalysis({ running: true, progress: 0 });

    video.pause();
    setIsPlaying(false);
    detector.setAthleteHeight(athleteHeight);
    ballTracker?.setAthleteHeight(athleteHeight);
    detector.reset();
    ballTracker?.reset();
    ballSeqRef.current = null;
    timelinePosesRef.current = [];
    setPeitadas([]);
    setSession({ score: 0, margin: 0, n: 0, reliable: false });
    setCurrentScore(null);
    setActivePeitadaIndex(null);
    setSelectedPeitadaIndex(null);

    const total = video.duration;
    const step = SAMPLE_STEP_S;

    for (let t = 0; t <= total; t += step) {
      if (cancelAnalysisRef.current) break;

      await seekTo(video, t);
      const videoTimeMs = t * 1000;

      const pose = detectPose(video, performance.now());
      if (pose && pose.landmarks) {
        const prevState = detector.getCurrentState();
        detector.feed(pose, videoTimeMs);
        const newState = detector.getCurrentState();

        // Start ball tracking when entering IMPACT
        if (prevState !== 'impact' && newState === 'impact' && ballTracker) {
          const lShoulder = pose.landmarks[11];
          const rShoulder = pose.landmarks[12];
          ballTracker.startTracking({
            x: (lShoulder.x + rShoulder.x) / 2,
            y: (lShoulder.y + rShoulder.y) / 2 - 0.05
          }, aspectRef.current, athleteHeight);
          ballSeqRef.current = detector.getPendingSeq();
        }

        if (ballTracker && ballTracker.isTracking()) {
          const ballResult = ballTracker.feedFrame(video, videoTimeMs, pose.landmarks);
          if (ballResult) {
            detector.applyBallData(ballSeqRef.current, ballResult);
            ballSeqRef.current = null;
          }
        }

        // Cache pose timeline for smooth 60fps playback without inference drops
        timelinePosesRef.current.push({
          timeMs: videoTimeMs,
          pose,
          debug: detector.getDebug(),
          state: newState
        });
      }

      // Yield UI updates and progress
      if (Math.round(t / step) % 4 === 0) {
        setAnalysis({ running: true, progress: Math.min(0.99, t / total) });
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (cancelAnalysisRef.current) {
      analysisRunningRef.current = false;
      setAnalysis({ running: false, progress: 0 });
      setAnalysisStatus('idle');
      return;
    }

    // Flush any pending in-flight movement & ball flight
    if (ballTracker?.isTracking()) {
      detector.applyBallData(ballSeqRef.current, ballTracker.stopTracking());
      ballSeqRef.current = null;
    }
    detector.flush(total * 1000);

    const finalPeitadas = detector.getPeitadas();
    setPeitadas(finalPeitadas);
    setSession(detector.getSessionScore());
    if (finalPeitadas.length > 0) {
      setCurrentScore(finalPeitadas[0].score);
      setSelectedPeitadaIndex(0);
    }

    await seekTo(video, 0);
    analysisRunningRef.current = false;
    setAnalysis({ running: false, progress: 1 });
    setAnalysisStatus('ready');

    if (timelinePosesRef.current.length > 0) {
      setCurrentPose(timelinePosesRef.current[0].pose);
      setDebug(timelinePosesRef.current[0].debug);
    }
  }, []);

  /**
   * Playback animation loop.
   * Runs smoothly during playback to update skeleton overlay and highlight the active peitada card.
   */
  const playbackLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended) {
      setIsPlaying(false);
      return;
    }

    const videoTimeMs = video.currentTime * 1000;
    const poses = timelinePosesRef.current;

    // Fast lookup of closest pose in timeline
    if (poses.length > 0) {
      let low = 0, high = poses.length - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (poses[mid].timeMs < videoTimeMs) low = mid + 1;
        else high = mid - 1;
      }
      const idx = Math.min(poses.length - 1, Math.max(0, low));
      const entry = poses[idx];
      if (entry) {
        setCurrentPose(entry.pose);
        setDebug(entry.debug);
      }
    }

    // Determine active peitada based on current video timestamp
    const currentPList = peitadas;
    const activeIdx = currentPList.findIndex((p) => {
      const start = p.startMs;
      const end = p.endMs || (p.startMs + 1200);
      return videoTimeMs >= start && videoTimeMs <= (end + 250);
    });

    if (activeIdx >= 0) {
      setActivePeitadaIndex(activeIdx);
      setSelectedPeitadaIndex(activeIdx);
      const activeP = currentPList[activeIdx];
      setCurrentScore(activeP.score);

      // Phase indicator based on peitada timing
      if (activeP.impactMs && Math.abs(videoTimeMs - activeP.impactMs) < 160) {
        setPeitadaState('impact');
      } else if (videoTimeMs < (activeP.impactMs || (activeP.startMs + 350))) {
        setPeitadaState('arching');
      } else {
        setPeitadaState('landing');
      }
    } else {
      setActivePeitadaIndex(null);
      setPeitadaState('idle');
    }

    animFrameRef.current = requestAnimationFrame(playbackLoop);
  }, [peitadas]);

  // Start or stop playback loop
  useEffect(() => {
    if (isPlaying && analysisStatus === 'ready') {
      animFrameRef.current = requestAnimationFrame(playbackLoop);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, analysisStatus, playbackLoop]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;

    if (analysisStatus !== 'ready') {
      runFullAnalysis();
      return;
    }

    if (isPlaying) {
      v.pause();
      setIsPlaying(false);
    } else {
      v.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const restart = () => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
    setIsPlaying(false);
    setActivePeitadaIndex(null);
    setPeitadaState('idle');
    if (timelinePosesRef.current.length > 0) {
      setCurrentPose(timelinePosesRef.current[0].pose);
    }
  };

  const setRate = (r) => {
    setPlaybackRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  };

  const jumpToPeitada = (timeMs, idx) => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      setIsPlaying(false);
      const targetSec = Math.max(0, (timeMs / 1000) - 0.4);
      v.currentTime = targetSec;
      setActivePeitadaIndex(idx);
      setSelectedPeitadaIndex(idx);

      // Find closest pose in timeline
      const poses = timelinePosesRef.current;
      if (poses.length > 0) {
        const targetMs = targetSec * 1000;
        let low = 0, high = poses.length - 1;
        while (low <= high) {
          const mid = (low + high) >> 1;
          if (poses[mid].timeMs < targetMs) low = mid + 1;
          else high = mid - 1;
        }
        const found = poses[Math.min(poses.length - 1, Math.max(0, low))];
        if (found) {
          setCurrentPose(found.pose);
          setDebug(found.debug);
        }
      }
    }
  };

  const isVertical = videoDims.vertical;
  const stageWidth = isVertical ? 340 : 540;
  const stageHeight = isVertical ? 604 : 338;

  const scoreColor = (s) => {
    if (s >= 80) return 'var(--success-text)';
    if (s >= 60) return 'var(--warning-text)';
    return 'var(--danger-text)';
  };
  const scoreFill = (s) => {
    if (s >= 80) return 'var(--success)';
    if (s >= 60) return 'var(--warning)';
    return 'var(--danger)';
  };
  const scoreStatus = (s) => (s >= 80 ? 'status-good' : s >= 60 ? 'status-warn' : 'status-error');

  const ballMetric = (p, key) => (p?.details?.ballMeasured ? `${p.details[key]}m` : '—');

  const ANGLE_HINT = 'Precisa de vista de perfil: de frente esse movimento acontece na profundidade.';

  const phaseLabel = {
    idle: 'Aguardando movimento',
    preparing: 'Preparação',
    arching: 'Arqueamento',
    impact: 'Impacto',
    landing: 'Aterrissagem'
  };

  const statusText = {
    loading: 'Carregando o modelo de pose…',
    ready: 'Detector pronto para análise',
    error: 'Falha ao carregar o detector de pose'
  };

  const handleHeightChange = (newH) => {
    if (isNaN(newH) || newH < 1.30 || newH > 2.30) return;
    setAthleteHeight(newH);
    try {
      localStorage.setItem('peitada_athlete_height_m', String(newH));
    } catch {}
    peitadaDetectorRef.current?.setAthleteHeight(newH);
    ballTrackerRef.current?.setAthleteHeight(newH);
    const updated = peitadaDetectorRef.current?.getPeitadas() || [];
    setPeitadas([...updated]);
    setSession(peitadaDetectorRef.current?.getSessionScore() || session);
    if (activeOrSelectedIdx < updated.length) {
      setCurrentScore(updated[activeOrSelectedIdx].score);
    }
  };

  // Currently focused peitada on the right-hand card
  const activeOrSelectedIdx = activePeitadaIndex !== null ? activePeitadaIndex : (selectedPeitadaIndex !== null ? selectedPeitadaIndex : 0);
  const currentPeitadaItem = peitadas[activeOrSelectedIdx] || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Toolbar */}
      <div className="card p-5" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        justifyContent: 'space-between', gap: 16
      }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={22} strokeWidth={2} style={{ color: 'var(--primary)' }} />
            Análise da Peitada
          </h2>
          <p className="text-sm text-muted" style={{ marginTop: 2 }}>
            {analysis.running
              ? `Analisando o vídeo inteiro… ${Math.round(analysis.progress * 100)}%`
              : analysisStatus === 'ready'
                ? `Análise concluída (${peitadas.length} peitada${peitadas.length === 1 ? '' : 's'} detectada${peitadas.length === 1 ? '' : 's'})`
                : statusText[detectorStatus]}
          </p>
          {analysis.running && (
            <div style={{
              height: 4, borderRadius: 2, background: 'var(--surface-sunken)',
              border: '1px solid var(--border)', marginTop: 8, width: 240, maxWidth: '100%'
            }}>
              <div style={{
                height: '100%', borderRadius: 2, background: 'var(--accent)',
                width: `${Math.round(analysis.progress * 100)}%`, transition: 'width 0.2s linear'
              }} />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {/* Athlete Height Ruler Input - Clearly Highlighted */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--surface-sunken)', border: '1.5px solid var(--border-strong)',
            borderRadius: 'var(--r-btn)', padding: '6px 14px',
            boxShadow: 'var(--shadow-card)'
          }}>
            <Ruler size={18} strokeWidth={2} style={{ color: 'var(--primary)', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                Altura do Atleta
              </span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, marginTop: 2 }}>
                <input
                  type="number"
                  min="1.30"
                  max="2.30"
                  step="0.01"
                  value={athleteHeight}
                  onChange={(e) => handleHeightChange(parseFloat(e.target.value))}
                  style={{
                    width: 54, background: 'transparent', border: 'none',
                    fontWeight: 800, fontSize: 15, color: 'var(--text)', textAlign: 'left',
                    padding: 0, margin: 0, outline: 'none'
                  }}
                  title="Altura do atleta (em metros) usada como régua de calibração métrica para o vídeo"
                />
                <span className="text-xs font-semibold text-muted">m</span>
              </div>
            </div>
          </div>

          {/* Main Action: Rodar Análise / Reanalisar */}
          {analysisStatus !== 'ready' ? (
            <button
              onClick={analysis.running ? () => { cancelAnalysisRef.current = true; } : runFullAnalysis}
              className="btn-accent"
              disabled={detectorStatus !== 'ready'}
            >
              <Activity size={18} strokeWidth={2} />
              {analysis.running ? 'Cancelar' : 'Rodar Análise'}
            </button>
          ) : (
            <button
              onClick={runFullAnalysis}
              className="btn-secondary"
              title="Executa novamente a análise do vídeo"
            >
              <RefreshCw size={16} strokeWidth={2} />
              Reanalisar
            </button>
          )}

          <button onClick={() => setShowOverlay(!showOverlay)} className="btn-secondary"
                  style={showOverlay ? { borderColor: 'var(--primary)', color: 'var(--primary)' } : undefined}>
            {showOverlay ? <Eye size={18} strokeWidth={1.75} /> : <EyeOff size={18} strokeWidth={1.75} />}
            Esqueleto
          </button>

          <div style={{
            display: 'flex', gap: 2, padding: 3,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-btn)'
          }}>
            {[0.25, 0.5, 1.0].map((r) => (
              <button key={r} onClick={() => setRate(r)} className="num" style={{
                padding: '6px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                border: 'none',
                background: playbackRate === r ? 'var(--primary)' : 'transparent',
                color: playbackRate === r ? 'var(--primary-contrast)' : 'var(--text-muted)'
              }}>{r}x</button>
            ))}
          </div>
        </div>
      </div>

      {/* TOP SECTION: Video on Left + Real-time Focused Card on Right */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'stretch' }}>

        {/* Left Column: Video Stage */}
        <div ref={stageRef} style={{
          position: 'relative', width: stageWidth, height: stageHeight,
          background: 'var(--stage)', borderRadius: 'var(--r-card)', overflow: 'hidden',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', flexShrink: 0,
          margin: '0 auto'
        }}>
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            playsInline
            muted={isMuted}
            onLoadedMetadata={onMetadata}
            onEnded={() => setIsPlaying(false)}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              objectFit: 'contain', background: 'var(--stage)', zIndex: 1
            }}
          />

          <canvas
            ref={canvasRef}
            id="poseOverlayCanvas"
            width={stageWidth}
            height={stageHeight}
            style={{
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
              pointerEvents: 'none', zIndex: 2
            }}
          />
          <PoseCanvasOverlay
            canvasId="poseOverlayCanvas"
            landmarks={currentPose?.landmarks}
            worldLandmarks={currentPose?.worldLandmarks}
            showAngleOverlay={showOverlay}
            width={stageWidth}
            height={stageHeight}
            videoAspect={videoDims.w / videoDims.h}
          />

          {/* Phase indicator */}
          <div style={{
            position: 'absolute', top: 12, left: 12, right: 12, zIndex: 3,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 8, pointerEvents: 'none'
          }}>
            <span className="text-xs font-semibold" style={{
              color: '#fff',
              background: peitadaState === 'impact' ? 'var(--accent)' : 'rgba(15,20,25,0.75)',
              padding: '5px 11px', borderRadius: 'var(--r-badge)',
              transition: 'background-color 0.15s ease'
            }}>
              {phaseLabel[peitadaState]}
            </span>

            {showOverlay && debug && (
              <span className="num text-xs" style={{
                color: debug.tilt >= 12 ? 'var(--success)' : 'rgba(255,255,255,0.85)',
                background: 'rgba(15,20,25,0.75)',
                padding: '5px 9px', borderRadius: 'var(--r-badge)'
              }}>
                {debug.tilt > 0 ? '+' : ''}{debug.tilt}° · conf {debug.confidence}
              </span>
            )}
          </div>

          {/* Model Loading State */}
          {detectorStatus === 'loading' && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 7,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(15,20,25,0.88)'
            }}>
              <Loader size={40} strokeWidth={1.75}
                      style={{ color: 'var(--secondary)', animation: 'spin 1s linear infinite' }} />
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.8)', marginTop: 14 }}>
                Carregando o modelo…
              </p>
            </div>
          )}

          {/* Prompt Overlay: Rodar Análise (Required before playback) */}
          {analysisStatus === 'idle' && detectorStatus === 'ready' && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 6,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(15, 20, 25, 0.75)', backdropFilter: 'blur(3px)',
              padding: 24, textAlign: 'center'
            }}>
              <button
                onClick={runFullAnalysis}
                className="btn-accent"
                style={{
                  padding: '14px 28px', fontSize: 16, borderRadius: 'var(--r-btn)',
                  boxShadow: 'var(--shadow-float)', transform: 'scale(1.04)'
                }}
              >
                <Activity size={22} strokeWidth={2.2} />
                <span>Rodar Análise</span>
              </button>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.8)', marginTop: 12, maxWidth: 260 }}>
                Processe o vídeo primeiro para detectar todas as peitadas e liberar o play.
              </p>
            </div>
          )}

          {/* Analysis Progress Overlay */}
          {analysisStatus === 'analyzing' && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 6,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(15, 20, 25, 0.88)', backdropFilter: 'blur(4px)',
              padding: 24, textAlign: 'center'
            }}>
              <Loader size={38} strokeWidth={2} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
              <p className="font-semibold text-sm" style={{ color: '#fff', marginTop: 14 }}>
                Analisando o vídeo… {Math.round(analysis.progress * 100)}%
              </p>
              <div style={{
                height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.15)',
                marginTop: 12, width: 220, maxWidth: '100%', overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%', borderRadius: 3, background: 'var(--accent)',
                  width: `${Math.round(analysis.progress * 100)}%`, transition: 'width 0.15s ease'
                }} />
              </div>
              <button
                onClick={() => { cancelAnalysisRef.current = true; }}
                className="btn-secondary"
                style={{ marginTop: 18, padding: '6px 14px', fontSize: 12, color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }}
              >
                Cancelar
              </button>
            </div>
          )}

          {/* Tap-to-play overlay (Available only when analysis is ready) */}
          {analysisStatus === 'ready' && (
            <button onClick={togglePlay} aria-label={isPlaying ? 'Pausar' : 'Reproduzir'} style={{
              position: 'absolute', inset: 0, zIndex: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', border: 'none', cursor: 'pointer',
              opacity: isPlaying ? 0 : 1, transition: 'opacity 0.2s'
            }}>
              <span style={{
                width: 62, height: 62, borderRadius: '50%', background: 'var(--accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: 'var(--shadow-float)'
              }}>
                {isPlaying
                  ? <Pause size={26} strokeWidth={2} color="#fff" />
                  : <Play size={26} strokeWidth={2} color="#fff" style={{ marginLeft: 3 }} />}
              </span>
            </button>
          )}

          {/* Transport Bar */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 5,
            padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(15,20,25,0.85)', backdropFilter: 'blur(6px)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={togglePlay}
                className="btn-icon"
                style={{
                  color: analysisStatus === 'ready' ? '#fff' : 'rgba(255,255,255,0.4)',
                  cursor: analysisStatus === 'ready' ? 'pointer' : 'not-allowed'
                }}
                disabled={analysisStatus !== 'ready'}
                aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                title={analysisStatus !== 'ready' ? 'Clique em Rodar Análise para habilitar o play' : ''}
              >
                {isPlaying ? <Pause size={18} strokeWidth={2} /> : <Play size={18} strokeWidth={2} />}
              </button>
              <button
                onClick={restart}
                className="btn-icon"
                style={{
                  color: analysisStatus === 'ready' ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)',
                  cursor: analysisStatus === 'ready' ? 'pointer' : 'not-allowed'
                }}
                disabled={analysisStatus !== 'ready'}
                aria-label="Recomeçar"
              >
                <RotateCcw size={17} strokeWidth={1.75} />
              </button>
              <button
                onClick={() => { if (videoRef.current) { videoRef.current.muted = !isMuted; setIsMuted(!isMuted); } }}
                className="btn-icon" style={{ color: 'rgba(255,255,255,0.75)' }}
                aria-label={isMuted ? 'Ativar som' : 'Silenciar'}>
                {isMuted ? <VolumeX size={17} strokeWidth={1.75} /> : <Volume2 size={17} strokeWidth={1.75} />}
              </button>
            </div>
            {currentScore !== null && (
              <span className="num text-sm" style={{ color: scoreColor(currentScore), fontWeight: 700 }}>
                {currentScore}/100
              </span>
            )}
          </div>
        </div>

        {/* Right Column: Live Focused Card (Atualiza em tempo real conforme o vídeo toca) */}
        <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 16 }}>
          
          {/* Card em Destaque da Peitada Atual */}
          <div className="card p-6" style={{
            flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            border: activePeitadaIndex !== null ? '1.5px solid var(--accent)' : '1px solid var(--border)',
            boxShadow: activePeitadaIndex !== null ? '0 0 16px rgba(255,90,54,0.18)' : 'var(--shadow-card)',
            transition: 'all 0.25s ease'
          }}>
            <div>
              {/* Header do Card em Destaque */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="badge badge-accent" style={{ fontSize: 11, padding: '3px 8px' }}>
                      {activePeitadaIndex !== null ? '▶ AO VIVO NO VÍDEO' : 'PEITADA EM DESTAQUE'}
                    </span>
                    {currentPeitadaItem && (
                      <span className="text-xs text-muted font-medium">
                        {(currentPeitadaItem.startMs / 1000).toFixed(1)}s no vídeo
                      </span>
                    )}
                  </div>
                  <h3 style={{ marginTop: 6, fontSize: 22 }}>
                    {currentPeitadaItem ? `Peitada ${activeOrSelectedIdx + 1}` : 'Aguardando Análise'}
                  </h3>
                </div>

                {currentPeitadaItem && (
                  <div style={{ textAlign: 'right' }}>
                    <div className="num" style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, color: scoreColor(currentPeitadaItem.score) }}>
                      {currentPeitadaItem.score}
                    </div>
                  </div>
                )}
              </div>

              {/* Medições Biomecânicas Detalhadas */}
              {currentPeitadaItem ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 18px', margin: '20px 0' }}>
                  {[
                    {
                      label: 'Flexão do Joelho',
                      weight: currentPeitadaItem.details.ballMeasured ? '22%' : '30%',
                      val: currentPeitadaItem.details.kneeScore,
                      detail: `~${roundTo(currentPeitadaItem.details.kneeFlexion, ANGLE_STEP)}°`,
                      tip: 'Ideal: 120° a 150°'
                    },
                    {
                      label: 'Arco do Tronco',
                      weight: currentPeitadaItem.details.ballMeasured ? '26%' : '35%',
                      val: currentPeitadaItem.details.archScore,
                      detail: `~${roundTo(currentPeitadaItem.details.torsoArch, ANGLE_STEP)}°`,
                      tip: 'Ideal: 23° a 40°'
                    },
                    {
                      label: 'Simetria dos Braços',
                      weight: currentPeitadaItem.details.ballMeasured ? '10%' : '15%',
                      val: currentPeitadaItem.details.armScore,
                      detail: `Δ~${roundTo(currentPeitadaItem.details.armBalance, ANGLE_STEP)}°`,
                      tip: 'Diferença < 15°'
                    },
                    {
                      label: 'Avanço do Quadril',
                      weight: currentPeitadaItem.details.ballMeasured ? '12%' : '20%',
                      val: currentPeitadaItem.details.hipScore,
                      detail: `~${roundTo(currentPeitadaItem.details.hipThrust, 1)}cm`,
                      missing: false,
                      tip: 'Ideal: ~14 a 26cm à frente'
                    },
                    {
                      label: 'Altura Máx. da Bola',
                      weight: currentPeitadaItem.details.ballMeasured ? '30%' : 'N/A',
                      val: currentPeitadaItem.details.ballHeightScore,
                      detail: ballMetric(currentPeitadaItem, 'ballMaxHeight'),
                      missing: !currentPeitadaItem.details.ballMeasured,
                      tip: currentPeitadaItem.details.ballMeasured ? 'Ideal: 1.80m a 2.80m acima do peito' : (currentPeitadaItem.details.ballFailReason || 'Não rastreada'),
                      fullWidth: true
                    }
                  ].map((m) => (
                    <div key={m.label} style={{
                      background: 'var(--surface-sunken)', padding: '10px 12px', borderRadius: 'var(--r-badge)',
                      border: '1px solid var(--border)',
                      gridColumn: m.fullWidth ? '1 / -1' : undefined
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span className="text-xs font-semibold" style={{ color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {m.label}
                          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 500 }}>({m.weight})</span>
                        </span>
                        <span className="num font-bold text-sm" style={{ color: m.missing ? 'var(--text-faint)' : scoreColor(m.val) }}>
                          {m.detail}
                        </span>
                      </div>
                      <div style={{
                        height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.08)', marginTop: 6,
                        overflow: 'hidden'
                      }}>
                        <div style={{
                          height: '100%', borderRadius: 3, width: `${m.val}%`,
                          background: m.missing ? 'var(--border-strong)' : scoreFill(m.val),
                          transition: 'width 0.3s ease'
                        }} />
                      </div>
                      <span className="text-xs text-muted" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                        {m.tip}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '36px 16px' }}>
                  <p className="text-sm text-muted">
                    Clique em <strong style={{ color: 'var(--accent)' }}>Rodar Análise</strong> para processar o vídeo
                    e visualizar as métricas detalhadas de cada peitada aqui.
                  </p>
                </div>
              )}

              {/* Feedback e Correções da Peitada Atual */}
              {currentPeitadaItem && currentPeitadaItem.flaws && (
                <div style={{
                  borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 8,
                  display: 'flex', flexDirection: 'column', gap: 6
                }}>
                  <span className="text-xs font-semibold text-muted" style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Avaliação Técnica
                  </span>
                  {currentPeitadaItem.flaws.map((f, j) => (
                    <p key={j} className="text-xs" style={{
                      color: f.startsWith('✅') ? 'var(--success-text)' : 'var(--text)',
                      display: 'flex', alignItems: 'flex-start', gap: 6
                    }}>
                      <span>{f}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>

            {/* Rodapé do Card: Score Médio da Sessão */}
            {session.reliable && (
              <div style={{
                marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <span className="text-xs text-muted">
                  Média geral da sessão ({session.n} repetições):
                </span>
                <span className="num font-bold text-sm" style={{ color: scoreColor(session.score) }}>
                  {session.score} pts
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* BOTTOM SECTION: Cards com os valores da peitada 1, peitada 2, peitada 3... */}
      {peitadas.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={18} style={{ color: 'var(--accent)' }} />
              Histórico de Peitadas ({peitadas.length})
            </h3>
            <p className="text-xs text-muted">
              Clique em qualquer card para saltar para o momento exato no vídeo
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16
          }}>
            {peitadas.map((p, i) => {
              const isActive = activePeitadaIndex === i;
              const isSelected = selectedPeitadaIndex === i;

              return (
                <div
                  key={i}
                  className={`card card-interactive card-status ${scoreStatus(p.score)} ${isActive ? 'card-peitada-active' : ''} p-4`}
                  onClick={() => jumpToPeitada(p.startMs, i)}
                  style={{
                    border: isSelected && !isActive ? '1.5px solid var(--primary)' : undefined,
                    transition: 'all 0.2s ease',
                    position: 'relative'
                  }}
                >
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="font-semibold text-sm">Peitada {i + 1}</span>
                      <span className="text-xs text-faint num">
                        {(p.startMs / 1000).toFixed(1)}s
                      </span>
                    </div>

                    <span className="num font-bold text-lg" style={{ color: scoreColor(p.score) }}>
                      {p.score}
                    </span>
                  </div>

                  {/* Resumo compacto de métricas */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(48px, 1fr))', gap: '6px 8px',
                    fontSize: 11, margin: '8px 0', padding: '8px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)'
                  }}>
                    <div>
                      <span className="text-faint block" style={{ fontSize: 10 }}>Joelho</span>
                      <span className="num font-semibold" style={{ color: scoreColor(p.details.kneeScore) }}>
                        ~{roundTo(p.details.kneeFlexion, ANGLE_STEP)}°
                      </span>
                    </div>
                    <div>
                      <span className="text-faint block" style={{ fontSize: 10 }}>Arco</span>
                      <span className="num font-semibold" style={{ color: scoreColor(p.details.archScore) }}>
                        ~{roundTo(p.details.torsoArch, ANGLE_STEP)}°
                      </span>
                    </div>
                    <div>
                      <span className="text-faint block" style={{ fontSize: 10 }}>Braços</span>
                      <span className="num font-semibold" style={{ color: scoreColor(p.details.armScore) }}>
                        Δ~{roundTo(p.details.armBalance, ANGLE_STEP)}°
                      </span>
                    </div>
                    <div>
                      <span className="text-faint block" style={{ fontSize: 10 }}>Quadril</span>
                      <span className="num font-semibold" style={{ color: scoreColor(p.details.hipScore) }}>
                        ~{roundTo(p.details.hipThrust, 1)}cm
                      </span>
                    </div>
                    <div>
                      <span className="text-faint block" style={{ fontSize: 10 }}>Alt. Bola</span>
                      <span className="num font-semibold" style={{ color: p.details.ballMeasured ? scoreColor(p.details.ballHeightScore) : 'var(--text-faint)' }}>
                        {ballMetric(p, 'ballMaxHeight')}
                      </span>
                    </div>
                  </div>

                  {/* Resumo da dica */}
                  <p className="text-xs text-muted" style={{
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    color: p.flaws[0]?.startsWith('✅') ? 'var(--success-text)' : 'var(--text-muted)'
                  }}>
                    {p.flaws[0] || '✅ Boa execução'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
