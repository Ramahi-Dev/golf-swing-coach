import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAddress, evaluateImpact, evaluateSwing, spineTilt, lateralShiftInches } from '../src/metrics.js';
import { angleDiff, buildPose, inchesPerPixel } from '../src/geometry.js';
import { makePose } from './helpers.js';

const RH = { dir: 1, hand: 'right', club: 'irons', inPerPx: 0.1 };
const byKey = (ms) => Object.fromEntries(ms.map((m) => [m.key, m]));

test('spine tilt is positive when shoulders lean away from target (RH = screen left)', () => {
  const p = makePose({ shoulderMid: { x: 472, y: 650 } }); // 28 px left over 200 px ≈ 8°
  const t = spineTilt(p, 1);
  assert.ok(t > 7 && t < 9, `tilt ${t}`);
  assert.ok(spineTilt(p, -1) < 0, 'same pose is tilted toward target for a lefty');
});

test('address card matches a textbook iron setup', () => {
  const p = makePose({ shoulderMid: { x: 472, y: 650 } });
  const m = byKey(evaluateAddress(p, { ...RH, ball: { x: 510, y: 1280 } }));
  assert.equal(m.spineTilt.rating, 'good');
  assert.equal(m.spineTilt.display, '8° away from target');
  assert.equal(m.stance.rating, 'good'); // 210 / 150 = 1.4
  assert.equal(m.stance.display, 'About shoulder width');
  assert.equal(m.ballPos.display, 'Center');
  assert.equal(m.ballPos.rating, 'good');
});

test('ball position without a marked ball asks the user to set it', () => {
  const m = byKey(evaluateAddress(makePose(), RH));
  assert.equal(m.ballPos.rating, 'none');
  assert.match(m.ballPos.display, /Set ball/);
});

test('driver ranges differ from irons', () => {
  const p = makePose({ shoulderMid: { x: 472, y: 650 } });
  const m = byKey(evaluateAddress(p, { ...RH, club: 'driver', ball: { x: 510, y: 1280 } }));
  assert.equal(m.ballPos.rating, 'bad'); // center is too far back for a driver
  assert.match(m.ballPos.cue, /forward/);
});

test('lateral shift sign follows the target direction', () => {
  assert.equal(lateralShiftInches({ x: 520 }, { x: 500 }, 1, 0.1), 2);
  assert.equal(lateralShiftInches({ x: 520 }, { x: 500 }, -1, 0.1), -2);
});

test('impact flags a head that moved toward the target', () => {
  const a = makePose();
  const i = makePose({ head: { x: 540, y: 545 }, hipMid: { x: 540, y: 850 }, hands: { x: 530, y: 900 } });
  const m = byKey(evaluateImpact(i, a, RH));
  assert.equal(m.hipImpact.rating, 'good'); // 4 in
  assert.equal(m.headImpact.rating, 'bad'); // 4 in toward target
  assert.match(m.headImpact.cue, /behind the ball/);
});

test('evaluateSwing scores and picks an impact cue first', () => {
  const address = makePose({ shoulderMid: { x: 472, y: 650 } });
  const rec = {
    address,
    top: makePose({ hands: { x: 380, y: 520 } }),
    impact: makePose({ head: { x: 540, y: 545 }, hipMid: { x: 540, y: 850 }, hands: { x: 530, y: 900 } }),
    finish: makePose({ hipMid: { x: 600, y: 840 }, hands: { x: 640, y: 560 } }),
    held: true,
  };
  const r = evaluateSwing(rec, RH);
  assert.equal(r.checkpoints.length, 4);
  assert.ok(r.score > 0 && r.score <= 100);
  assert.match(r.coachLine, /behind the ball/);
});

test('angleDiff wraps around', () => {
  assert.equal(angleDiff(170, -170), 20);
  assert.equal(angleDiff(10, 100), 90);
});

test('buildPose + inchesPerPixel use world segment lengths', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
  const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (i, y, wy, x = 0.5) => {
    lm[i] = { x, y, z: 0, visibility: 1 };
    world[i] = { x: 0, y: wy, z: 0 };
  };
  // Chain shoulder(11/12) → hip(23/24) → knee(25/26) → ankle(27/28), 0.25 normalized ≈ 0.5 m each.
  for (const [s, hp, k, a, x] of [[11, 23, 25, 27, 0.55], [12, 24, 26, 28, 0.45]]) {
    set(s, 0.25, -0.5, x); set(hp, 0.5, 0, x); set(k, 0.75, 0.5, x); set(a, 1.0, 1.0, x);
  }
  set(15, 0.6, 0.1, 0.52); set(16, 0.6, 0.1, 0.48);
  const p = buildPose(lm, world, 1000, 1000);
  assert.ok(p);
  // 250 px ↔ 0.5 m  → 0.5 * 39.37 / 250 ≈ 0.0787 in/px
  assert.ok(Math.abs(inchesPerPixel(p) - 0.0787) < 0.001);
  lm[15].visibility = 0.1;
  assert.equal(buildPose(lm, world, 1000, 1000), null, 'missing wrist → no pose');
});
