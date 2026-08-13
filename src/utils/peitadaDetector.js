/**
 * peitadaDetector.js
 * Real-time "Peitada" (chest attack) detector for futevôlei.
 *
 * Analyzes a stream of pose landmarks to detect individual peitada events,
 * score them biomechanically, and provide corrective feedback.
 *
 * All geometry runs on MediaPipe *world* landmarks (metres, origin between the
 * hips). The normalized image landmarks cannot be used for angles: x is scaled
 * by the frame width and y by the frame height, so on a 720x1280 video the
 * space is stretched 1.78x on one axis and every angle comes out skewed.
 * When world landmarks are missing we fall back to the normalized ones with the
 * aspect ratio undone, which restores square units even if the scale is
 * arbitrary.
 *
 * Uses a state machine approach:
 *   IDLE → PREPARING → ARCHING → IMPACT → LANDING → IDLE
 */

// Explicit extension so this module also loads under plain Node (see test/).
import { calculateAngle3D } from './geometryMath.js';

// Shoulder-to-ankle length of a typical footvolley athlete, used to express
// distances in centimetres when we only have unit-less fallback landmarks.
const BODY_HEIGHT_CM = 142;

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (v) => Math.hypot(v.x, v.y, v.z);

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z || 0) + (b.z || 0)) / 2
  };
}

/**
 * Direction the athlete faces, plus how far we should trust its *sign*.
 *
 * Sagittal lean can only be read reliably off the image plane: MediaPipe's z is
 * a weak depth estimate, so any direction that lives mostly in z carries a sign
 * we cannot stand behind. Confidence is therefore the share of the forward
 * vector lying along the image x axis — near 1 in a profile view (where a
 * backward arch is plainly visible) and near 0 head-on, where no 2D method can
 * separate an arch from a forward fold. Callers must degrade gracefully when
 * confidence is low rather than trusting a coin flip.
 *
 * Derived from heel→toe (and ear→nose as backup) because those genuinely point
 * forward. The hip axis is deliberately not used: crossing it with gravity
 * yields a forward vector that lies in z exactly when the hips are well
 * separated, which is precisely when its sign is least trustworthy.
 */
function facing(lm) {
  const candidates = [
    sub(midpoint(lm[31], lm[32]), midpoint(lm[29], lm[30])), // heels → toes
    sub(lm[0], midpoint(lm[7], lm[8]))                       // ears → nose
  ];

  let best = null;
  let bestConfidence = 0;
  for (const v of candidates) {
    const m = len(v);
    if (m < 1e-6) continue;
    const confidence = Math.abs(v.x) / m;
    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      best = { x: v.x / m, y: v.y / m, z: v.z / m };
    }
  }
  return { fwd: best, confidence: bestConfidence };
}

/**
 * Torso tilt from vertical, in degrees.
 * Positive = arching backwards (what a peitada needs), negative = folding forwards.
 */
function signedTorsoTilt(lm, fwd) {
  if (!fwd) return 0;
  const torso = sub(midpoint(lm[11], lm[12]), midpoint(lm[23], lm[24]));
  const upComponent = -torso.y; // y grows downwards
  const forwardLean = dot(torso, fwd);
  return (Math.atan2(-forwardLean, upComponent) * 180) / Math.PI;
}

/** Unsigned angle between the torso and vertical, in degrees. */
function torsoTiltMagnitude(lm) {
  const torso = sub(midpoint(lm[11], lm[12]), midpoint(lm[23], lm[24]));
  const m = len(torso);
  if (m < 1e-6) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, -torso.y / m))) * 180) / Math.PI;
}

/** Shoulder-to-ankle length, our unit-agnostic scale reference. */
function bodyScale(lm) {
  return len(sub(midpoint(lm[11], lm[12]), midpoint(lm[27], lm[28])));
}

const PHASES = {
  IDLE: 'idle',
  PREPARING: 'preparing',
  ARCHING: 'arching',
  IMPACT: 'impact',
  LANDING: 'landing'
};

// Thresholds for peitada detection
const ARCH_START_ANGLE = 12;  // backward torso tilt that starts a candidate
const ARCH_PEAK_ANGLE = 18;   // minimum peak tilt to qualify as a peitada
const RETURN_ANGLE = 10;      // torso tilt considered back to neutral
const PEAK_DROP_ANGLE = 4;    // fall from peak that marks the impact

// A rally of consecutive peitadas never brings the torso back near vertical, so
// closing an event on an absolute return angle swallows every peitada after the
// first. Close it once the arch has unwound most of the way from *its own*
// peak instead, and arm the next one on a fresh rise out of a local minimum
// rather than on a return to upright.
const RELEASE_FRACTION = 0.6; // of peak tilt
const RISE_DELTA = 8;         // degrees above the local minimum to re-arm

const COOLDOWN_MS = 350;      // minimum time between peitadas

// Re-detecting the *same* peitada (replay, seek) lands within a sample or two
// of the original because sampling is deterministic on video time. Keep this
// tight so genuinely close peitadas are not merged into one.
const DEDUPE_MS = 250;

// Samples in the smoothing window. At one sample per 50ms of video, 3 keeps a
// fast rally's peaks intact; longer windows flatten them into a single arch.
const TILT_SMOOTHING = 3;

// Hip thrust as a fraction of body height (unit-free, so framing/zoom independent)
const HIP_THRUST_GOOD = 0.07;
const HIP_THRUST_OK = 0.03;

// How much of the facing direction must lie in the image plane before we let
// its sign decide anything. Below this we only know *how far* the torso is off
// vertical, not which way, so we fall back to the unsigned angle and accept
// that a deep forward fold may be scored as a peitada. Detection must never be
// blocked by a direction we cannot see.
const FACING_CONFIDENCE = 0.5;

/**
 * Creates a PeitadaDetector instance.
 * Call `feed(pose, videoTimeMs)` on each sampled frame, where `pose` is
 * `{ landmarks, worldLandmarks }` as returned by poseDetector.detectPose().
 *
 * Timestamps must be *video* time, not wall-clock time, so that results do not
 * depend on playback rate. Seeking backwards is handled automatically.
 */
export function createPeitadaDetector() {
  let state = PHASES.IDLE;
  let currentPeitada = null;
  let peitadas = [];
  let lastPeitadaEndMs = -Infinity;
  let lastFedMs = -Infinity;
  let peakTilt = 0;
  let valleyTilt = Infinity; // local minimum while idle, used to re-arm
  let peakLandmarks = null;
  let tiltHistory = [];   // last N tilt values for smoothing
  let nextSeq = 1;        // stable id handed out to each candidate peitada
  let version = 0;        // bumped whenever the peitada list changes
  let videoAspect = 1;    // width / height, only used by the fallback path
  let pendingBallData = new Map(); // seq → ball data that arrived before commit
  let lastDebug = { tilt: 0, confidence: 0, state: PHASES.IDLE };

  function getSmoothedTilt(newTilt) {
    tiltHistory.push(newTilt);
    if (tiltHistory.length > TILT_SMOOTHING) tiltHistory.shift();
    return tiltHistory.reduce((s, v) => s + v, 0) / tiltHistory.length;
  }

  /**
   * Pick the landmark set to measure on. World landmarks are metric and free of
   * perspective distortion; the fallback merely un-stretches the image axes.
   */
  function metricLandmarks(pose) {
    if (pose.worldLandmarks && pose.worldLandmarks.length >= 33) {
      return pose.worldLandmarks;
    }
    if (!pose.landmarks || pose.landmarks.length < 33) return null;
    return pose.landmarks.map((lm) => ({
      x: lm.x * videoAspect,
      y: lm.y,
      z: (lm.z || 0) * videoAspect
    }));
  }

  function scorePeitada(peakLm, peakTiltAngle) {
    if (!peakLm || peakLm.length < 33) {
      return { score: 50, details: {}, bodyFlaws: ['Landmarks insuficientes para análise'] };
    }

    const scale = bodyScale(peakLm);
    const { fwd } = facing(peakLm);

    // 1. Knee flexion (ideal: 120°-150° for proper spring)
    const lKneeAngle = calculateAngle3D(peakLm[23], peakLm[25], peakLm[27]);
    const rKneeAngle = calculateAngle3D(peakLm[24], peakLm[26], peakLm[28]);
    const avgKnee = (lKneeAngle + rKneeAngle) / 2;
    let kneeScore;
    if (avgKnee >= 120 && avgKnee <= 150) kneeScore = 100;
    else if (avgKnee >= 100 && avgKnee <= 170) kneeScore = 70;
    else kneeScore = 40;

    // 2. Torso arch (ideal: 20°-40° backward tilt)
    let archScore;
    if (peakTiltAngle >= 20 && peakTiltAngle <= 40) archScore = 100;
    else if (peakTiltAngle >= 15 && peakTiltAngle <= 50) archScore = 70;
    else if (peakTiltAngle >= 10) archScore = 50;
    else archScore = 30;

    // 3. Arm balance (arms should be roughly symmetric and extended)
    const lArmAngle = calculateAngle3D(peakLm[11], peakLm[13], peakLm[15]);
    const rArmAngle = calculateAngle3D(peakLm[12], peakLm[14], peakLm[16]);
    const armDiff = Math.abs(lArmAngle - rArmAngle);
    let armScore;
    if (armDiff < 15) armScore = 100;
    else if (armDiff < 30) armScore = 75;
    else armScore = 50;

    // 4. Hip thrust: how far the hips lead the ankles along the facing axis,
    //    as a fraction of body height so that camera distance does not matter.
    const hipLead = fwd
      ? dot(sub(midpoint(peakLm[23], peakLm[24]), midpoint(peakLm[27], peakLm[28])), fwd)
      : 0;
    const hipThrustRatio = scale > 1e-6 ? hipLead / scale : 0;
    let hipScore;
    if (hipThrustRatio > HIP_THRUST_GOOD) hipScore = 100;
    else if (hipThrustRatio > HIP_THRUST_OK) hipScore = 70;
    else hipScore = 40;

    // Weighted total (body-only, before ball data)
    const score = Math.round(
      kneeScore * 0.30 + archScore * 0.30 + armScore * 0.20 + hipScore * 0.20
    );

    // Detect flaws
    const bodyFlaws = [];
    if (avgKnee > 165) bodyFlaws.push('🦵 Perna dura: flexione mais os joelhos antes do impacto para agir como uma mola e ganhar impulsão.');
    if (avgKnee < 100) bodyFlaws.push('🦵 Agachamento excessivo: não flexione tanto os joelhos, senão você perde o tempo de bola e o impacto.');
    if (peakTiltAngle < 15) bodyFlaws.push('🔙 Tronco reto: jogue os ombros para trás e projete o peito para cima, formando um arco para bater embaixo da bola.');
    if (peakTiltAngle > 50) bodyFlaws.push('🔙 Cuidado com a lombar: você está arqueando demais as costas. Tente manter o arqueamento controlado.');
    if (armDiff > 30) bodyFlaws.push('💪 Desequilíbrio: abra bem os dois braços simultaneamente para ganhar estabilidade no ar e direcionar a bola.');
    if (hipThrustRatio < HIP_THRUST_OK) bodyFlaws.push('🏋️ Faltou quadril: na hora do contato com a bola, impulsione o quadril forte para frente para dar potência à peitada.');

    return {
      score,
      details: {
        kneeFlexion: Math.round(avgKnee),
        kneeScore,
        torsoArch: Math.round(peakTiltAngle),
        archScore,
        armBalance: Math.round(armDiff),
        armScore,
        hipThrust: Math.round(hipThrustRatio * BODY_HEIGHT_CM * 10) / 10,
        hipScore,
        // Ball metrics are filled in later via applyBallData()
        ballMaxHeight: 0,
        ballHeightScore: 0,
        ballHorizDist: 0,
        ballDistScore: 0,
        ballEstimated: true
      },
      bodyFlaws
    };
  }

  /** Rebuilds the visible flaw list so re-analysis never duplicates entries. */
  function composeFlaws(p) {
    const all = [...(p.ballFlaws || []), ...(p.bodyFlaws || [])];
    p.flaws = all.length > 0
      ? all
      : ['✅ Movimento impecável! O arco, a flexão e os braços estão perfeitos.'];
  }

  /**
   * Insert a finished peitada, replacing any previous detection of the same
   * moment. Without this, replaying or seeking over a segment appends the same
   * peitada again and again.
   */
  function commit(p) {
    const existing = peitadas.findIndex((x) => Math.abs(x.startMs - p.startMs) < DEDUPE_MS);
    if (existing >= 0) peitadas[existing] = p;
    else peitadas.push(p);
    peitadas.sort((a, b) => a.startMs - b.startMs);
    peitadas.forEach((x, i) => { x.index = i; });
    version++;

    // The ball can land before the athlete does, in which case its data arrived
    // while this peitada was still in flight.
    const pending = pendingBallData.get(p.seq);
    if (pending) {
      pendingBallData.delete(p.seq);
      applyBallData(p.seq, pending);
    }
  }

  /** Scores and commits the in-flight peitada, then arms for the next one. */
  function finishPeitada(videoTimeMs, tilt) {
    const result = scorePeitada(peakLandmarks, peakTilt);
    currentPeitada.endMs = videoTimeMs;
    currentPeitada.score = result.score;
    currentPeitada.bodyScore = result.score;
    currentPeitada.details = result.details;
    currentPeitada.bodyFlaws = result.bodyFlaws;
    currentPeitada.ballFlaws = [];
    composeFlaws(currentPeitada);

    commit(currentPeitada);
    lastPeitadaEndMs = videoTimeMs;

    // The valley restarts from where this one closed, so a rally re-arms on the
    // next rise instead of waiting for the athlete to straighten up. The
    // smoothing window is deliberately kept: clearing it mid-rally would create
    // an artificial jump in the very signal used to arm the next peitada.
    state = PHASES.LANDING;
    currentPeitada = null;
    peakTilt = 0;
    valleyTilt = tilt;
    peakLandmarks = null;
  }

  function feed(pose, videoTimeMs) {
    if (!pose) return;
    const lm = metricLandmarks(pose);
    if (!lm) return;

    // The user seeked backwards: drop the in-flight candidate so the state
    // machine and the cooldown do not sit in the future and stall detection.
    if (videoTimeMs < lastFedMs - 100) resetTransient();
    lastFedMs = videoTimeMs;

    const { fwd, confidence } = facing(lm);

    // Only let the sign gate detection when we can actually see which way the
    // athlete faces. Otherwise use the unsigned angle, so a movement is never
    // silently dropped because of a depth estimate we do not trust.
    const rawTilt = confidence >= FACING_CONFIDENCE
      ? signedTorsoTilt(lm, fwd)
      : torsoTiltMagnitude(lm);

    const tilt = getSmoothedTilt(rawTilt);
    lastDebug = { tilt: Math.round(tilt), confidence: Math.round(confidence * 100) / 100, state };

    switch (state) {
      case PHASES.IDLE:
        // Track the local minimum so the next peitada is armed by a fresh rise,
        // not by the athlete standing up straight (which never happens mid-rally).
        valleyTilt = Math.min(valleyTilt, tilt);
        if (
          tilt > ARCH_START_ANGLE &&
          tilt > valleyTilt + RISE_DELTA &&
          (videoTimeMs - lastPeitadaEndMs) > COOLDOWN_MS
        ) {
          state = PHASES.PREPARING;
          peakTilt = tilt;
          peakLandmarks = lm;
          currentPeitada = { startMs: videoTimeMs, seq: nextSeq++ };
        }
        break;

      case PHASES.PREPARING:
        if (tilt > peakTilt) {
          peakTilt = tilt;
          peakLandmarks = lm;
        }
        if (tilt > ARCH_PEAK_ANGLE) {
          state = PHASES.ARCHING;
        } else if (tilt < RETURN_ANGLE) {
          // False start — back to idle. Clear the smoothing window too, or the
          // aborted attempt bleeds into the next one.
          state = PHASES.IDLE;
          currentPeitada = null;
          peakTilt = 0;
          peakLandmarks = null;
          tiltHistory = [];
        }
        break;

      case PHASES.ARCHING:
        if (tilt > peakTilt) {
          peakTilt = tilt;
          peakLandmarks = lm;
        } else if (tilt < peakTilt - PEAK_DROP_ANGLE) {
          // Past the peak — this is the impact moment
          state = PHASES.IMPACT;
          currentPeitada.impactMs = videoTimeMs;
          currentPeitada.peakTilt = peakTilt;
        }
        break;

      case PHASES.IMPACT:
        // Close on a relative unwind, so a rally does not collapse into one
        // long IMPACT that never commits. Scoring happens right here rather
        // than on the following sample: a peitada at the very end of the clip
        // would otherwise never be committed at all.
        if (tilt < Math.max(RETURN_ANGLE, peakTilt * RELEASE_FRACTION)) {
          finishPeitada(videoTimeMs, tilt);
        }
        break;

      case PHASES.LANDING:
        // Already scored; this state exists only so the UI can show the
        // landing beat before going back to idle.
        state = PHASES.IDLE;
        break;
    }
  }

  /**
   * Commit a peitada that is still in flight. The closing unwind can lag the
   * movement by a few samples, so a peitada performed right at the end of a
   * clip would otherwise never be scored. Call this when playback ends.
   */
  function flush(videoTimeMs) {
    const qualified =
      currentPeitada &&
      peakTilt >= ARCH_PEAK_ANGLE &&
      (state === PHASES.IMPACT || state === PHASES.ARCHING);
    if (!qualified) return;
    finishPeitada(videoTimeMs ?? lastFedMs, 0);
    state = PHASES.IDLE;
  }

  function getCurrentState() {
    return state;
  }

  function getPeitadas() {
    return peitadas.map((p) => ({ ...p, details: { ...p.details }, flaws: [...p.flaws] }));
  }

  function getLatestPeitada() {
    return peitadas.length > 0 ? peitadas[peitadas.length - 1] : null;
  }

  function getCurrentPeakTilt() {
    return peakTilt;
  }

  /** Stable id of the candidate currently in flight, for ball association. */
  function getPendingSeq() {
    return currentPeitada ? currentPeitada.seq : null;
  }

  /** Bumped whenever the peitada list changes, so the UI can skip re-renders. */
  function getVersion() {
    return version;
  }

  /**
   * Live smoothed tilt and facing confidence. Surfaced in the UI so a failure
   * to detect is visible instead of silent — this exact failure mode (sign
   * inverted, threshold never reached, nothing scored) is otherwise invisible.
   */
  function getDebug() {
    return { ...lastDebug, state };
  }

  function setVideoAspect(ratio) {
    if (ratio > 0) videoAspect = ratio;
  }

  /**
   * Attach ball tracking results to the peitada identified by `seq`.
   *
   * Estimated (non-measured) trajectories are displayed but deliberately kept
   * out of the score: they are derived from torso tilt, not from the ball, and
   * letting them move the grade would be inventing a measurement.
   */
  function applyBallData(seq, ballData) {
    if (seq == null || !ballData) return;

    const p = peitadas.find((x) => x.seq === seq);
    if (!p) {
      // Not committed yet — stash it, commit() will pick it up.
      if (currentPeitada && currentPeitada.seq === seq) pendingBallData.set(seq, ballData);
      return;
    }

    const hMeters = ballData.maxHeightMeters;
    const dMeters = ballData.horizontalDistanceMeters;

    // Ball max height in meters (ideal for footvolley peitada: 1.2m to 2.8m above impact)
    let ballHeightScore;
    if (hMeters >= 1.2 && hMeters <= 2.8) ballHeightScore = 100;
    else if (hMeters >= 0.8 && hMeters <= 3.5) ballHeightScore = 75;
    else if (hMeters >= 0.4) ballHeightScore = 50;
    else ballHeightScore = 25;

    // Ball horizontal distance in meters (ideal: 0.8m to 2.5m towards net/partner)
    let ballDistScore;
    if (dMeters >= 0.8 && dMeters <= 2.5) ballDistScore = 100;
    else if (dMeters >= 0.4 && dMeters <= 3.5) ballDistScore = 75;
    else if (dMeters < 0.4) ballDistScore = 40; // too vertical
    else ballDistScore = 50;                    // too far

    p.details.ballMaxHeight = hMeters;
    p.details.ballHeightScore = ballHeightScore;
    p.details.ballHorizDist = dMeters;
    p.details.ballDistScore = ballDistScore;
    p.details.ballEstimated = !ballData.measured;

    p.ballFlaws = [];

    if (ballData.measured) {
      // Body: 75% (knee 20%, arch 22%, arms 17%, hip 16%) — Ball: 25% (height 15%, distance 10%)
      p.score = Math.round(
        p.details.kneeScore * 0.20 +
        p.details.archScore * 0.22 +
        p.details.armScore * 0.17 +
        p.details.hipScore * 0.16 +
        ballHeightScore * 0.15 +
        ballDistScore * 0.10
      );

      if (hMeters < 0.8) p.ballFlaws.push(`🏐 Bola baixa (${hMeters}m): projete o peito mais para cima no contato para subir a bola no mínimo 1.20m.`);
      if (hMeters > 3.5) p.ballFlaws.push(`🏐 Bola muito alta (${hMeters}m): controle o impacto do peito para não estourar a bola além de 2.80m.`);
      if (dMeters < 0.4) p.ballFlaws.push(`📏 Sem projeção (${dMeters}m): empurre a bola para frente (meta: 1.0m ~ 2.0m) para seu parceiro levantar.`);
      if (dMeters > 3.5) p.ballFlaws.push(`📏 Bola longa (${dMeters}m): amortecida exagerada. Tente controlar o deslocamento em até 2.50m.`);
    } else {
      p.score = p.bodyScore;
    }

    composeFlaws(p);
    version++;
  }

  function getOverallScore() {
    if (peitadas.length === 0) return 0;
    return Math.round(peitadas.reduce((s, p) => s + p.score, 0) / peitadas.length);
  }

  /** Clears the in-flight candidate but keeps everything already detected. */
  function resetTransient() {
    state = PHASES.IDLE;
    currentPeitada = null;
    peakTilt = 0;
    valleyTilt = Infinity;
    peakLandmarks = null;
    tiltHistory = [];
    lastPeitadaEndMs = -Infinity;
    lastFedMs = -Infinity;
    pendingBallData.clear();
  }

  function reset() {
    resetTransient();
    peitadas = [];
    nextSeq = 1;
    version++;
  }

  return {
    feed,
    flush,
    getCurrentState,
    getPeitadas,
    getLatestPeitada,
    getCurrentPeakTilt,
    getPendingSeq,
    getVersion,
    getDebug,
    getOverallScore,
    setVideoAspect,
    applyBallData,
    resetTransient,
    reset
  };
}
