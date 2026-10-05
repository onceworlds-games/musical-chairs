// Small drawing helpers shared by the room, the screens and the posters. No state, nothing that touches window.

export const FONT = '"Baloo 2", "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
export const INK = '#2d1650'; // the outline colour of everything
export const SHADOW = 'rgba(30, 10, 60, 0.35)';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

export const ease = {
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inQuad: (t) => t * t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outElastic: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};

/** A pop: 0 -> 1.3 -> 1 over `dur` seconds (scale for something that just appeared). */
export function pop(age, dur = 0.35) {
  if (age <= 0) return 0;
  if (age >= dur) return 1;
  return ease.outBack(age / dur);
}

export function font(size) {
  return `800 ${Math.max(1, Math.round(size))}px ${FONT}`;
}

/** '#rrggbb' mixed toward white (amt > 0) or black (amt < 0). */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `rgb(${r},${g},${b})`;
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Text with a thick dark outline under a fill (white by default). */
export function label(ctx, text, x, y, size, o = {}) {
  ctx.save();
  ctx.font = font(size);
  ctx.textAlign = o.align || 'center';
  ctx.textBaseline = o.baseline || 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  if (o.rotate || o.scale) {
    ctx.translate(x, y);
    if (o.rotate) ctx.rotate(o.rotate);
    if (o.scale) ctx.scale(o.scale, o.scale);
    x = 0;
    y = 0;
  }
  if (o.drop) {
    ctx.fillStyle = SHADOW;
    ctx.fillText(text, x + o.drop, y + o.drop);
  }
  ctx.lineWidth = o.lw ?? Math.max(3, size * 0.2);
  ctx.strokeStyle = o.stroke || INK;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = o.fill || '#fff';
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function textWidth(ctx, text, size) {
  ctx.save();
  ctx.font = font(size);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

/** A name that fits `maxW` px, with an ellipsis if it must be cut. */
export function fitName(ctx, text, size, maxW) {
  let t = String(text || '');
  if (textWidth(ctx, t, size) <= maxW) return t;
  while (t.length > 1 && textWidth(ctx, `${t}…`, size) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
}

export function ellipse(ctx, x, y, rx, ry, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0, rx), Math.max(0, ry), rot, 0, Math.PI * 2);
}

/** Fill then outline the current path. */
export function fillStroke(ctx, fill, lw, stroke = INK) {
  ctx.fillStyle = fill;
  ctx.fill();
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

export function starPath(ctx, x, y, r, points = 5, inner = 0.45, rot = -Math.PI / 2) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? r : r * inner;
    const a = rot + (i * Math.PI) / points;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** A check mark inside a circle of radius r at (x, y). */
export function checkBadge(ctx, x, y, r, fill = '#2ed573') {
  circle(ctx, x, y, r);
  fillStroke(ctx, fill, Math.max(2, r * 0.22));
  ctx.beginPath();
  ctx.moveTo(x - r * 0.45, y + r * 0.02);
  ctx.lineTo(x - r * 0.12, y + r * 0.36);
  ctx.lineTo(x + r * 0.5, y - r * 0.36);
  ctx.lineWidth = Math.max(2.5, r * 0.3);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** A music note (head, stem, flag) with its head at (x, y), size s. */
export function noteShape(ctx, x, y, s, color) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, s * 0.16);
  ctx.lineJoin = 'round';
  ellipse(ctx, x, y, s * 0.5, s * 0.36, -0.4);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + s * 0.42, y - s * 0.1);
  ctx.lineTo(x + s * 0.42, y - s * 1.5);
  ctx.quadraticCurveTo(x + s * 1.1, y - s * 1.2, x + s * 0.9, y - s * 0.6);
  ctx.stroke();
  ctx.restore();
}

/** A tiny chair icon (for the HUD): centre (x, y), width s. */
export function chairIcon(ctx, x, y, s, color) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1.5, s * 0.1);
  ctx.strokeStyle = INK;
  roundRect(ctx, x - s * 0.4, y - s * 0.5, s * 0.8, s * 0.3, s * 0.1);
  fillStroke(ctx, shade(color, -0.2), ctx.lineWidth);
  roundRect(ctx, x - s * 0.45, y - s * 0.15, s * 0.9, s * 0.5, s * 0.14);
  fillStroke(ctx, color, ctx.lineWidth);
  ctx.restore();
}

/** Round to a number of decimals (for small messages). */
export const r1 = (v) => Math.round(v * 10) / 10;
export const r2 = (v) => Math.round(v * 100) / 100;
