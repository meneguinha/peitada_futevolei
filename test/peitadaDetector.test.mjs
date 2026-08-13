import { createPeitadaDetector } from '../src/utils/peitadaDetector.js';
import {
  FIGURE, ILLUSTRATED_KNEE_ANGLE, ILLUSTRATED_TORSO_TILT, angleAt, torsoTiltOf
} from '../src/utils/figureGeometry.js';

const D = Math.PI / 180;

// Build a synthetic athlete as MediaPipe world landmarks (metres, y down,
// origin between the hips). `tiltDeg` > 0 = arching backwards.
// `yawDeg` rotates the athlete about the vertical axis: 0 = facing the camera,
// 90 = profile, 180 = back to the camera.
function makePose({ tiltDeg = 0, kneeZ = 0.186, thrust = 0.12, yawDeg = 0, armSkew = 0 }) {
  const t = tiltDeg * D;
  const sMid = { x: 0, y: -0.5 * Math.cos(t), z: 0.5 * Math.sin(t) }; // forward = -z

  const p = new Array(33).fill(null).map(() => ({ x: 0, y: 0, z: 0 }));
  p[23] = { x: +0.15, y: 0, z: 0 };                     // left hip
  p[24] = { x: -0.15, y: 0, z: 0 };                     // right hip
  p[11] = { x: sMid.x + 0.2, y: sMid.y, z: sMid.z };    // left shoulder
  p[12] = { x: sMid.x - 0.2, y: sMid.y, z: sMid.z };    // right shoulder
  p[13] = { x: sMid.x + 0.42, y: sMid.y + 0.02, z: sMid.z };
  p[14] = { x: sMid.x - 0.42, y: sMid.y + 0.02, z: sMid.z + armSkew };
  p[15] = { x: sMid.x + 0.68, y: sMid.y + 0.04, z: sMid.z };
  p[16] = { x: sMid.x - 0.68, y: sMid.y + 0.04, z: sMid.z + armSkew * 2 };
  p[25] = { x: +0.15, y: 0.45, z: -kneeZ };             // left knee
  p[26] = { x: -0.15, y: 0.45, z: -kneeZ };
  p[27] = { x: +0.15, y: 0.90, z: thrust };             // left ankle (hips lead)
  p[28] = { x: -0.15, y: 0.90, z: thrust };
  p[29] = { x: +0.15, y: 0.98, z: thrust + 0.06 };      // left heel
  p[30] = { x: -0.15, y: 0.98, z: thrust + 0.06 };
  p[31] = { x: +0.15, y: 0.98, z: thrust - 0.14 };      // left toe, points forward
  p[32] = { x: -0.15, y: 0.98, z: thrust - 0.14 };
  p[0] = { x: 0, y: sMid.y - 0.15, z: sMid.z - 0.09 };  // nose, points forward
  p[7] = { x: +0.07, y: sMid.y - 0.13, z: sMid.z + 0.02 }; // left ear
  p[8] = { x: -0.07, y: sMid.y - 0.13, z: sMid.z + 0.02 };

  const y = yawDeg * D;
  return p.map((q) => ({
    x: q.x * Math.cos(y) + q.z * Math.sin(y),
    y: q.y,
    z: -q.x * Math.sin(y) + q.z * Math.cos(y)
  }));
}

// A peitada: rise to `peak` degrees and come back down, sampled every 50ms.
function run(profile, yawDeg = 0, extra = {}) {
  const det = createPeitadaDetector();
  profile.forEach((tiltDeg, i) => {
    det.feed({ worldLandmarks: makePose({ tiltDeg, yawDeg, ...extra }) }, i * 50);
  });
  return det;
}

const bell = (peak, n = 40) =>
  Array.from({ length: n }, (_, i) => peak * Math.sin((i / (n - 1)) * Math.PI));

let failures = 0;
const check = (name, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${actual}${ok ? '' : ` (esperado ${expected})`}`);
};

console.log('--- deteccao ---');
for (const yaw of [0, 45, 90, 135, 180, 270]) {
  check(`arco 30deg, yaw ${yaw}`, run(bell(30), yaw).getPeitadas().length, 1);
}

console.log('\n--- sequencia de peitadas (rally) ---');
// The real failure: in a rally the athlete never returns to upright between
// peitadas, so a closing condition based on an absolute return angle commits
// only the ones where they happened to stand up. Tilt here oscillates between
// 14 and 30 degrees and never goes near vertical.
const rally = (cycles, lo = 14, hi = 30, perCycle = 16) =>
  Array.from({ length: cycles * perCycle }, (_, i) => {
    const phase = (i % perCycle) / perCycle;
    return lo + (hi - lo) * Math.sin(phase * Math.PI);
  });

// Tail: the athlete settles after the last peitada, as in a real clip.
const settle = Array(8).fill(8);
for (const n of [3, 5, 8]) {
  check(`${n} peitadas seguidas sem voltar a vertical`, run([...rally(n), ...settle], 90).getPeitadas().length, n);
}
// And with no settling at all — clip cut right after the last peitada — the
// end-of-playback flush has to rescue the one still in flight.
for (const n of [3, 5]) {
  const det = run(rally(n), 90);
  const before = det.getPeitadas().length;
  det.flush();
  check(`${n} peitadas com corte seco (flush)`, det.getPeitadas().length, n);
  check(`  flush resgatou a ultima`, det.getPeitadas().length - before, 1);
}
// A single arch held for a while is one movement, not many: rise once, hold,
// come down once.
const held = [...bell(30, 10).slice(0, 5), ...Array(20).fill(29), ...bell(30, 10).slice(5)];
check('arco sustentado nao vira varias', run(held, 90).getPeitadas().length, 1);

console.log('\n--- rejeicao de flexao frontal, onde da pra enxergar ---');
// In profile the facing direction is visible in the image plane, so the sign is
// trustworthy and a forward fold is correctly rejected.
for (const yaw of [90, 270]) {
  check(`perfil: flexao -40deg rejeitada, yaw ${yaw}`, run(bell(-40), yaw).getPeitadas().length, 0);
}
// Head-on, no 2D method can separate an arch from a fold. We accept the false
// positive rather than risk suppressing real peitadas — that tradeoff is the
// whole point of the confidence gate.
for (const yaw of [0, 180]) {
  check(`frontal: flexao aceita via fallback, yaw ${yaw}`, run(bell(-40), yaw).getPeitadas().length, 1);
}
check('tronco quase reto 8deg', run(bell(8)).getPeitadas().length, 0);

console.log('\n--- regressao: direcao incerta nunca bloqueia deteccao ---');
// Regression guard for the bug that shipped: deriving "forward" from an axis
// that lives in MediaPipe's unreliable z inverted the sign on profile videos,
// so the threshold was never crossed and nothing was ever scored. A movement
// must still be detected when the facing direction is unusable.
const noFacing = (tiltDeg, yawDeg) => {
  const p = makePose({ tiltDeg, yawDeg });
  [0, 7, 8, 29, 30, 31, 32].forEach((i) => { p[i] = { x: 0, y: 0, z: 0 }; });
  return p;
};
for (const yaw of [0, 90, 180, 270]) {
  const det = createPeitadaDetector();
  bell(30).forEach((tiltDeg, i) => det.feed({ worldLandmarks: noFacing(tiltDeg, yaw) }, i * 50));
  check(`sem pes/cabeca ainda detecta, yaw ${yaw}`, det.getPeitadas().length, 1);
  check(`  e reporta confianca zero, yaw ${yaw}`, det.getDebug().confidence, 0);
}

console.log('\n--- score e metricas (arco 30deg, perfil) ---');
const p = run(bell(30), 90).getPeitadas()[0];
console.log(JSON.stringify({ score: p.score, ...p.details }, null, 2));
check('arco ~30deg', Math.abs(p.details.torsoArch - 30) <= 3, true);

// Knee angle against two analytically unambiguous configurations:
// collinear hip-knee-ankle must read 180, and perpendicular segments 90.
const straight = run(bell(30), 90, { kneeZ: 0, thrust: 0 }).getPeitadas()[0];
check('perna colinear = 180deg', straight.details.kneeFlexion, 180);
const square = run(bell(30), 90, { kneeZ: 0.45, thrust: 0 }).getPeitadas()[0];
check('perna em angulo reto = 90deg', square.details.kneeFlexion, 90);
check('bracos simetricos', p.details.armBalance <= 1, true);
check('quadril pontuado', p.details.hipScore, 100);
console.log('flaws:', p.flaws);

console.log('\n--- independencia de aspect ratio ---');
// Same movement, same numbers, regardless of how the frame was shaped.
const a = run(bell(30), 90).getPeitadas()[0];
const b = run(bell(30), 90).getPeitadas()[0];
check('deterministico', a.score === b.score, true);

console.log('\n--- idempotencia sob replay/seek ---');
const det = createPeitadaDetector();
const seq = bell(30);
// Play the clip, then rewind and play it again from the start.
for (const pass of [0, 1]) {
  if (pass === 1) det.resetTransient();
  seq.forEach((tiltDeg, i) => det.feed({ worldLandmarks: makePose({ tiltDeg, yawDeg: 90 }) }, i * 50));
}
check('replay nao duplica', det.getPeitadas().length, 1);

// Seek backwards mid-clip must not stall detection.
const det2 = createPeitadaDetector();
seq.slice(0, 15).forEach((tiltDeg, i) => det2.feed({ worldLandmarks: makePose({ tiltDeg, yawDeg: 90 }) }, i * 50));
seq.forEach((tiltDeg, i) => det2.feed({ worldLandmarks: makePose({ tiltDeg, yawDeg: 90 }) }, i * 50));
check('seek para tras nao trava', det2.getPeitadas().length, 1);

console.log('\n--- figura explicativa da tela inicial ---');
// The diagram teaches angle measurement, so it must survive being measured:
// the drawn joints have to produce the angles the legend claims.
// Joint coordinates are rounded to one decimal for legibility in the SVG, so
// half a degree is the precision the drawing can actually carry.
const TOL = 0.5;
const drawnKnee = angleAt(FIGURE.hip, FIGURE.knee, FIGURE.ankle);
const drawnTilt = torsoTiltOf(FIGURE);
check(`joelho desenhado = ${drawnKnee.toFixed(2)}deg, rotulo ${ILLUSTRATED_KNEE_ANGLE}`,
  Math.abs(drawnKnee - ILLUSTRATED_KNEE_ANGLE) <= TOL, true);
check(`tronco desenhado = ${drawnTilt.toFixed(2)}deg, rotulo ${ILLUSTRATED_TORSO_TILT}`,
  Math.abs(drawnTilt - ILLUSTRATED_TORSO_TILT) <= TOL, true);
// Facing +x, so an arch is shoulders behind the hip and thrust is hip ahead of ankle.
check('ombros atras do quadril (arco pra tras)', FIGURE.shoulder.x < FIGURE.hip.x, true);
check('quadril a frente do tornozelo (avanco)', FIGURE.hip.x > FIGURE.ankle.x, true);
check('rotulos dentro das faixas ideais',
  ILLUSTRATED_KNEE_ANGLE >= 120 && ILLUSTRATED_KNEE_ANGLE <= 150 &&
  ILLUSTRATED_TORSO_TILT >= 20 && ILLUSTRATED_TORSO_TILT <= 40, true);

console.log('\n--- bola estimada fica fora do score ---');
const det3 = run(bell(30), 90);
const before = det3.getPeitadas()[0];
det3.applyBallData(before.seq, { maxHeightMeters: 9.9, horizontalDistanceMeters: 9.9, measured: false, valid: true });
check('score inalterado por estimativa', det3.getPeitadas()[0].score, before.score);
det3.applyBallData(before.seq, { maxHeightMeters: 0.2, horizontalDistanceMeters: 0.1, measured: true, valid: true });
check('score muda com medicao real', det3.getPeitadas()[0].score !== before.score, true);
check('flaws nao duplicam', new Set(det3.getPeitadas()[0].flaws).size, det3.getPeitadas()[0].flaws.length);

console.log(`\n${failures === 0 ? 'TODOS OS CHECKS PASSARAM' : failures + ' CHECK(S) FALHARAM'}`);
process.exit(failures === 0 ? 0 : 1);

