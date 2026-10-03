// Poster mode (?poster=thumb1 | thumb2 | thumb3 | thumb4 | icon | badge-<id>): a finished, deterministic scene from
// the game's own renderer, with no platform and no network, for the store art. Bots fly a seeded zone to a lively
// moment; the last few frames are drawn with the phosphor fade so trails and shards look the way they do in play.
// Sets window.__posterReady when the picture is done.
import { Vector } from './render/vector.js';
import { View } from './render/view.js';
import { Fx } from './render/fx.js';
import { SHAPE, SHIP_SHAPES } from './render/shapes.js';
import { World } from './sim/world.js';
import { WORLDS, MODS, E } from './sim/data.js';
import { MOD_ICONS, iconPath } from './ui/icons.js';
import { spawnEnemy } from './sim/enemies.js';

const WHITE = '#ffffff';

export async function runPoster(kind) {
  const canvas = document.getElementById('screen');
  const W = Math.max(64, innerWidth);
  const H = Math.max(64, innerHeight);
  const vec = new Vector(canvas);
  vec.quality = 'high';
  vec.resize(W, H, 1);
  try {
    await document.fonts?.ready;
  } catch {}
  try {
    if (kind === 'thumb1') thumb(vec, W, H, { world: 0, level: 3, shape: 'circle', seed: 41, ships: [0], mods: [{ pierce: 1 }], boss: true, burst: true });
    else if (kind === 'thumb2') thumb(vec, W, H, { world: 1, level: 2, shape: 'square', seed: 7, ships: [1], mods: [{}], chord: true });
    else if (kind === 'thumb3') thumb(vec, W, H, { world: 3, level: 2, shape: 'star', seed: 23, ships: [0, 3, 5], mods: [{}, {}, {}], spin: 2.2, burst: true });
    else if (kind === 'thumb4') draftPoster(vec, W, H);
    else if (kind === 'icon') icon(vec, W, H);
    else if (kind && kind.startsWith('badge-')) badge(vec, W, H, kind.slice(6));
    else thumb(vec, W, H, { world: 0, level: 1, shape: 'circle', seed: 3, ships: [0], mods: [{}] });
  } catch (err) {
    console.error(err);
  }
  window.__posterReady = true;
}

/**
 * A composed moment: the web, a wave placed lane by lane at every depth, the ships firing, shards from the last
 * kills. The world is the real simulation (stepped a few frames so flips and fuses move); only the cast is placed.
 */
function thumb(vec, W, H, o) {
  const def = WORLDS[o.world];
  const zone = { mode: 'run', world: o.world, level: o.level, shape: o.shape, bpm: def.bpm, seed: o.seed, oc: 1 };
  const players = o.ships.map((ship, i) => ({ id: `p${i}`, ship, mods: o.mods[i] || {}, kind: 'driven' }));
  const w = new World({ zone, players, carry: { lives: 3, score: 184260, mult: 6, res: 70 } });
  w.spawns = [];
  while (w.phase === 0) w.update();
  const fx = new Fx();
  const view = new View(vec, fx);
  view.setWeb(w.web, def.hue);
  view.layout(W, H, H * 0.04, H * 0.04);
  view.minSize = Math.max(8, H / 60);
  const n = w.n;
  const start = w.web.start;
  // The ships on the rim, near the bottom.
  o.ships.forEach((_, k) => {
    const ship = w.ships[k];
    ship.u = ship.pu = (start + [0, -2, 2][k] + n) % n;
    ship.in.target = ship.u;
    ship.in.fire = true;
    ship.inv = 0;
  });
  // The wave.
  const cast = o.cast || [
    [E.FLIPPER, 3, 0.82],
    [E.FLIPPER, 5, 0.55],
    [E.TANKER, 7, 0.7],
    [E.SPIKER, 9, 0.45],
    [E.FLIPPER, 11, 0.3],
    [E.FUSEBALL, 13, 0.62],
    [E.WEAVER, 2, 0.4],
    [E.FLIPPER, 14, 0.9],
    [E.GHOST, 6, 0.86],
    [E.FLIPPER, 1, 0.18],
    [E.PULSAR, 10, 0.75],
    [E.FLIPPER, 8, 0.95],
    [E.FLIPPER, 4, 0.97],
    [E.SHOT, start + 1, 0.22],
  ];
  for (const [type, lane, z] of cast) {
    const e = spawnEnemy(w, type, (start + lane) % n, { z });
    e.next = w.tick + 3 + (lane % 3);
  }
  w.spikes[(start + 9) % n] = 0.5;
  w.spikes[(start + 12) % n] = 0.32;
  const tints = o.ships.map((_, k) => [WHITE, '#ffd23d', '#ff5c8a'][k] || WHITE);
  // A few frames: bolts leave, things move, the phosphor builds.
  const frames = 22;
  for (let i = 0; i < frames; i++) {
    w.update();
    w.update();
    for (const ev of w.drain()) if (ev.k === 'kill') fx.shatter(shapeAt(view, ev.a, ev.lane, ev.z), def.hue, 140, 0.7);
    if (i === 8 && o.burst) {
      const p = view.P((start + 5) % n, 0.5, [0, 0]);
      fx.shatter(shapeAt(view, E.TANKER, (start + 5) % n, 0.5), def.hue, 160, 0.8);
      fx.ring(p[0], p[1], 6, 70, 0.6, WHITE, 20);
      fx.sparks(p[0], p[1], WHITE, 22, 240, 9);
    }
    fx.update(1 / 30);
    vec.frame(1 / 60, 1);
    view.draw({ w, alpha: 1, t: 1.2 + i / 30 + (o.spin || 0), me: 0, tints, calm: false, pulse: i > frames - 4 ? 0.9 : 0.3, od: false, shake: null, rim: 'plain', trails: [] });
    fx.draw(vec);
  }
  if (o.boss) {
    // The boss far away: a serpent's segments circling the end of the tunnel.
    const vx = view.cx + view.vp[0] * view.S;
    const vy = view.cy + view.vp[1] * view.S;
    const r = view.S * 0.12;
    vec.begin();
    for (let k = 0; k < 6; k++) {
      const a = -0.6 + k * 0.5;
      const x = vx + Math.cos(a) * r * 1.55;
      const y = vy + Math.sin(a) * r * 1.55;
      const rr = r * (0.44 - k * 0.035);
      for (let i = 0; i <= 6; i++) {
        const b = Math.PI / 6 + (Math.PI * 2 * i) / 6;
        if (i === 0) vec.move(x + Math.cos(b) * rr, y + Math.sin(b) * rr);
        else vec.to(x + Math.cos(b) * rr, y + Math.sin(b) * rr);
      }
    }
    vec.glow(def.hue, 2, 1);
    vec.thin(WHITE, 1.2, 0.7);
  }
  if (o.chord) {
    // A chord: three lanes at once, a triangle joining the kills, a burst at each.
    const lanes = [(start + 3) % n, (start + 8) % n, (start + 13) % n];
    const pts = lanes.map((l) => view.P(l, 0.45, [0, 0]));
    for (let k = 0; k < 3; k++) {
      fx.shatter(shapeAt(view, E.FLIPPER, lanes[k], 0.45), def.hue, 170, 0.7);
      fx.ring(pts[k][0], pts[k][1], 6, 52, 0.55, WHITE, 18);
      fx.sparks(pts[k][0], pts[k][1], WHITE, 20, 220, 9);
    }
    fx.update(0.1);
    vec.begin();
    vec.move(pts[0][0], pts[0][1]);
    vec.to(pts[1][0], pts[1][1]);
    vec.to(pts[2][0], pts[2][1]);
    vec.to(pts[0][0], pts[0][1]);
    vec.glow(WHITE, 1.8, 0.95);
    fx.draw(vec);
  }
}

function shapeAt(view, type, lane, z) {
  const f = view.frame(lane, z, {});
  const out = [];
  for (const st of SHAPE[type] || SHAPE[E.FLIPPER]) {
    for (let i = 0; i + 3 < st.length; i += 2) out.push(f.cx + st[i] * f.ax + st[i + 1] * f.dx, f.cy + st[i] * f.ay + st[i + 1] * f.dy, f.cx + st[i + 2] * f.ax + st[i + 3] * f.dx, f.cy + st[i + 2] * f.ay + st[i + 3] * f.dy);
  }
  return out;
}

/** The draft, as a poster: three mod cards in the stroke font over a dim web. */
function draftPoster(vec, W, H) {
  const hue = WORLDS[2].hue;
  const w = new World({ zone: { mode: 'run', world: 2, level: 1, shape: 'star', bpm: 116, seed: 9, oc: 0 }, players: [{ id: 'a', ship: 2, kind: 'bot' }] });
  const view = new View(vec, new Fx());
  view.setWeb(w.web, hue);
  view.layout(W, H, H * 0.05, H * 0.05);
  vec.frame(1, 0);
  view.draw({ w, alpha: 1, t: 0, me: -1, tints: [WHITE], calm: true, pulse: 0, od: false, shake: null, rim: 'plain', trails: [] });
  const c = vec.ctx;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = '#020403';
  c.globalAlpha = 0.72;
  c.fillRect(0, 0, W, H);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'lighter';
  vec.text('PICK ONE', W / 2, H * 0.14, H * 0.06, WHITE, 0.5, 1);
  const picks = ['chain', 'metronome', 'ricochet'];
  const cw = W * 0.24;
  const ch = H * 0.5;
  const gap = W * 0.03;
  const x0 = W / 2 - (3 * cw + 2 * gap) / 2;
  picks.forEach((k, i) => {
    const def = MODS.find((m) => m.key === k);
    const x = x0 + i * (cw + gap);
    const y = H * 0.28;
    const on = i === 1;
    const col = on ? WHITE : hue;
    const cc = 18;
    vec.begin();
    vec.move(x, y + cc);
    vec.to(x, y);
    vec.to(x + cc, y);
    vec.move(x + cw - cc, y);
    vec.to(x + cw, y);
    vec.to(x + cw, y + cc);
    vec.move(x + cw, y + ch - cc);
    vec.to(x + cw, y + ch);
    vec.to(x + cw - cc, y + ch);
    vec.move(x + cc, y + ch);
    vec.to(x, y + ch);
    vec.to(x, y + ch - cc);
    vec.glow(col, 2, 1);
    const size = ch * 0.34;
    vec.begin();
    iconPath(vec, MOD_ICONS[k], x + cw / 2 - size / 2, y + ch * 0.12, size);
    vec.glow(col, 2.4, 1);
    vec.text(def.name, x + cw / 2, y + ch * 0.62, Math.min(H * 0.05, cw / (def.name.length * 0.95)), col, 0.5, 1);
    vec.text(def.tag, x + cw / 2, y + ch * 0.8, Math.min(H * 0.024, cw / (def.tag.length * 0.92)), WHITE, 0.5, 0.75);
  });
}

/** The icon: a white ship on a mint ring of lanes. */
function icon(vec, W, H) {
  const hue = WORLDS[0].hue;
  vec.frame(1, 0);
  const cx = W / 2;
  const cy = H * 0.47;
  const R = W * 0.34;
  const r = W * 0.1;
  const n = 16;
  const at = (i, rad) => {
    const a = Math.PI / 2 + ((i - 0.5) * Math.PI * 2) / n;
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad];
  };
  vec.begin();
  for (let i = 0; i <= n; i++) {
    const p = at(i, R);
    if (i === 0) vec.move(p[0], p[1]);
    else vec.to(p[0], p[1]);
  }
  vec.glow(hue, W / 140, 1);
  vec.begin();
  for (let i = 0; i < n; i++) {
    const a = at(i, R);
    const b = at(i, r);
    vec.move(a[0], a[1]);
    vec.to(b[0], b[1]);
  }
  for (let i = 0; i <= n; i++) {
    const p = at(i, r);
    if (i === 0) vec.move(p[0], p[1]);
    else vec.to(p[0], p[1]);
  }
  vec.glow(hue, W / 280, 0.75);
  // The lit lane and its bolts.
  vec.begin();
  for (const side of [0, 1]) {
    const a = at(side, R);
    const b = at(side, r);
    vec.move(a[0], a[1]);
    vec.to(b[0], b[1]);
  }
  for (let k = 0; k < 3; k++) {
    const d = R * (0.74 - k * 0.2);
    vec.move(cx, cy + d);
    vec.to(cx, cy + d - R * 0.07);
  }
  vec.glow(WHITE, W / 200, 0.9);
  const s = W * 0.12;
  vec.begin();
  for (const st of SHIP_SHAPES[0]) {
    for (let i = 0; i < st.length; i += 2) {
      const x = cx + st[i] * s;
      const y = cy + R - st[i + 1] * s * 0.95 + s * 0.1;
      if (i === 0) vec.move(x, y);
      else vec.to(x, y);
    }
  }
  vec.glow(WHITE, W / 110, 1.2);
}

const BADGES = {
  'first-zone': ['#3dffb0', (v, c, s) => web(v, c, s, 12)],
  'perfect-bar': [
    '#3dffb0',
    (v, c, s) => {
      for (let i = 0; i < 5; i++) v.line(c - s, c - s * 0.5 + i * s * 0.25, c + s, c - s * 0.5 + i * s * 0.25);
      v.move(c - s * 0.35, c);
      v.to(c - s * 0.05, c + s * 0.35);
      v.to(c + s * 0.5, c - s * 0.45);
    },
  ],
  'chord-master': [
    '#ffb13d',
    (v, c, s) => {
      const p = [0, 1, 2].map((i) => [c + Math.cos(-Math.PI / 2 + (i * Math.PI * 2) / 3) * s * 0.8, c + Math.sin(-Math.PI / 2 + (i * Math.PI * 2) / 3) * s * 0.8]);
      v.move(p[0][0], p[0][1]);
      v.to(p[1][0], p[1][1]);
      v.to(p[2][0], p[2][1]);
      v.to(p[0][0], p[0][1]);
      for (const q of p) ring(v, q[0], q[1], s * 0.16, 10);
    },
  ],
  overdrive: [
    '#ffffff',
    (v, c, s) => {
      for (let i = 0; i < 8; i++) v.line(c - s + i * s * 0.26, c + s * 0.7, c - s + i * s * 0.26 + s * 0.16, c + s * 0.7);
      v.move(c + s * 0.15, c - s * 0.85);
      v.to(c - s * 0.3, c + s * 0.05);
      v.to(c + s * 0.15, c + s * 0.05);
      v.to(c - s * 0.2, c + s * 0.5);
    },
  ],
  'hydra-down': [
    '#3dffb0',
    (v, c, s) => {
      for (let k = 0; k < 4; k++) ring(v, c - s * 0.75 + k * s * 0.5, c + Math.sin(k * 1.4) * s * 0.3, s * 0.24, 6);
      v.line(c - s, c + s * 0.85, c + s, c - s * 0.85);
    },
  ],
  'conductor-down': [
    '#8fe3ff',
    (v, c, s) => {
      star(v, c, c - s * 0.15, s * 0.55, 5);
      v.line(c - s * 0.9, c + s * 0.9, c + s * 0.1, c - s * 0.1);
    },
  ],
  'maestro-down': [
    '#ff5c8a',
    (v, c, s) => {
      ring(v, c, c, s * 0.95, 32);
      star(v, c, c, s * 0.6, 8);
      ring(v, c, c, s * 0.22, 12);
    },
  ],
  flawless: [
    '#ffffff',
    (v, c, s) => {
      v.move(c, c - s);
      v.to(c + s * 0.7, c);
      v.to(c, c + s);
      v.to(c - s * 0.7, c);
      v.to(c, c - s);
      v.move(c, c - s * 0.45);
      v.to(c + s * 0.3, c);
      v.to(c, c + s * 0.45);
      v.to(c - s * 0.3, c);
      v.to(c, c - s * 0.45);
    },
  ],
  tethered: [
    '#b6ff3d',
    (v, c, s) => {
      tri(v, c - s * 0.7, c + s * 0.35, s * 0.32);
      tri(v, c + s * 0.7, c + s * 0.35, s * 0.32);
      v.move(c - s * 0.45, c - s * 0.05);
      for (let i = 1; i <= 6; i++) v.to(c - s * 0.45 + i * s * 0.15, c - s * 0.05 + (i % 2 ? -1 : 1) * s * 0.16);
    },
  ],
  'overclock-4': [
    '#ff4a2b',
    (v, c, s) => {
      for (let i = 0; i <= 20; i++) {
        const a = Math.PI * 0.75 + (Math.PI * 1.5 * i) / 20;
        if (i === 0) v.move(c + Math.cos(a) * s * 0.9, c + Math.sin(a) * s * 0.9);
        else v.to(c + Math.cos(a) * s * 0.9, c + Math.sin(a) * s * 0.9);
      }
      for (let k = 0; k < 4; k++) {
        const a = Math.PI * 0.75 + (Math.PI * 1.5 * (k + 1)) / 5;
        v.line(c + Math.cos(a) * s * 0.65, c + Math.sin(a) * s * 0.65, c + Math.cos(a) * s * 0.9, c + Math.sin(a) * s * 0.9);
      }
      v.line(c, c, c + s * 0.55, c - s * 0.35);
    },
  ],
  'daily-run': [
    '#ffd23d',
    (v, c, s) => {
      ring(v, c, c, s * 0.42, 16);
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI * 2 * k) / 8;
        v.line(c + Math.cos(a) * s * 0.6, c + Math.sin(a) * s * 0.6, c + Math.cos(a) * s * 0.9, c + Math.sin(a) * s * 0.9);
      }
    },
  ],
  'deep-descent': [
    '#5cb8ff',
    (v, c, s) => {
      for (let k = 0; k < 4; k++) ring(v, c, c, s * (0.95 - k * 0.22), 6, Math.PI / 6);
      v.line(c, c - s * 0.5, c, c + s * 0.35);
      v.move(c - s * 0.2, c + s * 0.15);
      v.to(c, c + s * 0.35);
      v.to(c + s * 0.2, c + s * 0.15);
    },
  ],
};
export const BADGE_IDS = Object.keys(BADGES);

function ring(v, x, y, r, n, rot = 0) {
  for (let i = 0; i <= n; i++) {
    const a = rot + (Math.PI * 2 * i) / n;
    if (i === 0) v.move(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else v.to(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
}
function star(v, x, y, r, points) {
  for (let i = 0; i <= points * 2; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / points;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) v.move(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else v.to(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
}
function tri(v, x, y, s) {
  v.move(x - s, y - s * 0.3);
  v.to(x + s, y - s * 0.3);
  v.to(x, y + s * 0.8);
  v.to(x - s, y - s * 0.3);
}
function web(v, c, s, n) {
  ring(v, c, c, s, n, Math.PI / 2 - Math.PI / n);
  ring(v, c, c, s * 0.3, n, Math.PI / 2 - Math.PI / n);
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 - Math.PI / n + (Math.PI * 2 * i) / n;
    v.line(c + Math.cos(a) * s, c + Math.sin(a) * s, c + Math.cos(a) * s * 0.3, c + Math.sin(a) * s * 0.3);
  }
  tri(v, c, c + s * 0.9, s * 0.18);
}

function badge(vec, W, H, id) {
  const [hue, draw] = BADGES[id] || BADGES['first-zone'];
  vec.frame(1, 0);
  const c = W / 2;
  vec.begin();
  ring(vec, c, c, W * 0.44, 48);
  vec.glow(hue, W / 140, 0.55);
  vec.begin();
  draw(vec, c, W * 0.27);
  vec.glow(hue, W / 75, 1.15);
}
