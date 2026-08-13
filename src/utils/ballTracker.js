/**
 * ballTracker.js
 * Tracks the futevôlei ball in video frames after a peitada impact.
 * 
 * Uses color-based blob detection on a downscaled offscreen canvas
 * to find the bright ball and track its trajectory.
 * 
 * Returns max height (normalized 0-1, lower = higher on screen)
 * and horizontal distance traveled (normalized 0-1).
 */

const TRACK_CANVAS_W = 160;
const TRACK_CANVAS_H = 284;

let offscreenCanvas = null;
let offscreenCtx = null;

function getOffscreenCanvas() {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = TRACK_CANVAS_W;
    offscreenCanvas.height = TRACK_CANVAS_H;
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: offscreenCanvas, ctx: offscreenCtx };
}

/**
 * Detect the ball position in a video frame.
 * Looks for bright, small blobs in the frame.
 * 
 * @param {HTMLVideoElement} videoEl
 * @param {Object} searchHint - Optional hint for where to search { x, y } normalized 0-1
 * @returns {{ x: number, y: number, confidence: number } | null}
 */
export function detectBallPosition(videoEl, searchHint = null) {
  if (!videoEl || videoEl.readyState < 2) return null;

  const { canvas, ctx } = getOffscreenCanvas();
  
  try {
    ctx.drawImage(videoEl, 0, 0, TRACK_CANVAS_W, TRACK_CANVAS_H);
  } catch {
    return null;
  }

  const imageData = ctx.getImageData(0, 0, TRACK_CANVAS_W, TRACK_CANVAS_H);
  const data = imageData.data;

  // Find bright pixel clusters
  // The futevôlei ball is typically bright (white, yellow, or orange)
  const brightPixels = [];
  
  for (let y = 0; y < TRACK_CANVAS_H; y++) {
    for (let x = 0; x < TRACK_CANVAS_W; x++) {
      const i = (y * TRACK_CANVAS_W + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      // Brightness check (V in HSV)
      const brightness = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const saturation = brightness > 0 ? (brightness - minC) / brightness : 0;
      
      // Ball criteria:
      // 1. Very bright (>200) OR bright and warm-colored (orange/yellow ball)
      // 2. Not just sky/background (some saturation or very white)
      const isBrightWhite = brightness > 210 && saturation < 0.25;
      const isBrightOrangeYellow = brightness > 170 && saturation > 0.3 && r > 150 && g > 80 && b < 150;
      
      if (isBrightWhite || isBrightOrangeYellow) {
        brightPixels.push({ x, y, brightness });
      }
    }
  }

  if (brightPixels.length === 0) return null;

  // Cluster bright pixels using simple grid-based grouping
  const cellSize = 8;
  const clusters = {};
  
  for (const px of brightPixels) {
    const cx = Math.floor(px.x / cellSize);
    const cy = Math.floor(px.y / cellSize);
    const key = `${cx},${cy}`;
    if (!clusters[key]) clusters[key] = { pixels: [], sumX: 0, sumY: 0, sumB: 0 };
    clusters[key].pixels.push(px);
    clusters[key].sumX += px.x;
    clusters[key].sumY += px.y;
    clusters[key].sumB += px.brightness;
  }

  // Find the best cluster:
  // - Ball-sized (not too many pixels = large bright area like sky, not too few = noise)
  // - If we have a search hint, prefer clusters near the hint
  let bestCluster = null;
  let bestScore = -1;

  const ballMinPx = 3;   // minimum pixels for a ball-sized cluster
  const ballMaxPx = 120; // maximum pixels (not a huge bright area)

  for (const key of Object.keys(clusters)) {
    const c = clusters[key];
    const count = c.pixels.length;
    if (count < ballMinPx || count > ballMaxPx) continue;

    const centroidX = c.sumX / count / TRACK_CANVAS_W;
    const centroidY = c.sumY / count / TRACK_CANVAS_H;
    const avgBrightness = c.sumB / count;

    // Score: brightness + proximity to hint (if available)
    let score = avgBrightness;
    
    if (searchHint) {
      const dist = Math.sqrt((centroidX - searchHint.x) ** 2 + (centroidY - searchHint.y) ** 2);
      // Closer to hint = better (max bonus of 100 when dist < 0.1)
      score += Math.max(0, 100 - dist * 500);
    }

    // Prefer smaller blobs (more likely to be the ball vs large bright areas)
    if (count < 30) score += 30;

    if (score > bestScore) {
      bestScore = score;
      bestCluster = { x: centroidX, y: centroidY, confidence: Math.min(1, score / 300) };
    }
  }

  return bestCluster;
}

/**
 * Creates a BallTracker instance that tracks the ball across frames
 * after a peitada impact.
 */
export function createBallTracker() {
  let tracking = false;
  let trajectory = [];   // Array of { x, y, timeMs }
  let impactPos = null;   // Ball position at impact
  let framesSinceImpact = 0;
  const MAX_TRACK_FRAMES = 40; // Track for ~2 seconds at 20fps

  function startTracking(initialHint) {
    tracking = true;
    trajectory = [];
    impactPos = initialHint || null;
    framesSinceImpact = 0;
  }

  function feedFrame(videoEl, timeMs, playerLandmarks = null) {
    if (!tracking) return null;
    
    framesSinceImpact++;
    if (framesSinceImpact > MAX_TRACK_FRAMES) {
      return stopTracking(playerLandmarks);
    }

    // Search hint: use last known position, or impact position
    const lastPos = trajectory.length > 0 ? trajectory[trajectory.length - 1] : impactPos;
    const hint = lastPos ? { x: lastPos.x, y: lastPos.y } : null;

    const pos = detectBallPosition(videoEl, hint);
    if (pos && pos.confidence > 0.2) {
      trajectory.push({ x: pos.x, y: pos.y, timeMs });
    }

    return null; // Still tracking
  }

  function stopTracking(playerLandmarks = null) {
    tracking = false;
    
    // Reference scale estimation (human shoulder-to-ankle = ~1.42m in standard footvolley athletes)
    let scaleMetersPerNorm = 3.2; // default: full vertical frame = ~3.2m
    if (playerLandmarks && playerLandmarks.length >= 29) {
      const sMid = {
        x: (playerLandmarks[11].x + playerLandmarks[12].x) / 2,
        y: (playerLandmarks[11].y + playerLandmarks[12].y) / 2
      };
      const aMid = {
        x: (playerLandmarks[27].x + playerLandmarks[28].x) / 2,
        y: (playerLandmarks[27].y + playerLandmarks[28].y) / 2
      };
      const bodyNormDist = Math.hypot(sMid.x - aMid.x, sMid.y - aMid.y);
      if (bodyNormDist > 0.12 && bodyNormDist < 0.95) {
        scaleMetersPerNorm = 1.42 / bodyNormDist;
      }
    }

    let measuredHeight = 0;
    let measuredDist = 0;

    if (trajectory.length >= 3) {
      const startY = trajectory[0].y;
      let minY = startY;
      for (const pt of trajectory) {
        if (pt.y < minY) minY = pt.y;
      }
      const heightGainNorm = Math.max(0, startY - minY);
      measuredHeight = heightGainNorm * scaleMetersPerNorm;

      const startX = trajectory[0].x;
      let maxHorizDistNorm = 0;
      for (const pt of trajectory) {
        const dist = Math.abs(pt.x - startX);
        if (dist > maxHorizDistNorm) maxHorizDistNorm = dist;
      }
      measuredDist = maxHorizDistNorm * scaleMetersPerNorm;
    }

    // Kinematic estimate fallback/refinement based on body position
    let estHeight = 1.65; // realistic default height gain for peitada
    let estDist = 1.25;

    if (playerLandmarks && playerLandmarks.length >= 29) {
      const lShoulder = playerLandmarks[11];
      const rShoulder = playerLandmarks[12];
      const lHip = playerLandmarks[23];
      const rHip = playerLandmarks[24];
      const sY = (lShoulder.y + rShoulder.y) / 2;
      const hY = (lHip.y + rHip.y) / 2;
      const torsoTilt = Math.abs(sY - hY);

      // Higher torso tilt/arch = higher trajectory launch
      estHeight = Math.min(3.2, Math.max(1.1, 1.30 + (torsoTilt * scaleMetersPerNorm) * 0.8));
      estDist = Math.min(2.8, Math.max(0.7, 0.90 + (torsoTilt * scaleMetersPerNorm) * 0.5));
    }

    // Did we actually see the ball, or are we about to report a guess?
    // Blob-on-brightness tracking fails often (sky, sand, white shorts), and
    // blending a real measurement with the kinematic guess would corrupt both.
    // So: report the measurement when we have one, the estimate otherwise, and
    // always say which it is. `measured: false` keeps these numbers out of the
    // score — see peitadaDetector.applyBallData().
    const measured = trajectory.length >= 5 && measuredHeight > 0.4 && measuredDist > 0.3;

    const finalHeight = measured ? measuredHeight : estHeight;
    const finalDist = measured ? measuredDist : estDist;

    const result = {
      maxHeightMeters: Math.round(finalHeight * 100) / 100,
      horizontalDistanceMeters: Math.round(finalDist * 100) / 100,
      trajectory: [...trajectory],
      samples: trajectory.length,
      measured,
      valid: true
    };

    trajectory = [];
    impactPos = null;
    framesSinceImpact = 0;
    return result;
  }

  function isTracking() {
    return tracking;
  }

  function reset() {
    tracking = false;
    trajectory = [];
    impactPos = null;
    framesSinceImpact = 0;
  }

  return {
    startTracking,
    feedFrame,
    stopTracking,
    isTracking,
    reset
  };
}
