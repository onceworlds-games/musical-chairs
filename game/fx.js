// Juice: a pool of particles, floating numbers, camera shake as decaying trauma, and a short freeze for the biggest hits.
// Positions are in room units (the camera turns them into pixels). Nothing here touches window or onceworlds.

import { INK, clamp, ease, label, starPath, noteShape } from './gfx.js';

const MAX = 320;
export const CONFETTI = ['#ff4757', '#ffc312', '#2ed573', '#2f9bff', '#a55eea', '#ff6bb5', '#1dd1c1', '#ff7f32'];

export class Fx {
  constructor() {
    this.p = Array.from({ length: MAX }, () => ({ on: false, kind: 'dot', x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0, life: 0, max: 1, size: 0.1, rot: 0, vr: 0, color: '#fff', grow: 0 }));
    this.cursor = 0;
    this.floaters = [];
    this.trauma = 0;
    this.freeze = 0;
    this.time = 0;
    this.quality = 1; // 1, 0.7 or 0.4 from the platform's graphics setting
    this.reduced = false; // the player wants less motion
  }

  setQuality(q, reduced) {
    this.quality = q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1;
    this.reduced = Boolean(reduced);
  }

  /** How many of `n` particles to make at the current settings. */
  count(n) {
    return Math.max(n > 0 ? 1 : 0, Math.round(n * this.quality * (this.reduced ? 0.5 : 1)));
  }

  spawn(kind, x, y, o = {}) {
    for (let k = 0; k < MAX; k++) {
      const q = this.p[(this.cursor + k) % MAX];
      if (q.on) continue;
      this.cursor = (this.cursor + k + 1) % MAX;
      q.on = true;
      q.kind = kind;
      q.x = x;
      q.y = y;
      q.vx = o.vx || 0;
      q.vy = o.vy || 0;
      q.g = o.g || 0;
      q.drag = o.drag || 0;
      q.life = 0;
      q.max = o.life || 0.8;
      q.size = o.size || 0.12;
      q.rot = o.rot || 0;
      q.vr = o.vr || 0;
      q.color = o.color || '#fff';
      q.grow = o.grow || 0;
      return q;
    }
    return null;
  }

  confetti(x, y, n = 24, spread = 1, up = 1) {
    const c = this.count(n);
    const calm = this.reduced ? 0.6 : 1;
    for (let i = 0; i < c; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4 * spread;
      const sp = (2 + Math.random() * 5) * up * calm;
      this.spawn('conf', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 7, drag: 1.2, life: 1.4 + Math.random() * 0.9, size: 0.1 + Math.random() * 0.08, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14, color: CONFETTI[(Math.random() * CONFETTI.length) | 0] });
    }
  }

  /** Confetti raining over the whole room (a win). */
  rain(w, n = 6) {
    const c = this.count(n);
    for (let i = 0; i < c; i++) {
      this.spawn('conf', Math.random() * w, -0.6, { vx: (Math.random() - 0.5) * 1.5, vy: 1 + Math.random() * 2, g: 1.2, drag: 0.5, life: 3.2, size: 0.1 + Math.random() * 0.08, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 9, color: CONFETTI[(Math.random() * CONFETTI.length) | 0] });
    }
  }

  puff(x, y, n = 6, size = 0.28) {
    const c = this.count(n);
    for (let i = 0; i < c; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.8 + Math.random() * 1.6;
      this.spawn('puff', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - 0.2, drag: 3, life: 0.45 + Math.random() * 0.25, size: size * (0.7 + Math.random() * 0.6), color: 'rgba(255,255,255,0.85)', grow: 1.6 });
    }
  }

  dust(x, y, vx, vy) {
    if (this.reduced && Math.random() < 0.6) return;
    this.spawn('puff', x, y, { vx: -vx * 0.15 + (Math.random() - 0.5) * 0.6, vy: -vy * 0.15 - 0.2, drag: 3, life: 0.35, size: 0.16, color: 'rgba(255,240,220,0.7)', grow: 1.4 });
  }

  sparks(x, y, n = 8, color = '#fff6a0') {
    const c = this.count(n);
    for (let i = 0; i < c; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2.5 + Math.random() * 4;
      this.spawn('spark', x, y, { vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 4, life: 0.3 + Math.random() * 0.2, size: 0.1 + Math.random() * 0.1, rot: a, color });
    }
  }

  note(x, y, color) {
    this.spawn('note', x, y, { vx: (Math.random() - 0.3) * 0.9, vy: -1.3 - Math.random() * 0.6, life: 1.7, size: 0.22, color, rot: (Math.random() - 0.5) * 0.4 });
  }

  floater(text, x, y, color = '#fff', size = 22) {
    if (this.floaters.length > 24) this.floaters.shift();
    this.floaters.push({ text, x, y, color, size, age: 0, life: 1.1 });
  }

  addShake(amount) {
    if (this.reduced) return;
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  hitStop(seconds) {
    if (this.reduced) return;
    this.freeze = Math.max(this.freeze, seconds);
  }

  /** The camera's shake in pixels: smooth sines scaled by trauma squared, never random jitter. */
  shakeOffset(max) {
    const t = this.trauma * this.trauma;
    if (t < 0.0005) return [0, 0];
    return [Math.sin(this.time * 43 + 1.3) * max * t, Math.sin(this.time * 57 + 4.1) * max * t];
  }

  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - 1.7 * dt);
    if (this.freeze > 0) this.freeze = Math.max(0, this.freeze - dt);
    for (let i = 0; i < MAX; i++) {
      const q = this.p[i];
      if (!q.on) continue;
      q.life += dt;
      if (q.life >= q.max) {
        q.on = false;
        continue;
      }
      if (q.drag) {
        const d = Math.exp(-q.drag * dt);
        q.vx *= d;
        q.vy *= d;
      }
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.rot += q.vr * dt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.age += dt;
      if (f.age >= f.life) this.floaters.splice(i, 1);
    }
  }

  draw(ctx, cam) {
    const s = cam.s;
    for (let i = 0; i < MAX; i++) {
      const q = this.p[i];
      if (!q.on) continue;
      const t = q.life / q.max;
      const px = cam.ox + q.x * s;
      const py = cam.oy + q.y * s;
      switch (q.kind) {
        case 'conf': {
          ctx.save();
          ctx.globalAlpha = t > 0.8 ? (1 - t) / 0.2 : 1;
          ctx.translate(px, py);
          ctx.rotate(q.rot);
          ctx.scale(1, Math.abs(Math.cos(q.rot * 1.7 + i)) * 0.8 + 0.2);
          ctx.fillStyle = q.color;
          ctx.fillRect(-q.size * s, -q.size * s * 0.55, q.size * s * 2, q.size * s * 1.1);
          ctx.restore();
          break;
        }
        case 'puff': {
          ctx.globalAlpha = (1 - t) * 0.9;
          ctx.fillStyle = q.color;
          ctx.beginPath();
          ctx.arc(px, py, q.size * s * (1 + q.grow * t), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          break;
        }
        case 'spark': {
          ctx.save();
          ctx.globalAlpha = 1 - t;
          ctx.translate(px, py);
          ctx.rotate(q.rot);
          ctx.fillStyle = q.color;
          ctx.fillRect(-q.size * s * 1.6, -q.size * s * 0.3, q.size * s * 3.2, q.size * s * 0.6);
          ctx.restore();
          break;
        }
        case 'note': {
          ctx.save();
          ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
          ctx.translate(px, py);
          ctx.rotate(q.rot + Math.sin(q.life * 4) * 0.2);
          noteShape(ctx, 0, 0, q.size * s * ease.outBack(Math.min(1, t * 5)), q.color);
          ctx.restore();
          break;
        }
        case 'star': {
          ctx.save();
          ctx.globalAlpha = 1 - t;
          starPath(ctx, px, py, q.size * s * (1 + t), 5, 0.45, q.rot);
          ctx.fillStyle = q.color;
          ctx.fill();
          ctx.lineWidth = Math.max(1.5, s * 0.04);
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.restore();
          break;
        }
        default: {
          ctx.globalAlpha = 1 - t;
          ctx.fillStyle = q.color;
          ctx.beginPath();
          ctx.arc(px, py, q.size * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
    for (const f of this.floaters) {
      const t = f.age / f.life;
      const y = cam.oy + f.y * s - ease.outCubic(t) * s * 1.4;
      const sc = t < 0.15 ? ease.outBack(t / 0.15) : 1;
      label(ctx, f.text, cam.ox + f.x * s, y, f.size * sc, { fill: f.color, alpha: t > 0.7 ? (1 - t) / 0.3 : 1 });
    }
  }
}
