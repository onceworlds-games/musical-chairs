// A whole run without a screen: bot ships fly zone after zone, drafting between them. Used by the balance
// harness, the tests and nothing else (the game itself steps World from the room's clock).
import { World, PHASE } from './world.js';
import { Bot, botPick } from './bot.js';
import { zoneFor, zoneCount, draftOptions, addMod } from './run.js';
import { Rng, hash32 } from './rng.js';
import { SHIP, STEPS_PER_BAR, startLives } from './data.js';

/**
 * opts: { mode: 'run' | 'descent' | 'daily', seed, skill, ships: [index...] (one per bot), oc, picks: 'random' | 'smart' | 'none',
 *         mods: [{ key: n }] per ship to start with, from: first zone index, to: last zone index, maxZones }
 * Returns { zones: [{ idx, world, level, cleared, seconds, score, kills, hits, chords, perfect }], score, depth, cleared, seconds, cause }
 */
export function playRun(opts = {}) {
  const mode = opts.mode || 'run';
  const run = { mode, seed: opts.seed >>> 0 || 1, oc: opts.oc || 0, daily: opts.daily };
  const shipTypes = opts.ships || [0];
  const bots = shipTypes.map((_, i) => new Bot(opts.skills?.[i] || opts.skill || 'average', hash32(run.seed, i)));
  const pickRng = new Rng(hash32(run.seed, 'picks'));
  let mods = shipTypes.map((_, i) => ({ ...(opts.mods?.[i] || {}) }));
  let carry = { lives: opts.lives ?? startLives(run.oc, shipTypes.length), score: 0, mult: 1, res: 0 };
  for (const m of mods) if (m.encore) carry.lives = Math.min(SHIP.maxLives + 2, carry.lives + m.encore);
  const total = Math.min(zoneCount(run), opts.maxZones ?? 200);
  const from = opts.from || 0;
  const to = Math.min(total - 1, opts.to ?? total - 1);
  const zones = [];
  let seconds = 0;
  let cause = 0;
  let cleared = true;
  for (let idx = from; idx <= to; idx++) {
    const zone = zoneFor(run, idx);
    const players = shipTypes.map((ship, i) => ({ id: `b${i}`, ship, mods: mods[i], kind: 'bot' }));
    const w = new World({ zone, players, carry, auth: true });
    const limit = 400 * STEPS_PER_BAR; // nothing lasts this long; a guard against a stuck zone
    while (w.phase !== PHASE.DONE && w.phase !== PHASE.OVER && w.step < limit) {
      for (let i = 0; i < bots.length; i++) bots[i].drive(w, w.ships[i]);
      w.update();
      if (w.ev.length > 256) w.ev.length = 0;
    }
    w.ev.length = 0;
    const secs = w.step * w.dt;
    seconds += secs + 6; // a few seconds between zones for the draft
    const ok = w.phase === PHASE.DONE;
    zones.push({
      idx,
      world: zone.world,
      level: zone.level,
      cleared: ok,
      seconds: secs,
      score: w.score - carry.score,
      kills: w.stats.kills,
      hits: w.stats.hits,
      chords: w.stats.chords,
      perfect: w.stats.perfect,
      od: w.stats.od,
      lives: w.lives,
      stuck: w.step >= limit,
    });
    carry = { lives: w.lives, score: w.score, mult: w.mult, res: w.res };
    if (!ok) {
      cleared = false;
      cause = w.ships.find((s) => s.cause)?.cause || 0;
      break;
    }
    // The draft: one mod each.
    if (opts.picks !== 'none') {
      mods = mods.map((m, i) => {
        const options = draftOptions(run, `b${i}`, idx, m, shipTypes.length > 1);
        const pick = botPick(options, pickRng, opts.picks === 'smart');
        if (!pick) return m;
        if (pick === 'encore') carry.lives = Math.min(SHIP.maxLives + 2, carry.lives + 1);
        return addMod(m, pick);
      });
    }
  }
  const last = zones[zones.length - 1];
  return { zones, score: carry.score, depth: last ? last.idx + (last.cleared ? 1 : 0) : 0, cleared, seconds, cause, mods };
}
