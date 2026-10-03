// The vector display: thin lines with a white-hot core and a coloured halo, stroked three times with additive
// blending over a faint phosphor persistence. One path is built per colour group and stroked at decreasing widths,
// so a frame costs a few dozen draw calls however many lines it has. Also the stroke font every label is drawn in.

const HEX = /^#([0-9a-f]{6})$/i;

/** Colour strings for a hue, cached: the halo is the hue, the core leans to white. */
const palette = new Map();
export function tone(hex) {
  let t = palette.get(hex);
  if (t) return t;
  const m = HEX.exec(hex) || HEX.exec('#ffffff');
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  const mix = (c, k) => Math.round(c + (255 - c) * k);
  t = {
    hex,
    rgb: [r, g, b],
    halo: `rgb(${r},${g},${b})`,
    mid: `rgb(${mix(r, 0.3)},${mix(g, 0.3)},${mix(b, 0.3)})`,
    core: `rgb(${mix(r, 0.72)},${mix(g, 0.72)},${mix(b, 0.72)})`,
  };
  palette.set(hex, t);
  return t;
}

export class Vector {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true }) || canvas.getContext('2d');
    this.w = 1;
    this.h = 1;
    this.pr = 1;
    this.quality = 'high';
    this.calm = false;
    this.fadeAlpha = 0.5;
  }

  resize(cssW, cssH, pr) {
    const w = Math.max(1, Math.round(cssW * pr));
    const h = Math.max(1, Math.round(cssH * pr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = cssW;
    this.h = cssH;
    this.pr = pr;
    this.clear();
  }

  clear() {
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = '#020403';
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Starts a frame: the last frame fades like phosphor (or is wiped, on low quality). dt in seconds. */
  frame(dt, persistence = 1) {
    const c = this.ctx;
    c.setTransform(this.pr, 0, 0, this.pr, 0, 0);
    c.globalCompositeOperation = 'source-over';
    if (this.quality === 'low' || persistence <= 0) {
      c.globalAlpha = 1;
    } else {
      // Frame-rate independent: the same trail length at 30 and 120 frames a second.
      const keep = Math.pow(1 - this.fadeAlpha / persistence, Math.min(4, Math.max(0.25, dt * 60)));
      c.globalAlpha = Math.min(1, Math.max(0.2, 1 - keep));
    }
    c.fillStyle = '#020403';
    c.fillRect(0, 0, this.w, this.h);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }

  begin() {
    this.ctx.beginPath();
  }
  move(x, y) {
    this.ctx.moveTo(x, y);
  }
  to(x, y) {
    this.ctx.lineTo(x, y);
  }
  line(x1, y1, x2, y2) {
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
  }
  /** pts: flat [x0, y0, x1, y1, ...]. */
  poly(pts, closed = false, n = pts.length) {
    const c = this.ctx;
    c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < n; i += 2) c.lineTo(pts[i], pts[i + 1]);
    if (closed) c.closePath();
  }

  /** Strokes the current path as a glowing line: hex colour, core width in CSS px, brightness 0..1+. */
  glow(hex, width = 1.4, bright = 1) {
    const c = this.ctx;
    const t = tone(hex);
    const b = Math.max(0, Math.min(1.6, bright));
    if (b <= 0.01) return;
    if (this.quality === 'high') {
      // The halo stays a halo on thick strokes (big text): it widens by a fixed amount, not a multiple.
      c.strokeStyle = t.halo;
      c.globalAlpha = 0.09 * b;
      c.lineWidth = Math.min(width * 7, width + 16);
      c.stroke();
      c.globalAlpha = 0.24 * b;
      c.lineWidth = Math.min(width * 3, width + 6);
      c.stroke();
      c.strokeStyle = t.core;
      c.globalAlpha = Math.min(1, 0.95 * b);
      c.lineWidth = width;
      c.stroke();
    } else if (this.quality === 'medium') {
      c.strokeStyle = t.halo;
      c.globalAlpha = 0.18 * b;
      c.lineWidth = Math.min(width * 4, width + 10);
      c.stroke();
      c.strokeStyle = t.core;
      c.globalAlpha = Math.min(1, b);
      c.lineWidth = width * 1.1;
      c.stroke();
    } else {
      c.strokeStyle = t.mid;
      c.globalAlpha = 0.35 * b;
      c.lineWidth = width * 2.6;
      c.stroke();
      c.strokeStyle = t.core;
      c.globalAlpha = Math.min(1, b);
      c.lineWidth = width * 1.15;
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  /** A plain thin stroke (no halo): dim structure lines. */
  thin(hex, width = 1, alpha = 0.4) {
    const c = this.ctx;
    c.strokeStyle = tone(hex).halo;
    c.globalAlpha = alpha;
    c.lineWidth = width;
    c.stroke();
    c.globalAlpha = 1;
  }

  /** A soft filled disc of light (bloom on a hit, a pickup), additive. */
  dot(x, y, r, hex, alpha = 0.5) {
    const c = this.ctx;
    c.fillStyle = tone(hex).halo;
    c.globalAlpha = alpha * 0.35;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = alpha;
    c.beginPath();
    c.arc(x, y, r * 0.35, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- the stroke font

  /** Adds a string's strokes to the current path. size: cap height in CSS px. align: 0 left, 0.5 centre, 1 right. */
  textPath(str, x, y, size, align = 0) {
    const s = String(str).toUpperCase();
    const u = size / 6;
    const adv = 5 * u + size * 0.06;
    const width = measureRaw(s, adv, u);
    let cx = x - width * align;
    const c = this.ctx;
    for (const ch of s) {
      const g = GLYPHS.get(ch);
      if (g) {
        for (const stroke of g.strokes) {
          c.moveTo(cx + stroke[0] * u, y + stroke[1] * u);
          if (stroke.length === 2) c.lineTo(cx + stroke[0] * u + 0.01, y + stroke[1] * u);
          for (let i = 2; i < stroke.length; i += 2) c.lineTo(cx + stroke[i] * u, y + stroke[i + 1] * u);
        }
      }
      cx += (g ? g.w : 4) * u + adv - 4 * u;
    }
    return width;
  }

  /** Draws a glowing label. y is the top of the capitals. */
  text(str, x, y, size, hex = '#ffffff', align = 0, bright = 1, weight = 1) {
    this.begin();
    const w = this.textPath(str, x, y, size, align);
    this.glow(hex, Math.max(1, size / 10) * weight, bright);
    return w;
  }

  measure(str, size) {
    const u = size / 6;
    return measureRaw(String(str).toUpperCase(), 5 * u + size * 0.06, u);
  }
}

function measureRaw(s, adv, u) {
  let w = 0;
  let n = 0;
  for (const ch of s) {
    const g = GLYPHS.get(ch);
    w += (g ? g.w : 4) * u + adv - 4 * u;
    n++;
  }
  return n ? w - (adv - 4 * u) : 0;
}

// Glyphs on a 4 x 6 grid (y down). Each stroke is a polyline "x,y x,y ..."; strokes are separated by "|".
// A single point draws a dot.
const SRC = {
  A: '0,6 0,2 2,0 4,2 4,6|0,4 4,4',
  B: '0,3 0,0 3,0 4,1 4,2 3,3 0,3 0,6 3,6 4,5 4,4 3,3',
  C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5',
  D: '0,0 0,6 2,6 4,4 4,2 2,0 0,0',
  E: '4,0 0,0 0,6 4,6|0,3 3,3',
  F: '4,0 0,0 0,6|0,3 3,3',
  G: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '1,0 3,0|2,0 2,6|1,6 3,6',
  J: '4,0 4,5 3,6 1,6 0,5',
  K: '0,0 0,6|4,0 0,4|1.5,3 4,6',
  L: '0,0 0,6 4,6',
  M: '0,6 0,0 2,3 4,0 4,6',
  N: '0,6 0,0 4,6 4,0',
  O: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0',
  P: '0,6 0,0 3,0 4,1 4,2 3,3 0,3',
  Q: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2.5,4.5 4,6',
  R: '0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6',
  S: '4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5',
  T: '0,0 4,0|2,0 2,6',
  U: '0,0 0,5 1,6 3,6 4,5 4,0',
  V: '0,0 2,6 4,0',
  W: '0,0 1,6 2,2.5 3,6 4,0',
  X: '0,0 4,6|4,0 0,6',
  Y: '0,0 2,3 4,0|2,3 2,6',
  Z: '0,0 4,0 0,6 4,6',
  0: '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|3.2,1.2 0.8,4.8',
  1: '0.8,1.2 2,0 2,6|0.8,6 3.2,6',
  2: '0,1 1,0 3,0 4,1 4,2 0,6 4,6',
  3: '0,0 4,0 2,2.4 3,2.4 4,3.4 4,5 3,6 1,6 0,5',
  4: '3,6 3,0 0,4 4,4',
  5: '4,0 0,0 0,2.6 3,2.6 4,3.6 4,5 3,6 0,6',
  6: '3.4,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.4 3,2.6 0,2.6',
  7: '0,0 4,0 1.2,6',
  8: '1,0 3,0 4,1 4,2 3,3 1,3 0,2 0,1 1,0|1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3',
  9: '4,3.4 1,3.4 0,2.4 0,1 1,0 3,0 4,1 4,5 3,6 0.6,6',
  '.': '2,6',
  ',': '2,5.4 1.5,6.6',
  ':': '2,1.8|2,5',
  '!': '2,0 2,4.2|2,6',
  '?': '0,1 1,0 3,0 4,1 4,2 2,3.6 2,4.2|2,6',
  '-': '0.8,3 3.2,3',
  '+': '0.6,3 3.4,3|2,1.6 2,4.4',
  '/': '4,0 0,6',
  "'": '2,0 2,1.6',
  '%': '0,6 4,0|0,0 1,0 1,1 0,1 0,0|3,5 4,5 4,6 3,6 3,5',
  '#': '1.2,0 1.2,6|2.8,0 2.8,6|0,2 4,2|0,4 4,4',
  '(': '3,0 2,1 2,5 3,6',
  ')': '1,0 2,1 2,5 1,6',
  '<': '4,0 0,3 4,6',
  '>': '0,0 4,3 0,6',
  '=': '0,2 4,2|0,4 4,4',
  _: '0,6 4,6',
  '×': '1,2 3,4|3,2 1,4',
  '←': '4,3 0,3|1.8,1.2 0,3 1.8,4.8',
  '→': '0,3 4,3|2.2,1.2 4,3 2.2,4.8',
  '↑': '2,6 2,0|0.2,1.8 2,0 3.8,1.8',
  '↓': '2,0 2,6|0.2,4.2 2,6 3.8,4.2',
  '·': '2,3',
  '◀': '3.4,0.6 0.6,3 3.4,5.4 3.4,0.6',
  '▶': '0.6,0.6 3.4,3 0.6,5.4 0.6,0.6',
  ' ': '',
};
const NARROW = { I: 4, 1: 4, '.': 2, ',': 2, ':': 2, '!': 2, "'": 2, '·': 2 };

export const GLYPHS = new Map();
for (const [ch, src] of Object.entries(SRC)) {
  const strokes = src
    ? src.split('|').map((p) =>
        p
          .trim()
          .split(/\s+/)
          .flatMap((xy) => xy.split(',').map(Number)),
      )
    : [];
  // Narrow glyphs sit centred in a narrower cell.
  const w = NARROW[ch] ?? 4;
  const shift = (w - 4) / 2;
  GLYPHS.set(
    ch,
    {
      w,
      strokes: strokes.map((s) => s.map((v, i) => (i % 2 === 0 ? v + shift : v))),
    },
  );
}

/** Whether every character of a string has a glyph (else it is drawn with the UI face). */
export function strokeable(str) {
  for (const ch of String(str).toUpperCase()) if (!GLYPHS.has(ch)) return false;
  return true;
}
