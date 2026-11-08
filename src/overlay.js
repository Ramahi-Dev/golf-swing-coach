// Draws the skeleton, spine line, head box, reference line and ball marker onto a canvas.
// All pose coordinates are in video pixels; `scale` maps them onto the target canvas.

const C = {
  limb: '#ffd84a',
  joint: '#ef4444',
  spine: '#5bd0f5',
  frame: '#7ee0c3',
  headOk: '#4ade80',
  headOut: '#ef4444',
  ref: 'rgba(255,255,255,0.9)',
};

const LIMBS = [
  ['L_SHOULDER', 'L_ELBOW'],
  ['L_ELBOW', 'L_WRIST'],
  ['R_SHOULDER', 'R_ELBOW'],
  ['R_ELBOW', 'R_WRIST'],
  ['L_HIP', 'L_KNEE'],
  ['L_KNEE', 'L_ANKLE'],
  ['L_ANKLE', 'L_FOOT'],
  ['R_HIP', 'R_KNEE'],
  ['R_KNEE', 'R_ANKLE'],
  ['R_ANKLE', 'R_FOOT'],
];
const JOINTS = ['L_SHOULDER', 'R_SHOULDER', 'L_ELBOW', 'R_ELBOW', 'L_WRIST', 'R_WRIST', 'L_HIP', 'R_HIP', 'L_KNEE', 'R_KNEE', 'L_ANKLE', 'R_ANKLE'];

/** Head box drawn around the address head position. */
export function headBox(address) {
  const w = address.torso * 0.55;
  const h = address.torso * 0.7;
  return { x: address.head.x - w / 2, y: address.head.y - h / 2, w, h };
}

export function headInBox(pose, address) {
  const b = headBox(address);
  return pose.head.x >= b.x && pose.head.x <= b.x + b.w && pose.head.y >= b.y && pose.head.y <= b.y + b.h;
}

export function drawOverlay(ctx, pose, { address = null, ball = null, scale = 1 } = {}) {
  const S = (p) => ({ x: p.x * scale, y: p.y * scale });
  const ref = pose ?? address;
  const unit = Math.max(1.5, (ref ? ref.torso : 200) * scale * 0.022);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Dashed vertical reference line through the address head position, down to the ball.
  if (address) {
    const top = S({ x: address.head.x, y: address.head.y - address.torso * 0.6 });
    const bottomY = ball ? ball.y * scale : Math.max(address.pts.L_ANKLE.y, address.pts.R_ANKLE.y) * scale;
    ctx.strokeStyle = C.ref;
    ctx.lineWidth = unit * 0.6;
    ctx.setLineDash([unit * 3, unit * 3]);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(top.x, bottomY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (ball) {
    const b = S(ball);
    const r = unit * 3;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = unit * 0.7;
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.stroke();
    const fs = Math.round(unit * 6);
    ctx.font = `700 ${fs}px system-ui, sans-serif`;
    const label = 'BALL';
    const tw = ctx.measureText(label).width;
    const px = fs * 0.4;
    ctx.fillStyle = 'rgba(20,20,24,0.8)';
    roundRect(ctx, b.x - tw / 2 - px, b.y + r + unit, tw + px * 2, fs * 1.35, fs * 0.3);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, b.x, b.y + r + unit + fs * 0.7);
  }

  if (!pose) {
    ctx.restore();
    return;
  }

  // Head box — green while the head stays inside its address position, red when it leaves.
  if (address) {
    const box = headBox(address);
    const p = S({ x: box.x, y: box.y });
    ctx.strokeStyle = headInBox(pose, address) ? C.headOk : C.headOut;
    ctx.lineWidth = unit * 0.7;
    ctx.strokeRect(p.x, p.y, box.w * scale, box.h * scale);
  }

  const vis = (k) => pose.pts[k].v >= 0.3;

  // Limbs
  ctx.strokeStyle = C.limb;
  ctx.lineWidth = unit;
  for (const [a, b] of LIMBS) {
    if (!vis(a) || !vis(b)) continue;
    const p = S(pose.pts[a]);
    const q = S(pose.pts[b]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  // Shoulder and hip lines
  ctx.strokeStyle = C.frame;
  ctx.lineWidth = unit * 0.8;
  for (const [a, b] of [
    ['L_SHOULDER', 'R_SHOULDER'],
    ['L_HIP', 'R_HIP'],
  ]) {
    const p = S(pose.pts[a]);
    const q = S(pose.pts[b]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }

  // Spine
  const hm = S(pose.hipMid);
  const sm = S(pose.shoulderMid);
  ctx.strokeStyle = C.spine;
  ctx.lineWidth = unit * 1.3;
  ctx.beginPath();
  ctx.moveTo(hm.x, hm.y);
  ctx.lineTo(sm.x, sm.y);
  ctx.stroke();

  // Joints
  for (const k of JOINTS) {
    if (!vis(k)) continue;
    const p = S(pose.pts[k]);
    ctx.fillStyle = C.joint;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = unit * 0.35;
    ctx.beginPath();
    ctx.arc(p.x, p.y, unit * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // Head center
  const h = S(pose.head);
  ctx.fillStyle = C.spine;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = unit * 0.4;
  ctx.beginPath();
  ctx.arc(h.x, h.y, unit * 1.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
