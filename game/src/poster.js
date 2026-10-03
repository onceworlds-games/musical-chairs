// Poster mode (?poster=thumb1 | thumb2 | thumb3 | thumb4 | icon | badge-<id>): a finished, deterministic scene from
// the game's own renderer, with no platform and no network, for the store art. Bots fly a seeded zone to a lively
// moment; the last few frames are drawn with the phosphor fade so trails and shards look the way they do in play.
// Sets window.__posterReady when the picture is done.
import { Vector, tone } from './render/vector.js';
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
    if (kind === 'thumb1') thumb(vec, W, H, COVER);
    else if (kind === 'thumb2') thumb(vec, W, H, CHORD);
    else if (kind === 'thumb3') thumb(vec, W, H, TOGETHER);
    else if (kind === 'thumb4') draftPoster(vec, W, H);
    else if (kind === 'icon') icon(vec, W, H);
    else if (kind && kind.startsWith('badge-')) badge(vec, W, H, kind.slice(6));
    else thumb(vec, W, H, COVER);
  } catch (err) {
    console.error(err);
  }
  window.__posterReady = true;
}

// The scenes: [type, lane offset from the start lane, depth]. Bursts are kills caught mid-explosion.
const COVER = {
  world: 0,
  shape: 'circle',
  ships: [0],
  stretch: 1.75,
  boss: true,
  rings: [0.07, 0.15, 0.25, 0.37, 0.5, 0.65, 0.82],
  trails: true,
  bloom: true,
  title: true,
  cast: [
    [E.FLIPPER, 2, 0],
    [E.FLIPPER, -3, 0.15],
    [E.WEAVER, 5, 0.22],
    [E.FLIPPER, -6, 0.1],
    [E.FLIPPER, 8, 0.12],
    [E.FLIPPER, 4, 0.34],
    [E.FLIPPER, -2, 0.4],
    [E.FLIPPER, 7, 0.46],
    [E.TANKER, -5, 0.52],
    [E.FUSEBALL, 1, 0.44],
    [E.SPIKER, -8, 0.36],
    [E.GHOST, 6, 0.3],
    [E.FLIPPER, -7, 0.6],
    [E.FLIPPER, 3, 0.62],
    [E.PULSAR, -1, 0.7],
    [E.TANKER, 5, 0.68],
    [E.BOMBER, 9, 0.78],
    [E.FLIPPER, -4, 0.74],
    [E.FLIPPER, 0, 0.82],
    [E.SIREN, 11, 0.58],
    [E.SIREN, 13, 0.58],
    [E.SIREN, 15, 0.58],
    [E.SHOT, 5, 0.26],
  ],
  pulses: [-1],
  spikes: [[-8, 0.42], [10, 0.3]],
  bolts: [[0, 0.07], [0, 0.19], [0, 0.31], [0, 0.43], [0, 0.55], [1, 0.14], [-1, 0.14]],
  chord: [-6, 5, 1],
  chordDepths: [0.34, 0.4, 0.62],
  header: 0.13,
};
const CHORD = {
  world: 1,
  shape: 'square',
  ships: [1],
  stretch: 1.75,
  rings: [0.1, 0.22, 0.36, 0.52, 0.7],
  trails: true,
  bloom: true,
  cast: [
    [E.FLIPPER, -2, 0.22],
    [E.WEAVER, 3, 0.3],
    [E.FUSEBALL, 6, 0.55],
    [E.FLIPPER, -6, 0.6],
    [E.TANKER, 1, 0.66],
    [E.FLIPPER, 8, 0.2],
    [E.SPIKER, -8, 0.5],
    [E.FLIPPER, -9, 0.12],
    [E.FLIPPER, 11, 0.4],
    [E.FLIPPER, 4, 0.78],
  ],
  spikes: [[-8, 0.42]],
  bolts: [[-1, 0.12], [0, 0.12], [1, 0.12], [-1, 0.3], [0, 0.3], [1, 0.3]],
  chord: [-4, 0, 4],
};
const TOGETHER = {
  world: 3,
  shape: 'heptagon',
  ships: [0, 5],
  shipLanes: [-1, 1],
  stretch: 1.55,
  t0: 0,
  header: 0.025,
  rings: [0.1, 0.2, 0.32, 0.46, 0.62, 0.8],
  trails: true,
  bloom: true,
  cast: [
    [E.FLIPPER, 5, 0.3],
    [E.WEAVER, -5, 0.22],
    [E.BOMBER, -6, 0.8],
    [E.MINE, -7, 0.4],
    [E.TANKER, 7, 0.55],
    [E.GHOST, -9, 0.36],
    [E.PULSAR, 9, 0.62],
    [E.FLIPPER, 10, 0.7],
    [E.FLIPPER, -3, 0.5],
    [E.FLIPPER, 4, 0.76],
    [E.FUSEBALL, 0, 0.58],
    [E.FLIPPER, -11, 0.28],
    [E.SIREN, 12, 0.5],
    [E.SIREN, 14, 0.5],
    [E.FLIPPER, 14, 0.2],
  ],
  pulses: [9],
  bolts: [[-1, 0.15], [-1, 0.35], [1, 0.22], [1, 0.42], [1, 0.6]],
  chord: [-5, 5, 9],
  chordDepths: [0.4, 0.34, 0.5],
  tether: true,
};

/**
 * A composed moment: the real simulation's web and enemies, placed lane by lane, stepped a few frames so flips and
 * fuses move and the phosphor builds; the ships firing; shards from kills caught mid-explosion.
 */
function thumb(vec, W, H, o) {
  const def = WORLDS[o.world];
  const zone = { mode: 'run', world: o.world, level: 2, shape: o.shape, bpm: def.bpm, seed: 11, oc: 1 };
  const players = o.ships.map((ship, i) => ({ id: `p${i}`, ship, mods: {}, kind: 'driven' }));
  const w = new World({ zone, players, carry: { lives: 3, score: 184260, mult: 6, res: 70 } });
  w.spawns = [];
  while (w.phase === 0) w.update();
  const fx = new Fx();
  const view = new View(vec, fx);
  if (o.stretch) view.maxStretch = o.stretch;
  view.setWeb(w.web, def.hue, false);
  view.layout(W, H, H * (o.header || 0.03), H * 0.05);
  view.minSize = Math.max(9, H / 55);
  const n = w.n;
  const at = (off) => (((w.web.start + off) % n) + n) % n;
  o.ships.forEach((_, k) => {
    const ship = w.ships[k];
    ship.u = ship.pu = at(o.shipLanes ? o.shipLanes[k] : 0);
    ship.in.target = ship.u;
    ship.in.fire = false;
    ship.inv = 0;
  });
  for (const [type, off, z] of o.cast) {
    const e = spawnEnemy(w, type, at(off), { z });
    e.next = Infinity; // hold the pose
    if (z === 0) e.st = 1;
  }
  for (const [off, h] of o.spikes || []) w.spikes[at(off)] = h;
  for (const off of o.pulses || []) w.pulses.push([at(off), w.step + 60]);
  const tints = o.ships.map((_, k) => [WHITE, '#ffd23d', '#ff5c8a'][k] || WHITE);
  // Bolts in flight, placed where the picture wants them.
  const placeBolts = () => {
    w.bolts.length = 0;
    for (const [off, z] of o.bolts || []) {
      const ship = w.ships[0];
      const b = w.spawnBolt(ship, at(off), { dmg: 0, speed: 0 });
      if (b) (b.z = z), (b.pz = z - 0.02);
    }
  };
  const frames = 16;
  for (let i = 0; i < frames; i++) {
    w.update();
    placeBolts();
    if (i === frames - 6) {
      for (const [type, off, z] of o.bursts || []) {
        const p = view.P(at(off), z, [0, 0]);
        fx.shatter(shapeAt(view, type, at(off), z), def.hue, 150, 0.9);
        fx.ring(p[0], p[1], 4, H * 0.09, 0.7, WHITE, 20);
        fx.sparks(p[0], p[1], WHITE, 26, H * 0.4, H / 70);
      }
    }
    fx.update(1 / 40);
    vec.frame(1 / 60, 1);
    if (i === frames - 1 && o.rings) tunnelLight(vec, view, def.hue);
    view.draw({ w, alpha: 1, t: (o.t0 ?? 1.4) + i / 40, me: 0, tints, calm: false, pulse: i > frames - 3 ? 1 : 0.4, od: false, shake: null, rim: 'plain', trails: [], rings: i === frames - 1 ? o.rings : null });
    fx.draw(vec);
  }
  if (o.trails) {
    // Streaks behind everything that climbs: where it was a moment ago, fading toward the far end.
    for (const [type, off, z] of o.cast) {
      if (z < 0.08 || type === E.SPIKER || type === E.MINE) continue;
      streak(vec, view, at(off), z, 0.1 + 0.18 * (1 - z), def.hue, type === E.SHOT ? WHITE : null);
    }
    for (const [off, z] of o.bolts || []) streak(vec, view, at(off), z, 0.13, WHITE, WHITE, 1.6);
  }
  if (o.boss) hydra(vec, view, def.hue);
  if (o.chord) {
    // A chord: three lanes at once, a triangle joining the kills, a burst at each.
    const zs = o.chordDepths || [0.34, 0.34, 0.34];
    const lanes = o.chord.map(at);
    const pts = lanes.map((l, k) => view.P(l, zs[k], [0, 0]));
    for (let k = 0; k < 3; k++) {
      const z = zs[k];
      fx.shatter(shapeAt(view, E.FLIPPER, lanes[k], z), def.hue, 190, 0.8);
      fx.ring(pts[k][0], pts[k][1], 6, H * 0.08, 0.6, WHITE, 18);
      fx.ring(pts[k][0], pts[k][1], 3, H * 0.14, 0.9, def.hue, 18);
      fx.sparks(pts[k][0], pts[k][1], WHITE, 34, H * 0.4, H / 60);
    }
    fx.update(0.1);
    vec.begin();
    vec.move(pts[0][0], pts[0][1]);
    vec.to(pts[1][0], pts[1][1]);
    vec.to(pts[2][0], pts[2][1]);
    vec.to(pts[0][0], pts[0][1]);
    vec.glow(WHITE, 1.5, 0.9);
    fx.draw(vec);
    for (const p of pts) rays(vec, p[0], p[1], H * 0.11, 14, 3);
  }
  if (o.title) title(vec, W, H, def.hue);
  if (o.bloom) bloom(vec, W, H);
  if (o.vignette !== false) vignette(vec, W, H);
}

/** The light at the far end of the tunnel: a soft pool the lanes run into. */
function tunnelLight(vec, view, hue) {
  const c = vec.ctx;
  const x = view.vx();
  const y = view.vy();
  const r = view.S * 0.62;
  const t = tone(hue).rgb;
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.translate(x, y);
  c.scale(view.Sx / view.S, view.Sy / view.S);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, `rgba(${t[0]},${t[1]},${t[2]},0.11)`);
  g.addColorStop(0.5, `rgba(${t[0]},${t[1]},${t[2]},0.04)`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(-r, -r, r * 2, r * 2);
  c.restore();
}

/** A line from where a thing is to where it was a moment ago (further down the lane), fading out. */
function streak(vec, view, lane, z, len, hue, core = null, width = 1.1) {
  const a = [0, 0];
  const b = [0, 0];
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const z0 = z + (len * i) / steps;
    const z1 = z + (len * (i + 1)) / steps;
    if (z1 >= 1) break;
    view.P(lane, z0, a);
    view.P(lane, z1, b);
    vec.begin();
    vec.line(a[0], a[1], b[0], b[1]);
    vec.thin(core || hue, width, 0.5 * (1 - i / steps));
  }
}

/** Rays from a point: a burst's glints. */
function rays(vec, x, y, r, count, seed) {
  vec.begin();
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + seed * 0.7 + Math.sin(i * 12.9898 + seed) * 0.15;
    const r0 = r * (0.25 + 0.15 * Math.abs(Math.sin(i * 3.1 + seed)));
    const r1 = r * (0.7 + 0.5 * Math.abs(Math.sin(i * 7.7 + seed)));
    vec.line(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1);
  }
  vec.glow(WHITE, 1.3, 1);
}

/** The Hydra a long way down the tunnel: a serpent's segments circling the far end. */
function hydra(vec, view, hue) {
  const vx = view.vx();
  const vy = view.vy();
  const r = view.S * 0.13;
  vec.begin();
  for (let k = 0; k < 7; k++) {
    const a = -2.7 + k * 0.5;
    const x = vx + Math.cos(a) * r * 1.5 * (view.Sx / view.S);
    const y = vy + Math.sin(a) * r * 1.5 * (view.Sy / view.S);
    const rr = r * (0.48 - k * 0.035);
    for (let i = 0; i <= 6; i++) {
      const b = Math.PI / 6 + (Math.PI * 2 * i) / 6;
      if (i === 0) vec.move(x + Math.cos(b) * rr, y + Math.sin(b) * rr);
      else vec.to(x + Math.cos(b) * rr, y + Math.sin(b) * rr);
    }
  }
  vec.glow(hue, 2.4, 1.1);
  vec.thin(WHITE, 1.4, 0.85);
  // Its eye: the white-hot head.
  const hx = vx + Math.cos(-2.7) * r * 1.5 * (view.Sx / view.S);
  const hy = vy + Math.sin(-2.7) * r * 1.5 * (view.Sy / view.S);
  vec.dot(hx, hy, r * 0.5, WHITE, 0.6);
}

/** The title word in the stroke font, across the top. */
function title(vec, W, H, hue) {
  const size = H * 0.092;
  vec.text('RIMSHOT', W / 2, H * 0.03, size, hue, 0.5, 1, 0.8);
  vec.text('RIMSHOT', W / 2 + 1, H * 0.03 + 1, size, WHITE, 0.5, 0.6, 0.25);
}

/** A glow that spreads: the picture blurred and laid back over itself, twice, so every line has a halo. */
function bloom(vec, W, H) {
  const c = vec.ctx;
  const cv = vec.canvas;
  const copy = document.createElement('canvas');
  copy.width = cv.width;
  copy.height = cv.height;
  copy.getContext('2d').drawImage(cv, 0, 0);
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'lighter';
  for (const [blur, alpha] of [[H * 0.022, 0.8], [H * 0.006, 0.55]]) {
    c.filter = `blur(${blur}px)`;
    c.globalAlpha = alpha;
    c.drawImage(copy, 0, 0);
  }
  c.restore();
  c.filter = 'none';
  c.globalAlpha = 1;
}

/** The corners fall into the dark, so the eye stays in the tunnel. */
function vignette(vec, W, H) {
  const c = vec.ctx;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  const g = c.createRadialGradient(vec.canvas.width / 2, vec.canvas.height / 2, Math.min(W, H) * 0.35, vec.canvas.width / 2, vec.canvas.height / 2, Math.hypot(W, H) * 0.62);
  g.addColorStop(0, 'rgba(2,4,3,0)');
  g.addColorStop(1, 'rgba(2,4,3,0.72)');
  c.fillStyle = g;
  c.fillRect(0, 0, vec.canvas.width, vec.canvas.height);
  c.restore();
}

function shapeAt(view, type, lane, z) {
  const f = view.frame(lane, z, {});
  const out = [];
  for (const st of SHAPE[type] || SHAPE[E.FLIPPER]) {
    for (let i = 0; i + 3 < st.length; i += 2) out.push(f.cx + st[i] * f.ax + st[i + 1] * f.dx, f.cy + st[i] * f.ay + st[i + 1] * f.dy, f.cx + st[i + 2] * f.ax + st[i + 3] * f.dx, f.cy + st[i + 2] * f.ay + st[i + 3] * f.dy);
  }
  return out;
}

/** The draft, as it is in the game: three mods coming up three lanes of the next world's ring. */
function draftPoster(vec, W, H) {
  const hue = WORLDS[2].hue;
  const w = new World({ zone: { mode: 'run', world: 2, level: 1, shape: 'circle', bpm: 116, seed: 9, oc: 0 }, players: [{ id: 'a', ship: 0, kind: 'driven' }] });
  w.spawns = [];
  const view = new View(vec, new Fx());
  view.maxStretch = 1.55;
  view.setWeb(w.web, hue, false);
  view.layout(W, H, H * 0.03, H * 0.03);
  vec.frame(1, 0);
  tunnelLight(vec, view, hue);
  view.draw({ w, alpha: 1, t: 0.3, me: 0, tints: [WHITE], calm: true, pulse: 0.6, od: false, shake: null, rim: 'plain', trails: [], rings: [0.1, 0.2, 0.32, 0.46, 0.62, 0.8] });
  const cx = view.vx();
  const cy = view.vy();
  const R = view.S;
  const c = vec.ctx;
  c.globalCompositeOperation = 'source-over';
  c.save();
  c.translate(cx, cy);
  c.scale(view.Sx / view.S, view.Sy / view.S);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.8);
  g.addColorStop(0, 'rgba(2,4,3,0.9)');
  g.addColorStop(1, 'rgba(2,4,3,0)');
  c.fillStyle = g;
  c.fillRect(-R, -R, R * 2, R * 2);
  c.restore();
  c.globalCompositeOperation = 'lighter';
  vec.text('PICK ONE', cx, cy - R * 0.62, R * 0.17, WHITE, 0.5, 1, 1.1);
  const picks = [['chain', -4], ['metronome', 0], ['ricochet', 4]];
  const f = {};
  for (const [k, off] of picks) {
    const def = MODS.find((m) => m.key === k);
    const lane = (w.web.start + off + w.n) % w.n;
    const on = k === 'metronome';
    view.frame(lane, 0.44, f);
    vec.begin();
    for (const j of [lane, lane + 1]) {
      const a = view.B(j, 0, [0, 0]);
      const b = view.B(j, 1, [0, 0]);
      vec.line(a[0], a[1], b[0], b[1]);
    }
    vec.glow(on ? WHITE : hue, 1.4, on ? 0.9 : 0.45);
    const size = R * 0.4;
    vec.begin();
    iconPath(vec, MOD_ICONS[k], f.cx - size / 2, f.cy - size / 2, size);
    vec.glow(on ? WHITE : hue, 3.4, 1);
    vec.text(def.name, f.cx, f.cy - size / 2 - R * 0.07 - 12, R * 0.07, on ? WHITE : hue, 0.5, 1);
  }
  // The ship on the rim, the three notes it will play.
  const ship = view.frame(w.web.start, 0, {});
  vec.begin();
  view.strokes(SHIP_SHAPES[0], { ...ship, cx: ship.cx - ship.dx * 0.06, cy: ship.cy - ship.dy * 0.06 }, 1, 1.05);
  vec.glow(WHITE, 2.2, 1.1);
  bloom(vec, W, H);
  vignette(vec, W, H);
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
  vec.glow(hue, W / 90, 1.1);
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
  vec.glow(hue, W / 170, 0.85);
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
  vec.glow(WHITE, W / 130, 1);
  const s = W * 0.13;
  vec.begin();
  for (const st of SHIP_SHAPES[0]) {
    for (let i = 0; i < st.length; i += 2) {
      const x = cx + st[i] * s;
      const y = cy + R - st[i + 1] * s * 0.95 + s * 0.1;
      if (i === 0) vec.move(x, y);
      else vec.to(x, y);
    }
  }
  vec.glow(WHITE, W / 70, 1.25);
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
