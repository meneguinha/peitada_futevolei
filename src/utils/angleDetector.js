/**
 * Angle & Camera Perspective Detection Utility
 * Determines if video recording is Profile (Lateral), Frontal, or Diagonal 3/4
 */

export const CAMERA_PERSPECTIVES = {
  PROFILE: 'profile',    // Visão Lateral
  FRONTAL: 'frontal',    // Visão Frontal / De Frente
  DIAGONAL: 'diagonal'   // Visão Diagonal 3/4
};

export const PERSPECTIVE_LABELS = {
  profile: { name: 'Visão Lateral (Perfil)', icon: '↔️', desc: 'Ideal para medir o arquamento das costas e flexão de joelho' },
  frontal: { name: 'Visão Frontal', icon: '↕️', desc: 'Ideal para medir abertura de braços e simetria de ombros' },
  diagonal: { name: 'Visão Diagonal (3/4)', icon: '↗️', desc: 'Perspectiva adaptativa 3D calibrada para visão angular de quadra' }
};

/**
 * Detects the camera angle based on body pose landmarks across frames
 * @param {Array} landmarks - 33 MediaPipe pose keypoints
 * @returns {String} camera perspective key ('profile' | 'frontal' | 'diagonal')
 */
export function detectCameraPerspective(landmarks) {
  if (!landmarks || landmarks.length < 33) return CAMERA_PERSPECTIVES.DIAGONAL;

  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const leftHip = landmarks[23];
  const rightHip = landmarks[24];

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return CAMERA_PERSPECTIVES.DIAGONAL;
  }

  // 1. Calculate shoulder width relative to torso height
  const shoulderWidth2D = Math.abs(leftShoulder.x - rightShoulder.x);
  const leftTorsoHeight = Math.abs(leftShoulder.y - leftHip.y);
  const rightTorsoHeight = Math.abs(rightShoulder.y - rightHip.y);
  const avgTorsoHeight = (leftTorsoHeight + rightTorsoHeight) / 2 || 0.3;

  const widthToHeightRatio = shoulderWidth2D / avgTorsoHeight;

  // 2. Depth difference (Z-coordinate) between left and right shoulders
  const shoulderZDiff = Math.abs((leftShoulder.z || 0) - (rightShoulder.z || 0));

  // Classification threshold heuristics
  if (widthToHeightRatio < 0.28 || shoulderZDiff > 0.25) {
    return CAMERA_PERSPECTIVES.PROFILE;
  } else if (widthToHeightRatio > 0.65 && shoulderZDiff < 0.12) {
    return CAMERA_PERSPECTIVES.FRONTAL;
  } else {
    return CAMERA_PERSPECTIVES.DIAGONAL;
  }
}

/**
 * Normalizes biomechanical metric parameters based on the identified camera perspective
 */
export function getPerspectiveMultipliers(perspective) {
  switch (perspective) {
    case CAMERA_PERSPECTIVES.PROFILE:
      return {
        archWeight: 1.0,
        kneeFlexWeight: 1.0,
        armSpreadWeight: 0.7,
        hipThrustWeight: 1.0
      };
    case CAMERA_PERSPECTIVES.FRONTAL:
      return {
        archWeight: 0.75,
        kneeFlexWeight: 0.8,
        armSpreadWeight: 1.0,
        hipThrustWeight: 0.75
      };
    case CAMERA_PERSPECTIVES.DIAGONAL:
    default:
      return {
        archWeight: 0.9,
        kneeFlexWeight: 0.9,
        armSpreadWeight: 0.85,
        hipThrustWeight: 0.9
      };
  }
}
