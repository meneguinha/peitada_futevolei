/**
 * Geometry & Biomechanics Math Utilities for Footvolley Pose Analysis
 */

// Calculate 2D angle in degrees between three points (A -> B -> C, where B is the vertex)
export function calculateAngle2D(a, b, c) {
  if (!a || !b || !c) return 0;
  
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  
  if (angle > 180.0) {
    angle = 360.0 - angle;
  }
  return Math.round(angle * 10) / 10;
}

// Calculate 3D angle between three points incorporating z (depth)
export function calculateAngle3D(a, b, c) {
  if (!a || !b || !c) return 0;
  
  const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) };
  const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z || 0) - (b.z || 0) };
  
  const dotProduct = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
  const magAB = Math.sqrt(ab.x * ab.x + ab.y * ab.y + ab.z * ab.z);
  const magCB = Math.sqrt(cb.x * cb.x + cb.y * cb.y + cb.z * cb.z);
  
  if (magAB * magCB === 0) return 0;
  
  let cosTheta = dotProduct / (magAB * magCB);
  cosTheta = Math.max(-1, Math.min(1, cosTheta));
  
  const angleRad = Math.acos(cosTheta);
  return Math.round(((angleRad * 180.0) / Math.PI) * 10) / 10;
}

// Calculate spine arch curvature angle (Neck -> Mid Back -> Hips)
// Lower angle or higher deviation = deeper thoracic back arch
export function calculateSpineArchAngle(shoulderMid, hipMid, kneeMid) {
  if (!shoulderMid || !hipMid || !kneeMid) return 180;
  return calculateAngle2D(shoulderMid, hipMid, kneeMid);
}

// Calculate Euclidean distance between two points
export function calculateDistance(a, b) {
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Midpoint helper
export function getMidpoint(a, b) {
  if (!a && !b) return { x: 0, y: 0, z: 0 };
  if (!a) return b;
  if (!b) return a;
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z || 0) + (b.z || 0)) / 2,
    visibility: ((a.visibility || 1) + (b.visibility || 1)) / 2
  };
}

// Calculate Body Inclination relative to vertical axis (0° = vertical standing)
export function calculateBodyTilt(hipMid, shoulderMid) {
  if (!hipMid || !shoulderMid) return 0;
  const dx = shoulderMid.x - hipMid.x;
  const dy = hipMid.y - shoulderMid.y; // invert Y for screen coords
  const angleRad = Math.atan2(dx, dy);
  return Math.round(((angleRad * 180.0) / Math.PI) * 10) / 10;
}
