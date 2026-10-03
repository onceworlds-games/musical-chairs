// A run as a sequence of zones, and the choices between them. Pure: the session (net/) keeps the record in room
// state and asks this module what zone comes next, what each player may draft, and what the Daily is today.
import { Rng, hash32 } from './rng.js';
import { WORLDS, MODS, SHIPS, RUN_WORLDS, LEVELS_PER_WORLD, OC_BPM } from './data.js';

export const MODES = ['run', 'descent', 'daily', 'practice'];
export const MODE_NAMES = { run: 'RUN', descent: 'DESCENT', daily: 'DAILY', practice: 'PRACTICE' };
export const TEMPOS = [0.8, 0.9, 1, 1.1, 1.2];
const DAILY_WORLDS = 3;

/** How many zones a run of this mode has (Infinity: the Descent). */
export function zoneCount(run) {
  if (run.mode === 'practice') return 1;
  if (run.mode === 'descent') return Infinity;
  if (run.mode === 'daily') return DAILY_WORLDS * LEVELS_PER_WORLD;
  return RUN_WORLDS * LEVELS_PER_WORLD;
}

/** The day number for the Daily (the platform's clock in ms). */
export function dayOf(nowMs) {
  return Math.floor((Number(nowMs) || 0) / 86400000);
}

/** Today's Daily: the same seed, ship, starting mods and worlds for everyone. */
export function dailyFor(day) {
  const rng = new Rng(hash32('daily', day));
  const worlds = [rng.int(2), 2 + rng.int(2), 4 + rng.int(2)];
  const ship = rng.int(SHIPS.length);
  const pool = MODS.filter((m) => !m.coop).map((m) => m.key);
  rng.shuffle(pool);
  return { day, seed: hash32('daily-seed', day), ship, mods: pool.slice(0, 2), worlds };
}

/** The zone at index idx of a run: everything World needs to build it. */
export function zoneFor(run, idx) {
  const oc = Math.max(0, Math.min(8, run.oc | 0));
  const seed = hash32(run.seed, idx);
  if (run.mode === 'practice') {
    const p = run.practice || {};
    const world = clampInt(p.world, 0, WORLDS.length - 1, 0);
    const level = clampInt(p.level, 1, LEVELS_PER_WORLD, 1);
    const tempo = TEMPOS.includes(p.tempo) ? p.tempo : 1;
    const def = WORLDS[world];
    return {
      mode: 'practice',
      world,
      level,
      shape: level >= 4 ? def.bossShape : def.shapes[level - 1],
      bpm: Math.round(def.bpm * tempo),
      practicePace: 1,
      seed,
      oc: 0,
      depth: 0,
      practice: true,
      hints: true,
      idx,
    };
  }
  if (run.mode === 'descent') {
    // Gold and Sky first, then every world in a seeded order; three zones and a boss each; the tempo climbs.
    const group = Math.floor(idx / LEVELS_PER_WORLD);
    const level = (idx % LEVELS_PER_WORLD) + 1;
    let world;
    if (group === 0) world = 6;
    else if (group === 1) world = 7;
    else world = new Rng(hash32(run.seed, 'descent', group)).int(WORLDS.length);
    const def = WORLDS[world];
    const rng = new Rng(hash32(run.seed, 'shape', idx));
    const shape = level >= 4 ? def.bossShape : def.shapes[rng.int(def.shapes.length)];
    return { mode: 'descent', world, level, shape, bpm: Math.min(160, 116 + 2 * idx + oc * OC_BPM), seed, oc, depth: idx, idx };
  }
  const worlds = run.mode === 'daily' ? run.daily?.worlds || [0, 2, 4] : [0, 1, 2, 3, 4, 5];
  const w = Math.floor(idx / LEVELS_PER_WORLD);
  const world = worlds[Math.min(worlds.length - 1, w)] ?? 0;
  const level = (idx % LEVELS_PER_WORLD) + 1;
  const def = WORLDS[world];
  return {
    mode: run.mode === 'daily' ? 'daily' : 'run',
    world,
    level,
    shape: level >= 4 ? def.bossShape : def.shapes[level - 1],
    bpm: def.bpm + oc * OC_BPM,
    seed,
    oc,
    depth: run.mode === 'daily' ? w : 0,
    guided: Boolean(run.guided) && idx === 0,
    idx,
  };
}

/** "2-3", "BOSS 4", for the HUD and results. */
export function zoneLabel(zone) {
  if (!zone) return '';
  const w = zone.mode === 'descent' ? Math.floor(zone.idx / LEVELS_PER_WORLD) + 1 : (zone.mode === 'daily' ? Math.floor(zone.idx / LEVELS_PER_WORLD) : zone.world) + 1;
  return zone.level >= 4 ? `${w}-B` : `${w}-${zone.level}`;
}

/** The mods a player may pick from after zone idx (3, or 2 at Overclock 7). Seeded, so a reload offers the same. */
export function draftOptions(run, playerId, idx, owned = {}, coop = false) {
  const count = (run.oc | 0) >= 7 ? 2 : 3;
  const rng = new Rng(hash32(run.seed, run.mode === 'daily' ? 'daily' : String(playerId), 'draft', idx));
  const pool = MODS.filter((m) => (owned[m.key] || 0) < m.max && (!m.coop || coop));
  const out = [];
  while (out.length < count && pool.length) {
    const weights = pool.map((m) => (owned[m.key] ? 0.75 : 1));
    const i = rng.weighted(weights);
    out.push(pool[i].key);
    pool.splice(i, 1);
  }
  return out;
}

/** Validates a mods object from untrusted state: known keys, whole counts within each mod's max. */
export function cleanMods(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const m of MODS) {
    const v = raw[m.key];
    if (Number.isInteger(v) && v > 0) out[m.key] = Math.min(m.max, v);
  }
  return out;
}

export function addMod(mods, key) {
  const def = MODS.find((m) => m.key === key);
  if (!def) return mods;
  const out = { ...mods };
  out[key] = Math.min(def.max, (out[key] || 0) + 1);
  return out;
}

function clampInt(v, lo, hi, d) {
  const n = Number(v);
  if (!Number.isFinite(n)) return d;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export { clampInt };
