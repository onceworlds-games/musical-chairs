// The zone's score: a list of spawns on the beat grid, written from the seed by a budget system. Each stanza is an
// 8-bar phrase with a dynamic shape (quiet bars, builds, rushes); each bar spends its share of the stanza's threat
// budget on motifs (a single note, an arpeggio up the lanes, a chord across the web, a mirrored pair, a choir).
// The result is checked before it is used: lanes in range, ticks in order, no two spawns on one lane and tick.
import { Rng, hash32 } from './rng.js';
import { E, ENEMIES, WORLDS, COUNTIN_BARS, STANZA_BARS, STANZAS, TICKS_PER_BAR, OC_BUDGET, BOSS_BARS } from './data.js';

const PHRASES = [
  [0.5, 1, 1, 1.5, 0.6, 1, 1.4, 2],
  [1, 0.6, 1.2, 1.6, 0.5, 1.2, 0.8, 2.1],
  [0.6, 1.4, 0.5, 1.5, 0.6, 1.5, 1, 1.9],
  [0.8, 0.8, 1.6, 0.4, 1, 1, 1.8, 1.6],
];
const LEVEL_MUL = [1, 1.14, 1.28, 0.55];
const STANZA_MUL = [0.8, 1, 1.22];

/** Threat budget for one stanza of a zone. */
export function stanzaBudget(zone, stanza) {
  const world = WORLDS[zone.world] ?? WORLDS[0];
  const lvl = LEVEL_MUL[Math.min(3, Math.max(0, zone.level - 1))];
  const st = STANZA_MUL[Math.min(2, Math.max(0, stanza))];
  const oc = 1 + OC_BUDGET * (zone.oc || 0);
  const depth = 1 + 0.05 * Math.max(0, zone.depth || 0); // the Descent keeps adding
  const guided = zone.guided ? 0.6 : zone.world === 0 && zone.level === 1 && !zone.depth ? 0.75 : 1;
  return world.budget * lvl * st * oc * depth * guided * (zone.density || 1);
}

function poolFor(zone) {
  const world = WORLDS[zone.world] ?? WORLDS[0];
  const pool = [];
  for (const [type, weight] of Object.entries(world.pool)) pool.push([Number(type), weight]);
  // Early zones of a world hold back its newest enemies a little.
  return pool;
}

/**
 * Builds the zone's spawn list. zone: { world, level (1-3, 4 = boss), n (lanes), closed, seed, oc, guided, start }.
 * Returns { spawns: [{ tick, type, lane, group }], endTick }.
 */
export function buildZone(zone) {
  const rng = new Rng(hash32('zone', zone.seed, zone.world, zone.level, zone.depth || 0));
  const n = zone.n;
  const spawns = [];
  const taken = new Set();
  const put = (tick, type, lane, group = 0) => {
    lane = ((lane % n) + n) % n;
    if (!zone.closed) lane = Math.max(0, Math.min(n - 1, lane));
    let t = tick;
    while (taken.has(t * 64 + lane)) t += 1; // never two on one lane and tick
    taken.add(t * 64 + lane);
    spawns.push({ tick: t, type, lane, group });
  };
  const pool = poolFor(zone);
  const boss = zone.level >= 4;
  const stanzas = boss ? Math.ceil(BOSS_BARS / STANZA_BARS) : STANZAS;
  let groupId = 1;
  let recent = [];
  const freshLane = () => {
    for (let tries = 0; tries < 8; tries++) {
      const lane = rng.int(n);
      if (!recent.includes(lane)) return lane;
    }
    return rng.int(n);
  };
  const note = (lane) => {
    recent.push(lane);
    if (recent.length > Math.max(3, Math.floor(n / 3))) recent.shift();
  };

  if (zone.guided) guidedOpening(zone, put);

  for (let s = 0; s < stanzas; s++) {
    const budget = stanzaBudget(zone, boss ? 1 : s);
    const phrase = PHRASES[rng.int(PHRASES.length)];
    const sum = phrase.reduce((a, b) => a + b, 0);
    let carry = 0;
    for (let b = 0; b < STANZA_BARS; b++) {
      const bar = COUNTIN_BARS + s * STANZA_BARS + b;
      if (zone.guided && bar < COUNTIN_BARS + 6) continue; // the guided opening owns these bars
      if (boss && b === 0 && s === 0) continue; // the boss takes the stage alone
      let money = (budget * phrase[b]) / sum + carry;
      const rush = phrase[b] >= 1.5;
      const ticks = rush ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 8, 12];
      let slot = 0;
      let guard = 0;
      while (money > 1.5 && guard++ < 12) {
        const tick = bar * TICKS_PER_BAR + ticks[Math.min(ticks.length - 1, slot)];
        const motif = rng.next();
        const affordable = pool.filter(([type]) => ENEMIES[type].cost <= money);
        if (!affordable.length) break;
        const type = affordable[rng.weighted(affordable.map(([, w]) => w))][0];
        const cost = ENEMIES[type].cost;
        if (type === E.SIREN) {
          // A choir: three to five sirens a few lanes apart, all at once.
          const size = Math.min(5, Math.max(3, Math.floor(money / cost)));
          if (size < 3) {
            slot++;
            continue;
          }
          const lane = freshLane();
          const gap = Math.max(1, Math.floor(n / (size * 2)));
          for (let i = 0; i < size; i++) put(tick, E.SIREN, lane + i * gap, groupId);
          groupId++;
          note(lane);
          money -= size * cost;
          slot += 2;
        } else if (type === E.FLIPPER && motif < 0.22 && money >= cost * 3) {
          // An arpeggio: three or four flippers climbing up neighbouring lanes, one per eighth.
          const len = money >= cost * 4 && rng.chance(0.5) ? 4 : 3;
          const lane = freshLane();
          const dir = rng.sign();
          for (let i = 0; i < len; i++) put(tick + i * 2, E.FLIPPER, lane + dir * i);
          note(lane);
          money -= len * cost;
          slot += len;
        } else if ((type === E.FLIPPER || type === E.WEAVER) && motif < 0.4 && money >= cost * 3) {
          // A chord: three at once, spread across the web (kill them on one beat for a CHORD).
          const lane = freshLane();
          const third = Math.floor(n / 3);
          for (let i = 0; i < 3; i++) put(tick, type, lane + i * third + (zone.closed ? 0 : -1));
          note(lane);
          money -= 3 * cost;
          slot += 2;
        } else if (motif < 0.52 && money >= cost * 2 && type !== E.BOMBER) {
          // A mirrored pair.
          const lane = freshLane();
          const other = zone.closed ? lane + Math.floor(n / 2) : n - 1 - lane;
          put(tick, type, lane);
          if (other !== lane) put(tick, type, other);
          note(lane);
          money -= 2 * cost;
          slot += 1;
        } else {
          const lane = freshLane();
          put(tick, type, lane);
          note(lane);
          money -= cost;
          slot += 1;
        }
        if (slot >= ticks.length) break;
      }
      carry = Math.max(0, Math.min(money, budget * 0.25));
    }
  }
  spawns.sort((a, b) => a.tick - b.tick || a.lane - b.lane);
  const endTick = (COUNTIN_BARS + stanzas * STANZA_BARS) * TICKS_PER_BAR;
  return { spawns, endTick };
}

/** The first zone a new player sees: one flipper straight ahead, then one off to the side, then a spiker and a pair. */
function guidedOpening(zone, put) {
  const s = zone.start || 0;
  const base = COUNTIN_BARS * TICKS_PER_BAR;
  put(base, E.FLIPPER, s);
  put(base + TICKS_PER_BAR * 2, E.FLIPPER, s + 3);
  put(base + TICKS_PER_BAR * 3, E.SPIKER, s - 4);
  put(base + TICKS_PER_BAR * 4, E.FLIPPER, s - 2);
  put(base + TICKS_PER_BAR * 5, E.FLIPPER, s + 5);
  put(base + TICKS_PER_BAR * 5 + 8, E.TANKER, s + 1);
}

/** Checks a built zone: everything a test (and a paranoid runtime) wants to be true. Returns a list of problems. */
export function validateZone(zone, built) {
  const problems = [];
  let last = -1;
  const seen = new Set();
  for (const sp of built.spawns) {
    if (!Number.isInteger(sp.tick) || sp.tick < 0) problems.push(`bad tick ${sp.tick}`);
    if (sp.tick < last) problems.push('out of order');
    last = sp.tick;
    if (!Number.isInteger(sp.lane) || sp.lane < 0 || sp.lane >= zone.n) problems.push(`bad lane ${sp.lane}`);
    if (!ENEMIES[sp.type]) problems.push(`bad type ${sp.type}`);
    const key = sp.tick * 64 + sp.lane;
    if (seen.has(key)) problems.push(`stacked spawn ${sp.tick}/${sp.lane}`);
    seen.add(key);
    if (sp.tick < COUNTIN_BARS * TICKS_PER_BAR) problems.push('spawn during the count-in');
  }
  if (zone.level < 4 && built.spawns.length < 6) problems.push(`too few spawns (${built.spawns.length})`);
  return problems;
}
