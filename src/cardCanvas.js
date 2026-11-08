// Draws the "YOU vs TOUR PRO" checkpoint card (and captions) straight onto a canvas,
// so it can be burned into exported video frames.

const COL = {
  panel: 'rgba(18, 20, 28, 0.86)',
  text: '#f5f6f8',
  muted: '#a3a9b6',
  you: '#ffd84a',
  pro: '#ff5ad1',
  good: '#34d399',
  ok: '#fbbf24',
  bad: '#f43f5e',
  none: '#6b7280',
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function wrap(ctx, text, maxW) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
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

/** Base font size for a canvas of this size. */
export const unitFor = (w, h) => Math.max(10, Math.min(w, h * 0.62) / 30);

/**
 * Draw a checkpoint card at the top of the canvas.
 * card: { title, index, metrics, score }
 */
export function drawCard(ctx, card, W, H) {
  const u = unitFor(W, H);
  const pad = u * 1.1;
  const x = u;
  const y = u;
  const w = W - u * 2;
  const colW = (w - pad * 2 - u) / 2;
  const metrics = card.metrics.filter((m) => m.rating !== 'none');

  // Lay out first so the panel can be sized to fit.
  const rows = metrics.map((m) => {
    ctx.font = `600 ${u * 0.95}px ${FONT}`;
    const you = wrap(ctx, m.display, colW - u * 1.3);
    ctx.font = `${u * 0.9}px ${FONT}`;
    const pro = wrap(ctx, m.pro, colW);
    return { m, you, pro, h: Math.max(u * 1.25 + you.length * u * 1.15, (pro.length + 0.4) * u * 1.15) + u * 0.45 };
  });
  const headH = u * 2.4;
  const colHeadH = u * 1.5;
  const h = pad + headH + colHeadH + rows.reduce((s, r) => s + r.h, 0) + pad * 0.6;

  ctx.save();
  ctx.fillStyle = COL.panel;
  roundRect(ctx, x, y, w, h, u * 0.9);
  ctx.fill();

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  let cy = y + pad + u * 1.6;
  ctx.fillStyle = COL.text;
  ctx.font = `800 ${u * 1.9}px ${FONT}`;
  ctx.fillText(card.title, x + pad, cy);
  const tw = ctx.measureText(card.title).width;
  ctx.fillStyle = COL.muted;
  ctx.font = `${u * 0.85}px ${FONT}`;
  ctx.fillText(`checkpoint ${card.index + 1}/4`, x + pad + tw + u * 0.7, cy);
  if (card.score != null) {
    ctx.textAlign = 'right';
    ctx.font = `700 ${u * 0.85}px ${FONT}`;
    ctx.fillText(`Score ${card.score}`, x + w - pad, cy);
    ctx.textAlign = 'left';
  }

  cy = y + pad + headH + u * 0.6;
  const leftX = x + pad;
  const rightX = x + pad + colW + u;
  ctx.font = `800 ${u * 0.95}px ${FONT}`;
  ctx.fillStyle = COL.you;
  ctx.fillText('YOU', leftX, cy);
  ctx.fillStyle = COL.pro;
  ctx.fillText('TOUR PRO', rightX, cy);
  cy += colHeadH - u * 0.6;

  for (const r of rows) {
    const top = cy;
    // dot + label
    ctx.fillStyle = COL[r.m.rating] ?? COL.none;
    ctx.beginPath();
    ctx.arc(leftX + u * 0.4, top + u * 0.75, u * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COL.text;
    ctx.font = `700 ${u}px ${FONT}`;
    ctx.fillText(r.m.label, leftX + u * 1.3, top + u * 1.1);
    ctx.fillStyle = COL.you;
    ctx.font = `600 ${u * 0.95}px ${FONT}`;
    r.you.forEach((line, i) => ctx.fillText(line, leftX + u * 1.3, top + u * 1.1 + (i + 1) * u * 1.15));
    ctx.fillStyle = COL.pro;
    ctx.font = `${u * 0.9}px ${FONT}`;
    const proTop = top + r.h - u * 0.45 - r.pro.length * u * 1.15;
    r.pro.forEach((line, i) => ctx.fillText(line, rightX, proTop + (i + 0.8) * u * 1.15));
    cy += r.h;
  }
  ctx.restore();
}

/** A caption pill near the bottom of the frame (e.g. the coaching line or "SLOW-MO"). */
export function drawCaption(ctx, text, W, H, { color = COL.text, maxLines = 3 } = {}) {
  const u = unitFor(W, H);
  ctx.save();
  ctx.font = `600 ${u * 1.05}px ${FONT}`;
  const lines = wrap(ctx, text, W - u * 5).slice(0, maxLines);
  const lh = u * 1.4;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + u * 2;
  const h = lines.length * lh + u * 0.9;
  const x = (W - w) / 2;
  const y = H - h - u * 1.5;
  ctx.fillStyle = COL.panel;
  roundRect(ctx, x, y, w, h, u * 0.7);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + u * 0.45 + lh * (i + 0.5)));
  ctx.restore();
}

/** Small corner tag, e.g. "SLOW-MO 0.5×". */
export function drawTag(ctx, text, W, H) {
  const u = unitFor(W, H);
  ctx.save();
  ctx.font = `800 ${u * 0.8}px ${FONT}`;
  const w = ctx.measureText(text).width + u * 1.2;
  const x = W - w - u;
  const y = H - u * 2.6 - u * 1.6;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, x, y, w, u * 1.6, u * 0.5);
  ctx.fill();
  ctx.fillStyle = COL.you;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + u * 0.8);
  ctx.restore();
}
