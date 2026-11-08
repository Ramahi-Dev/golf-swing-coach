// Turns analyzed swings into an edited highlight clip:
//   trim to each swing → play → freeze at ADDRESS → play → freeze at TOP → … → FINISH → tail
// Freeze frames carry the skeleton overlay and the YOU vs TOUR PRO card.
// Encoding uses WebCodecs + an MP4 muxer, so export runs faster than real time and the output
// timing is exact regardless of how long each seek/draw takes.

import { CHECKPOINTS } from './metrics.js';
import { drawOverlay } from './overlay.js';
import { drawCaption, drawCard, drawTag } from './cardCanvas.js';
import { poseAt, seek } from './clipAnalyzer.js';

const MUXER_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs';

export const EDIT_DEFAULTS = {
  lead: 0.75, // media seconds kept before address
  tail: 1.0, // media seconds kept after the finish
  hold: 1.5, // seconds each checkpoint is frozen in the output
  speed: 1, // playback speed of the moving parts (0.5 = extra slow motion)
  fps: 30,
};

/**
 * Build the edit decision list. Pure — no DOM.
 * swings: [{ address, top, impact, finish }] where each pose has .t (media seconds).
 * Returns segments: { type: 'play', swing, from, to } | { type: 'hold', swing, cp, at, dur }
 */
export function planTimeline(swings, duration, opts = {}) {
  const o = { ...EDIT_DEFAULTS, ...opts };
  const segs = [];
  let prevEnd = 0;
  swings.forEach((s, si) => {
    const times = CHECKPOINTS.map((c) => s[c.id].t);
    const start = Math.max(0, prevEnd, times[0] - o.lead);
    const end = Math.min(duration, Math.max(times[3], times[3] + o.tail));
    let cur = start;
    CHECKPOINTS.forEach((c, ci) => {
      const at = Math.max(cur, times[ci]);
      if (at > cur + 1e-3) segs.push({ type: 'play', swing: si, from: cur, to: at });
      segs.push({ type: 'hold', swing: si, cp: ci, at, dur: o.hold });
      cur = at;
    });
    if (end > cur + 1e-3) segs.push({ type: 'play', swing: si, from: cur, to: end });
    prevEnd = end;
  });
  return segs;
}

/** Expand segments into one entry per output frame. Pure. */
export function expandFrames(segs, opts = {}) {
  const { fps, speed } = { ...EDIT_DEFAULTS, ...opts };
  const out = [];
  for (const s of segs) {
    if (s.type === 'play') {
      const n = Math.max(1, Math.round(((s.to - s.from) / speed) * fps));
      for (let k = 0; k < n; k++) out.push({ seg: s, t: s.from + (k * speed) / fps, hold: false });
    } else {
      const n = Math.max(1, Math.round(s.dur * fps));
      for (let k = 0; k < n; k++) out.push({ seg: s, t: s.at, hold: true });
    }
  }
  return out;
}

export const clipDuration = (segs, opts) => expandFrames(segs, opts).length / ({ ...EDIT_DEFAULTS, ...opts }.fps);

export function canExport() {
  return typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
}

async function pickEncoderConfig(width, height, fps) {
  const bitrate = Math.round(width * height * fps * 0.12);
  const candidates = [
    ['avc1.640033', 'avc'],
    ['avc1.640028', 'avc'],
    ['avc1.4d0028', 'avc'],
    ['avc1.42E01F', 'avc'],
    ['vp09.00.40.08', 'vp9'],
  ];
  for (const [codec, muxCodec] of candidates) {
    const cfg = { codec, width, height, bitrate, framerate: fps };
    if (codec.startsWith('avc')) cfg.avc = { format: 'avc' };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(cfg);
      if (supported) return { cfg, muxCodec };
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/**
 * Render the edited clip to an MP4 Blob.
 * ctx.results[i] = evaluateSwing() output for swings[i]
 */
export async function renderClip(video, { swings, results, frames, segs, opts = {}, ball = null, onProgress, isCancelled }) {
  if (!canExport()) throw new Error('This browser can’t export video. Try Chrome, Edge or Safari 17+.');
  const o = { ...EDIT_DEFAULTS, showSkeleton: true, slowmo: 1, ...opts };
  const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(1, 1920 / Math.max(vw, vh));
  const W = Math.round((vw * scale) / 2) * 2;
  const H = Math.round((vh * scale) / 2) * 2;
  const picked = await pickEncoderConfig(W, H, o.fps);
  if (!picked) throw new Error('No supported video encoder found in this browser.');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: picked.muxCodec, width: W, height: H, frameRate: o.fps },
    fastStart: 'in-memory',
  });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure(picked.cfg);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d');
  const s = W / vw;
  const effectiveSlow = o.slowmo / o.speed;
  const outFrames = expandFrames(segs, o);
  const frameDur = 1e6 / o.fps;
  let lastDrawnKey = null;

  for (let i = 0; i < outFrames.length; i++) {
    if (isCancelled?.()) {
      encoder.close();
      throw new Error('cancelled');
    }
    if (encodeError) throw encodeError;
    const f = outFrames[i];
    const swing = swings[f.seg.swing];
    const result = results[f.seg.swing];
    const key = f.hold ? `h${f.seg.swing}-${f.seg.cp}` : `p${f.t}`;

    // Holds repeat the same picture, so only redraw when the content changes.
    if (key !== lastDrawnKey) {
      await seek(video, f.t);
      g.drawImage(video, 0, 0, W, H);
      if (f.hold) {
        const cp = result.checkpoints[f.seg.cp];
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(0, 0, W, H);
        drawOverlay(g, cp.pose, { address: swing.address, ball, scale: s });
        drawCard(g, { title: cp.title, index: f.seg.cp, metrics: cp.metrics, score: f.seg.cp === 3 ? result.score : null }, W, H);
        const isLast = f.seg.cp === 3;
        const tip = isLast ? result.coachLine : cp.metrics.find((m) => m.rating === 'bad' && m.cue)?.cue;
        if (tip) drawCaption(g, tip, W, H, { color: isLast ? '#f5f6f8' : '#ffd84a' });
      } else {
        if (o.showSkeleton) {
          const pose = poseAt(frames, f.t);
          const showBase = f.t >= swing.address.t - 1e-3;
          drawOverlay(g, pose, { address: showBase ? swing.address : null, ball, scale: s });
        }
        if (effectiveSlow > 1.05) drawTag(g, `SLOW-MO ${Math.round(effectiveSlow * 10) / 10}×`, W, H);
      }
      lastDrawnKey = key;
    }

    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
    encoder.encode(vf, { keyFrame: i % (o.fps * 2) === 0 });
    vf.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 4));
    if (i % 5 === 0) await onProgress?.(i / outFrames.length, canvas);
  }

  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
  muxer.finalize();
  await onProgress?.(1, canvas);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}
