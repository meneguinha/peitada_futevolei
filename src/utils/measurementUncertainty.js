/**
 * The pose model's error budget, and scoring that respects it.
 *
 * Single-camera markerless 3D pose is not a precise instrument. Mercadal-Baudart
 * et al. (2024, Heliyon 10(6):e27596) validated single-camera markerless 3D pose
 * against VICON and reported RMS errors around 6 deg for knee, hip and spine
 * flexion, and 7-10 deg for trunk angle — the noisiest of the group, and the one
 * this app leans on hardest. MediaPipe specifically has been measured at roughly
 * 9 deg mean absolute error on static tasks and 13 deg on dynamic ones, and
 * degrades sharply with unfavourable camera geometry.
 *
 * Those authors also warn that accuracy falls off quickly for movements outside
 * the model's training distribution. A futevolei set is certainly outside it, so
 * the figures below are optimistic, not conservative.
 *
 * Two consequences are implemented here:
 *
 *  1. Scores ramp continuously instead of stepping at a threshold. Under the old
 *     bands a knee at 150 deg scored 100 and at 151 deg scored 70 — a 30 point
 *     cliff inside the noise floor. Grades must not flip on a difference the
 *     sensor cannot resolve.
 *
 *  2. Every score carries the uncertainty it inherits from its input, and a
 *     session score is withheld until enough repetitions exist to average the
 *     noise down. Averaging n repetitions shrinks the random component by
 *     sqrt(n); this is the only honest way to get precision out of this sensor.
 */

/** One standard deviation of measurement error, in each metric's own units. */
export const SIGMA = {
  arch: 8,        // trunk angle, degrees
  knee: 6,        // knee flexion, degrees
  armDiff: 9,     // difference of two elbow angles: independent errors compound
  hipRatio: 0.02  // hip lead as a fraction of body height
};

/** Display resolution: rounding finer than this would imply false precision. */
export const ANGLE_STEP = 5;

/** Below this many repetitions the averaged score is not worth showing. */
export const MIN_REPS_FOR_SCORE = 3;

/**
 * Ideal bands as anchor points [value, score], interpolated linearly and held
 * flat beyond the ends. The anchors preserve the previous calibration — these
 * remain heuristics, not published norms — but the transitions are now gradual
 * rather than stepped.
 */
export const BANDS = {
  knee:       [[80, 25], [95, 50], [110, 75], [120, 92], [130, 100], [140, 100], [148, 92], [158, 80], [168, 55], [178, 35], [185, 20]],
  arch:       [[5, 20], [9, 35], [14, 55], [18, 75], [23, 90], [28, 100], [36, 100], [41, 90], [46, 80], [52, 60], [62, 35], [75, 20]],
  armDiff:    [[0, 100], [8, 100], [15, 90], [25, 80], [38, 65], [52, 45], [70, 25]],
  hipRatio:   [[0, 25], [0.03, 50], [0.055, 75], [0.08, 90], [0.11, 100], [0.14, 100], [0.16, 90], [0.22, 80], [0.30, 45]],
  ballHeight: [[0.2, 20], [0.5, 40], [0.8, 60], [1.2, 78], [1.6, 88], [1.9, 94], [2.2, 100], [2.5, 100], [2.8, 94], [3.3, 80], [3.8, 60], [4.5, 30]],
  ballDist:   [[0.1, 25], [0.4, 55], [0.8, 88], [1.2, 100], [2.4, 100], [3.0, 85], [3.6, 60], [4.5, 30]]
};

/** Piecewise-linear score through the anchor points, flat outside the ends. */
export function rampScore(value, anchors) {
  if (!Number.isFinite(value)) return 0;
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];

  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (value >= x0 && value <= x1) {
      const t = x1 === x0 ? 0 : (value - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * How far the score could move if the measurement were off by one sigma —
 * the score's own error bar, not a confidence interval on the athlete.
 */
export function scoreUncertainty(value, sigma, anchors) {
  const s = rampScore(value, anchors);
  return Math.max(
    Math.abs(rampScore(value - sigma, anchors) - s),
    Math.abs(rampScore(value + sigma, anchors) - s)
  );
}

/** Round to a step the sensor can actually resolve. */
export function roundTo(value, step = ANGLE_STEP) {
  return Math.round(value / step) * step;
}

/**
 * Weighted average over the components that are actually available, with the
 * weights renormalised across them.
 *
 * A metric that depends on a direction the camera cannot resolve must not be
 * scored as if it were zero — that would punish the athlete for the camera
 * angle. Dropping it and reweighting keeps the result on the same 0-100 scale
 * and lets the score reflect only what was genuinely measured.
 *
 * `parts` is [{ score, weight, available }].
 */
export function weightedScore(parts) {
  const usable = parts.filter((p) => p.available);
  const total = usable.reduce((a, p) => a + p.weight, 0);
  if (total <= 0) return 0;
  return Math.round(usable.reduce((a, p) => a + p.score * p.weight, 0) / total);
}

/**
 * Combine independent per-metric uncertainties through a weighted sum.
 * `parts` is [{ uncertainty, weight }].
 */
export function combineUncertainty(parts) {
  const sumSq = parts.reduce((acc, p) => acc + (p.weight * p.uncertainty) ** 2, 0);
  return Math.sqrt(sumSq);
}

/**
 * Session score from a list of repetitions.
 *
 * The reported margin is the larger of two things: how much the athlete varied
 * between repetitions, and how much the sensor could be wrong. Both shrink with
 * sqrt(n), which is exactly why a single repetition is not reported at all.
 */
export function sessionScore(reps) {
  const n = reps.length;
  if (n === 0) return { score: 0, margin: 0, n: 0, reliable: false };

  const scores = reps.map((r) => r.score);
  const mean = scores.reduce((a, b) => a + b, 0) / n;

  const spread = n > 1
    ? Math.sqrt(scores.reduce((a, s) => a + (s - mean) ** 2, 0) / (n - 1)) / Math.sqrt(n)
    : 0;

  const meanMeasurement =
    reps.reduce((a, r) => a + (r.details?.scoreUncertainty || 0), 0) / n;
  const measurement = meanMeasurement / Math.sqrt(n);

  return {
    score: Math.round(mean),
    margin: Math.round(Math.max(spread, measurement)),
    n,
    reliable: n >= MIN_REPS_FOR_SCORE
  };
}
