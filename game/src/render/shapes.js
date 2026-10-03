// Vector silhouettes in a lane's local frame: x runs across the lane (-1 at its left edge, 1 at its right), y runs
// down the tunnel (0 at the object's depth, + toward the far end). Every enemy has its own outline so nothing is told
// apart by colour alone. Strokes are flat arrays [x0, y0, x1, y1, ...].
import { E } from '../sim/data.js';

const TAU = Math.PI * 2;

function ring(n, r, rot = 0, sx = 1, sy = 1) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = rot + (TAU * i) / n;
    out.push(Math.cos(a) * r * sx, Math.sin(a) * r * sy);
  }
  return out;
}

export const SHAPE = {
  [E.FLIPPER]: [[-0.9, -0.42, -0.9, 0.42, 0.9, -0.42, 0.9, 0.42, -0.9, -0.42]],
  [E.TANKER]: [
    [-0.78, -0.62, 0.78, -0.62, 0.78, 0.62, -0.78, 0.62, -0.78, -0.62],
    [0, -0.42, 0.46, 0, 0, 0.42, -0.46, 0, 0, -0.42],
  ],
  [E.SPIKER]: [
    (() => {
      const out = [];
      for (let i = 0; i <= 26; i++) {
        const t = i / 26;
        const a = t * TAU * 2.2;
        const r = 0.12 + 0.72 * t;
        out.push(Math.cos(a) * r, Math.sin(a) * r * 0.85);
      }
      return out;
    })(),
  ],
  [E.PULSAR]: [[-0.92, 0, -0.62, -0.5, -0.31, 0.5, 0, -0.5, 0.31, 0.5, 0.62, -0.5, 0.92, 0]],
  [E.GHOST]: [
    [0, -0.75, 0.72, 0, 0, 0.75, -0.72, 0, 0, -0.75],
    [0, -0.25, 0.24, 0, 0, 0.25, -0.24, 0, 0, -0.25],
  ],
  [E.WEAVER]: [
    (() => {
      const out = [];
      for (let i = 0; i <= 24; i++) {
        const t = (TAU * i) / 24;
        const d = 1 + Math.sin(t) ** 2;
        out.push((0.9 * Math.cos(t)) / d, (0.9 * Math.sin(t) * Math.cos(t)) / d);
      }
      return out;
    })(),
  ],
  [E.BOMBER]: [
    [-0.95, 0.35, 0, -0.55, 0.95, 0.35, 0.45, 0.1, -0.45, 0.1, -0.95, 0.35],
    [-0.45, 0.1, -0.3, 0.55],
    [0.45, 0.1, 0.3, 0.55],
  ],
  [E.MINE]: [ring(8, 0.42, Math.PI / 8), [-0.24, 0, 0.24, 0], [0, -0.24, 0, 0.24]],
  [E.SIREN]: [
    [-0.5, -0.62, 0.5, -0.62, -0.5, 0.62, 0.5, 0.62, -0.5, -0.62],
    [-0.18, 0, 0.18, 0],
  ],
  [E.SHOT]: [
    [-0.3, -0.3, 0.3, 0.3],
    [0.3, -0.3, -0.3, 0.3],
    [0, -0.42, 0, 0.42],
  ],
};

/** A fuseball's fuses wriggle: five rays of three kinks, bent by time. */
export function fuseStrokes(t, seed, out) {
  out.length = 0;
  for (let k = 0; k < 5; k++) {
    const a = (TAU * k) / 5 + seed;
    const s = [];
    s.push(0, 0);
    for (let j = 1; j <= 3; j++) {
      const r = (0.3 * j) / 1;
      const wob = Math.sin(t * 9 + k * 2.3 + j * 1.7) * 0.35;
      s.push(Math.cos(a + wob) * r * 0.95, Math.sin(a + wob) * r * 0.75);
    }
    out.push(s);
  }
  return out;
}

/** Pickups are notes: a head and a stem; flags say which (one: tempo, two: zap, none: a ship). */
export function noteStrokes(kind) {
  const head = ring(7, 0.28, 0.4, 1.25, 0.85).map((v, i) => (i % 2 ? v + 0.35 : v - 0.1));
  const out = [head, [0.22, 0.32, 0.22, -0.7]];
  if (kind === 3) out.push([0.22, -0.7, 0.62, -0.42]);
  if (kind === 1) out.push([0.22, -0.7, 0.62, -0.42], [0.22, -0.45, 0.62, -0.17]);
  return out;
}

/** The ships: each sits on the rim across its lane, prongs pointing down the tunnel (y +). */
export const SHIP_SHAPES = [
  // Plectrum: a pick with a notch.
  [[-0.95, -0.12, 0.95, -0.12, 0.42, 0.55, 0, 0.82, -0.42, 0.55, -0.95, -0.12], [-0.35, 0.05, 0, 0.42, 0.35, 0.05]],
  // Mallet: a hammer head on a short handle.
  [[-0.95, -0.15, 0.95, -0.15, 0.95, 0.28, -0.95, 0.28, -0.95, -0.15], [-0.18, 0.28, -0.18, 0.78, 0.18, 0.78, 0.18, 0.28]],
  // Reed: a long split diamond.
  [[-0.9, -0.1, 0, -0.22, 0.9, -0.1, 0.16, 0.9, 0, 0.62, -0.16, 0.9, -0.9, -0.1]],
  // Bow: an arc and its string.
  [[-0.95, 0.05, -0.62, 0.48, 0, 0.66, 0.62, 0.48, 0.95, 0.05], [-0.95, 0.05, 0.95, 0.05], [0, 0.05, 0, 0.9]],
  // Chime: a bell.
  [[-0.9, 0.0, 0.9, 0.0, 0.62, 0.18, 0.5, 0.62, 0.22, 0.82, -0.22, 0.82, -0.5, 0.62, -0.62, 0.18, -0.9, 0.0], [0, 0.82, 0, 0.98]],
  // Fork: two tines and a handle.
  [[-0.72, 0.85, -0.72, 0.05, -0.45, -0.18, 0.45, -0.18, 0.72, 0.05, 0.72, 0.85], [0, -0.18, 0, -0.6]],
];

/** A wreck: the ship's lines broken apart. */
export const WRECK = [[-0.9, -0.1, -0.2, 0.3], [0.1, 0.5, 0.8, 0.0], [-0.4, 0.7, 0.3, 0.75], [0.5, -0.2, 0.9, 0.3]];

/** Boss pieces. */
export const BOSS_SHAPES = {
  segment: [ring(6, 0.82, Math.PI / 6), ring(6, 0.38, 0)],
  shield: [[-1, -0.25, 1, -0.25, 1, 0.25, -1, 0.25, -1, -0.25], [-0.6, -0.25, -0.4, 0.25], [0.4, -0.25, 0.6, 0.25]],
  pane: [[-0.85, -0.9, 0.85, -0.9, 0.85, 0.9, -0.85, 0.9, -0.85, -0.9]],
  heart: [[0, -0.5, 0.42, 0, 0, 0.5, -0.42, 0, 0, -0.5]],
};
