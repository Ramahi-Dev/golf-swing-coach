import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwingDetector } from '../src/swingDetector.js';
import { makePose } from './helpers.js';

const FPS = 60;
const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

/** Feed a sequence of hand positions; returns events. */
function run(segments) {
  const events = { address: 0, complete: null, cancel: [], candidates: {} };
  const d = new SwingDetector({
    onAddress: (_, isNew) => isNew && events.address++,
    onCandidate: (slot, pose) => (events.candidates[slot] = pose),
    onComplete: (rec) => (events.complete = rec),
    onCancel: (r) => events.cancel.push(r),
  });
  let t = 0;
  let pos = segments[0].from;
  for (const seg of segments) {
    const n = Math.round(seg.dur * FPS);
    for (let i = 1; i <= n; i++) {
      pos = lerp(seg.from ?? pos, seg.to ?? seg.from ?? pos, i / n);
      t += 1 / FPS;
      d.update(makePose({ hands: pos }), t);
    }
  }
  return { events, d };
}

const ADDR = { x: 500, y: 900 };
const TOP = { x: 400, y: 520 };
const FIN = { x: 640, y: 560 };

test('detects address → top → impact → finish for a full swing', () => {
  const { events, d } = run([
    { from: ADDR, to: ADDR, dur: 1.0 },
    { from: ADDR, to: TOP, dur: 0.8 },
    { from: TOP, to: { x: 505, y: 905 }, dur: 0.25 },
    { from: { x: 505, y: 905 }, to: FIN, dur: 0.3 },
    { from: FIN, to: FIN, dur: 0.8 },
  ]);
  assert.equal(events.address, 1);
  assert.ok(events.complete, 'swing completed');
  const r = events.complete;
  assert.equal(r.top.hands.y, TOP.y);
  assert.ok(Math.abs(r.impact.hands.y - r.address.hands.y) < 30, `impact y ${r.impact.hands.y}`);
  assert.equal(r.held, true);
  assert.equal(d.state, 'cooldown');
});

test('a small waggle does not count as a swing', () => {
  const { events, d } = run([
    { from: ADDR, to: ADDR, dur: 1.0 },
    { from: ADDR, to: { x: 440, y: 840 }, dur: 0.3 },
    { from: { x: 440, y: 840 }, to: ADDR, dur: 0.3 },
    { from: ADDR, to: ADDR, dur: 0.5 },
  ]);
  assert.equal(events.complete, null);
  assert.equal(d.state, 'address', 'still locked at address, ready to swing');
  assert.equal(events.address, 1);
});

test('no address is locked while the hands keep moving', () => {
  const { events } = run([
    { from: ADDR, to: { x: 560, y: 900 }, dur: 0.5 },
    { from: { x: 560, y: 900 }, to: ADDR, dur: 0.5 },
  ]);
  assert.equal(events.address, 0);
});

test('finish times out as "not held" if the golfer never settles', () => {
  const segs = [
    { from: ADDR, to: ADDR, dur: 1.0 },
    { from: ADDR, to: TOP, dur: 0.8 },
    { from: TOP, to: { x: 505, y: 905 }, dur: 0.25 },
    { from: { x: 505, y: 905 }, to: FIN, dur: 0.3 },
  ];
  // keep wobbling around the finish for 4 s
  for (let i = 0; i < 20; i++) {
    segs.push({ from: FIN, to: { x: FIN.x + 60, y: FIN.y }, dur: 0.1 }, { from: { x: FIN.x + 60, y: FIN.y }, to: FIN, dur: 0.1 });
  }
  const { events } = run(segs);
  assert.ok(events.complete);
  assert.equal(events.complete.held, false);
});
