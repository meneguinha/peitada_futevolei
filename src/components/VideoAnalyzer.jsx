import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Play, Pause, RotateCcw, Eye, EyeOff, Volume2, VolumeX, Loader, Activity } from 'lucide-react';
import PoseCanvasOverlay from './PoseCanvasOverlay';
import { initPoseDetector, detectPose, isDetectorReady } from '../utils/poseDetector';
import { createPeitadaDetector } from '../utils/peitadaDetector';
import { createBallTracker } from '../utils/ballTracker';

export default function VideoAnalyzer({ videoData }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const animFrameRef = useRef(null);
  const peitadaDetectorRef = useRef(null);
  const ballTrackerRef = useRef(null);
  const ballSeqRef = useRef(null);
  const lastSampleMsRef = useRef(-Infinity);
  const peitadaVersionRef = useRef(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [showOverlay, setShowOverlay] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [videoDims, setVideoDims] = useState({ w: 720, h: 1280, vertical: true });

  // Pose detection state
  const [detectorStatus, setDetectorStatus] = useState('loading'); // loading | ready | error
  const [currentPose, setCurrentPose] = useState(null);
  const [debug, setDebug] = useState(null);
  const [peitadaState, setPeitadaState] = useState('idle');
  const [peitadas, setPeitadas] = useState([]);
  const [currentScore, setCurrentScore] = useState(null);
  const [overallScore, setOverallScore] = useState(0);

  const videoUrl = videoData?.url || null;

  // Initialize MediaPipe + peitada detector
  useEffect(() => {
    peitadaDetectorRef.current = createPeitadaDetector();
    ballTrackerRef.current = createBallTracker();

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

  // When video metadata loads
  const onMetadata = () => {
    const v = videoRef.current;
    if (v) {
      const vert = v.videoHeight > v.videoWidth;
      setVideoDims({ w: v.videoWidth, h: v.videoHeight, vertical: vert });
      peitadaDetectorRef.current?.setVideoAspect(v.videoWidth / v.videoHeight);
    }
  };

  // Seeking invalidates the in-flight movement: the state machine and the
  // cooldown would otherwise be anchored to a timestamp that is now in the
  // future, which silently stops all detection. Already-scored peitadas stay.
  const onSeeking = () => {
    lastSampleMsRef.current = -Infinity;
    ballSeqRef.current = null;
    peitadaDetectorRef.current?.resetTransient();
    ballTrackerRef.current?.reset();
  };

  // Detection only runs while playing, so after a seek (clicking a peitada card
  // pauses and jumps) the skeleton would stay frozen on the frame we left —
  // drawn over a completely different image. Re-detect the single frame we
  // landed on. Display only: the state machine is not fed, since onSeeking has
  // already dropped the in-flight movement.
  const detectStill = useCallback(() => {
    const video = videoRef.current;
    if (!video || !isDetectorReady() || video.readyState < 2) return;
    const pose = detectPose(video, performance.now());
    if (pose && pose.landmarks) setCurrentPose(pose);
  }, []);

  // Wait for the new frame to actually be decoded before reading it.
  const onSeeked = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => detectStill());
    } else {
      requestAnimationFrame(() => detectStill());
    }
  }, [detectStill]);

  // One analysis sample per 50ms of video time (~20 samples/s at any speed)
  const SAMPLE_INTERVAL_MS = 50;

  // Real-time pose detection loop
  const detectLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended || !isDetectorReady()) {
      animFrameRef.current = requestAnimationFrame(detectLoop);
      return;
    }

    const videoTimeMs = video.currentTime * 1000;

    // Throttle on *video* time rather than wall-clock. Throttling on the real
    // clock samples 4x more densely at 0.25x than at 1x, which shrinks the
    // smoothing window and shifts the peak — the same clip would score
    // differently depending on the playback speed the user happened to pick.
    if (Math.abs(videoTimeMs - lastSampleMsRef.current) < SAMPLE_INTERVAL_MS) {
      animFrameRef.current = requestAnimationFrame(detectLoop);
      return;
    }
    lastSampleMsRef.current = videoTimeMs;

    // MediaPipe's VIDEO mode requires strictly increasing timestamps, so it is
    // fed the wall clock; everything downstream uses video time.
    const pose = detectPose(video, performance.now());
    if (pose && pose.landmarks) {
      setCurrentPose(pose);

      const detector = peitadaDetectorRef.current;
      const ballTracker = ballTrackerRef.current;
      if (detector) {
        const prevState = detector.getCurrentState();
        detector.feed(pose, videoTimeMs);
        const newState = detector.getCurrentState();

        // Start ball tracking when we enter IMPACT phase
        if (prevState !== 'impact' && newState === 'impact' && ballTracker) {
          const lShoulder = pose.landmarks[11];
          const rShoulder = pose.landmarks[12];
          ballTracker.startTracking({
            x: (lShoulder.x + rShoulder.x) / 2,
            y: (lShoulder.y + rShoulder.y) / 2 - 0.05 // slightly above chest
          });
          // Remember which peitada this flight belongs to by its stable id —
          // list positions shift as detections are re-committed.
          ballSeqRef.current = detector.getPendingSeq();
        }

        if (ballTracker && ballTracker.isTracking()) {
          const ballResult = ballTracker.feedFrame(video, videoTimeMs, pose.landmarks);
          if (ballResult) {
            detector.applyBallData(ballSeqRef.current, ballResult);
            ballSeqRef.current = null;
          }
        }

        setPeitadaState(newState);
        // Batched with the pose update above, so this costs no extra render.
        setDebug(detector.getDebug());

        // The scored list only changes a couple of times per clip; re-rendering
        // it on every one of the ~20 samples per second is wasted work.
        const version = detector.getVersion();
        if (version !== peitadaVersionRef.current) {
          peitadaVersionRef.current = version;
          setPeitadas(detector.getPeitadas());
          setOverallScore(detector.getOverallScore());
          const latest = detector.getLatestPeitada();
          if (latest) setCurrentScore(latest.score);
        }
      }
    }

    animFrameRef.current = requestAnimationFrame(detectLoop);
  }, []);

  // Start/stop detection loop with play state
  useEffect(() => {
    if (isPlaying && detectorStatus === 'ready') {
      animFrameRef.current = requestAnimationFrame(detectLoop);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPlaying, detectorStatus, detectLoop]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
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
    setCurrentPose(null);
    setDebug(null);
    setPeitadas([]);
    setCurrentScore(null);
    setOverallScore(0);
    setPeitadaState('idle');
    // Every piece of analysis state has to go back, including the ball tracker:
    // restarting mid-flight used to leave it stuck in `tracking: true` forever.
    lastSampleMsRef.current = -Infinity;
    ballSeqRef.current = null;
    peitadaVersionRef.current = 0;
    peitadaDetectorRef.current?.reset();
    ballTrackerRef.current?.reset();
  };

  const setRate = (r) => {
    setPlaybackRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  };

  const jumpToPeitada = (timeMs) => {
    const v = videoRef.current;
    if (v) {
      v.pause();
      setIsPlaying(false);
      // Volta 0.5s antes do início do movimento para dar contexto
      v.currentTime = Math.max(0, (timeMs / 1000) - 0.5);
    }
  };

  const isVertical = videoDims.vertical;
  const stageWidth = isVertical ? 340 : 600;
  const stageHeight = isVertical ? 604 : 338;

  // Two ramps on purpose: the brand hues are legible as a fill or a rail, but
  // not as text on a light surface (yellow on white is 1.6:1). Numbers get the
  // darkened variants; bars and rails keep the signal colours.
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

  // Ball figures are still shown when they come from the kinematic estimate
  // instead of real tracking, but prefixed with "≈" so a guess never reads as a
  // measurement. The detector keeps those out of the score.
  const ballMetric = (p, key) => {
    const v = p.details[key];
    if (!v) return '—';
    return `${p.details.ballEstimated ? '≈' : ''}${v}m`;
  };

  const phaseLabel = {
    idle: 'Aguardando movimento',
    preparing: 'Preparação',
    arching: 'Arqueamento',
    impact: 'Impacto',
    landing: 'Aterrissagem'
  };

  const statusText = {
    loading: 'Carregando o modelo de pose…',
    ready: 'Detector pronto',
    error: 'Falha ao carregar o detector de pose'
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="card p-5" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center',
        justifyContent: 'space-between', gap: 16, marginBottom: 20
      }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={22} strokeWidth={2} style={{ color: 'var(--primary)' }} />
            Análise da peitada
          </h2>
          <p className="text-sm text-muted" style={{ marginTop: 2 }}>
            {statusText[detectorStatus]}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>

        {/* Video stage — stays dark in both themes: footage reads better on black */}
        <div ref={stageRef} style={{
          position: 'relative', width: stageWidth, height: stageHeight,
          background: 'var(--stage)', borderRadius: 'var(--r-card)', overflow: 'hidden',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-card)', flexShrink: 0
        }}>
          <video
            ref={videoRef}
            src={videoUrl}
            preload="auto"
            playsInline
            muted={isMuted}
            onLoadedMetadata={onMetadata}
            onLoadedData={onSeeked}
            onSeeking={onSeeking}
            onSeeked={onSeeked}
            onEnded={() => {
              setIsPlaying(false);
              // A peitada performed in the last moments of the clip is still in
              // flight when playback stops; score it instead of dropping it.
              const detector = peitadaDetectorRef.current;
              if (detector) {
                detector.flush((videoRef.current?.currentTime || 0) * 1000);
                setPeitadas(detector.getPeitadas());
                setOverallScore(detector.getOverallScore());
                peitadaVersionRef.current = detector.getVersion();
              }
            }}
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

            {/* Live tilt readout. A peitada needs this to climb past +12°; if it
                stays low or goes negative during a real arch, detection is the
                problem, not the movement. "conf" is how well the camera angle
                lets us tell forwards from backwards. */}
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

          {detectorStatus === 'loading' && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 5,
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

          {/* Tap-to-play overlay */}
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

          {/* Transport */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 5,
            padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(15,20,25,0.85)', backdropFilter: 'blur(6px)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <button onClick={togglePlay} className="btn-icon" style={{ color: '#fff' }}
                      aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}>
                {isPlaying ? <Pause size={18} strokeWidth={2} /> : <Play size={18} strokeWidth={2} />}
              </button>
              <button onClick={restart} className="btn-icon" style={{ color: 'rgba(255,255,255,0.75)' }}
                      aria-label="Recomeçar">
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

        {/* Score panel */}
        <div style={{ flex: 1, minWidth: 300 }}>

          <div className="card p-6 text-center" style={{ marginBottom: 16 }}>
            <p className="text-xs text-muted font-medium" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Score geral
            </p>
            <div className="num" style={{
              fontSize: 52, fontWeight: 700, lineHeight: 1.1, marginTop: 6,
              color: peitadas.length > 0 ? scoreColor(overallScore) : 'var(--text-faint)'
            }}>
              {peitadas.length > 0 ? overallScore : '—'}
            </div>
            <p className="text-sm text-muted" style={{ marginTop: 4 }}>
              {peitadas.length === 0
                ? 'Dê play para analisar'
                : `Média de ${peitadas.length} peitada${peitadas.length > 1 ? 's' : ''}`}
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {peitadas.map((p, i) => (
              <div
                key={i}
                className={`card card-interactive card-status ${scoreStatus(p.score)} p-4`}
                onClick={() => jumpToPeitada(p.startMs)}
                style={{ animation: 'fadeIn 0.25s ease' }}
              >
                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10
                }}>
                  <span className="font-semibold text-sm">Peitada {i + 1}</span>
                  <span className="num" style={{ fontSize: 20, fontWeight: 700, color: scoreColor(p.score) }}>
                    {p.score}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
                  {[
                    { label: 'Joelho', val: p.details.kneeScore, detail: `${p.details.kneeFlexion}°` },
                    { label: 'Arco', val: p.details.archScore, detail: `${p.details.torsoArch}°` },
                    { label: 'Braços', val: p.details.armScore, detail: `Δ${p.details.armBalance}°` },
                    { label: 'Quadril', val: p.details.hipScore, detail: `${p.details.hipThrust}cm` },
                    { label: 'Alt. bola', val: p.details.ballHeightScore, detail: ballMetric(p, 'ballMaxHeight'), estimated: p.details.ballEstimated },
                    { label: 'Dist. bola', val: p.details.ballDistScore, detail: ballMetric(p, 'ballHorizDist'), estimated: p.details.ballEstimated }
                  ].map((m) => (
                    <div key={m.label}
                         title={m.estimated ? 'Estimativa a partir do corpo — a bola não foi rastreada, então não conta no score.' : undefined}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <span className="text-xs text-muted">{m.label}</span>
                        <span className="num text-xs" style={{ color: m.estimated ? 'var(--text-faint)' : scoreColor(m.val) }}>
                          {m.detail}
                        </span>
                      </div>
                      <div style={{
                        height: 4, borderRadius: 2, background: 'var(--surface-sunken)', marginTop: 3,
                        border: '1px solid var(--border)'
                      }}>
                        <div style={{
                          height: '100%', borderRadius: 2, width: `${m.val}%`,
                          background: m.estimated ? 'var(--border-strong)' : scoreFill(m.val),
                          transition: 'width 0.4s ease'
                        }} />
                      </div>
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {p.flaws.map((f, j) => (
                    <p key={j} className="text-xs" style={{
                      color: f.startsWith('✅') ? 'var(--success)' : 'var(--text-muted)'
                    }}>{f}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {peitadas.length === 0 && detectorStatus === 'ready' && (
            <div className="card p-6 text-center">
              <p className="text-sm text-muted">
                Aperte <strong style={{ color: 'var(--text)' }}>play</strong>. Cada peitada é detectada
                automaticamente e recebe uma nota assim que o movimento fecha.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
