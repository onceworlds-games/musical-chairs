// The heads-up display, in the stroke font: score and multiplier with the beat ring (top right), ships and zaps,
// the zone (top centre, clear of the platform's buttons at the top left), Resonance and Overdrive along the bottom,
// the boss's health, and the big words of the moment ("PERFECT BAR", "CHORD", "ZONE 3").
import { RESONANCE_MAX, STEPS_PER_BEAT } from '../sim/data.js';

const WHITE = '#ffffff';

export class Hud {
  constructor(vec) {
    this.vec = vec;
    this.msgs = [];
    this.hint = null;
    this.scoreShown = 0;
    this.multPop = 0;
  }

  /** A word of the moment. kind: 'big' (centre), 'small' (under it). */
  say(text, { size = 1, life = 1.4, color = WHITE, kind = 'big', priority = 0 } = {}) {
    if (kind === 'big') {
      // A new big word replaces a weaker one.
      this.msgs = this.msgs.filter((m) => m.kind !== 'big' || m.priority > priority);
    }
    if (this.msgs.length > 5) this.msgs.shift();
    this.msgs.push({ text: String(text), size, life, max: life, color, kind, priority });
  }

  showHint(text) {
    this.hint = text ? { text, life: 4, max: 4 } : null;
  }

  clear() {
    this.msgs = [];
    this.hint = null;
  }

  update(dt) {
    for (const m of this.msgs) m.life -= dt;
    this.msgs = this.msgs.filter((m) => m.life > 0);
    if (this.hint) {
      this.hint.life -= dt;
      if (this.hint.life <= 0) this.hint = null;
    }
    if (this.multPop > 0) this.multPop = Math.max(0, this.multPop - dt * 3);
  }

  /**
   * d: { W, H, hue, score, mult, lives, zaps, res, od (0..1 left), zone, boss: { name, hp, max } | null,
   *      beat (0..1 into the beat), calm, touch, watching, practice }
   */
  draw(d) {
    const v = this.vec;
    const W = d.W;
    const H = d.H;
    const small = Math.min(W, H) < 520;
    const pad = 14;
    // Score: counts up to the real number.
    this.scoreShown += (d.score - this.scoreShown) * 0.25;
    if (Math.abs(d.score - this.scoreShown) < 1) this.scoreShown = d.score;
    const sz = small ? 17 : 24;
    v.text(String(Math.round(this.scoreShown)).padStart(1, '0'), W - pad, pad, sz, d.hue, 1, 1);
    // Multiplier with the beat ring around it.
    const my = pad + sz + (small ? 14 : 18);
    const mx = W - pad - (small ? 14 : 18);
    const r = small ? 12 : 16;
    const beat = d.calm ? 0.5 : 1 - d.beat;
    v.begin();
    for (let i = 0; i <= 24; i++) {
      const a = (Math.PI * 2 * i) / 24 - Math.PI / 2;
      const rr = r * (1 + (d.calm ? 0 : 0.12 * beat * beat));
      if (i === 0) v.move(mx + Math.cos(a) * rr, my + Math.sin(a) * rr);
      else v.to(mx + Math.cos(a) * rr, my + Math.sin(a) * rr);
    }
    v.glow(d.hue, 1.1, 0.35 + 0.5 * beat * beat);
    const ms = (small ? 10 : 13) * (1 + this.multPop * 0.4);
    v.text(`${d.mult}`, mx, my - ms / 2, ms, d.mult >= 8 ? WHITE : d.hue, 0.5, 1);
    v.text('×', mx - r - 4, my - (small ? 4 : 5), small ? 8 : 10, d.hue, 1, 0.7);
    // Ships and zaps under the score.
    const ly = my + r + 10;
    const icon = small ? 9 : 11;
    for (let i = 0; i < Math.min(8, d.lives); i++) {
      const x = W - pad - i * (icon + 5) - icon / 2;
      v.begin();
      v.move(x - icon / 2, ly);
      v.to(x + icon / 2, ly);
      v.to(x, ly + icon * 0.9);
      v.to(x - icon / 2, ly);
      v.glow(WHITE, 1, 0.85);
    }
    if (d.practice) v.text('∞', W - pad, ly, icon, WHITE, 1, 0.8);
    for (let i = 0; i < d.zaps; i++) {
      const x = W - pad - i * (icon + 4) - icon / 2;
      const y = ly + icon + 8;
      v.begin();
      v.move(x + 2, y);
      v.to(x - 2, y + icon * 0.5);
      v.to(x + 2, y + icon * 0.5);
      v.to(x - 2, y + icon);
      v.glow(d.hue, 1, 0.9);
    }
    // The zone, top centre (the platform's buttons own the top left).
    if (d.zone) v.text(d.zone, W / 2, pad + 2, small ? 10 : 12, d.hue, 0.5, 0.8);
    if (d.watching) v.text('WATCHING', W / 2, pad + (small ? 18 : 22), small ? 9 : 11, WHITE, 0.5, 0.6);
    // The boss: a bar under the zone.
    if (d.boss) {
      const bw = Math.min(W * 0.46, 360);
      const bx = W / 2 - bw / 2;
      const by = pad + (small ? 30 : 36);
      const k = Math.max(0, Math.min(1, d.boss.hp / Math.max(1, d.boss.max)));
      v.text(d.boss.name, W / 2, by - (small ? 13 : 15), small ? 8 : 10, WHITE, 0.5, 0.7);
      v.begin();
      v.move(bx, by);
      v.to(bx + bw * k, by);
      v.glow(WHITE, 2, 0.9);
      v.begin();
      v.move(bx, by - 4);
      v.to(bx, by + 4);
      v.move(bx + bw, by - 4);
      v.to(bx + bw, by + 4);
      v.glow(d.hue, 1, 0.5);
    }
    // Resonance (or Overdrive running down) along the bottom centre, clear of the thumbs' corners.
    const mw = Math.min(W * (d.touch ? 0.42 : 0.5), 420);
    const mxx = W / 2 - mw / 2;
    const myy = H - (small ? 22 : 28);
    const segs = 20;
    const gap = 3;
    const sw = (mw - gap * (segs - 1)) / segs;
    if (d.od > 0) {
      v.begin();
      v.move(W / 2 - (mw / 2) * d.od, myy);
      v.to(W / 2 + (mw / 2) * d.od, myy);
      v.glow(WHITE, 3, 0.95);
      v.text('OVERDRIVE', W / 2, myy - (small ? 15 : 18), small ? 9 : 11, WHITE, 0.5, 0.9);
    } else {
      const filled = Math.floor((d.res / RESONANCE_MAX) * segs);
      v.begin();
      for (let i = 0; i < filled; i++) v.line(mxx + i * (sw + gap), myy, mxx + i * (sw + gap) + sw, myy);
      v.glow(d.hue, 2, 0.95);
      v.begin();
      for (let i = filled; i < segs; i++) v.line(mxx + i * (sw + gap), myy, mxx + i * (sw + gap) + sw, myy);
      v.thin(d.hue, 1.5, 0.3);
    }
    // Words of the moment.
    let stack = 0;
    for (const m of this.msgs) {
      const f = m.life / m.max;
      const appear = Math.min(1, (1 - f) * 8);
      const fade = Math.min(1, f * 3);
      const base = (small ? 22 : 34) * m.size;
      const s = m.kind === 'big' ? base * (d.calm ? 1 : 0.85 + 0.15 * appear) : base * 0.5;
      const y = H * 0.36 + stack;
      v.text(m.text, W / 2, y, s, m.color, 0.5, fade * (m.kind === 'big' ? 1 : 0.85), m.kind === 'big' ? 1.2 : 1);
      stack += s + 12;
    }
    if (this.hint) {
      const f = Math.min(1, this.hint.life, (this.hint.max - this.hint.life) * 4);
      v.text(this.hint.text, W / 2, myy - (small ? 40 : 50), small ? 11 : 14, WHITE, 0.5, 0.85 * f);
    }
  }
}
