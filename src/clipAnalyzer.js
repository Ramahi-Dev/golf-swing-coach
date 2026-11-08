// Offline analysis of a recorded swing video.
//
// Pass 1 steps through the file frame by frame (by seeking, so no frames are skipped no matter
// how slow the device is) and stores a pose per sample. Swing detection then runs over those
// stored poses — cheaply, and as many times as we like — which is how slow-motion is handled:
// a 240 fps clip played back at 30 fps stretches every motion 8×, so the detector needs to know
// the factor to convert media time back to real time. In "auto" mode we try several factors and
// keep the one whose downswing duration looks like a real golf swing (~0.3 s).

import { buildPose } from './geometry.js';
import { SwingDetector } from './swingDetector.js';

export const SLOWMO_FACTORS = [1, 2, 4, 8, 16];
const TYPICAL_DOWNSWING_S = 0.3;

/** Run the swing detector over stored samples [{t, pose}] (t = media seconds). */
export function detectSwings(frames, slowmo = 1) {
  const swings = [];
  const det = new SwingDetector({ onComplete: (rec) => swings.push(rec) });
  let last = 0;
  for (const f of frames) {
    det.update(f.pose, f.t / slowmo);
    last = f.t / slowmo;
  }
  det.flush(last);
  return swings;
}

/**
 * Pick the slow-motion factor that best explains the footage.
 * Returns { factor, swings }; swings is empty if nothing was found at any factor.
 */
export function chooseSlowmo(frames, factors = SLOWMO_FACTORS) {
  let best = { factor: factors[0], swings: [], score: Infinity };
  for (const f of factors) {
    const swings = detectSwings(frames, f);
    if (!swings.length) continue;
    const downs = swings.map((s) => (s.impact.t - s.top.t) / f).sort((a, b) => a - b);
    const median = downs[Math.floor(downs.length / 2)];
    // Distance from a typical downswing on a log scale, so 2× too fast ≈ 2× too slow.
    const score = Math.abs(Math.log(Math.max(median, 1e-3) / TYPICAL_DOWNSWING_S));
    if (score < best.score) best = { factor: f, swings, score };
  }
  return { factor: best.factor, swings: best.swings };
}

/**
 * Resolve when the next decoded frame is presented. 'seeked' alone is not enough: browsers can
 * fire it before the new frame is decoded, and drawImage() then paints the previous frame.
 * Times out quickly when the seek lands on the frame that is already showing (no new frame comes).
 */
function nextFrame(video, timeoutMs = 80) {
  if (typeof video.requestVideoFrameCallback !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const id = video.requestVideoFrameCallback(() => {
      clearTimeout(timer);
      resolve();
    });
    const timer = setTimeout(() => {
      video.cancelVideoFrameCallback?.(id);
      resolve();
    }, timeoutMs);
  });
}

/** Seek a <video> and resolve once the frame at time t is ready to draw. */
export async function seek(video, t) {
  if (Math.abs(video.currentTime - t) < 1e-6 && video.readyState >= 2) return;
  const frame = nextFrame(video);
  await seeked(video, t);
  await frame;
}

function seeked(video, t) {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('Could not read this video.'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = t;
  });
}

/**
 * Pass 1: sample poses through the whole video.
 * onFrame(t, pose) is called after each sample (for progress / preview).
 * Returns [{ t, pose }] where pose.t is also set for convenience.
 */
export async function samplePoses(video, engine, { step = 1 / 30, onFrame, isCancelled } = {}) {
  const frames = [];
  const dur = video.duration;
  if (!Number.isFinite(dur) || dur <= 0) throw new Error('Could not read the video length.');
  engine.reset();
  const n = Math.floor(dur / step);
  for (let i = 0; i <= n; i++) {
    if (isCancelled?.()) throw new Error('cancelled');
    await seek(video, Math.min(i * step, dur - 0.001));
    const t = video.currentTime;
    const res = engine.detect(video, t * 1000);
    const pose = res ? buildPose(res.landmarks, res.world, video.videoWidth, video.videoHeight) : null;
    if (pose) pose.t = t;
    frames.push({ t, pose });
    await onFrame?.(t, pose, i / n);
  }
  return frames;
}

/** Nearest stored pose to media time t (binary search). */
export function poseAt(frames, t) {
  let lo = 0;
  let hi = frames.length - 1;
  if (hi < 0) return null;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = frames[Math.max(0, lo - 1)];
  const b = frames[lo];
  return (Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b).pose;
}
