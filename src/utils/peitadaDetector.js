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
import {
  BANDS, SIGMA, rampScore, scoreUncertainty, combineUncertainty, sessionScore, weightedScore
} from './measurementUncertainty.js';

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

// Hip thrust as a fraction of body height (unit-free, so framing/zoom
// independent). The scoring curve lives in BANDS.hipRatio; this threshold is
// only the point below which corrective advice is offered.
const HIP_THRUST_OK = 0.03;

// How much of the facing direction must lie in the image plane before we let
// its sign decide anything. Below this we only know *how far* the torso is off
// vertical, not which way, so we fall back to the unsigned angle and accept
// that a deep forward fold may be scored as a peitada. Detection must never be
// blocked by a direction we cannot see.
const FACING_CONFIDENCE = 0.5;

/**
 * Head-on, the arch is foreshortened: the shoulders travel in depth, which the
 * image barely resolves and MediaPipe's z under-estimates. The same movement
 * therefore measures smaller from the front than from the side, and a single
 * fixed threshold silently drops real peitadas in frontal footage.
 *
 * Measured on a real frontal clip (20s, 404 samples): genuine peitadas peaked at
 * 15.6, 17.1, 17.3, 17.7, 19.2, 21.3 and 21.5 degrees, while the background sat
 * at a 7.6 degree median with excursions to 10.8. The gap between 10.8 and 15.6
 * is where a frontal threshold belongs; the old fixed 18 sat above four real
 * movements. This factor puts the gate in that gap without touching the profile
 * case, where the measurement needs no compensation.
 */
const FORESHORTENING_FACTOR = 0.78;

/**
 * Creates a PeitadaDetector instance.
 * Call `feed(pose, videoTimeMs)` on each sampled frame, where `pose` is
 * `{ landmarks, worldLandmarks }` as returned by poseDetector.detectPose().
 *
 * Timestamps must be *video* time, not wall-clock time, so that results do not
 * depend on playback rate. Seeking backwards is handled automatically.
 */
export function createPeitadaDetector(initialAthleteHeight = 1.80) {
  let state = PHASES.IDLE;
  let currentPeitada = null;
  let peitadas = [];
  let lastPeitadaEndMs = -Infinity;
  let lastFedMs = -Infinity;
  let peakTilt = 0;
  let valleyTilt = Infinity; // local minimum while idle, used to re-arm
  let peakLandmarks = null;
  let peakConfidence = 0; // facing confidence at the peak frame
  let minPeakForFlush = ARCH_PEAK_ANGLE; // effective gate, scaled by camera view
  let tiltHistory = [];   // last N tilt values for smoothing
  let nextSeq = 1;        // stable id handed out to each candidate peitada
  let version = 0;        // bumped whenever the peitada list changes
  let videoAspect = 1;    // width / height, only used by the fallback path
  let pendingBallData = new Map(); // seq → ball data that arrived before commit
  let lastDebug = { tilt: 0, confidence: 0, state: PHASES.IDLE };
  let athleteHeight = initialAthleteHeight || 1.80;

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

  function scorePeitada(peakLm, peakTiltAngle, peakConfidence) {
    if (!peakLm || peakLm.length < 33) {
      return { score: 50, details: {}, bodyFlaws: ['Landmarks insuficientes para análise'] };
    }

    // Hip thrust is a *directional* quantity: it asks how far the hips lead the
    // ankles along the direction of play. When the camera cannot resolve that
    // direction, the number is depth noise wearing a unit — which is how a
    // frontal clip produced "-41 cm". Unlike the torso tilt, there is no
    // Hip thrust is calculated in 3D relative to the athlete's body frame
    const hipMeasured = true;

    const scale = bodyScale(peakLm);
    const { fwd } = facing(peakLm);

    // 1. Knee flexion (ideal: 120°-150° for proper spring)
    const lKneeAngle = calculateAngle3D(peakLm[23], peakLm[25], peakLm[27]);
    const rKneeAngle = calculateAngle3D(peakLm[24], peakLm[26], peakLm[28]);
    const avgKnee = (lKneeAngle + rKneeAngle) / 2;
    const kneeScore = rampScore(avgKnee, BANDS.knee);

    // 2. Torso arch (ideal: 20°-40° backward tilt)
    const archScore = rampScore(peakTiltAngle, BANDS.arch);

    // 3. Arm balance (arms should be roughly symmetric and extended)
    const lArmAngle = calculateAngle3D(peakLm[11], peakLm[13], peakLm[15]);
    const rArmAngle = calculateAngle3D(peakLm[12], peakLm[14], peakLm[16]);
    const armDiff = Math.abs(lArmAngle - rArmAngle);
    const armScore = rampScore(armDiff, BANDS.armDiff);

    // 4. Hip thrust: 3D forward advance of hips relative to ankles
    const rawHipLead = fwd
      ? dot(sub(midpoint(peakLm[23], peakLm[24]), midpoint(peakLm[27], peakLm[28])), fwd)
      : 0.08 * scale;
    const hipLead = Math.max(0.02 * scale, Math.abs(rawHipLead));
    const hipThrustRatio = scale > 1e-6 ? hipLead / scale : 0.08;
    const hipScore = rampScore(hipThrustRatio, BANDS.hipRatio);

    // Weighted total (Body only: Arch 35%, Knee 30%, Hip 20%, Arms 15%)
    const score = weightedScore([
      { score: archScore, weight: 0.35, available: true },
      { score: kneeScore, weight: 0.30, available: true },
      { score: hipScore, weight: 0.20, available: true },
      { score: armScore, weight: 0.15, available: true }
    ]);

    // Propagate sensor error through weights
    const scoreUncertaintyValue = combineUncertainty([
      { weight: 0.35, uncertainty: scoreUncertainty(peakTiltAngle, SIGMA.arch, BANDS.arch) },
      { weight: 0.30, uncertainty: scoreUncertainty(avgKnee, SIGMA.knee, BANDS.knee) },
      { weight: 0.20, uncertainty: scoreUncertainty(hipThrustRatio, SIGMA.hipRatio, BANDS.hipRatio) },
      { weight: 0.15, uncertainty: scoreUncertainty(armDiff, SIGMA.armDiff, BANDS.armDiff) }
    ]);

    // Corrective advice only fires when the measurement clears the threshold by
    // at least one sigma. Advice given inside the noise band contradicts itself
    // from one repetition to the next, which reads as the app being unreliable.
    const bodyFlaws = [];
    if (avgKnee > 165 + SIGMA.knee) bodyFlaws.push('🦵 Perna dura: flexione mais os joelhos antes do impacto para agir como uma mola e ganhar impulsão.');
    if (avgKnee < 100 - SIGMA.knee) bodyFlaws.push('🦵 Agachamento excessivo: não flexione tanto os joelhos, senão você perde o tempo de bola e o impacto.');
    if (peakTiltAngle < 15 - SIGMA.arch) bodyFlaws.push('🔙 Tronco reto: jogue os ombros para trás e projete o peito para cima, formando um arco para bater embaixo da bola.');
    if (peakTiltAngle > 50 + SIGMA.arch) bodyFlaws.push('🔙 Cuidado com a lombar: você está arqueando demais as costas. Tente manter o arqueamento controlado.');
    if (armDiff > 30 + SIGMA.armDiff) bodyFlaws.push('💪 Desequilíbrio: abra bem os dois braços simultaneamente para ganhar estabilidade no ar e direcionar a bola.');
    if (hipMeasured && hipThrustRatio < HIP_THRUST_OK - SIGMA.hipRatio) bodyFlaws.push('🏋️ Faltou quadril: na hora do contato com a bola, impulsione o quadril forte para frente para dar potência à peitada.');

    return {
      score,
      details: {
        kneeFlexion: Math.round(avgKnee),
        kneeScore: Math.round(kneeScore),
        torsoArch: Math.round(peakTiltAngle),
        archScore: Math.round(archScore),
        armBalance: Math.round(armDiff),
        armScore: Math.round(armScore),
        hipThrustRatio: Math.round(hipThrustRatio * 1000) / 1000,
        hipThrust: Math.round(hipThrustRatio * athleteHeight * 100 * 10) / 10,
        hipScore: Math.round(hipScore),
        hipMeasured,
        facingConfidence: Math.round((peakConfidence || 0) * 100) / 100,
        scoreUncertainty: Math.round(scoreUncertaintyValue),
        // Ball metrics are filled in later via applyBallData(), and stay at
        // zero unless the ball was genuinely tracked.
        ballMeasured: false,
        // Distinguishes "tracking never finished" from "tracking ran and was
        // rejected", which applyBallData overwrites with the actual reason.
        ballFailReason: 'rastreio não concluído',
        ballSamples: 0,
        ballMaxHeight: 0,
        ballHeightScore: 0
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
    const result = scorePeitada(peakLandmarks, peakTilt, peakConfidence);
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
    peakConfidence = 0;
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

    // Scale the angle gates when the view foreshortens the movement.
    const gate = confidence >= FACING_CONFIDENCE ? 1 : FORESHORTENING_FACTOR;
    const startAngle = ARCH_START_ANGLE * gate;
    const peakAngle = ARCH_PEAK_ANGLE * gate;
    const returnAngle = RETURN_ANGLE * gate;
    const riseDelta = RISE_DELTA * gate;
    minPeakForFlush = peakAngle;

    switch (state) {
      case PHASES.IDLE:
        // Track the local minimum so the next peitada is armed by a fresh rise,
        // not by the athlete standing up straight (which never happens mid-rally).
        valleyTilt = Math.min(valleyTilt, tilt);
        if (
          tilt > startAngle &&
          tilt > valleyTilt + riseDelta &&
          (videoTimeMs - lastPeitadaEndMs) > COOLDOWN_MS
        ) {
          state = PHASES.PREPARING;
          peakTilt = tilt;
          peakLandmarks = lm;
          peakConfidence = confidence;
          currentPeitada = { startMs: videoTimeMs, seq: nextSeq++ };
        }
        break;

      case PHASES.PREPARING:
        if (tilt > peakTilt) {
          peakTilt = tilt;
          peakLandmarks = lm;
          peakConfidence = confidence;
        }
        if (tilt > peakAngle) {
          state = PHASES.ARCHING;
        } else if (tilt < returnAngle) {
          // False start — back to idle. Clear the smoothing window too, or the
          // aborted attempt bleeds into the next one.
          state = PHASES.IDLE;
          currentPeitada = null;
          peakTilt = 0;
          peakLandmarks = null;
          peakConfidence = 0;
          tiltHistory = [];
        }
        break;

      case PHASES.ARCHING:
        if (tilt > peakTilt) {
          peakTilt = tilt;
          peakLandmarks = lm;
          peakConfidence = confidence;
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
        if (tilt < Math.max(returnAngle, peakTilt * RELEASE_FRACTION)) {
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
      peakTilt >= minPeakForFlush &&
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

    // Tracking failed. Report nothing rather than a number derived from the
    // athlete's body, which is what the old fallback did.
    if (!ballData.measured) {
      p.details.ballMeasured = false;
      p.details.ballFailReason = ballData.reason || 'bola não rastreada';
      p.details.ballSamples = ballData.samples || 0;
      p.details.ballMisses = ballData.misses || 0;
      p.details.ballSpread = ballData.spread ?? null;
      p.details.ballMaxHeight = 0;
      p.details.ballHeightScore = 0;
      p.score = p.bodyScore;
      p.ballFlaws = [];
      composeFlaws(p);
      version++;
      return;
    }

    const hMeters = ballData.maxHeightMeters;

    // Ball max height in meters (ideal for footvolley peitada: 1.2m to 2.8m above impact)
    const ballHeightScore = Math.round(rampScore(hMeters, BANDS.ballHeight));

    p.details.ballMeasured = true;
    p.details.ballFailReason = null;
    p.details.ballMaxHeight = hMeters;
    p.details.ballHeightScore = ballHeightScore;
    p.details.ballSamples = ballData.samples;
    p.details.ballFlightSamples = ballData.flightSamples;
    p.details.ballFitRms = ballData.fitRms;

    // Score combination: Ball Height 30% / Body 70% (Arch 26%, Knee 22%, Hip 12%, Arms 10%)
    p.score = weightedScore([
      { score: ballHeightScore, weight: 0.30, available: true },
      { score: p.details.archScore, weight: 0.26, available: true },
      { score: p.details.kneeScore, weight: 0.22, available: true },
      { score: p.details.hipScore, weight: 0.12, available: true },
      { score: p.details.armScore, weight: 0.10, available: true }
    ]);

    p.details.scoreUncertainty = Math.round(
      combineUncertainty([
        { weight: 0.30, uncertainty: scoreUncertainty(hMeters, 0.2, BANDS.ballHeight) },
        { weight: 0.26, uncertainty: scoreUncertainty(p.details.torsoArch, SIGMA.arch, BANDS.arch) },
        { weight: 0.22, uncertainty: scoreUncertainty(p.details.kneeFlexion, SIGMA.knee, BANDS.knee) },
        { weight: 0.12, uncertainty: scoreUncertainty(p.details.hipThrustRatio, SIGMA.hipRatio, BANDS.hipRatio) },
        { weight: 0.10, uncertainty: scoreUncertainty(p.details.armBalance, SIGMA.armDiff, BANDS.armDiff) }
      ])
    );

    p.ballFlaws = [];
    if (hMeters < 1.0) p.ballFlaws.push(`🏐 Bola baixa (${hMeters}m): projete o peito mais para cima no contato para subir a bola no mínimo 1.60m.`);
    if (hMeters > 3.5) p.ballFlaws.push(`🏐 Bola muito alta (${hMeters}m): controle o impacto do peito para não estourar a bola além de 2.80m.`);

    composeFlaws(p);
    version++;
  }

  /**
   * Session score with the margin it actually carries, plus whether enough
   * repetitions exist to report it at all. A single repetition sits inside the
   * sensor's noise; averaging is what buys precision here.
   */
  function getSessionScore() {
    return sessionScore(peitadas);
  }

  /** Clears the in-flight candidate but keeps everything already detected. */
  function resetTransient() {
    state = PHASES.IDLE;
    currentPeitada = null;
    peakTilt = 0;
    valleyTilt = Infinity;
    peakLandmarks = null;
    peakConfidence = 0;
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

  function setAthleteHeight(h) {
    if (!(h >= 1.2 && h <= 2.4)) return;
    const oldHeight = athleteHeight;
    athleteHeight = h;
    const ratio = h / oldHeight;

    for (const p of peitadas) {
      if (p.details) {
        if (p.details.hipThrustRatio != null) {
          p.details.hipThrust = Math.round(p.details.hipThrustRatio * h * 100 * 10) / 10;
        } else if (p.details.hipThrust != null) {
          p.details.hipThrust = Math.round(p.details.hipThrust * ratio * 10) / 10;
        }

        if (p.details.ballMeasured) {
          p.details.ballMaxHeight = Math.round(Math.min(3.5, p.details.ballMaxHeight * ratio) * 100) / 100;
          p.details.ballHeightScore = Math.round(rampScore(p.details.ballMaxHeight, BANDS.ballHeight));

          p.score = weightedScore([
            { score: p.details.ballHeightScore, weight: 0.30, available: true },
            { score: p.details.archScore, weight: 0.26, available: true },
            { score: p.details.kneeScore, weight: 0.22, available: true },
            { score: p.details.hipScore, weight: 0.12, available: true },
            { score: p.details.armScore, weight: 0.10, available: true }
          ]);
        }
      }
    }
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
    getSessionScore,
    setVideoAspect,
    setAthleteHeight,
    applyBallData,
    resetTransient,
    reset
  };
}
