// What warns and what burns, and the bosses, mixed into View: pulsar build-ups and their lightning, mine and boss
// blasts, the boss's telegraphs (chevrons walking down the doomed lanes, the tide rising), and the bosses' pieces.
import { E, STEPS_PER_BEAT, TICKS_PER_BAR } from '../sim/data.js';
import { BOSS_SHAPES } from './shapes.js';
import { ROLE } from '../sim/bosses.js';

const WHITE = '#ffffff';
const tmpA = [0, 0];
const tmpB = [0, 0];
const tmpC = [0, 0];

export const hazardMethods = {
  drawHazards(scene) {
    const w = scene.w;
    const v = this.vec;
    const n = this.web.n;
    const calm = scene.calm;
    const tick = w.tick;
    // Pulsars: the build-up brightens their lane, then the lane burns for a beat.
    v.begin();
    let any = false;
    for (const e of w.enemies) {
      if (e.dead || e.type !== E.PULSAR) continue;
      const period = w.oc >= 5 ? TICKS_PER_BAR : TICKS_PER_BAR * 2;
      const phase = tick % period;
      const warn = period - phase;
      if (warn <= TICKS_PER_BAR / 2 && warn > 0) {
        const lane = Math.round(e.lane);
        const k = 1 - warn / (TICKS_PER_BAR / 2);
        this.laneEdges(lane, 0, Math.max(0, e.z), k);
        any = true;
      }
    }
    if (any) v.glow(WHITE, 1, 0.5);
    if (w.pulses.length) {
      v.begin();
      for (const p of w.pulses) this.lightning(p[0], scene.t, calm);
      v.glow(WHITE, 1.4, calm ? 0.6 : 0.95);
    }
    if (w.booms.length) {
      v.begin();
      for (const p of w.booms) this.laneFill(p[0], 0, 0.35);
      v.glow(WHITE, 1.3, 0.9);
    }
    // Boss telegraphs: chevrons walking down the doomed lanes toward the rim, brighter as the moment comes.
    if (w.boss && w.boss.tele.length) {
      for (const t of w.boss.tele) {
        const left = t.at - w.step;
        if (left > STEPS_PER_BEAT * 3) continue;
        const k = left > 0 ? 1 - left / (STEPS_PER_BEAT * 3) : 1;
        v.begin();
        for (const lane of t.lanes) {
          if (lane < 0 || lane >= n) continue;
          if (left <= 0) this.laneFill(lane, 0, t.kind === 'tide' ? 1 : 0.6);
          else if (t.kind === 'tide') this.tide(lane, k, scene.t);
          else this.chevrons(lane, k, calm ? 0 : scene.t, calm);
        }
        v.glow(WHITE, left <= 0 ? 1.4 : 1, left <= 0 ? 0.85 : 0.25 + 0.55 * k);
      }
    }
  },

  laneEdges(lane, z0, z1, k) {
    for (const j of [lane, lane + 1]) {
      this.B(j, z0, tmpA);
      this.B(j, z0 + (z1 - z0) * Math.max(0.1, k), tmpB);
      this.vec.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
    }
  },

  laneFill(lane, z0, z1) {
    for (const off of [0.2, 0.5, 0.8]) {
      this.P(lane - 0.5 + off, z0, tmpA);
      this.P(lane - 0.5 + off, z1, tmpB);
      this.vec.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
    }
  },

  lightning(lane, t, calm) {
    const v = this.vec;
    for (let i = 0; i <= 14; i++) {
      const z = i / 14;
      const wob = calm ? (i % 2 ? 0.22 : -0.22) : Math.sin(t * 11 + i * 2.1) * 0.3;
      this.P(lane + wob, z, tmpA);
      if (i === 0) v.move(tmpA[0], tmpA[1]);
      else v.to(tmpA[0], tmpA[1]);
    }
    this.laneEdges(lane, 0, 1, 1);
  },

  chevrons(lane, k, t, calm) {
    const v = this.vec;
    const off = calm ? 0 : (t * 1.5) % 0.25;
    for (let z = 0.75 - off; z > 0.04; z -= 0.25) {
      this.P(lane - 0.4, z + 0.06, tmpA);
      this.P(lane, z, tmpB);
      this.P(lane + 0.4, z + 0.06, tmpC);
      v.move(tmpA[0], tmpA[1]);
      v.to(tmpB[0], tmpB[1]);
      v.to(tmpC[0], tmpC[1]);
    }
  },

  tide(lane, k, t) {
    // Water rising: a wavy line at the crest, and the lane edges below it.
    const crest = 1 - k * 0.92;
    const v = this.vec;
    for (let i = 0; i <= 6; i++) {
      const u = lane - 0.5 + i / 6;
      this.P(u, crest + Math.sin(t * 8 + i + lane) * 0.02, tmpA);
      if (i === 0) v.move(tmpA[0], tmpA[1]);
      else v.to(tmpA[0], tmpA[1]);
    }
    for (const j of [lane, lane + 1]) {
      this.B(j, 1, tmpA);
      this.B(j, crest, tmpB);
      v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
    }
  },

  drawBoss(scene) {
    const w = scene.w;
    const v = this.vec;
    const boss = w.boss;
    const f = this.flat;
    const t = scene.t;
    const enter = boss.active ? 1 : Math.min(1, (w.step - boss.enterAt) / Math.max(1, boss.activeAt - boss.enterAt));
    const flash = !scene.calm && boss.parts.some((p) => !p.dead && p.flash > 0);
    // The core: a ring at the far end and a slowly turning star inside it.
    const core = boss.parts.find((p) => !p.dead && p.a === ROLE.CORE && boss.kind !== 'tide');
    if (core) {
      const z = 0.9 + (1 - enter) * 0.1;
      v.begin();
      const n = this.web.n;
      const bounds = this.web.closed ? n : n + 1;
      for (let j = 0; j < bounds; j++) {
        this.B(j, z, tmpA);
        if (j === 0) v.move(tmpA[0], tmpA[1]);
        else v.to(tmpA[0], tmpA[1]);
      }
      if (this.web.closed) {
        this.B(0, z, tmpA);
        v.to(tmpA[0], tmpA[1]);
      }
      // The star.
      const vx = this.vx();
      const vy = this.vy();
      const r = this.S * 0.12 * (0.6 + 0.4 * enter);
      const rot = scene.calm ? 0 : t * 0.6;
      const open = boss.kind !== 'conductor' || w.tick % TICKS_PER_BAR >= 8;
      const k = open ? 1 : 0.55;
      for (let i = 0; i <= 10; i++) {
        const ang = rot + (Math.PI * i) / 5;
        const rr = i % 2 ? r * 0.45 * k : r;
        if (i === 0) v.move(vx + Math.cos(ang) * rr, vy + Math.sin(ang) * rr);
        else v.to(vx + Math.cos(ang) * rr, vy + Math.sin(ang) * rr);
      }
      v.glow(flash ? WHITE : this.hue, 1.6, (open ? 1 : 0.5) * enter);
    }
    v.begin();
    for (const p of boss.parts) {
      if (p.dead || p.a === ROLE.CORE && boss.kind !== 'tide') continue;
      if (p.a === ROLE.SHIELD && p.c <= 0) continue;
      let u = p.lane;
      if (p.fs >= 0) {
        const k = Math.min(1, (w.step - p.fs + scene.alpha) / p.fl);
        u = p.from + (p.to - p.from) * k;
      }
      const z = p.z + (1 - enter) * 0.1;
      this.frame(u, z, f);
      if (p.a === ROLE.SEGMENT) this.strokes(BOSS_SHAPES.segment, f, 0.95, 0.95);
      else if (p.a === ROLE.SHIELD) this.strokes(BOSS_SHAPES.shield, f, 1, 1);
      else if (p.a === ROLE.MIRROR) {
        this.strokes(BOSS_SHAPES.pane, f, 0.9, 1.2);
        if (p.b === 0) this.strokes(BOSS_SHAPES.heart, f, 0.9, 0.9);
      } else this.strokes(BOSS_SHAPES.segment, f, 1.1, 1.1);
    }
    v.glow(flash ? WHITE : this.hue, 1.5, 0.95 * enter);
    v.thin(WHITE, 1, 0.6 * enter);
  },
};
