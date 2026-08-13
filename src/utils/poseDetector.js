/**
 * poseDetector.js
 * Real-time MediaPipe Pose Landmarker for video analysis.
 * Detects 33 body landmarks per frame using the browser GPU.
 */

let poseLandmarker = null;
let isInitializing = false;
let initPromise = null;

/**
 * Initialize the MediaPipe PoseLandmarker (loads WASM + model).
 * Safe to call multiple times — only initializes once.
 */
export async function initPoseDetector() {
  if (poseLandmarker) return poseLandmarker;
  if (initPromise) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      console.log('[PoseDetector] Loading MediaPipe WASM runtime...');
      const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      console.log('[PoseDetector] Creating PoseLandmarker...');
      poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        numPoses: 1
      });

      console.log('[PoseDetector] ✅ Ready!');
      isInitializing = false;
      return poseLandmarker;
    } catch (err) {
      console.error('[PoseDetector] ❌ Failed to initialize:', err);
      isInitializing = false;
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Detect pose landmarks from a video element at a given timestamp.
 * @param {HTMLVideoElement} videoEl 
 * @param {number} timestampMs - performance.now() or video.currentTime * 1000
 * @returns {{ landmarks: Array, worldLandmarks: Array } | null}
 */
export function detectPose(videoEl, timestampMs) {
  if (!poseLandmarker) return null;
  if (videoEl.readyState < 2) return null; // Not enough data

  try {
    const result = poseLandmarker.detectForVideo(videoEl, timestampMs);
    if (result && result.landmarks && result.landmarks.length > 0) {
      return {
        landmarks: result.landmarks[0],       // 33 landmarks, normalized {x, y, z, visibility}
        worldLandmarks: result.worldLandmarks?.[0] || null  // 3D world coordinates
      };
    }
  } catch (e) {
    // Silently ignore detection errors (e.g., timestamp issues)
  }
  return null;
}

/**
 * Check if the detector is ready.
 */
export function isDetectorReady() {
  return poseLandmarker !== null;
}

/**
 * Check if initialization is in progress.
 */
export function isDetectorLoading() {
  return isInitializing;
}
