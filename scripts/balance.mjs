// The balance harness: bot ships of three skills fly the pure simulation across seeds and print the numbers the
// design is held to (see README "Balance"). `npm run balance` (all sections), `node scripts/balance.mjs quick`,
// or name sections: `node scripts/balance.mjs survival mods ships`.
import { playRun } from '../game/src/sim/headless.js';
import { draftOptions, addMod } from '../game/src/sim/run.js';
import { botPick } from '../game/src/sim/bot.js';
import { Rng, hash32 } from '../game/src/sim/rng.js';
import { MODS, SHIPS } from '../game/src/sim/data.js';

const args = process.argv.slice(2);
const quick = args.includes('quick');
const onlyMods = (args.find((a) => a.startsWith('only=')) || '').slice(5).split(',').filter(Boolean);
const want = args.filter((a) => a !== 'quick' && !a.startsWith('only='));
const on = (name) => !want.length || want.includes(name);
const N = quick ? 60 : 300;
const pct = (x) => `${(100 * x).toFixed(0)}%`.padStart(5);
const t0 = performance.now();
const table = [];
const row = (...cells) => {
  const line = cells.map((c, i) => String(c).padEnd(i === 0 ? 34 : 12)).join('');
  table.push(line);
  console.log(line);
};

/** A good build for a ship: the smart bot's picks over the drafts before zone `to` (no playing involved). */
function buildFor(ship, to, seed, skip = []) {
  const run = { mode: 'run', seed, oc: 0 };
  const rng = new Rng(hash32(seed, 'build'));
  let mods = {};
  for (let i = 0; i < to; i++) {
    const options = draftOptions(run, 'b0', i, mods, false).filter((o) => !skip.includes(o));
    const pick = botPick(options, rng, true);
    if (pick) mods = addMod(mods, pick);
  }
  return mods;
}

function runs(n, opts) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(playRun({ ...opts, seed: hash32(opts.tag || 'b', i) }));
  return out;
}

// ---------------------------------------------------------------- survival and run length
if (on('survival')) {
  row('SURVIVAL (Run, random drafts)', 'clear 1-1', 'no-hit 1-1', 'clear W3', 'final', 'mean min', 'p50 score', 'p90/p50');
  for (const skill of ['novice', 'average', 'expert']) {
    const rs = runs(N, { skill, picks: 'random', tag: `surv-${skill}` });
    const c11 = rs.filter((r) => r.zones[0]?.cleared).length / rs.length;
    const nh11 = rs.filter((r) => r.zones[0]?.cleared && r.zones[0].hits === 0).length / rs.length;
    const w3 = rs.filter((r) => r.depth >= 12).length / rs.length;
    const fin = rs.filter((r) => r.cleared).length / rs.length;
    const mins = rs.reduce((a, r) => a + r.seconds, 0) / rs.length / 60;
    const scores = rs.map((r) => r.score).sort((a, b) => a - b);
    const p50 = scores[Math.floor(scores.length * 0.5)];
    const p90 = scores[Math.floor(scores.length * 0.9)];
    row(`  ${skill}`, pct(c11), pct(nh11), pct(w3), pct(fin), mins.toFixed(1), p50, (p90 / Math.max(1, p50)).toFixed(2));
  }
  // Where runs end, for the average bot.
  const rs = runs(N, { skill: 'average', picks: 'random', tag: 'depth' });
  const hist = new Array(25).fill(0);
  for (const r of rs) hist[Math.min(24, r.depth)]++;
  console.log('  average: runs ending at zone index (0-24):', hist.join(' '));
}

// ---------------------------------------------------------------- the final boss with a good build
function finalBoss(skill, extra = {}, n = N, ship = 0, base = null) {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const seed = hash32('final', skill, i);
    const mods = { ...(base || buildFor(ship, 23, seed)), ...extra };
    const r = playRun({ seed, skill, ships: [ship], mods: [mods], from: 23, to: 23, picks: 'none', lives: 3 });
    if (r.cleared) wins++;
  }
  return wins / n;
}
if (on('final')) {
  row('FINAL BOSS (good build, 3 ships)', 'novice', 'average', 'expert');
  row('  Maestro', pct(finalBoss('novice')), pct(finalBoss('average')), pct(finalBoss('expert')));
}

// ---------------------------------------------------------------- mod impact on the expert's final boss
// The baseline is a good build without the mod (the smart bot's picks over every draft, that mod refused); the test
// gives the same build the mod at its full stack. Pairs take the strongest singles two at a time.
if (on('mods')) {
  const n = quick ? 60 : 160;
  const rate = (skip, extra) => {
    let wins = 0;
    for (let i = 0; i < n; i++) {
      const seed = hash32('mods', i);
      const mods = { ...buildFor(0, 23, seed, skip), ...extra };
      const r = playRun({ seed, skill: 'expert', mods: [mods], from: 23, to: 23, picks: 'none', lives: 3 });
      if (r.cleared) wins++;
    }
    return wins / n;
  };
  row('MOD IMPACT (expert, final boss)', 'without', 'with max', 'delta');
  const deltas = [];
  for (const m of MODS) {
    if (m.coop || (onlyMods.length && !onlyMods.includes(m.key))) continue;
    const base = rate([m.key], {});
    const with_ = rate([m.key], { [m.key]: m.max });
    deltas.push([m.key, with_ - base]);
    row(`  ${m.name}`, pct(base), pct(with_), `${with_ - base >= 0 ? '+' : ''}${(100 * (with_ - base)).toFixed(0)}`);
  }
  deltas.sort((a, b) => b[1] - a[1]);
  console.log('  strongest:', deltas.slice(0, 5).map(([k, d]) => `${k} ${(100 * d).toFixed(0)}`).join(', '));
  const top = deltas.slice(0, 5).map(([k]) => k);
  row('PAIRS (strongest singles)', 'without', 'with both', 'delta');
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = MODS.find((m) => m.key === top[i]);
      const b = MODS.find((m) => m.key === top[j]);
      const base = rate([a.key, b.key], {});
      const both = rate([a.key, b.key], { [a.key]: a.max, [b.key]: b.max });
      row(`  ${a.name} + ${b.name}`, pct(base), pct(both), `${both - base >= 0 ? '+' : ''}${(100 * (both - base)).toFixed(0)}`);
    }
  }
}

// ---------------------------------------------------------------- ships at world 4
if (on('ships')) {
  const n = quick ? 60 : 200;
  row('SHIPS (average, world 4, own best build)', 'clear W4', 'mean score');
  for (let s = 0; s < SHIPS.length; s++) {
    let wins = 0;
    let score = 0;
    for (let i = 0; i < n; i++) {
      const seed = hash32('ships', s, i);
      const mods = buildFor(s, 12, seed);
      const r = playRun({ seed, skill: 'average', ships: [s], mods: [mods], from: 12, to: 15, picks: 'smart', lives: 3 });
      if (r.cleared) wins++;
      score += r.score;
    }
    row(`  ${SHIPS[s].name}`, pct(wins / n), Math.round(score / n));
  }
}

// ---------------------------------------------------------------- the Descent and co-op
if (on('descent')) {
  const rs = runs(quick ? 40 : 120, { mode: 'descent', skill: 'average', picks: 'random', tag: 'descent', maxZones: 60 });
  const depth = rs.reduce((a, r) => a + r.depth, 0) / rs.length;
  const mins = rs.reduce((a, r) => a + r.seconds, 0) / rs.length / 60;
  row('DESCENT (average)', `depth ${depth.toFixed(1)}`, `${mins.toFixed(1)} min`);
}
if (on('coop')) {
  for (const players of [2, 4]) {
    const rs = runs(quick ? 40 : 120, { skill: 'average', ships: new Array(players).fill(0).map((_, i) => i % SHIPS.length), picks: 'random', tag: `coop${players}` });
    const w3 = rs.filter((r) => r.depth >= 12).length / rs.length;
    const fin = rs.filter((r) => r.cleared).length / rs.length;
    row(`CO-OP ${players} (average)`, `W3 ${pct(w3)}`, `final ${pct(fin)}`);
  }
}

console.log(`\n${((performance.now() - t0) / 1000).toFixed(1)} s`);
