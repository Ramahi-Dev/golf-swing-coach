import { createPoseEngine } from './pose.js';
import { buildPose, inchesPerPixel } from './geometry.js';
import { SwingDetector } from './swingDetector.js';
import { CHECKPOINTS, evaluateAddress, evaluateSwing, lateralShiftInches, targetDirFor } from './metrics.js';
import { drawOverlay } from './overlay.js';
import { Coach } from './coach.js';
import { loadSettings, saveSettings } from './settings.js';
import { initEditor } from './editorUI.js';

const $ = (id) => document.getElementById(id);
const els = {
  video: $('video'),
  canvas: $('canvas'),
  card: $('card'),
  status: $('status'),
  bottombar: $('bottombar'),
  headShift: $('headShift'),
  hipShift: $('hipShift'),
  muteBtn: $('muteBtn'),
  toolbar: $('toolbar'),
  ballBtn: $('ballBtn'),
  flipBtn: $('flipBtn'),
  speedSel: $('speedSel'),
  liveBtn: $('liveBtn'),
  stopBtn: $('stopBtn'),
  review: $('review'),
  thumbs: $('thumbs'),
  scoreLine: $('scoreLine'),
  start: $('start'),
  startBtn: $('startBtn'),
  fileInput: $('fileInput'),
  startMsg: $('startMsg'),
  handSel: $('handSel'),
  clubSel: $('clubSel'),
  facingSel: $('facingSel'),
  modelSel: $('modelSel'),
};
const ctx = els.canvas.getContext('2d');

const settings = loadSettings();
const coach = new Coach(settings.voice);

const S = {
  engine: null,
  engineModel: null,
  stream: null,
  source: null, // 'camera' | 'file'
  running: false,
  mode: 'live', // 'live' | 'review'
  pose: null,
  address: null,
  inPerPx: null,
  swing: null, // { result, snaps }
  reviewIdx: 0,
  reviewTimer: null,
  lastVideoTime: -1,
  armBall: false,
  lastUi: 0,
};

// One snapshot canvas per checkpoint, overwritten as better candidates arrive.
const SNAP_W = 720;
const slots = Object.fromEntries(CHECKPOINTS.map((c) => [c.id, document.createElement('canvas')]));

const detector = new SwingDetector({
  onAddress(pose, isNew) {
    S.address = pose;
    S.inPerPx = inchesPerPixel(pose);
    if (isNew && S.mode === 'review' && S.source === 'camera') exitReview();
  },
  onCandidate(slot) {
    captureSlot(slot);
  },
  onCancel() {
    S.address = null;
  },
  onComplete(rec) {
    const result = evaluateSwing(rec, evalCtx());
    const snaps = Object.fromEntries(CHECKPOINTS.map((c) => [c.id, cloneCanvas(slots[c.id])]));
    S.swing = { result, snaps };
    coach.say(result.coachLine);
    enterReview();
  },
});

// ------------------------------------------------------------------ settings UI

els.handSel.value = settings.hand;
els.clubSel.value = settings.club;
els.facingSel.value = settings.facing;
els.modelSel.value = settings.model;
for (const [el, key] of [
  [els.handSel, 'hand'],
  [els.clubSel, 'club'],
  [els.facingSel, 'facing'],
  [els.modelSel, 'model'],
]) {
  el.addEventListener('change', () => {
    settings[key] = el.value;
    saveSettings(settings);
  });
}

const ICON_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/></svg>';
const ICON_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/></svg>';
function renderMute() {
  els.muteBtn.innerHTML = settings.voice ? ICON_ON : ICON_OFF;
}
renderMute();
els.muteBtn.addEventListener('click', () => {
  settings.voice = !settings.voice;
  coach.setEnabled(settings.voice);
  saveSettings(settings);
  renderMute();
});

// ------------------------------------------------------------------ starting / stopping

async function ensureEngine() {
  if (S.engine && S.engineModel === settings.model) return S.engine;
  S.engine?.close();
  setStartMsg('Loading pose model…');
  S.engine = await createPoseEngine({ model: settings.model });
  S.engineModel = settings.model;
  setStartMsg('');
  return S.engine;
}

async function startCamera() {
  coach.unlock();
  els.startBtn.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access needs HTTPS (or localhost) and a modern browser.');
    }
    setStartMsg('Opening camera…');
    await openStream();
    await ensureEngine();
    S.source = 'camera';
    begin();
  } catch (err) {
    console.error(err);
    stopStream();
    setStartMsg(err.message || String(err), true);
  } finally {
    els.startBtn.disabled = false;
  }
}

async function openStream() {
  stopStream();
  S.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: settings.facing,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 },
    },
  });
  els.video.removeAttribute('src');
  els.video.srcObject = S.stream;
  els.video.loop = false;
  await els.video.play();
}

function stopStream() {
  S.stream?.getTracks().forEach((t) => t.stop());
  S.stream = null;
}

async function startFile(file) {
  coach.unlock();
  try {
    stopStream();
    await ensureEngine();
    els.video.srcObject = null;
    els.video.src = URL.createObjectURL(file);
    els.video.loop = false;
    els.video.playbackRate = Number(els.speedSel.value);
    await els.video.play();
    S.source = 'file';
    begin();
  } catch (err) {
    console.error(err);
    setStartMsg(err.message || String(err), true);
  }
}

function begin() {
  setStartMsg('');
  S.running = true;
  S.mode = 'live';
  S.address = null;
  S.swing = null;
  S.lastVideoTime = -1;
  detector.reset();
  S.engine.reset();
  els.start.classList.add('hidden');
  for (const el of [els.card, els.status, els.bottombar, els.toolbar]) el.classList.remove('hidden');
  els.flipBtn.classList.toggle('hidden', S.source !== 'camera');
  els.speedSel.classList.toggle('hidden', S.source !== 'file');
  els.review.classList.add('hidden');
  els.liveBtn.classList.add('hidden');
  requestAnimationFrame(loop);
}

function stop() {
  S.running = false;
  clearInterval(S.reviewTimer);
  stopStream();
  els.video.pause();
  if (els.video.src) URL.revokeObjectURL(els.video.src);
  els.video.removeAttribute('src');
  els.video.srcObject = null;
  for (const el of [els.card, els.status, els.bottombar, els.toolbar, els.review]) el.classList.add('hidden');
  els.start.classList.remove('hidden');
}

els.startBtn.addEventListener('click', startCamera);
els.fileInput.addEventListener('change', () => {
  const f = els.fileInput.files?.[0];
  if (f) startFile(f);
  els.fileInput.value = '';
});
els.stopBtn.addEventListener('click', stop);

const editor = initEditor({
  ensureEngine,
  settings,
  saveSettings,
  onClose: () => els.start.classList.remove('hidden'),
});
$('editInput').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  coach.unlock();
  els.start.classList.add('hidden');
  editor.open(f);
});
els.flipBtn.addEventListener('click', async () => {
  settings.facing = settings.facing === 'user' ? 'environment' : 'user';
  els.facingSel.value = settings.facing;
  saveSettings(settings);
  try {
    await openStream();
    detector.reset();
    S.address = null;
  } catch (err) {
    console.error(err);
  }
});
els.speedSel.addEventListener('change', () => {
  els.video.playbackRate = Number(els.speedSel.value);
});
els.video.addEventListener('ended', () => {
  if (S.source === 'file') setStatus('Video finished — tap Stop to pick another', '');
});

// ------------------------------------------------------------------ ball marker

els.ballBtn.addEventListener('click', () => {
  S.armBall = !S.armBall;
  els.ballBtn.classList.toggle('armed', S.armBall);
  els.ballBtn.textContent = S.armBall ? 'Tap the ball…' : 'Set ball';
});

els.canvas.addEventListener('click', (e) => {
  if (!S.armBall) return;
  const r = els.canvas.getBoundingClientRect();
  settings.ball = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  saveSettings(settings);
  S.armBall = false;
  els.ballBtn.classList.remove('armed');
  els.ballBtn.textContent = 'Set ball';
});

function ballPx() {
  const { videoWidth: w, videoHeight: h } = els.video;
  return settings.ball && w ? { x: settings.ball.x * w, y: settings.ball.y * h } : null;
}

function evalCtx() {
  return {
    dir: targetDirFor(settings.hand),
    hand: settings.hand,
    club: settings.club,
    ball: ballPx(),
    inPerPx: S.inPerPx,
  };
}

// ------------------------------------------------------------------ main loop

function loop() {
  if (!S.running) return;
  requestAnimationFrame(loop);
  const v = els.video;
  if (v.readyState < 2 || !v.videoWidth) return;

  if (els.canvas.width !== v.videoWidth || els.canvas.height !== v.videoHeight) {
    els.canvas.width = v.videoWidth;
    els.canvas.height = v.videoHeight;
  }

  if (v.currentTime !== S.lastVideoTime) {
    if (v.currentTime < S.lastVideoTime) {
      detector.reset();
      S.address = null;
    }
    S.lastVideoTime = v.currentTime;
    const res = S.engine.detect(v, performance.now());
    S.pose = res ? buildPose(res.landmarks, res.world, v.videoWidth, v.videoHeight) : null;
    // For files, use media time so slow-motion playback still yields real swing timing.
    detector.update(S.pose, v.currentTime);
  }

  if (S.mode === 'review') renderReview();
  else renderLive();
}

function renderLive() {
  const { canvas } = els;
  ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
  drawOverlay(ctx, S.pose, { address: S.address, ball: ballPx() });

  const now = performance.now();
  if (now - S.lastUi < 200) return;
  S.lastUi = now;

  const dir = targetDirFor(settings.hand);
  const fmt = (v) => (v == null ? '—' : `${Math.abs(v).toFixed(1)} in`);
  const ok = S.pose && S.address;
  els.headShift.textContent = fmt(ok ? lateralShiftInches(S.pose.head, S.address.head, dir, S.inPerPx) : null);
  els.hipShift.textContent = fmt(ok ? lateralShiftInches(S.pose.hipMid, S.address.hipMid, dir, S.inPerPx) : null);

  if (S.pose) {
    renderCard({ title: 'ADDRESS', index: 0, metrics: evaluateAddress(S.pose, evalCtx()), live: true });
  } else {
    renderCard(null);
  }

  const st = detector.state;
  if (!S.pose) setStatus('Step into the frame — full body and ball visible', '');
  else if (st === 'idle') setStatus('Set up at address and hold still', '');
  else if (st === 'address') setStatus('Address locked ✓  Swing when ready', 'ready');
  else if (st === 'cooldown') setStatus('Analyzing…', 'busy');
  else setStatus('Swinging…', 'busy');
}

// ------------------------------------------------------------------ review mode

function enterReview() {
  S.mode = 'review';
  S.reviewIdx = 0;
  els.status.classList.add('hidden');
  els.review.classList.remove('hidden');
  els.liveBtn.classList.remove('hidden');
  buildThumbs();
  showCheckpoint(0);
  clearInterval(S.reviewTimer);
  // Auto-cycle the checkpoints like a slideshow; tapping a thumbnail stops it.
  S.reviewTimer = setInterval(() => showCheckpoint((S.reviewIdx + 1) % CHECKPOINTS.length), 3000);
}

function exitReview() {
  clearInterval(S.reviewTimer);
  S.mode = 'live';
  els.review.classList.add('hidden');
  els.liveBtn.classList.add('hidden');
  els.status.classList.remove('hidden');
}
els.liveBtn.addEventListener('click', exitReview);

function showCheckpoint(i) {
  S.reviewIdx = i;
  const cp = S.swing.result.checkpoints[i];
  renderCard({ title: cp.title, index: i, metrics: cp.metrics, score: S.swing.result.score });
  [...els.thumbs.children].forEach((t, j) => t.classList.toggle('active', j === i));
}

function renderReview() {
  const cp = S.swing.result.checkpoints[S.reviewIdx];
  const snap = S.swing.snaps[cp.id];
  const { canvas } = els;
  if (canvas.width !== cp.pose.w || canvas.height !== cp.pose.h) {
    canvas.width = cp.pose.w;
    canvas.height = cp.pose.h;
  }
  ctx.drawImage(snap, 0, 0, canvas.width, canvas.height);
  drawOverlay(ctx, cp.pose, {
    address: S.swing.result.checkpoints[0].pose,
    ball: ballPx(),
    scale: canvas.width / cp.pose.w,
  });

  const dir = targetDirFor(settings.hand);
  const a = S.swing.result.checkpoints[0].pose;
  const fmt = (v) => (v == null ? '—' : `${Math.abs(v).toFixed(1)} in`);
  els.headShift.textContent = fmt(lateralShiftInches(cp.pose.head, a.head, dir, S.inPerPx));
  els.hipShift.textContent = fmt(lateralShiftInches(cp.pose.hipMid, a.hipMid, dir, S.inPerPx));
}

function buildThumbs() {
  els.thumbs.replaceChildren();
  S.swing.result.checkpoints.forEach((cp, i) => {
    const b = document.createElement('button');
    b.className = 'thumb';
    const c = cloneCanvas(S.swing.snaps[cp.id]);
    const tctx = c.getContext('2d');
    drawOverlay(tctx, cp.pose, { address: S.swing.result.checkpoints[0].pose, scale: c.width / cp.pose.w });
    const label = document.createElement('span');
    const worst = worstRating(cp.metrics);
    const dot = document.createElement('i');
    dot.className = `dot ${worst}`;
    label.append(dot, document.createTextNode(cp.title));
    b.append(c, label);
    b.addEventListener('click', () => {
      clearInterval(S.reviewTimer);
      showCheckpoint(i);
    });
    els.thumbs.append(b);
  });
  const r = S.swing.result;
  els.scoreLine.textContent = `${r.score != null ? `Score ${r.score} · ` : ''}${r.coachLine}`;
}

function worstRating(metrics) {
  const order = ['bad', 'ok', 'good'];
  for (const r of order) if (metrics.some((m) => m.rating === r)) return r;
  return 'none';
}

// ------------------------------------------------------------------ rendering helpers

function renderCard(data) {
  if (!data) {
    els.card.replaceChildren(el('div', 'card-head', [el('h2', '', 'WAITING'), el('span', 'cp', 'no golfer detected')]));
    return;
  }
  const head = el('div', 'card-head', [
    el('h2', '', data.title),
    el('span', 'cp', `checkpoint ${data.index + 1}/4${data.live ? ' · live' : ''}`),
  ]);
  if (data.score != null) head.append(el('span', 'score', `Score ${data.score}`));
  const grid = el('div', 'card-grid', [el('div', 'col-h you', 'YOU'), el('div', 'col-h pro', 'TOUR PRO')]);
  for (const m of data.metrics) {
    grid.append(
      el('div', 'you-cell', [el('span', `dot ${m.rating}`), el('b', '', m.label), el('small', '', m.display)]),
      el('div', 'pro-cell', m.pro),
    );
  }
  els.card.replaceChildren(head, grid);
}

function el(tag, cls, content) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (Array.isArray(content)) n.append(...content);
  else if (content != null) n.textContent = content;
  return n;
}

function setStatus(text, cls) {
  if (els.status.textContent !== text) els.status.textContent = text;
  els.status.className = `status ${cls}`;
}

function setStartMsg(text, isError = false) {
  els.startMsg.textContent = text;
  els.startMsg.classList.toggle('error', isError);
}

function captureSlot(slot) {
  const v = els.video;
  if (!v.videoWidth) return;
  const c = slots[slot];
  const w = Math.min(SNAP_W, v.videoWidth);
  const h = Math.round((w * v.videoHeight) / v.videoWidth);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  c.getContext('2d').drawImage(v, 0, 0, w, h);
}

function cloneCanvas(src) {
  const c = document.createElement('canvas');
  c.width = src.width || 1;
  c.height = src.height || 1;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}
