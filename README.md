# ⚡ Footvolley Peitada — Real-Time Biomechanical Analysis

[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-Online-brightgreen?style=for-the-badge&logo=github)](https://meneguinha.github.io/peitada_futevolei/)
[![React](https://img.shields.io/badge/React-19-blue?style=for-the-badge&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=for-the-badge&logo=vite)](https://vitejs.dev/)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-Vision%203D-FF6F00?style=for-the-badge&logo=google)](https://developers.google.com/mediapipe)
[![License](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

A progressive web application for **automated, real-time biomechanical analysis of chest attacks ("Peitada") in footvolley**. Powered by Artificial Intelligence, 3D metric pose estimation, and geometric computer vision algorithms to evaluate motion execution, detect technical flaws, and recommend corrective drills directly in the browser—with no backend server or cloud video uploads required.

---

## 🌐 Live Application Link

- 🚀 **GitHub Pages App**: [https://meneguinha.github.io/peitada_futevolei/](https://meneguinha.github.io/peitada_futevolei/)
- 💻 **GitHub Repository**: [https://github.com/meneguinha/peitada_futevolei](https://github.com/meneguinha/peitada_futevolei)

---

## 📌 Project Overview

The **"Peitada"** (chest strike) is one of the most athletic and effective offensive moves in footvolley. Perfect execution requires biomechanical coordination across four key areas:
1. **Pre-impact knee flexion** to act as a spring for vertical leap;
2. **Torso arching** to position the upper chest directly beneath the ball;
3. **Explosive hip thrust** at contact to transfer momentum into the hit;
4. **Symmetric arm opening** for mid-air balance and directional control.

This application objectively measures and scores this movement. By analyzing full-speed or slow-motion video clips, the system automatically detects each chest attack event, calculates the athlete's 3D joint angles at the peak arch, and generates a **biomechanical score (0–100)** along with actionable technical feedback.

---

## ✨ Key Features

- 🎯 **Automated 3D State Machine Event Detection**:
  - Automatically identifies chest attack events without manual tagging via a finite state machine:
    $$\text{IDLE} \rightarrow \text{PREPARING} \rightarrow \text{ARCHING} \rightarrow \text{IMPACT} \rightarrow \text{LANDING} \rightarrow \text{IDLE}$$
  - Robust false-positive filtering and deduplication during rapid rallies.

- 📐 **Metric 3D Biomechanical Analysis (MediaPipe Pose)**:
  - Uses 3D metric coordinates (*World Landmarks* in meters, centered between the hips) provided by MediaPipe Pose.
  - Immune to video aspect ratio distortion (e.g., 9:16 vertical smartphone videos vs. 16:9 widescreen), camera tilt, or distance to the athlete.

- ⚽ **Integrated Computer Vision Ball Tracker**:
  - Tracks ball trajectory and fits parabola curves to validate the exact moment and location of contact.

- 📊 **Instant Biomechanical Diagnostic Report**:
  - Breakdown of individual sub-scores (knees, torso, arms, hips) alongside an overall technique grade.

- 💡 **Personalized Drill Recommendations**:
  - Recommends specific corrective drills based on detected technical flaws (e.g., stiff legs, insufficient hip extension, over/under-arching).

- 🎥 **Technical Video Player**:
  - Configurable slow-motion playback (**0.25x**, **0.5x**, **1.0x**).
  - Frame-by-frame navigation and instant jump to peak impact keyframes.
  - Toggleable 3D biomechanical skeleton overlay with dynamic color coding.
  - Custom Vite dev server middleware supporting **HTTP 206 Byte-Range** requests for smooth high-res MP4 streaming.

- 🔒 **100% Client-Side Privacy**:
  - All pose estimation and video processing runs locally in the browser via WebGL and WebAssembly. No video data ever leaves your device.

- 🔔 **Synthesized Audio & Visual Feedback**:
  - Real-time audio cues synthesized via the **Web Audio API** for impacts and scores.
  - Celebratory confetti effects (`canvas-confetti`) for excellent performance (score $\ge 85$).

- 🌓 **Light & Dark Mode Support**:
  - Responsive design system with seamless dynamic theme toggling.

---

## 📐 Biomechanical Model & Measured Metrics

At the **peak arching instant**, the application tracks 33 body keypoints to measure 4 primary biomechanical metrics:

| Metric | Ideal Range / Target | Score Weight | Biomechanical Description |
| :--- | :---: | :---: | :--- |
| 🔙 **Torso Arch** | **20° to 40°** | **30%** | Backward tilt angle between the torso line (hip $\rightarrow$ shoulders) and vertical. Peak tilt $< 18°$ is disqualified as a non-peitada. |
| 🦵 **Knee Flexion** | **120° to 150°** | **30%** | Knee joint angle (hip $\rightarrow$ knee $\rightarrow$ ankle). Angles $> 165°$ indicate "stiff legs" (loss of spring); $< 100°$ indicates over-squatting (loss of timing). |
| 💪 **Arm Symmetry** | **Difference < 15°** | **20%** | Angular comparison between left and right elbow. Symmetric extension ensures stability in air. |
| 🏋️ **Hip Thrust** | **> 0.07** | **20%** | Forward projection of hips relative to ankles along the facing axis, normalized as a fraction of athlete height (zoom/distance invariant). |

---

## 📂 Project Architecture

```text
peitada_futevolei/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions CI/CD deployment workflow
├── public/                     # Static assets and sample video files
│   ├── sample_peitada.mp4
│   └── favicon.svg
├── src/
│   ├── assets/                 # Brand assets and visual media
│   ├── components/             # React UI Components
│   │   ├── BiomechanicsReport.jsx   # Scorecard and detailed diagnostic breakdown
│   │   ├── DrillRecommendations.jsx # Corrective training drill suggestions
│   │   ├── Header.jsx               # Navigation bar, reset triggers, and theme switch
│   │   ├── HowItWorks.jsx           # Interactive biomechanical guide and stick figure diagram
│   │   ├── Logo.jsx                 # Application branding logo component
│   │   ├── MetricsBadge.jsx         # Real-time metric pills badge
│   │   ├── PhaseTimeline.jsx        # Detected peitada event timeline
│   │   ├── PoseCanvasOverlay.jsx    # 2D/3D skeleton canvas overlaid on video
│   │   ├── VideoAnalyzer.jsx        # Main video player and detection loop coordinator
│   │   └── VideoUploader.jsx        # Video dropzone and preloaded sample selector
│   ├── utils/                  # AI Engines, Mathematics, and Biomechanical Logic
│   │   ├── angleDetector.js         # Anatomical angle calculation utilities
│   │   ├── ballTracker.js           # Computer vision ball trajectory tracking
│   │   ├── biomechanicsEngine.js    # Integrated biomechanical scoring engine
│   │   ├── figureGeometry.js        # Synthetic diagram geometry solver
│   │   ├── geometryMath.js          # 3D vector math and spatial angles
│   │   ├── peitadaDetector.js       # Finite state machine and peitada detector
│   │   ├── poseDetector.js          # MediaPipe Pose initialization and inference
│   │   ├── sampleData.js            # Sample video metadata configuration
│   │   └── theme.js                 # Dynamic color theme state management (light/dark)
│   ├── App.jsx                 # Root React App component
│   ├── App.css                 # Component-specific styles
│   ├── index.css               # Design System, HSL variables, and global CSS reset
│   └── main.jsx                # React 19 entry point
├── test/
│   └── peitadaDetector.test.mjs # Automated unit test suite for state machine logic
├── .oxlintrc.json              # Oxlint linter configuration
├── index.html                  # Main application HTML template
├── package.json                # Project dependencies and script declarations
└── vite.config.js              # Vite configuration (base path /peitada_futevolei/)
```

---

## 🛠️ Tech Stack

- **Core Framework**: [React 19](https://react.dev/) + [Vite 8](https://vitejs.dev/)
- **Computer Vision & AI**: [@mediapipe/tasks-vision](https://www.npmjs.com/package/@mediapipe/tasks-vision) & [@tensorflow/tfjs](https://www.tensorflow.org/js) (WebGL Backend)
- **Styling**: Vanilla CSS with dynamic HSL color variables and custom Design System (no heavy utility libraries)
- **Iconography**: [Lucide React](https://lucide.dev/)
- **Animations & Sound**: `canvas-confetti` & Web Audio API (Native synthesized audio)
- **Testing & Code Quality**: Node.js ESM Test Runner & [Oxlint](https://oxc.rs/)
- **Deployment & Hosting**: GitHub Actions & GitHub Pages

---

## ⚡ Local Setup & Development

### Prerequisites
- **Node.js**: v18.0.0 or higher.
- **npm**: v9.0.0 or higher.

### Step-by-Step Guide

1. **Clone the repository:**
   ```bash
   git clone https://github.com/meneguinha/peitada_futevolei.git
   cd peitada_futevolei
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open your browser at the URL shown in the terminal (typically `http://localhost:5173/peitada_futevolei/`).

4. **Run automated unit tests:**
   ```bash
   npm test
   ```

5. **Run the linter:**
   ```bash
   npm run lint
   ```

6. **Build for production:**
   ```bash
   npm run build
   ```

---

## 🧪 Automated Test Suite

The project includes an automated testing suite in `test/peitadaDetector.test.mjs` that generates synthetic 3D poses to evaluate biomechanical edge cases, camera yaw rotation tolerances, valid movements, and flaw detection.

Run all tests via:
```bash
npm test
```

Key test scenarios include:
- Verification of torso arch and knee flexion angle extraction.
- Camera perspective yaw robustness ($0°$ front view, $90°$ profile, $180°$ back view).
- State machine event deduplication and fast-rally tracking.

---

## 🚀 Continuous Deployment (GitHub Pages)

Deployment is fully automated using **GitHub Actions** upon pushing to the `main` branch.

- Action Workflow: `.github/workflows/deploy.yml`
- Base Path in `vite.config.js`: `base: '/peitada_futevolei/'`
- Public Web URL: **[https://meneguinha.github.io/peitada_futevolei/](https://meneguinha.github.io/peitada_futevolei/)**

---

## 📄 License

This project is licensed under the **MIT License**. See the `LICENSE` file for details.

---

<p align="center">
  Crafted with ⚽ & AI for the global <strong>Footvolley</strong> community.
</p>

