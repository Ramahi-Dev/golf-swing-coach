// "Auto-edit swing video" screen: pick a (slow-mo) video → find swings → optional ball tap →
// render a trimmed clip that freezes on each checkpoint → preview, download, share.

import { inchesPerPixel } from './geometry.js';
import { evaluateSwing, targetDirFor } from './metrics.js';
import { drawOverlay } from './overlay.js';
import { chooseSlowmo, detectSwings, samplePoses, seek } from './clipAnalyzer.js';
import { canExport, clipDuration, planTimeline, renderClip } from './clipEditor.js';

export function initEditor({ ensureEngine, settings, saveSettings, onClose }) {
  const $ = (id) => document.getElementById(id);
  const els = {
    root: $('editor'),
    back: $('edBack'),
    canvas: $('edCanvas'),
    options: $('edOptions'),
    slowmo: $('edSlowmo'),
    hold: $('edHold'),
    speed: $('edSpeed'),
    skeleton: $('edSkeleton'),
    go: $('edGo'),
    ball: $('edBall'),
    ballSkip: $('edBallSkip'),
    progress: $('edProgress'),
    bar: $('edBar'),
    msg: $('edMsg'),
    result: $('edResult'),
    video: $('edVideo'),
    download: $('edDownload'),
    share: $('edShare'),
    again: $('edAgain'),
    error: $('edError'),
    summary: $('edSummary'),
  };
  const g = els.canvas.getContext('2d');
  const src = document.createElement('video');
  src.muted = true;
  src.playsInline = true;
  src.preload = 'auto';

  let busy = false;
  let cancelled = false;
  let srcUrl = null;
  let outUrl = null;
  let outBlob = null;
  let fileName = 'swing';
  let ballResolver = null;

  // ------------------------------------------------------------ options (persisted)
  const opts = [
    [els.slowmo, 'editSlowmo'],
    [els.hold, 'editHold'],
    [els.speed, 'editSpeed'],
    [els.skeleton, 'editSkeleton'],
  ];
  for (const [el, key] of opts) {
    el.value = String(settings[key]);
    el.addEventListener('change', () => {
      settings[key] = el.value;
      saveSettings(settings);
    });
  }

  // ------------------------------------------------------------ helpers
  const show = (el, on) => el.classList.toggle('hidden', !on);
  const setError = (t) => (els.error.textContent = t || '');
  const setProgress = (p, text) => {
    els.bar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    if (text != null) els.msg.textContent = text;
  };

  function sizeCanvas() {
    const scale = Math.min(1, 1280 / Math.max(src.videoWidth, src.videoHeight));
    els.canvas.width = Math.round(src.videoWidth * scale);
    els.canvas.height = Math.round(src.videoHeight * scale);
    return els.canvas.width / src.videoWidth;
  }

  function drawPreview(pose, address) {
    const s = els.canvas.width / src.videoWidth;
    g.drawImage(src, 0, 0, els.canvas.width, els.canvas.height);
    if (pose) drawOverlay(g, pose, { address, scale: s, ball: settings.editBall });
  }

  function resetView() {
    show(els.options, true);
    show(els.go, true);
    show(els.ball, false);
    show(els.progress, false);
    show(els.result, false);
    show(els.video, false);
    show(els.canvas, true);
    els.summary.textContent = '';
    setError('');
  }

  // ------------------------------------------------------------ open / close
  async function open(file) {
    cancelled = false;
    fileName = (file.name || 'swing').replace(/\.[^.]+$/, '');
    if (srcUrl) URL.revokeObjectURL(srcUrl);
    srcUrl = URL.createObjectURL(file);
    settings.editBall = null;
    show(els.root, true);
    resetView();
    if (!canExport()) setError('Heads up: this browser can’t export video. Use Chrome, Edge or Safari 17+.');
    src.src = srcUrl;
    try {
      await new Promise((res, rej) => {
        src.onloadedmetadata = res;
        src.onerror = () => rej(new Error('Could not open this video file.'));
      });
      sizeCanvas();
      await seek(src, Math.min(0.1, src.duration / 2));
      drawPreview(null);
    } catch (err) {
      setError(err.message);
    }
  }

  function close() {
    cancelled = true;
    ballResolver?.(null);
    src.removeAttribute('src');
    src.load();
    if (srcUrl) URL.revokeObjectURL(srcUrl);
    if (outUrl) URL.revokeObjectURL(outUrl);
    srcUrl = outUrl = outBlob = null;
    els.video.removeAttribute('src');
    show(els.root, false);
    busy = false;
    onClose?.();
  }
  els.back.addEventListener('click', close);
  els.again.addEventListener('click', () => {
    if (outUrl) URL.revokeObjectURL(outUrl);
    outUrl = outBlob = null;
    els.video.removeAttribute('src');
    resetView();
  });

  // ------------------------------------------------------------ ball tap
  els.canvas.addEventListener('click', (e) => {
    if (!ballResolver) return;
    const r = els.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * src.videoWidth;
    const y = ((e.clientY - r.top) / r.height) * src.videoHeight;
    ballResolver({ x, y });
  });
  els.ballSkip.addEventListener('click', () => ballResolver?.(null));
  const askForBall = () => new Promise((res) => (ballResolver = res)).finally(() => (ballResolver = null));

  // ------------------------------------------------------------ main pipeline
  els.go.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    cancelled = false;
    setError('');
    show(els.options, false);
    show(els.go, false);
    show(els.progress, true);
    try {
      setProgress(0, 'Loading pose model…');
      const engine = await ensureEngine();

      // Pass 1: poses for every frame.
      let n = 0;
      const frames = await samplePoses(src, engine, {
        isCancelled: () => cancelled,
        onFrame: async (t, pose, p) => {
          setProgress(p * 0.5, `Finding your swing… ${t.toFixed(1)} s / ${src.duration.toFixed(1)} s`);
          if (n++ % 3 === 0) {
            drawPreview(pose);
            await new Promise((r) => requestAnimationFrame(r));
          }
        },
      });

      // Swing detection (and slow-mo factor).
      const mode = settings.editSlowmo;
      const { factor, swings } =
        mode === 'auto' ? chooseSlowmo(frames) : { factor: Number(mode), swings: detectSwings(frames, Number(mode)) };
      if (!swings.length) {
        throw new Error(
          'No full swing found. Make sure your whole body is in frame from address to finish, filmed face-on. ' +
            'If this is slow-motion, try setting the slow-mo speed manually.',
        );
      }

      // Optional: tap the ball on the address frame.
      await seek(src, swings[0].address.t);
      drawPreview(swings[0].address, swings[0].address);
      show(els.progress, false);
      show(els.ball, true);
      const ball = await askForBall();
      if (cancelled) return;
      show(els.ball, false);
      show(els.progress, true);
      settings.editBall = ball;

      // Score every swing.
      const results = swings.map((s) =>
        evaluateSwing(s, {
          dir: targetDirFor(settings.hand),
          hand: settings.hand,
          club: settings.club,
          ball,
          inPerPx: inchesPerPixel(s.address),
        }),
      );

      // Pass 2: render.
      const editOpts = {
        hold: Number(settings.editHold),
        speed: Number(settings.editSpeed),
        showSkeleton: String(settings.editSkeleton) !== 'false',
        slowmo: factor,
      };
      const segs = planTimeline(swings, src.duration, editOpts);
      const total = clipDuration(segs, editOpts);
      outBlob = await renderClip(src, {
        swings,
        results,
        frames,
        segs,
        opts: editOpts,
        ball,
        isCancelled: () => cancelled,
        onProgress: async (p, frameCanvas) => {
          setProgress(0.5 + p * 0.5, `Rendering clip… ${Math.round(p * 100)}%`);
          g.drawImage(frameCanvas, 0, 0, els.canvas.width, els.canvas.height);
          await new Promise((r) => setTimeout(r, 0));
        },
      });

      // Result.
      outUrl = URL.createObjectURL(outBlob);
      els.video.src = outUrl;
      const outName = `${fileName}-coached.mp4`;
      els.download.href = outUrl;
      els.download.download = outName;
      const shareFile = new File([outBlob], outName, { type: 'video/mp4' });
      show(els.share, !!navigator.canShare?.({ files: [shareFile] }));
      els.share.onclick = () => navigator.share({ files: [shareFile], title: 'My swing' }).catch(() => {});
      const scores = results.map((r) => r.score).filter((x) => x != null);
      els.summary.textContent = [
        `${swings.length} swing${swings.length > 1 ? 's' : ''} found`,
        factor > 1 ? `slow-mo ${factor}× ${mode === 'auto' ? '(auto-detected)' : ''}`.trim() : 'normal speed',
        `${total.toFixed(1)} s clip`,
        scores.length ? `score ${scores.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      show(els.progress, false);
      show(els.canvas, false);
      show(els.video, true);
      show(els.result, true);
    } catch (err) {
      if (err.message !== 'cancelled') {
        console.error(err);
        setError(err.message || String(err));
        show(els.progress, false);
        show(els.ball, false);
        show(els.options, true);
        show(els.go, true);
      }
    } finally {
      busy = false;
    }
  });

  return { open, close };
}
