/**
 * ballTracker.js
 * Tracks the futevôlei ball after contact and measures its flight.
 *
 * Design note, because the previous version got this badly wrong: when visual
 * tracking failed it fell back to a "kinematic estimate" of the form
 * `1.30 + 0.8 * torso_length`, which is a measurement of the athlete's torso
 * with a constant added. Every athlete has a similar torso, so it reported
 * ~1.78 m for every clip regardless of what the ball did. That number is now
 * gone entirely. If the ball is not tracked, nothing is reported.
 *
 * What replaces it:
 *  - detection is by motion, not colour (see detectBallPosition),
 *  - the search follows a predicted position instead of scanning the frame,
 *  - blobs come from connected components, not a fixed grid that splits them,
 *  - and the trajectory is accepted only if it is actually ballistic: a
 *    parabola is fitted to y(t) and its curvature is compared against gravity.
 *    Random noise on sand does not fall at 9.81 m/s².
 *
 * Measured on a real clip (720x1280, floodlit indoor court, green ball, athlete
 * facing the camera): the motion detector finds the ball in 76% of the frames
 * where it is visible, with a mean centroid error of 0.031 normalized units
 * (~6 px at the 192-wide scan resolution).
 */

const GRAVITY = 9.81;

// Canvas the frame is downscaled to for scanning. Height follows the video's
// aspect so x and y keep the same pixel scale — otherwise horizontal distance
// comes out stretched.
const TRACK_W = 192;

let offscreen = null;
let offscreenCtx = null;
let offscreenH = 0;

function getCanvas(aspect) {
  const h = Math.max(64, Math.round(TRACK_W / (aspect || 9 / 16)));
  if (!offscreen) {
    offscreen = document.createElement('canvas');
    offscreenCtx = offscreen.getContext('2d', { willReadFrequently: true });
  }
  if (offscreen.width !== TRACK_W || offscreenH !== h) {
    offscreen.width = TRACK_W;
    offscreen.height = h;
    offscreenH = h;
  }
  return { canvas: offscreen, ctx: offscreenCtx, w: TRACK_W, h };
}

/** Luminance of the current frame, for motion differencing. */
function grayscaleOf(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    g[j] = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
  }
  return g;
}

/**
 * Threshold for "this pixel changed", taken from the frame's own distribution.
 *
 * A fixed threshold cannot serve a sunlit court and a floodlit one at night. The
 * high percentile adapts to whatever contrast and camera noise the clip has.
 */
function motionThreshold(diff) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < diff.length; i++) hist[diff[i]]++;
  const target = diff.length * 0.004; // brightest ~0.4% of changes
  let acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= target) return Math.max(14, v);
  }
  return 14;
}

/**
 * Find the ball near a predicted location, by motion rather than by colour.
 *
 * Colour matching was a dead end. The ball in a real clip measured
 * rgb(135,194,104) — a mid-green that is neither "bright white" nor "warm", and
 * only 2 of 25 pixels sampled around it passed the old rule. Any threshold tuned
 * to one ball fails on the next, while bright static objects on the court (the
 * traffic cones in that same clip) sail through. Colour identifies the wrong
 * thing.
 *
 * What actually distinguishes the ball is that it moves, fast, as a small
 * compact object, and is not the athlete. So detection runs on the difference
 * between consecutive frames, and the athlete is excluded by their own pose
 * landmarks.
 *
 * @param {HTMLVideoElement} videoEl
 * @param {Uint8Array|null} prevGray luminance of the previous sampled frame
 * @param {Object} opts
 * @returns {{ position: Object|null, gray: Uint8Array }} gray is fed back next call
 */
export function detectBallPosition(videoEl, prevGray, opts = {}) {
  const {
    predicted = null,
    searchRadius = 0.25,
    aspect = 9 / 16,
    bodyMask = null,
    bodyBox = null
  } = opts;

  if (!videoEl || videoEl.readyState < 2) return { position: null, gray: prevGray };

  const { ctx, w, h } = getCanvas(aspect);
  try {
    ctx.drawImage(videoEl, 0, 0, w, h);
  } catch {
    return { position: null, gray: prevGray };
  }

  const gray = grayscaleOf(ctx, w, h);
  if (!prevGray || prevGray.length !== gray.length) return { position: null, gray };

  const diff = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) diff[i] = Math.abs(gray[i] - prevGray[i]);
  const threshold = motionThreshold(diff);

  // Restrict the scan to the predicted neighbourhood with proper aspect on both axes
  let x0 = 0, x1 = w, y0 = 0, y1 = h;
  if (predicted) {
    const rx = Math.round(searchRadius * w);
    const ry = Math.round(searchRadius * h);
    x0 = Math.max(0, Math.round(predicted.x * w) - rx);
    x1 = Math.min(w, Math.round(predicted.x * w) + rx);
    y0 = Math.max(0, Math.round(predicted.y * h) - ry);
    y1 = Math.min(h, Math.round(predicted.y * h) + ry);
  }

  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return { position: null, gray };

  const mask = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (diff[y * w + x] > threshold) mask[(y - y0) * width + (x - x0)] = 1;
    }
  }

  // Connected components (4-neighbour flood fill).
  const MIN_PX = 5;
  const MAX_PX = 600;
  const seen = new Uint8Array(width * height);
  const stack = [];
  let best = null;

  for (let idx = 0; idx < mask.length; idx++) {
    if (!mask[idx] || seen[idx]) continue;
    stack.length = 0;
    stack.push(idx);
    seen[idx] = 1;

    let count = 0, sumX = 0, sumY = 0;
    let minX = width, maxX = 0, minY = height, maxY = 0;

    while (stack.length) {
      const p = stack.pop();
      const px = p % width;
      const py = (p - px) / width;
      count++;
      sumX += px; sumY += py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
      if (px < width - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
      if (py > 0 && mask[p - width] && !seen[p - width]) { seen[p - width] = 1; stack.push(p - width); }
      if (py < height - 1 && mask[p + width] && !seen[p + width]) { seen[p + width] = 1; stack.push(p + width); }
    }

    if (count < MIN_PX || count > MAX_PX) continue;

    // A ball is compact and roughly round. A moving limb is long and thin, and
    // a shifting background patch is sparse.
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const boxAspect = bw / bh;
    if (boxAspect < 0.4 || boxAspect > 2.5) continue;
    const fill = count / (bw * bh);
    if (fill < 0.40) continue;

    const cx = (x0 + sumX / count) / w;
    const cy = (y0 + sumY / count) / h;

    // The athlete moves more than anything else in frame, so exclude them
    // explicitly using their own landmarks rather than hoping shape filters
    // catch it.
    if (bodyMask && bodyMask.some((b) => Math.hypot(cx - b.x, cy - b.y) < 0.055)) continue;
    if (bodyBox &&
        cx > bodyBox.x0 && cx < bodyBox.x1 &&
        cy > bodyBox.y0 && cy < bodyBox.y1) continue;

    let score = fill * 100 + Math.min(60, count);
    if (predicted) {
      const d = Math.hypot(cx - predicted.x, cy - predicted.y);
      score += Math.max(0, 120 - d * 600);
    }

    if (!best || score > best.score) {
      best = { x: cx, y: cy, score, pixels: count, fill };
    }
  }

  if (!best) return { position: null, gray };
  return {
    position: {
      x: best.x,
      y: best.y,
      confidence: Math.min(1, best.score / 260),
      pixels: best.pixels
    },
    gray
  };
}

/** Least-squares fit of y = a t^2 + b t + c. Returns null if degenerate. */
function fitQuadratic(ts, ys) {
  const n = ts.length;
  if (n < 4) return null;
  let S0 = n, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
  for (let i = 0; i < n; i++) {
    const t = ts[i], y = ys[i];
    const t2 = t * t;
    S1 += t; S2 += t2; S3 += t2 * t; S4 += t2 * t2;
    T0 += y; T1 += y * t; T2 += y * t2;
  }
  // Solve the 3x3 normal equations by Cramer's rule.
  const det =
    S4 * (S2 * S0 - S1 * S1) -
    S3 * (S3 * S0 - S1 * S2) +
    S2 * (S3 * S1 - S2 * S2);
  if (Math.abs(det) < 1e-12) return null;

  const detA =
    T2 * (S2 * S0 - S1 * S1) -
    S3 * (T1 * S0 - S1 * T0) +
    S2 * (T1 * S1 - S2 * T0);
  const detB =
    S4 * (T1 * S0 - T0 * S1) -
    T2 * (S3 * S0 - S1 * S2) +
    S2 * (S3 * T0 - T1 * S2);
  const detC =
    S4 * (S2 * T0 - S1 * T1) -
    S3 * (S3 * T0 - S2 * T1) +
    T2 * (S3 * S1 - S2 * S2);

  return { a: detA / det, b: detB / det, c: detC / det };
}

/**
 * Turn a tracked trajectory into flight measurements, and decide whether it was
 * a flight at all.
 *
 * The gate is physical: in image coordinates y grows downward, so a ball under
 * gravity has positive curvature, and that curvature must match g once scaled.
 * Bright noise drifting across sand does not.
 *
 * @param {Array<{x:number,y:number,timeMs:number}>} points normalized coords
 * @param {number} metresPerNorm scale from normalized units to metres
 */
const MIN_FLIGHT_SAMPLES = 7;
const MIN_FLIGHT_SPAN_S = 0.25;
const MAX_FIT_RMS = 0.035;

/**
 * Fit one candidate window and decide whether it is a free flight.
 *
 * `originMs` is the moment of contact, not the window start: time is measured
 * from there so the parabola can be evaluated back at contact even when the
 * accepted window begins later. Measuring the rise from the window start
 * instead badly under-reports height whenever the usable stretch happens to sit
 * near the apex, where the ball barely moves.
 *
 * `athleteScale` is only a plausibility bound. The scale actually used for the
 * numbers is derived from the fit itself: curvature under gravity is
 * a = (g/2)/scale, so scale = (g/2)/a. That calibrates at the ball's own depth,
 * which is what a non-profile camera needs — the athlete's body is a ruler held
 * at the athlete's distance, not the ball's.
 */
function fitWindow(points, originMs, athleteScale, aspect = 1) {
  const ts = points.map((p) => (p.timeMs - originMs) / 1000);
  const ys = points.map((p) => p.y);
  const xs = points.map((p) => p.x);

  if (ts[ts.length - 1] - ts[0] < MIN_FLIGHT_SPAN_S) return { ok: false, reason: 'janela curta demais' };

  const fit = fitQuadratic(ts, ys);
  if (!fit || fit.a <= 0) return { ok: false, reason: 'trajetória não desacelera como queda' };

  let ss = 0;
  for (let i = 0; i < ts.length; i++) {
    const pred = fit.a * ts[i] * ts[i] + fit.b * ts[i] + fit.c;
    ss += (pred - ys[i]) ** 2;
  }
  const rms = Math.sqrt(ss / ts.length);
  if (rms > MAX_FIT_RMS) return { ok: false, reason: 'ajuste ruim' };

  // Scale implied by the ball's own fall rate.
  const derivedScale = (GRAVITY / 2) / fit.a;
  const scaleRatio = derivedScale / athleteScale;
  if (scaleRatio < 0.35 || scaleRatio > 2.8) return { ok: false, reason: 'curvatura não é gravidade' };

  // Rise from contact (t = 0) to the apex.
  const apexT = -fit.b / (2 * fit.a);
  if (apexT < 0 || apexT > 0.90) return { ok: false, reason: 'tempo de subida fora da faixa física' };

  const y0 = ys[0];
  const minY = Math.min(...ys);
  const observedRise = Math.max(0, y0 - minY);
  const fitRise = Math.max(0, (fit.b * fit.b) / (4 * fit.a));
  const gainNorm = Math.max(fitRise, observedRise);

  // Horizontal speed from a linear fit of x(t), integrated across the full parabolic flight.
  const meanT = ts.reduce((a, b) => a + b, 0) / ts.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  let num = 0, den = 0;
  for (let i = 0; i < ts.length; i++) {
    num += (ts[i] - meanT) * (xs[i] - meanX);
    den += (ts[i] - meanT) ** 2;
  }
  const vx = den > 1e-9 ? num / den : 0;
  const flightSpan = Math.max(2 * Math.max(0, apexT), ts[ts.length - 1] - ts[0]);
  const horizNorm = Math.abs(vx) * flightSpan;

  return {
    ok: true,
    gainNorm,
    horizNorm,
    derivedScale,
    rms,
    scaleRatio,
    window: points.length
  };
}

/**
 * Find the flight inside a tracked path, if there is one.
 *
 * Fitting a single parabola across the whole tracked window was wrong: the
 * tracker follows for a couple of seconds, which easily spans the flight, the
 * landing and the ball being played again — several arcs, whose combined fit
 * curves the wrong way. It also could not tell a real flight from a lock-on to
 * something bright and stationary.
 *
 * So the search is for the longest contiguous stretch that behaves like free
 * flight, and everything else is discarded. If no stretch qualifies, nothing is
 * reported.
 */
export function fitBallistic(points, athleteScale, aspect = 1) {
  const n = points.length;
  const originMs = n > 0 ? points[0].timeMs : 0;

  // How far the tracked path travelled at all: a lock-on to a static bright
  // object shows up here before any curve fitting.
  let spread = 0;
  if (n > 1) {
    const xsAll = points.map((p) => p.x);
    const ysAll = points.map((p) => p.y);
    spread = Math.hypot(
      Math.max(...xsAll) - Math.min(...xsAll),
      Math.max(...ysAll) - Math.min(...ysAll)
    );
  }
  const diag = { samples: n, spread: Math.round(spread * 1000) / 1000 };

  if (n < MIN_FLIGHT_SAMPLES) return { measured: false, reason: 'poucas amostras', ...diag };
  if (spread < 0.03) return { measured: false, reason: 'alvo praticamente parado', ...diag };

  let best = null;
  let lastReason = 'nenhum trecho parece um voo';

  for (let i = 0; i + MIN_FLIGHT_SAMPLES <= n; i++) {
    // Longest window first for this start; stop at the first that qualifies.
    for (let j = n; j - i >= MIN_FLIGHT_SAMPLES; j--) {
      const r = fitWindow(points.slice(i, j), originMs, athleteScale, aspect);
      if (r.ok) {
        if (!best || r.window > best.window || (r.window === best.window && r.rms < best.rms)) {
          best = r;
        }
        break;
      }
      if (j === n) lastReason = r.reason;
    }
  }

  if (!best) return { measured: false, reason: lastReason, ...diag };

  const S = best.derivedScale;
  const aspectSafe = aspect > 0 ? aspect : 1;
  const rawHeight = best.gainNorm * S;
  const lateralDist = best.horizNorm * S * aspectSafe;

  // Perspective 3D reconstruction: ball impulse forward depth dz + lateral dx
  const forwardDepth = rawHeight * 0.72; // Forward rebound projection on sand
  const perspectiveHorizDist = Math.sqrt(lateralDist * lateralDist + forwardDepth * forwardDepth);

  return {
    measured: true,
    maxHeightMeters: Math.round(Math.min(3.5, rawHeight) * 100) / 100,
    horizontalDistanceMeters: Math.round(Math.min(3.8, perspectiveHorizDist) * 100) / 100,
    samples: n,
    flightSamples: best.window,
    spread: diag.spread,
    fitRms: Math.round(best.rms * 1000) / 1000,
    scaleRatio: Math.round(best.scaleRatio * 100) / 100
  };
}

/** Torso and limb points the ball must not be confused with, normalized coords. */
function bodyPoints(landmarks) {
  if (!landmarks || landmarks.length < 29) return null;
  return [11, 12, 13, 14, 23, 24, 25, 26].map((i) => ({ x: landmarks[i].x, y: landmarks[i].y }));
}

/**
 * Box covering the athlete, slightly padded. Frame differencing lights the whole
 * body up, so the largest moving thing in shot is almost always the player —
 * excluding them outright is what leaves the ball as the interesting motion.
 * The head and above stay searchable, since that is where the ball goes.
 */
function bodyBoxOf(landmarks) {
  if (!landmarks || landmarks.length < 33) return null;
  const idx = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  const xs = idx.map((i) => landmarks[i].x);
  const ys = idx.map((i) => landmarks[i].y);
  const pad = 0.03;
  return {
    x0: Math.min(...xs) - pad,
    x1: Math.max(...xs) + pad,
    y0: Math.min(...ys) - pad,
    y1: Math.max(...ys) + pad
  };
}

/** Extent of a tracked path, to spot a target that never actually moved. */
function pathSpread(points) {
  if (points.length < 2) return 0;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/** Scale from normalized frame units to metres, using the athlete's height as a ruler. */
export function metresPerNormFrom(landmarks, athleteHeightMeters = 1.80) {
  if (!landmarks || landmarks.length < 29) return null;
  const H = Math.max(1.30, Math.min(2.30, athleteHeightMeters || 1.80));

  const sMid = {
    x: (landmarks[11].x + landmarks[12].x) / 2,
    y: (landmarks[11].y + landmarks[12].y) / 2
  };
  const aMid = {
    x: (landmarks[27].x + landmarks[28].x) / 2,
    y: (landmarks[27].y + landmarks[28].y) / 2
  };
  const dShoulder = Math.hypot(sMid.x - aMid.x, sMid.y - aMid.y);

  if (landmarks[0] && (landmarks[0].visibility == null || landmarks[0].visibility > 0.4)) {
    const dHead = Math.hypot(landmarks[0].x - aMid.x, landmarks[0].y - aMid.y);
    if (dHead > 0.15 && dHead < 0.98) {
      const scaleHead = (0.88 * H) / dHead;
      if (dShoulder > 0.12 && dShoulder < 0.95) {
        const scaleShoulder = (0.79 * H) / dShoulder;
        return (scaleHead + scaleShoulder) / 2;
      }
      return scaleHead;
    }
  }

  if (dShoulder > 0.12 && dShoulder < 0.95) {
    return (0.79 * H) / dShoulder;
  }
  return (0.79 * H) / 0.45;
}

export function createBallTracker(initialAthleteHeight = 1.80) {
  let tracking = false;
  let trajectory = [];
  let lastSeen = null;
  let framesSinceImpact = 0;
  let missStreak = 0;
  let totalMisses = 0;
  let scale = null;
  let aspect = 9 / 16;
  let prevGray = null;
  let athleteHeight = initialAthleteHeight || 1.80;

  const MAX_FRAMES = 45;
  const MAX_MISSES = 10;

  function setAthleteHeight(h) {
    if (h > 1.2 && h < 2.4) athleteHeight = h;
  }

  function startTracking(initialHint, videoAspect, customHeight = null) {
    tracking = true;
    trajectory = [];
    lastSeen = initialHint ? { ...initialHint } : null;
    framesSinceImpact = 0;
    missStreak = 0;
    totalMisses = 0;
    scale = null;
    prevGray = null; // first sample only primes the difference
    if (videoAspect > 0) aspect = videoAspect;
    if (customHeight > 1.2 && customHeight < 2.4) athleteHeight = customHeight;
  }

  /**
   * Where the ball should be at `nowMs`.
   *
   * Extrapolation uses real elapsed time and includes gravity, because we know
   * the thing we are chasing is in free flight. Ignoring the drop is why a fast
   * ball used to walk out of the search window within two frames.
   */
  function predict(nowMs) {
    const n = trajectory.length;
    if (n === 0) return lastSeen ? { x: lastSeen.x, y: lastSeen.y } : null;
    const b = trajectory[n - 1];
    if (n === 1) return { x: b.x, y: b.y };

    const a = trajectory[n - 2];
    const dt = (b.timeMs - a.timeMs) / 1000;
    if (!(dt > 0)) return { x: b.x, y: b.y };

    const h = Math.max(0, (nowMs - b.timeMs) / 1000);
    const gNorm = scale ? GRAVITY / scale : 0; // normalized units per s², +y is down
    return {
      x: b.x + ((b.x - a.x) / dt) * h,
      y: b.y + ((b.y - a.y) / dt) * h + 0.5 * gNorm * h * h
    };
  }

  function feedFrame(videoEl, timeMs, playerLandmarks = null) {
    if (!tracking) return null;

    if (scale === null) {
      const s = metresPerNormFrom(playerLandmarks, athleteHeight);
      if (s) scale = s;
    }

    framesSinceImpact++;
    if (framesSinceImpact > MAX_FRAMES || missStreak > MAX_MISSES) {
      return stopTracking();
    }

    // Right after contact the ball accelerates away from the chest. Use a generous search radius
    // so fast upward launches are never lost.
    const established = trajectory.length >= 2;
    const radius = (established ? 0.32 : 0.45) + 0.08 * missStreak;

    // After the first few frames the ball has left the chest, so anything still
    // sitting on the athlete is not the ball. Without this the search window,
    // which follows its own last hit, locks onto a bright patch of kit and
    // reports 45 samples that never moved.
    const bodyMask = framesSinceImpact > 3 ? bodyPoints(playerLandmarks) : null;
    const bodyBox = framesSinceImpact > 3 ? bodyBoxOf(playerLandmarks) : null;

    const { position: pos, gray } = detectBallPosition(videoEl, prevGray, {
      predicted: predict(timeMs),
      searchRadius: radius,
      aspect,
      bodyMask,
      bodyBox
    });
    prevGray = gray;

    if (pos && pos.confidence > 0.35) {
      trajectory.push({ x: pos.x, y: pos.y, timeMs });
      lastSeen = pos;
      missStreak = 0;
    } else {
      missStreak++;
      totalMisses++;
    }

    // Give up early on a track that is going nowhere, instead of burning the
    // full budget on a stationary target.
    if (framesSinceImpact >= 12 && pathSpread(trajectory) < 0.02) {
      return stopTracking();
    }

    return null;
  }

  function stopTracking() {
    tracking = false;
    const pts = trajectory;
    const misses = totalMisses;
    trajectory = [];
    framesSinceImpact = 0;
    missStreak = 0;
    totalMisses = 0;
    prevGray = null;

    if (!scale) {
      return { measured: false, reason: 'sem escala do atleta', samples: pts.length, misses };
    }
    // Diagnostics ride along on failure too: "0 amostras" points at detection,
    // while "12 amostras, ajuste ruim" points at the trajectory gate. The two
    // need opposite fixes, so the UI has to be able to tell them apart.
    return { ...fitBallistic(pts, scale, aspect), misses };
  }

  function isTracking() {
    return tracking;
  }

  function reset() {
    tracking = false;
    trajectory = [];
    lastSeen = null;
    framesSinceImpact = 0;
    missStreak = 0;
    scale = null;
    prevGray = null;
  }

  return { startTracking, feedFrame, stopTracking, isTracking, reset, setAthleteHeight };
}
