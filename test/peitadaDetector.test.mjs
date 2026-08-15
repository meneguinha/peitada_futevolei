import { createPeitadaDetector } from '../src/utils/peitadaDetector.js';
import {
  FIGURE, ILLUSTRATED_KNEE_ANGLE, ILLUSTRATED_TORSO_TILT, angleAt, torsoTiltOf
} from '../src/utils/figureGeometry.js';
import {
  BANDS, SIGMA, MIN_REPS_FOR_SCORE, rampScore, scoreUncertainty
} from '../src/utils/measurementUncertainty.js';
import { fitBallistic } from '../src/utils/ballTracker.js';

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
check('quadril pontuado bem', p.details.hipScore >= 90, true);
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

console.log('\n--- pontuacao continua e incerteza ---');
{
  // The point of the ramps: no cliffs. Sweep each band and assert that no
  // single-unit step moves the score more than a hair, and that a full sigma of
  // sensor error never swings it by more than a grade's worth.
  const sweep = (anchors, from, to, step) => {
    let maxStep = 0;
    for (let v = from; v <= to; v += step) {
      const d = Math.abs(rampScore(v + step, anchors) - rampScore(v, anchors));
      if (d > maxStep) maxStep = d;
    }
    return maxStep;
  };
  // No cliffs: the old bands jumped 30 points at a single degree. A gentle
  // slope is fine — flattening further would throw away real signal. What makes
  // a steep slope honest is that the reported uncertainty grows with it, which
  // is asserted below.
  check('joelho: sem salto abrupto', sweep(BANDS.knee, 60, 200, 1) <= 5, true);
  check('arco: sem salto abrupto', sweep(BANDS.arch, 0, 90, 1) <= 5, true);
  check('bracos: sem salto abrupto', sweep(BANDS.armDiff, 0, 90, 1) <= 5, true);

  // The old bands had a 30-point cliff at exactly 150°, inside the noise floor.
  const cliff = Math.abs(rampScore(151, BANDS.knee) - rampScore(150, BANDS.knee));
  check('sem degrau no antigo limiar de 150°', cliff <= 2, true);

  // The contract that makes a steep ramp acceptable: wherever a sigma of sensor
  // error would swing the score, the app must SAY so. Check that the reported
  // uncertainty tracks the local slope everywhere, not just at a lucky point.
  let worstUnreported = 0;
  for (const [name, anchors, sigma] of [
    ['joelho', BANDS.knee, SIGMA.knee],
    ['arco', BANDS.arch, SIGMA.arch],
    ['bracos', BANDS.armDiff, SIGMA.armDiff]
  ]) {
    for (let v = 0; v <= 200; v += 1) {
      const swing = Math.abs(rampScore(v + sigma, anchors) - rampScore(v - sigma, anchors)) / 2;
      const reported = scoreUncertainty(v, sigma, anchors);
      if (swing - reported > worstUnreported) worstUnreported = swing - reported;
    }
    check(`${name}: incerteza reportada cobre o desvio de 1σ`, worstUnreported <= 0.5, true);
  }
  check('arco em rampa reporta incerteza substancial',
    scoreUncertainty(16, SIGMA.arch, BANDS.arch) > 10, true);
  check('arco no centro do platô reporta incerteza moderada',
    scoreUncertainty(32, SIGMA.arch, BANDS.arch) < 10, true);

  // A perfect movement still scores very high — the ramps kept the old calibration but made 100 harder.
  const perfect = run(bell(30), 90).getPeitadas()[0];
  check('movimento ideal ainda pontua >= 95', perfect.score >= 95, true);
  check('e reporta incerteza propria', typeof perfect.details.scoreUncertainty, 'number');
}

console.log('\n--- score de sessao exige repeticoes ---');
{
  const det = createPeitadaDetector();
  const one = [...rally(1), ...Array(8).fill(8)];
  let t = 0;

  for (let rep = 1; rep <= 4; rep++) {
    one.forEach((tiltDeg) => {
      det.feed({ worldLandmarks: makePose({ tiltDeg, yawDeg: 90 }) }, t);
      t += 50;
    });
    const s = det.getSessionScore();
    check(`${rep} repeticao(oes) -> liberado?`, s.reliable, rep >= MIN_REPS_FOR_SCORE);
  }

  const finalS = det.getSessionScore();
  check('sessao reporta n', finalS.n >= MIN_REPS_FOR_SCORE, true);
  check('sessao reporta margem', typeof finalS.margin, 'number');
  check('margem nao negativa', finalS.margin >= 0, true);

  // Zero repetitions must never look like a real score.
  const empty = createPeitadaDetector().getSessionScore();
  check('sessao vazia nao e confiavel', empty.reliable, false);
  check('sessao vazia tem n=0', empty.n, 0);
}

console.log('\n--- metricas direcionais dependem do angulo de camera ---');
{
  // Profile: the facing direction is visible, so hip thrust is measured.
  const perfil = run(bell(30), 90).getPeitadas()[0];
  check('perfil: quadril e medido', perfil.details.hipMeasured, true);
  check('perfil: confianca alta', perfil.details.facingConfidence > 0.5, true);

  // 3D perspective reconstruction: hip thrust and horizontal distance are measured across all views
  const frontal = run(bell(30), 0).getPeitadas()[0];
  check('frontal: quadril e medido em 3D', frontal.details.hipMeasured, true);
  check('frontal: quadril tem valor positivo e fisico', frontal.details.hipThrust > 0, true);
  check(`frontal ainda pontua bem (${frontal.score})`, frontal.score >= 80, true);

  // Ball height evaluation
  const ball = { measured: true, maxHeightMeters: 1.5, samples: 14 };
  const dPerfil = run(bell(30), 90);
  dPerfil.applyBallData(dPerfil.getPeitadas()[0].seq, ball);
  check('perfil: altura da bola e medida',
    dPerfil.getPeitadas()[0].details.ballMeasured, true);

  const dFrontal = run(bell(30), 0);
  dFrontal.applyBallData(dFrontal.getPeitadas()[0].seq, ball);
  const fb = dFrontal.getPeitadas()[0].details;
  check('frontal: altura da bola e medida', fb.ballMeasured, true);
  check('frontal: reporta altura fisica', fb.ballMaxHeight > 0, true);
}

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

console.log('\n--- ajuste balistico da bola ---');
{
  // Synthesise a real ball flight in normalized image coords (y grows down) and
  // check the fit recovers the true apex height.
  const SCALE = 3.2;               // metres per normalized unit
  const makeFlight = ({ v0 = 5.0, vx = 1.6, n = 20, dt = 0.05, noise = 0, y0 = 0.7 }) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      const hMet = v0 * t - 0.5 * 9.81 * t * t;     // metres above contact
      const jitter = () => (noise ? (Math.sin(i * 12.9898) * 43758.5453 % 1) * noise : 0);
      pts.push({
        x: 0.5 + (vx * t) / SCALE + jitter(),
        y: y0 - hMet / SCALE + jitter(),
        timeMs: t * 1000
      });
    }
    return pts;
  };

  const trueApex = (5.0 ** 2) / (2 * 9.81); // v0^2 / 2g = 1.274 m
  const clean = fitBallistic(makeFlight({}), SCALE);
  check('voo limpo e aceito', clean.measured, true);
  check(`apice ~${trueApex.toFixed(2)}m (obtido ${clean.maxHeightMeters}m)`,
    Math.abs(clean.maxHeightMeters - trueApex) < 0.15, true);
  check('escala derivada bate com a do atleta',
    Math.abs(clean.scaleRatio - 1) < 0.15, true);
  check('reporta deslocamento horizontal', clean.horizontalDistanceMeters > 0, true);

  const verticalClip = fitBallistic(makeFlight({}), SCALE, 720 / 1280);
  check('aspect ratio vertical reduz distancia horizontal proporcionalmente',
    verticalClip.horizontalDistanceMeters < clean.horizontalDistanceMeters, true);

  // Different launches must give different numbers — the whole complaint about
  // the old estimator was that every clip returned the same value.
  const heights = [3.5, 5.0, 6.5, 8.0].map(
    (v0) => fitBallistic(makeFlight({ v0 }), SCALE).maxHeightMeters
  );
  check(`alturas variam entre lancamentos: ${heights.join(', ')}`,
    new Set(heights).size === heights.length, true);
  check('altura cresce com a velocidade inicial',
    heights.every((h, i) => i === 0 || h > heights[i - 1]), true);

  // Rejections.
  const straight = Array.from({ length: 20 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.5, timeMs: i * 50 }));
  check('linha reta e rejeitada', fitBallistic(straight, SCALE).measured, false);

  const upward = Array.from({ length: 20 }, (_, i) => ({ x: 0.3, y: 0.5 + 0.5 * (i * 0.05) ** 2, timeMs: i * 50 }));
  const up = fitBallistic(upward, SCALE);
  check('curvatura errada e rejeitada', up.measured, false);

  check('poucas amostras sao rejeitadas',
    fitBallistic(makeFlight({ n: 4 }), SCALE).measured, false);

  // Same flight, wrong scale: curvature no longer matches gravity.
  check('escala absurda e rejeitada pela gravidade',
    fitBallistic(makeFlight({}), 0.3).measured, false);

  // The real failure the user hit: 42 tracked samples spanning far more than one
  // flight. A single parabola over the whole window curves the wrong way, so the
  // flight has to be found inside the path rather than assumed to be all of it.
  const flight = makeFlight({ v0: 5.0, n: 16, dt: 0.05 });
  const afterLanding = Array.from({ length: 14 }, (_, i) => ({
    x: 0.5 + 1.6 * 0.8 / SCALE + i * 0.002,
    y: 0.72 + Math.sin(i) * 0.004,          // ball rolling/settling, not falling
    timeMs: 800 + i * 50
  }));
  const secondArc = makeFlight({ v0: 4.0, n: 12, dt: 0.05 }).map((p) => ({
    ...p, timeMs: p.timeMs + 1500
  }));
  const messy = [...flight, ...afterLanding, ...secondArc];

  const found = fitBallistic(messy, SCALE);
  check(`trecho de voo encontrado em ${messy.length} amostras`, found.measured, true);
  check(`apice do primeiro voo (~1.27m, obtido ${found.maxHeightMeters}m)`,
    Math.abs(found.maxHeightMeters - 1.274) < 0.2, true);
  check('usa apenas parte das amostras', found.flightSamples < messy.length, true);

  // Height must not depend on where the accepted window happens to start. A
  // stretch sitting near the apex barely moves, so measuring the rise from the
  // window start under-reports badly; the parabola is extrapolated back to
  // contact instead.
  // Tracking always begins at contact, so points[0] carries the contact time
  // even when the early samples are too messy to fit. Corrupt the first six and
  // check the usable later window still reports the full rise.
  const full = makeFlight({ v0: 5.0, n: 22, dt: 0.05 });
  const messyStart = full.map((pt, i) =>
    i < 6 ? { ...pt, x: 0.5 + (i % 2) * 0.05, y: 0.66 + (i % 3) * 0.03 } : pt);
  const fromLate = fitBallistic(messyStart, SCALE);
  check(`inicio ruidoso: ainda mede o voo inteiro (${fromLate.maxHeightMeters}m)`,
    Math.abs(fromLate.maxHeightMeters - 1.274) < 0.2, true);
  check('e usa apenas a parte limpa', fromLate.flightSamples < full.length, true);

  // The scale comes from the ball's own fall, not from the athlete's body. So a
  // wrong athlete ruler must not change the answer — only the plausibility gate
  // uses it. This is what a non-profile camera needs, since the body ruler sits
  // at the athlete's depth and the ball does not.
  const withGoodRuler = fitBallistic(full, SCALE).maxHeightMeters;
  const withOffRuler = fitBallistic(full, SCALE * 1.6).maxHeightMeters;
  check(`altura independe da regua do atleta (${withGoodRuler} vs ${withOffRuler})`,
    withGoodRuler === withOffRuler, true);
  check('regua absurda ainda e barrada pelo portao',
    fitBallistic(full, SCALE * 6).measured, false);

  // Lock-on to something bright and stationary must be caught before any fitting.
  const parado = Array.from({ length: 40 }, (_, i) => ({
    x: 0.31 + Math.sin(i) * 0.002, y: 0.44 + Math.cos(i) * 0.002, timeMs: i * 50
  }));
  const still = fitBallistic(parado, SCALE);
  check('alvo parado e rejeitado', still.measured, false);
  check('e diz que estava parado', still.reason, 'alvo praticamente parado');

  // Every rejection has to say how many samples it had. "0 amostras" means the
  // detector never saw the ball; "12 amostras, ajuste ruim" means it saw it and
  // the trajectory gate refused. Those need opposite fixes, so the count is not
  // optional diagnostics — it is the thing that makes the failure actionable.
  for (const [label, pts] of [
    ['vazio', []],
    ['linha reta', straight],
    ['curvatura invertida', upward]
  ]) {
    const r = fitBallistic(pts, SCALE);
    check(`${label}: reporta contagem de amostras`, typeof r.samples, 'number');
    check(`${label}: reporta motivo`, typeof r.reason, 'string');
  }
}

console.log('\n--- bola nao medida fica fora do score ---');
const det3 = run(bell(30), 90);
const before = det3.getPeitadas()[0];
det3.applyBallData(before.seq, { measured: false, reason: 'ajuste ruim' });
const unmeasured = det3.getPeitadas()[0];
check('score inalterado quando a bola nao e medida', unmeasured.score, before.score);
check('nenhum numero de bola e inventado', unmeasured.details.ballMaxHeight, 0);
check('marcado como nao medido', unmeasured.details.ballMeasured, false);
check('guarda o motivo da falha', unmeasured.details.ballFailReason, 'ajuste ruim');
det3.applyBallData(before.seq, { maxHeightMeters: 0.2, horizontalDistanceMeters: 0.1, measured: true, samples: 12 });
check('score muda com medicao real', det3.getPeitadas()[0].score !== before.score, true);
check('flaws nao duplicam', new Set(det3.getPeitadas()[0].flaws).size, det3.getPeitadas()[0].flaws.length);

console.log(`\n${failures === 0 ? 'TODOS OS CHECKS PASSARAM' : failures + ' CHECK(S) FALHARAM'}`);
process.exit(failures === 0 ? 0 : 1);

