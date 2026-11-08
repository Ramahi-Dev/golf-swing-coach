import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTimeline, expandFrames, clipDuration } from '../src/clipEditor.js';
import { chooseSlowmo, detectSwings, poseAt } from '../src/clipAnalyzer.js';
import { makePose } from './helpers.js';

const at = (t) => ({ t });
const swing = (a, top, imp, fin) => ({ address: at(a), top: at(top), impact: at(imp), finish: at(fin) });

test('planTimeline trims around the swing and pauses at every checkpoint', () => {
  const segs = planTimeline([swing(3, 5, 5.5, 7)], 20, { lead: 0.75, tail: 1, hold: 1.5 });
  assert.deepEqual(
    segs.map((s) => (s.type === 'play' ? `play ${s.from}-${s.to}` : `hold ${s.cp}@${s.at}`)),
    ['play 2.25-3', 'hold 0@3', 'play 3-5', 'hold 1@5', 'play 5-5.5', 'hold 2@5.5', 'play 5.5-7', 'hold 3@7', 'play 7-8'],
  );
});

test('planTimeline clamps to the video and never overlaps consecutive swings', () => {
  const segs = planTimeline([swing(0.2, 1, 1.2, 2), swing(2.5, 3, 3.2, 4)], 4.4, { lead: 1, tail: 1 });
  assert.equal(segs[0].from, 0);
  const second = segs.filter((s) => s.swing === 1);
  assert.equal(second[0].from ?? second[0].at, 3, 'second swing starts where the first ended');
  assert.equal(second.at(-1).to, 4.4, 'tail clamped to duration');
});

test('expandFrames: play length scales with speed, holds last hold*fps frames', () => {
  const segs = planTimeline([swing(1, 2, 2.5, 3)], 10, { lead: 0, tail: 0, hold: 2 });
  const fps = 30;
  const normal = expandFrames(segs, { fps, speed: 1, hold: 2 });
  const slow = expandFrames(segs, { fps, speed: 0.5, hold: 2 });
  const holds = normal.filter((f) => f.hold).length;
  assert.equal(holds, 4 * 2 * fps);
  assert.equal(normal.length - holds, 2 * fps); // 2 s of motion
  assert.equal(slow.length - holds, 4 * fps); // half speed → twice as long
  assert.equal(clipDuration(segs, { fps, speed: 1 }), 10);
  // frames advance monotonically through media time
  const ts = normal.map((f) => f.t);
  assert.ok(ts.every((t, i) => i === 0 || t >= ts[i - 1]));
});

// A synthetic swing in real seconds, as hand positions over time.
const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
const SWING = [
  [{ x: 500, y: 900 }, { x: 500, y: 900 }, 1.0],
  [{ x: 500, y: 900 }, { x: 400, y: 520 }, 0.8],
  [{ x: 400, y: 520 }, { x: 505, y: 905 }, 0.28],
  [{ x: 505, y: 905 }, { x: 640, y: 560 }, 0.3],
  [{ x: 640, y: 560 }, { x: 640, y: 560 }, 0.8],
];
function handsAt(realT) {
  let t0 = 0;
  for (const [a, b, d] of SWING) {
    if (realT <= t0 + d) return lerp(a, b, (realT - t0) / d);
    t0 += d;
  }
  return SWING.at(-1)[1];
}
/** Sample like the analyzer does: every 1/30 s of *media* time, footage slowed by `slow`. */
function sampleFrames(slow, extra = 0.3) {
  const realDur = SWING.reduce((s, x) => s + x[2], 0) + extra;
  const frames = [];
  for (let t = 0; t <= realDur * slow; t += 1 / 30) {
    const pose = makePose({ hands: handsAt(t / slow) });
    pose.t = t;
    frames.push({ t, pose });
  }
  return frames;
}

test('detectSwings finds the swing in normal-speed footage, with media timestamps', () => {
  const swings = detectSwings(sampleFrames(1), 1);
  assert.equal(swings.length, 1);
  const s = swings[0];
  assert.ok(s.address.t < s.top.t && s.top.t < s.impact.t && s.impact.t < s.finish.t);
  assert.ok(Math.abs(s.top.t - 1.8) < 0.05, `top at ${s.top.t}`);
});

for (const slow of [1, 4, 8]) {
  test(`chooseSlowmo auto-detects ${slow}× footage`, () => {
    const { factor, swings } = chooseSlowmo(sampleFrames(slow));
    assert.equal(swings.length, 1);
    assert.equal(factor, slow);
  });
}

test('slow-mo footage is missed if analyzed as normal speed (why auto-detect matters)', () => {
  assert.equal(detectSwings(sampleFrames(8), 1).length, 0);
});

test('detector flush closes a swing whose video ends mid follow-through', () => {
  const frames = sampleFrames(1, 0).filter((f) => f.t < 2.3);
  const swings = detectSwings(frames, 1);
  assert.equal(swings.length, 1);
  assert.equal(swings[0].held, false);
});

test('poseAt returns the nearest sample', () => {
  const frames = [0, 0.1, 0.2, 0.3].map((t) => ({ t, pose: { t } }));
  assert.equal(poseAt(frames, 0.14).t, 0.1);
  assert.equal(poseAt(frames, 0.16).t, 0.2);
  assert.equal(poseAt(frames, 5).t, 0.3);
  assert.equal(poseAt(frames, -1).t, 0);
});
