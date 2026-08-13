/**
 * Joint positions for the explanatory stick figure on the landing screen,
 * in SVG user units.
 *
 * These are not eyeballed. They were solved so that the drawn knee angle is
 * exactly ILLUSTRATED_KNEE_ANGLE and the drawn torso tilt exactly
 * ILLUSTRATED_TORSO_TILT — the midpoints of the ideal bands the legend quotes.
 * A diagram that teaches angle measurement should survive being measured, so
 * test/peitadaDetector.test.mjs asserts it.
 *
 * The figure faces +x (to the right), so the torso leaning to -x is a backward
 * arch and the hip sitting at a larger x than the ankle is hip thrust.
 */

export const ILLUSTRATED_KNEE_ANGLE = 135;
export const ILLUSTRATED_TORSO_TILT = 30;

export const FIGURE = {
  ankle: { x: 180, y: 262 },
  knee: { x: 225, y: 201.2 },
  hip: { x: 214, y: 128 },
  shoulder: { x: 170, y: 51.8 },
  frontElbow: { x: 218, y: 62 },
  frontWrist: { x: 258, y: 44 },
  backElbow: { x: 130, y: 70 },
  backWrist: { x: 94, y: 58 },
  head: { x: 152, y: 28, r: 14 }
};

/** Angle at `v` between the rays to `p` and `q`, in degrees. */
export function angleAt(p, v, q) {
  const u = { x: p.x - v.x, y: p.y - v.y };
  const w = { x: q.x - v.x, y: q.y - v.y };
  const cos = (u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y));
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Torso tilt from vertical, degrees. Positive = arched backwards. */
export function torsoTiltOf({ hip, shoulder }) {
  return (Math.atan2(hip.x - shoulder.x, hip.y - shoulder.y) * 180) / Math.PI;
}
