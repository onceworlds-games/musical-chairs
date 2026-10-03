// The player's save: what they have done, what it unlocked, and their choices. A versioned shape, read defensively:
// a missing, empty, corrupt, older or newer save all load (unknown fields are ignored, bad numbers become defaults).
import { SHIPS, SHIP_UNLOCKS, MODS } from './data.js';

export const SAVE_KEY = 'profile';
export const VERSION = 1;

export const TINTS = [
  { key: 'white', name: 'WHITE', hex: '#ffffff', need: null },
  { key: 'mint', name: 'MINT', hex: '#3dffb0', need: { worldsCleared: 1 } },
  { key: 'amber', name: 'AMBER', hex: '#ffb13d', need: { worldsCleared: 2 } },
  { key: 'ice', name: 'ICE', hex: '#8fe3ff', need: { worldsCleared: 3 } },
  { key: 'vermilion', name: 'VERMILION', hex: '#ff4a2b', need: { worldsCleared: 4 } },
  { key: 'lime', name: 'LIME', hex: '#b6ff3d', need: { worldsCleared: 5 } },
  { key: 'rose', name: 'ROSE', hex: '#ff5c8a', need: { worldsCleared: 6 } },
  { key: 'gold', name: 'GOLD', hex: '#ffd23d', need: { deepest: 8 } },
  { key: 'sky', name: 'SKY', hex: '#5cb8ff', need: { deepest: 16 } },
];
export const TRAILS = [
  { key: 'none', name: 'NONE', need: null },
  { key: 'dots', name: 'DOTS', need: { chords: 10 } },
  { key: 'dash', name: 'DASH', need: { chords: 50 } },
  { key: 'ribbon', name: 'RIBBON', need: { chords: 150 } },
];
export const RIMS = [
  { key: 'plain', name: 'PLAIN', need: null },
  { key: 'double', name: 'DOUBLE', need: { perfect: 25 } },
  { key: 'beads', name: 'BEADS', need: { perfect: 100 } },
  { key: 'teeth', name: 'TEETH', need: { perfect: 300 } },
];
export const TAPES = [
  { key: 'stop', name: 'TAPE STOP', need: null },
  { key: 'spin', name: 'SPIN DOWN', need: { runs: 5 } },
  { key: 'crush', name: 'CRUSH', need: { runs: 15 } },
  { key: 'sigh', name: 'SIGH', need: { runs: 40 } },
];

const COUNTERS = ['best', 'bestDescent', 'deepest', 'reached', 'worldsCleared', 'runs', 'cleared', 'kills', 'chords', 'perfect', 'tether', 'flawless', 'od', 'dailyDays'];

export function defaults() {
  return {
    v: VERSION,
    best: 0,
    bestDescent: 0,
    deepest: 0,
    reached: 0,
    worldsCleared: 0,
    runs: 0,
    cleared: 0,
    kills: 0,
    chords: 0,
    perfect: 0,
    tether: 0,
    flawless: 0,
    od: 0,
    dailyDays: 0,
    ocCleared: -1,
    mods: [],
    ship: 0,
    tint: 0,
    trail: 0,
    rim: 0,
    tape: 0,
    calm: false,
    autofire: false,
    first: true,
    hints: {},
    daily: { day: -1, best: 0, done: false },
  };
}

const int = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : d);

/** Any value from the save store becomes a valid profile. */
export function parseProfile(raw) {
  const p = defaults();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return p;
  // A newer save keeps what this build understands; an older one fills in the rest with defaults.
  for (const k of COUNTERS) p[k] = int(raw[k], 0, 99_999_999, p[k]);
  p.ocCleared = int(raw.ocCleared, -1, 8, -1);
  p.mods = Array.isArray(raw.mods) ? [...new Set(raw.mods.filter((m) => typeof m === 'string' && MODS.some((x) => x.key === m)))] : [];
  p.ship = int(raw.ship, 0, SHIPS.length - 1, 0);
  p.tint = int(raw.tint, 0, TINTS.length - 1, 0);
  p.trail = int(raw.trail, 0, TRAILS.length - 1, 0);
  p.rim = int(raw.rim, 0, RIMS.length - 1, 0);
  p.tape = int(raw.tape, 0, TAPES.length - 1, 0);
  p.calm = raw.calm === true;
  p.autofire = raw.autofire === true;
  p.first = raw.first !== false;
  if (raw.hints && typeof raw.hints === 'object' && !Array.isArray(raw.hints)) {
    for (const [k, n] of Object.entries(raw.hints).slice(0, 24)) if (typeof k === 'string' && k.length < 16) p.hints[k] = int(n, 0, 99, 0);
  }
  if (raw.daily && typeof raw.daily === 'object') {
    p.daily = { day: int(raw.daily.day, -1, 1e7, -1), best: int(raw.daily.best, 0, 99_999_999, 0), done: raw.daily.done === true };
  }
  // Choices that are no longer unlocked (or never were) fall back to the first.
  if (!shipUnlocked(p, p.ship)) p.ship = 0;
  if (!met(p, TINTS[p.tint].need)) p.tint = 0;
  if (!met(p, TRAILS[p.trail].need)) p.trail = 0;
  if (!met(p, RIMS[p.rim].need)) p.rim = 0;
  if (!met(p, TAPES[p.tape].need)) p.tape = 0;
  return p;
}

export function met(p, need) {
  if (!need) return true;
  for (const [k, v] of Object.entries(need)) if (!((p[k] ?? 0) >= v)) return false;
  return true;
}

export function shipUnlocked(p, index) {
  const ship = SHIPS[index];
  if (!ship) return false;
  const need = SHIP_UNLOCKS[ship.key];
  if (!need) return true;
  const { label: _label, ...rest } = need;
  return met(p, rest);
}

export function unlockLabel(index) {
  const ship = SHIPS[index];
  return SHIP_UNLOCKS[ship?.key]?.label || '';
}

export function needLabel(need) {
  if (!need) return '';
  const [k, v] = Object.entries(need)[0];
  return { worldsCleared: `CLEAR WORLD ${v}`, reached: `REACH WORLD ${v}`, deepest: `DESCEND ${v}`, chords: `${v} CHORDS`, perfect: `${v} PERFECT BARS`, runs: `${v} RUNS` }[k] || '';
}

/**
 * Folds a finished run into the profile. r: { mode, score, depth (zones cleared), worldsCleared, reached (world
 * number reached, 1-based), cleared (whole run), oc, kills, chords, perfect, tether, flawless, od, day, mods: [keys] }
 * Returns { profile, unlocked: [labels] } (a new object; the old one is untouched).
 */
export function recordRun(old, r) {
  const p = parseProfile(old);
  const before = unlockState(p);
  p.runs++;
  p.kills += r.kills | 0;
  p.chords += r.chords | 0;
  p.perfect += r.perfect | 0;
  p.tether += r.tether | 0;
  p.flawless += r.flawless | 0;
  p.od += r.od | 0;
  for (const m of r.mods || []) if (!p.mods.includes(m) && MODS.some((x) => x.key === m)) p.mods.push(m);
  if (r.mode === 'run' || r.mode === 'daily') {
    if (r.mode === 'run') p.best = Math.max(p.best, r.score | 0);
    p.reached = Math.max(p.reached, Math.min(6, r.reached | 0));
    p.worldsCleared = Math.max(p.worldsCleared, Math.min(6, r.worldsCleared | 0));
    if (r.cleared && r.mode === 'run') {
      p.cleared++;
      p.ocCleared = Math.max(p.ocCleared, Math.min(8, r.oc | 0));
    }
  }
  if (r.mode === 'descent') {
    p.bestDescent = Math.max(p.bestDescent, r.score | 0);
    p.deepest = Math.max(p.deepest, r.depth | 0);
  }
  if (r.mode === 'daily' && Number.isFinite(r.day)) {
    if (p.daily.day !== r.day) {
      p.daily = { day: r.day, best: 0, done: false };
      p.dailyDays++;
    }
    p.daily.best = Math.max(p.daily.best, r.score | 0);
    if (r.depth >= 1) p.daily.done = true;
  }
  if (r.depth >= 1) p.first = false;
  const after = unlockState(p);
  const unlocked = after.filter((x) => !before.includes(x));
  return { profile: p, unlocked };
}

function unlockState(p) {
  const out = [];
  SHIPS.forEach((s, i) => shipUnlocked(p, i) && out.push(`SHIP ${s.name}`));
  TINTS.forEach((t) => met(p, t.need) && out.push(`TINT ${t.name}`));
  TRAILS.forEach((t) => met(p, t.need) && out.push(`TRAIL ${t.name}`));
  RIMS.forEach((t) => met(p, t.need) && out.push(`RIM ${t.name}`));
  TAPES.forEach((t) => met(p, t.need) && out.push(`DEATH ${t.name}`));
  return out;
}

/** The highest Overclock this player may choose: one past the best they have cleared. */
export function ocAllowed(p) {
  return Math.max(0, Math.min(8, p.ocCleared + 1));
}
