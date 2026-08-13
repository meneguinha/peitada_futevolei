import { useEffect } from 'react';
import { calculateAngle2D, calculateAngle3D } from '../utils/geometryMath';
import { useThemePalette } from '../utils/theme';

/**
 * PoseCanvasOverlay - Draws ONLY stick figure skeleton lines on an existing canvas.
 * The canvas MUST already exist in the DOM with the given canvasId.
 * The canvas background stays 100% transparent so the <video> behind is fully visible.
 */
export default function PoseCanvasOverlay({
  canvasId = 'poseOverlayCanvas',
  landmarks,
  worldLandmarks,
  showAngleOverlay = true,
  width = 360,
  height = 640,
  videoAspect = 9 / 16
}) {
  const palette = useThemePalette();

  useEffect(() => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    // Resize canvas to match container
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // CLEAR to fully transparent - video shows through
    ctx.clearRect(0, 0, width, height);

    if (!landmarks || landmarks.length < 33 || !showAngleOverlay) return;

    // The <video> uses object-fit: contain, so it is letterboxed inside the
    // stage whenever its aspect ratio differs from the stage's. Mapping
    // landmarks onto the full canvas would slide the skeleton off the athlete
    // for any clip that is not exactly the stage's shape.
    const stageAspect = width / height;
    const dw = videoAspect > stageAspect ? width : height * videoAspect;
    const dh = videoAspect > stageAspect ? width / videoAspect : height;
    const ox = (width - dw) / 2;
    const oy = (height - dh) / 2;

    const pt = (lm) => ({ x: ox + (lm?.x ?? 0.5) * dw, y: oy + (lm?.y ?? 0.5) * dh });

    const lShoulder = pt(landmarks[11]);
    const rShoulder = pt(landmarks[12]);
    const lElbow = pt(landmarks[13]);
    const rElbow = pt(landmarks[14]);
    const lWrist = pt(landmarks[15]);
    const rWrist = pt(landmarks[16]);
    const lHip = pt(landmarks[23]);
    const rHip = pt(landmarks[24]);
    const lKnee = pt(landmarks[25]);
    const rKnee = pt(landmarks[26]);
    const lAnkle = pt(landmarks[27]);
    const rAnkle = pt(landmarks[28]);

    const shoulderMid = { x: (lShoulder.x + rShoulder.x) / 2, y: (lShoulder.y + rShoulder.y) / 2 };
    const hipMid = { x: (lHip.x + rHip.x) / 2, y: (lHip.y + rHip.y) / 2 };

    // Bone connections
    const bones = [
      [lShoulder, rShoulder],
      [lShoulder, lHip], [rShoulder, rHip],
      [lHip, rHip],
      [lShoulder, lElbow], [lElbow, lWrist],
      [rShoulder, rElbow], [rElbow, rWrist],
      [lHip, lKnee], [lKnee, lAnkle],
      [rHip, rKnee], [rKnee, rAnkle]
    ];

    // Bones. The overlay always sits on dark footage, so it uses the turquoise
    // rather than the deep blue, and a thin dark halo instead of a glow — enough
    // separation over a bright beach frame without the neon look.
    ctx.save();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineCap = 'round';
    bones.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.secondary;
    bones.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    });
    ctx.restore();

    // Spine arch curve — the measurement the score cares about most
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = palette.warning;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoulderMid.x, shoulderMid.y);
    ctx.quadraticCurveTo(
      (shoulderMid.x + hipMid.x) / 2 - 20,
      (shoulderMid.y + hipMid.y) / 2,
      hipMid.x, hipMid.y
    );
    ctx.stroke();
    ctx.restore();

    // Draw joints (white dots with cyan border)
    const joints = [lShoulder, rShoulder, lElbow, rElbow, lWrist, rWrist, lHip, rHip, lKnee, rKnee, lAnkle, rAnkle];
    joints.forEach(j => {
      ctx.beginPath();
      ctx.arc(j.x, j.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = palette.secondary;
      ctx.stroke();
    });

    // Knee angle label. Measured on the world landmarks (metres, no perspective
    // distortion) — the screen points only place the label. Reading the angle
    // off screen coordinates skews it by the video's aspect ratio.
    const metric = worldLandmarks && worldLandmarks.length >= 33 ? worldLandmarks : null;
    const kneeAngle = Math.round(
      metric
        ? calculateAngle3D(metric[23], metric[25], metric[27])
        : calculateAngle2D(lHip, lKnee, lAnkle)
    );
    const color = kneeAngle >= 120 && kneeAngle <= 150 ? palette.success : palette.warning;
    const label = `${kneeAngle}°`;
    ctx.font = '600 13px "JetBrains Mono", ui-monospace, monospace';
    const tw = ctx.measureText(label).width;
    const lx = lKnee.x + 12;
    const ly = lKnee.y;
    ctx.fillStyle = 'rgba(15,20,25,0.85)';
    ctx.beginPath();
    ctx.roundRect(lx - 6, ly - 12, tw + 12, 20, 6);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(label, lx, ly + 3);

    // Chest contact zone — coral is reserved for the moment of impact
    const cx = shoulderMid.x + 10;
    const cy = shoulderMid.y + (hipMid.y - shoulderMid.y) * 0.25;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fillStyle = palette.accent;
    ctx.globalAlpha = 0.35;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = palette.accent;
    ctx.stroke();

  }, [canvasId, landmarks, worldLandmarks, showAngleOverlay, width, height, videoAspect, palette]);

  // This component renders nothing - it draws on an existing canvas element
  return null;
}
