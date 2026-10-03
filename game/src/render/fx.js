// Pooled effects in screen space: shards of broken vectors, rings, sparks and score pops. Fixed-size typed arrays,
// so a busy wave allocates nothing; the oldest piece gives way when the pool is full.

const MAX_SHARDS = 640;
const MAX_RINGS = 48;
const MAX_POPS = 24;

export class Fx {
  constructor() {
    // Shards: a line segment that drifts, turns and fades.
    this.sx = new Float32Array(MAX_SHARDS);
    this.sy = new Float32Array(MAX_SHARDS);
    this.sl = new Float32Array(MAX_SHARDS); // half length
    this.sa = new Float32Array(MAX_SHARDS); // angle
    this.svx = new Float32Array(MAX_SHARDS);
    this.svy = new Float32Array(MAX_SHARDS);
    this.sva = new Float32Array(MAX_SHARDS);
    this.slife = new Float32Array(MAX_SHARDS);
    this.smax = new Float32Array(MAX_SHARDS);
    this.scol = new Array(MAX_SHARDS).fill('#ffffff');
    this.sNext = 0;
    this.rx = new Float32Array(MAX_RINGS);
    this.ry = new Float32Array(MAX_RINGS);
    this.r0 = new Float32Array(MAX_RINGS);
    this.r1 = new Float32Array(MAX_RINGS);
    this.rlife = new Float32Array(MAX_RINGS);
    this.rmax = new Float32Array(MAX_RINGS);
    this.rsides = new Uint8Array(MAX_RINGS);
    this.rcol = new Array(MAX_RINGS).fill('#ffffff');
    this.rNext = 0;
    this.pops = [];
    for (let i = 0; i < MAX_POPS; i++) this.pops.push({ x: 0, y: 0, text: '', life: 0, max: 1, col: '#fff', size: 12 });
    this.pNext = 0;
    this.scale = 1; // fewer shards on low quality or in Calm
    this.seed = 1;
  }

  rand() {
    // A small private generator: effects never touch the simulation's randomness.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  clear() {
    this.slife.fill(0);
    this.rlife.fill(0);
    for (const p of this.pops) p.life = 0;
  }

  /** Breaks an outline into shards that fly apart. pts: flat screen-space polyline. */
  shatter(pts, color, speed = 120, life = 0.55) {
    const step = this.scale < 0.6 ? 4 : 2;
    for (let i = 0; i + 3 < pts.length; i += step) {
      if (this.rand() > this.scale) continue;
      const x1 = pts[i];
      const y1 = pts[i + 1];
      const x2 = pts[i + 2];
      const y2 = pts[i + 3];
      const k = this.sNext;
      this.sNext = (k + 1) % MAX_SHARDS;
      this.sx[k] = (x1 + x2) / 2;
      this.sy[k] = (y1 + y2) / 2;
      this.sl[k] = Math.hypot(x2 - x1, y2 - y1) / 2;
      this.sa[k] = Math.atan2(y2 - y1, x2 - x1);
      const a = this.rand() * Math.PI * 2;
      const v = speed * (0.4 + this.rand());
      this.svx[k] = Math.cos(a) * v;
      this.svy[k] = Math.sin(a) * v;
      this.sva[k] = (this.rand() - 0.5) * 12;
      this.slife[k] = life * (0.7 + 0.5 * this.rand());
      this.smax[k] = this.slife[k];
      this.scol[k] = color;
    }
  }

  /** Short sparks from a point. */
  sparks(x, y, color, count = 8, speed = 160, len = 5) {
    const n = Math.round(count * this.scale);
    for (let i = 0; i < n; i++) {
      const k = this.sNext;
      this.sNext = (k + 1) % MAX_SHARDS;
      const a = this.rand() * Math.PI * 2;
      const v = speed * (0.5 + this.rand());
      this.sx[k] = x;
      this.sy[k] = y;
      this.sl[k] = len * (0.5 + this.rand());
      this.sa[k] = a;
      this.svx[k] = Math.cos(a) * v;
      this.svy[k] = Math.sin(a) * v;
      this.sva[k] = 0;
      this.slife[k] = 0.25 + 0.25 * this.rand();
      this.smax[k] = this.slife[k];
      this.scol[k] = color;
    }
  }

  ring(x, y, r0, r1, life, color, sides = 24) {
    const k = this.rNext;
    this.rNext = (k + 1) % MAX_RINGS;
    this.rx[k] = x;
    this.ry[k] = y;
    this.r0[k] = r0;
    this.r1[k] = r1;
    this.rlife[k] = life;
    this.rmax[k] = life;
    this.rsides[k] = sides;
    this.rcol[k] = color;
  }

  pop(x, y, text, color = '#ffffff', size = 11, life = 0.8) {
    const p = this.pops[this.pNext];
    this.pNext = (this.pNext + 1) % MAX_POPS;
    p.x = x;
    p.y = y;
    p.text = String(text);
    p.life = life;
    p.max = life;
    p.col = color;
    p.size = size;
  }

  update(dt) {
    const drag = Math.pow(0.12, dt);
    for (let k = 0; k < MAX_SHARDS; k++) {
      if (this.slife[k] <= 0) continue;
      this.slife[k] -= dt;
      this.sx[k] += this.svx[k] * dt;
      this.sy[k] += this.svy[k] * dt;
      this.svx[k] *= drag;
      this.svy[k] *= drag;
      this.sa[k] += this.sva[k] * dt;
    }
    for (let k = 0; k < MAX_RINGS; k++) if (this.rlife[k] > 0) this.rlife[k] -= dt;
    for (const p of this.pops) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.y -= 26 * dt;
    }
  }

  draw(vec) {
    // Shards grouped by colour so each colour is one stroke.
    const colours = new Set();
    for (let k = 0; k < MAX_SHARDS; k++) if (this.slife[k] > 0) colours.add(this.scol[k]);
    for (const col of colours) {
      for (const band of [0, 1]) {
        vec.begin();
        let any = false;
        for (let k = 0; k < MAX_SHARDS; k++) {
          if (this.slife[k] <= 0 || this.scol[k] !== col) continue;
          const f = this.slife[k] / this.smax[k];
          if ((f > 0.5 ? 1 : 0) !== band) continue;
          const c = Math.cos(this.sa[k]) * this.sl[k];
          const s = Math.sin(this.sa[k]) * this.sl[k];
          vec.line(this.sx[k] - c, this.sy[k] - s, this.sx[k] + c, this.sy[k] + s);
          any = true;
        }
        if (any) vec.glow(col, 1.1, band ? 0.85 : 0.4);
      }
    }
    for (let k = 0; k < MAX_RINGS; k++) {
      if (this.rlife[k] <= 0) continue;
      const f = 1 - this.rlife[k] / this.rmax[k];
      const e = 1 - (1 - f) * (1 - f);
      const r = this.r0[k] + (this.r1[k] - this.r0[k]) * e;
      vec.begin();
      const n = this.rsides[k];
      for (let i = 0; i <= n; i++) {
        const a = (Math.PI * 2 * i) / n;
        const x = this.rx[k] + Math.cos(a) * r;
        const y = this.ry[k] + Math.sin(a) * r;
        if (i === 0) vec.move(x, y);
        else vec.to(x, y);
      }
      vec.glow(this.rcol[k], 1.2, (1 - f) * 0.9);
    }
    for (const p of this.pops) {
      if (p.life <= 0) continue;
      const f = p.life / p.max;
      vec.text(p.text, p.x, p.y, p.size, p.col, 0.5, Math.min(1, f * 2) * 0.9);
    }
  }
}
