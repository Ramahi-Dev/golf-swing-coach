// Checkpoint metrics and "tour pro" reference ranges.
//
// Camera assumption: face-on view (camera in front of the golfer, chest facing the lens),
// image NOT mirrored. For a right-handed golfer the target is therefore to screen-right.
// Every lateral measurement is converted to "+ = toward target" with u(p) = p.x * dir.
//
// Reference ranges are coaching heuristics drawn from common face-on teaching numbers,
// not lab-grade biomechanics. They are intentionally kept in one place so they are easy to tune.

import { angle3, angleDiff, clamp, toDeg, yawDeg } from './geometry.js';

export const targetDirFor = (hand) => (hand === 'left' ? -1 : 1);

const u = (p, dir) => p.x * dir;

/** Lateral shift of point p relative to p0, in inches, + = toward the target. */
export function lateralShiftInches(p, p0, dir, inPerPx) {
  if (!p || !p0 || !inPerPx) return null;
  return (u(p, dir) - u(p0, dir)) * inPerPx;
}

function rate(v, good, ok) {
  if (v >= good[0] && v <= good[1]) return 'good';
  if (ok && v >= ok[0] && v <= ok[1]) return 'ok';
  return 'bad';
}

function metric({ key, label, value, display, pro, good, ok, lowCue, highCue }) {
  if (value == null || Number.isNaN(value)) {
    return { key, label, value: null, display: display ?? '—', pro, rating: 'none', cue: null };
  }
  const rating = rate(value, good, ok);
  const cue = rating === 'good' ? null : value < good[0] ? lowCue : highCue;
  return { key, label, value, display, pro, rating, cue };
}

const inches = (v, pos, neg) =>
  Math.abs(v) < 0.25 ? 'No change' : `${Math.abs(v).toFixed(1)} in ${v > 0 ? pos : neg}`;

/** Per-club reference ranges. good = green, ok = yellow, anything else = red. */
export const PRO = {
  irons: {
    ballPos: { good: [0.45, 0.68], ok: [0.38, 0.78], pro: 'Center to slightly forward (irons)' },
    spineTilt: { good: [2, 10], ok: [0, 14], pro: 'Slight tilt away from target' },
    stance: { good: [1.15, 1.65], ok: [1.0, 1.9], pro: 'About shoulder width (irons)' },
    handsAhead: { good: [1, 6], ok: [-0.5, 8], pro: 'Hands ahead of the ball (shaft lean)' },
  },
  driver: {
    ballPos: { good: [0.72, 1.0], ok: [0.62, 1.1], pro: 'Inside lead heel (driver)' },
    spineTilt: { good: [6, 15], ok: [3, 20], pro: 'Tilt away from target (more than irons)' },
    stance: { good: [1.45, 2.1], ok: [1.25, 2.4], pro: 'Wider than shoulders (driver)' },
    handsAhead: { good: [-1, 3], ok: [-3, 5], pro: 'Hands about even with the ball' },
  },
};

function ankles(pose, dir) {
  const a = pose.pts.L_ANKLE;
  const b = pose.pts.R_ANKLE;
  return u(a, dir) < u(b, dir) ? { trail: a, lead: b } : { trail: b, lead: a };
}

/** Where p sits between the trail ankle (0) and the lead ankle (1). */
function stanceFraction(p, pose, dir) {
  if (!pose.feetVisible) return null;
  const { trail, lead } = ankles(pose, dir);
  const span = u(lead, dir) - u(trail, dir);
  if (span <= 1) return null;
  return (u(p, dir) - u(trail, dir)) / span;
}

/** Spine tilt in degrees; + = upper body tilted away from the target. */
export function spineTilt(pose, dir) {
  const dx = u(pose.shoulderMid, dir) - u(pose.hipMid, dir);
  const dy = pose.hipMid.y - pose.shoulderMid.y;
  return toDeg(Math.atan2(-dx, dy));
}

function ballPositionLabel(t) {
  if (t < 0.38) return 'Back of stance';
  if (t < 0.46) return 'Slightly back';
  if (t < 0.56) return 'Center';
  if (t < 0.7) return 'Slightly forward';
  if (t <= 1.0) return 'Forward (toward lead heel)';
  return 'Outside lead foot';
}

function stanceLabel(r) {
  if (r < 1.1) return 'Narrow';
  if (r < 1.6) return 'About shoulder width';
  if (r < 2.0) return 'Wider than shoulders';
  return 'Very wide';
}

// ---------------------------------------------------------------- checkpoints

export function evaluateAddress(pose, ctx) {
  const { dir, club = 'irons', ball } = ctx;
  const ref = PRO[club] ?? PRO.irons;

  const bp = ball ? stanceFraction(ball, pose, dir) : null;
  const tilt = spineTilt(pose, dir);
  const shoulderW = Math.abs(pose.pts.L_SHOULDER.x - pose.pts.R_SHOULDER.x);
  const ankleW = Math.abs(pose.pts.L_ANKLE.x - pose.pts.R_ANKLE.x);
  const stance = pose.feetVisible && shoulderW > 1 ? ankleW / shoulderW : null;

  return [
    metric({
      key: 'ballPos',
      label: 'Ball position',
      value: bp,
      display: bp == null ? (ball ? 'Feet not visible' : 'Tap “Set ball” to mark it') : ballPositionLabel(bp),
      ...ref.ballPos,
      lowCue: 'Move the ball a little more forward in your stance.',
      highCue: 'The ball is too far forward. Move it back a touch.',
    }),
    metric({
      key: 'spineTilt',
      label: 'Spine tilt',
      value: tilt,
      display:
        Math.abs(tilt) < 1 ? 'Vertical' : `${Math.round(Math.abs(tilt))}° ${tilt > 0 ? 'away from' : 'toward'} target`,
      ...ref.spineTilt,
      lowCue: 'At address, tilt your upper body slightly away from the target.',
      highCue: 'You have too much tilt away from the target at address.',
    }),
    metric({
      key: 'stance',
      label: 'Stance',
      value: stance,
      display: stance == null ? 'Feet not visible' : stanceLabel(stance),
      ...ref.stance,
      lowCue: 'Widen your stance a bit.',
      highCue: 'Your stance is a bit wide. Bring your feet in.',
    }),
  ];
}

function rotation(pose, address, a, b) {
  if (!pose.world || !address.world) return null;
  return angleDiff(yawDeg(pose.world[a], pose.world[b]), yawDeg(address.world[a], address.world[b]));
}

export function evaluateTop(pose, address, ctx) {
  const { dir, inPerPx, hand } = ctx;
  const head = lateralShiftInches(pose.head, address.head, dir, inPerPx);
  const hip = lateralShiftInches(pose.hipMid, address.hipMid, dir, inPerPx);
  const turn = rotation(pose, address, 'L_SHOULDER', 'R_SHOULDER');
  const lead = hand === 'left' ? 'R' : 'L';
  const arm = pose.world
    ? angle3(pose.world[`${lead}_SHOULDER`], pose.world[`${lead}_ELBOW`], pose.world[`${lead}_WRIST`])
    : null;

  return [
    metric({
      key: 'headTop',
      label: 'Head',
      value: head,
      display: head == null ? '—' : inches(head, 'toward target', 'away from target'),
      good: [-2.5, 0.75],
      ok: [-4, 1.5],
      pro: 'Steady; small drift away is fine (0–2 in)',
      lowCue: 'Your head is swaying off the ball. Keep it more centered as you turn.',
      highCue: 'Your head is moving toward the target in the backswing. That is a reverse pivot.',
    }),
    metric({
      key: 'hipTop',
      label: 'Hip sway',
      value: hip,
      display: hip == null ? '—' : inches(hip, 'toward target', 'away from target'),
      good: [-2.5, 1],
      ok: [-4, 2],
      pro: 'Turn, don’t slide (under 2 in)',
      lowCue: 'Your hips are sliding away from the target. Turn them instead of swaying.',
      highCue: 'Your hips are drifting toward the target in the backswing. Load into your trail side.',
    }),
    metric({
      key: 'shoulderTurn',
      label: 'Shoulder turn (est.)',
      value: turn,
      display: turn == null ? '—' : `~${Math.round(turn)}°`,
      good: [80, 180],
      ok: [60, 180],
      pro: '~90° full turn',
      lowCue: 'Make a fuller shoulder turn in the backswing.',
      highCue: null,
    }),
    metric({
      key: 'leadArm',
      label: 'Lead arm',
      value: arm,
      display: arm == null ? '—' : `${arm >= 160 ? 'Straight' : arm >= 140 ? 'Slight bend' : 'Bent'} (${Math.round(arm)}°)`,
      good: [155, 180],
      ok: [135, 180],
      pro: 'Extended, mostly straight',
      lowCue: 'Keep your lead arm straighter at the top.',
      highCue: null,
    }),
  ];
}

export function evaluateImpact(pose, address, ctx) {
  const { dir, inPerPx, club = 'irons', ball } = ctx;
  const ref = PRO[club] ?? PRO.irons;
  const hip = lateralShiftInches(pose.hipMid, address.hipMid, dir, inPerPx);
  const head = lateralShiftInches(pose.head, address.head, dir, inPerPx);
  const handsRef = ball ?? address.hands;
  const hands = lateralShiftInches(pose.hands, handsRef, dir, inPerPx);
  const hipOpen = rotation(pose, address, 'L_HIP', 'R_HIP');

  return [
    metric({
      key: 'hipImpact',
      label: 'Hip shift',
      value: hip,
      display: hip == null ? '—' : inches(hip, 'toward target', 'away from target'),
      good: [2, 7],
      ok: [0.5, 9],
      pro: '3–6 in toward target',
      lowCue: 'Shift your hips toward the target before you hit the ball.',
      highCue: 'Your hips are sliding too far toward the target. Rotate more, slide less.',
    }),
    metric({
      key: 'headImpact',
      label: 'Head',
      value: head,
      display: head == null ? '—' : inches(head, 'toward target', 'away from target'),
      good: [-3, 1.5],
      ok: [-5, 3],
      pro: 'Behind the ball, at or behind address',
      lowCue: 'Your head is hanging back a lot at impact. Let your body move through.',
      highCue: 'Keep your head behind the ball through impact.',
    }),
    metric({
      key: 'handsImpact',
      label: ball ? 'Hands vs ball' : 'Hands vs address',
      value: hands,
      display: hands == null ? '—' : inches(hands, 'ahead', 'behind'),
      ...ref.handsAhead,
      lowCue: 'Get your hands ahead of the ball at impact.',
      highCue: 'Your hands are too far ahead at impact.',
    }),
    metric({
      key: 'hipOpen',
      label: 'Hips open (est.)',
      value: hipOpen,
      display: hipOpen == null ? '—' : `~${Math.round(hipOpen)}°`,
      good: [25, 60],
      ok: [12, 75],
      pro: '~35–45° open',
      lowCue: 'Clear your hips more through impact.',
      highCue: 'Your hips are spinning out early.',
    }),
  ];
}

export function evaluateFinish(pose, address, ctx, held) {
  const { dir } = ctx;
  const t = stanceFraction(pose.hipMid, address, dir);
  const handsHigh = (pose.shoulderMid.y - pose.hands.y) / address.torso; // + = above shoulders

  return [
    metric({
      key: 'weight',
      label: 'Weight transfer',
      value: t,
      display: t == null ? 'Feet not visible' : `${Math.round(clamp(t, 0, 1.2) * 100)}% to lead foot`,
      good: [0.75, 1.4],
      ok: [0.55, 1.6],
      pro: 'Fully on lead side',
      lowCue: 'Finish with your weight on your lead foot.',
      highCue: 'You are falling past your lead foot at the finish.',
    }),
    metric({
      key: 'balance',
      label: 'Balance',
      value: held ? 1 : 0,
      display: held ? 'Held the finish' : 'Didn’t hold the finish',
      good: [1, 1],
      ok: null,
      pro: 'Hold the pose in balance',
      lowCue: 'Hold your finish in balance for a second.',
      highCue: null,
    }),
    metric({
      key: 'handsFinish',
      label: 'Hands',
      value: handsHigh,
      display: handsHigh > 0.15 ? 'High finish' : handsHigh > -0.3 ? 'About shoulder height' : 'Low finish',
      good: [0.15, 10],
      ok: [-0.3, 10],
      pro: 'Hands finish high',
      lowCue: 'Finish with your hands high.',
      highCue: null,
    }),
  ];
}

export const CHECKPOINTS = [
  { id: 'address', title: 'ADDRESS' },
  { id: 'top', title: 'TOP' },
  { id: 'impact', title: 'IMPACT' },
  { id: 'finish', title: 'FINISH' },
];

const POINTS = { good: 2, ok: 1, bad: 0 };
// When picking the one thing to say out loud, impact faults matter most.
const CUE_PRIORITY = ['impact', 'top', 'address', 'finish'];

/** Evaluate a whole swing ({address, top, impact, finish, held}) into checkpoints + a coaching line. */
export function evaluateSwing(rec, ctx) {
  const a = rec.address;
  const metrics = {
    address: evaluateAddress(a, ctx),
    top: evaluateTop(rec.top, a, ctx),
    impact: evaluateImpact(rec.impact, a, ctx),
    finish: evaluateFinish(rec.finish, a, ctx, rec.held),
  };
  const checkpoints = CHECKPOINTS.map((c) => ({ ...c, pose: rec[c.id], metrics: metrics[c.id] }));

  const rated = Object.values(metrics).flat().filter((m) => m.rating !== 'none');
  const score = rated.length
    ? Math.round((rated.reduce((s, m) => s + POINTS[m.rating], 0) / (rated.length * 2)) * 100)
    : null;

  let cue = null;
  for (const level of ['bad', 'ok']) {
    for (const id of CUE_PRIORITY) {
      const m = metrics[id].find((x) => x.rating === level && x.cue);
      if (m) {
        cue = m.cue;
        break;
      }
    }
    if (cue) break;
  }
  const coachLine = cue
    ? `${score != null && score >= 80 ? 'Good swing.' : ''} ${cue}`.trim()
    : 'Great swing. Everything checked out.';

  return { checkpoints, score, coachLine };
}
