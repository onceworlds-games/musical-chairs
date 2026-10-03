// Bot ships: they fly the simulation for the balance harness, the title screen's attract mode and the posters.
// They read the world (with a reaction delay and lapses of attention that depend on their skill) and press the
// same inputs a player does: a target lane, Fire, Hop and Zap.
import { Rng, hash32 } from './rng.js';
import { E, STEPS_PER_BEAT, STEPS_PER_TICK, TICKS_PER_BAR, MODS, ENEMIES } from './data.js';
import { laneOf, laneDelta, laneDist } from './web.js';
import { S } from './enemies.js';
import { PHASE } from './world.js';
import { partOpen, ROLE } from './bosses.js';

export const SKILLS = {
  novice: { react: 26, aware: 0.5, noise: 0.16, hop: 0.15, zapAt: 6, zapWill: 0.5, fire: 0.85, spikes: 0, beatHop: 0, lookShots: 0.5, revive: 0.2 },
  average: { react: 18, aware: 0.84, noise: 0.06, hop: 0.6, zapAt: 4, zapWill: 0.85, fire: 0.97, spikes: 0.5, beatHop: 0.1, lookShots: 0.85, revive: 0.5 },
  expert: { react: 12, aware: 0.98, noise: 0.01, hop: 0.95, zapAt: 3, zapWill: 1, fire: 1, spikes: 1, beatHop: 0.5, lookShots: 1, revive: 0.65 },
};

export class Bot {
  constructor(skill = 'average', seed = 1) {
    this.k = SKILLS[skill] ?? SKILLS.average;
    this.skill = skill;
    this.rng = new Rng(hash32('bot', seed, skill));
    this.wait = 0;
    this.target = null;
    this.firing = true;
    this.danger = new Float32Array(64);
    this.value = new Float32Array(64);
  }

  /** Called every simulation step for its ship. */
  drive(w, ship) {
    const input = ship.in;
    if (ship.state !== 'live') {
      input.fire = false;
      return;
    }
    if (--this.wait > 0) {
      input.target = this.target;
      input.fire = this.firing;
      return;
    }
    this.wait = this.k.react + this.rng.int(4);
    this.decide(w, ship);
    input.target = this.target;
    input.fire = this.firing;
  }

  decide(w, ship) {
    const k = this.k;
    const n = w.n;
    const here = laneOf(w.web, ship.u);
    const danger = this.danger;
    const value = this.value;
    const now = this.now || (this.now = new Float32Array(64)); // deadly this instant (for the trip across)
    danger.fill(0);
    value.fill(0);
    now.fill(0);
    const horizon = STEPS_PER_BEAT * 1.5; // how far ahead it looks, in steps
    const seen = (p) => this.rng.next() < p;
    const warp = w.phase === PHASE.WARP;

    // Telegraphed lane hazards: pulsar pulses, armed mines, boss blasts.
    for (const e of w.enemies) {
      if (e.dead) continue;
      const lane = ((Math.round(e.lane) % n) + n) % n;
      if (e.type === E.PULSAR && seen(k.aware)) {
        const period = w.oc >= 5 ? TICKS_PER_BAR : TICKS_PER_BAR * 2;
        const toPulse = (period - (w.tick % period)) % period;
        if (toPulse * STEPS_PER_TICK < horizon + 8) danger[lane] += 10;
      } else if (e.type === E.MINE && e.st === S.ARMED && e.a <= 2 && seen(k.aware)) {
        for (let d = -1; d <= 1; d++) danger[wrapLane(w, lane + d)] += 9;
      } else if (e.type === E.SHOT && seen(k.lookShots)) {
        // A shot in a lane: deadly to whoever is there when it lands, unless it is shot first.
        const stepsToLand = (e.z / ((ENEMIES[E.SHOT].climb * w.pace) / STEPS_PER_BEAT)) | 0;
        if (stepsToLand < horizon) danger[lane] += lane === here && e.z > 0.12 && this.firing ? 1 : 7;
        if (stepsToLand < 6) now[lane] += 9;
      } else if (e.z < 0.03 && e.type !== E.PART && e.type !== E.SHOT && e.type !== E.MINE) {
        // Crawlers: one in a lane is beatable while firing; two together are not.
        danger[lane] += 2.2;
        if (e.fs >= 0) danger[wrapLane(w, e.to)] += 2.5;
      } else if (e.z < 0.16 && e.type !== E.PART) {
        danger[lane] += 0.8;
      }
    }
    for (const p of w.pulses) (danger[p[0]] += 12), (now[p[0]] += 12);
    for (const p of w.booms) (danger[p[0]] += 12), (now[p[0]] += 12);
    if (w.boss && seen(k.aware)) {
      for (const t of w.boss.tele) {
        if (t.at - w.step > horizon * 1.6) continue;
        for (const l of t.lanes) danger[l] += 11;
      }
    }

    // What is worth shooting: anything close to the rim first, choirs, bosses' open pieces, spikes before the warp.
    // A bolt takes a moment to get there, so it aims where the target will be (an expert leads better).
    const boltStep = ((ship.def.speed * (1 + 0.4 * (ship.mods.staccato || 0))) * w.dt) || 0.02;
    const shielded = new Set();
    if (w.boss) for (const p of w.boss.parts) if (!p.dead && p.a === ROLE.SHIELD && p.c > 0) shielded.add(((Math.round(p.lane) % n) + n) % n);
    for (const e of w.enemies) {
      if (e.dead) continue;
      const travel = e.z / boltStep;
      const lead = this.skill === 'expert' ? 1 : this.skill === 'average' ? 0.6 : 0.2;
      const lane = predictLane(w, e, travel * lead);
      if (lane < 0) continue;
      if (e.type === E.PART) {
        if (!w.boss || !w.boss.active) continue;
        if (e.a === ROLE.CORE) {
          if (!partOpen(w, w.boss, e) && w.boss.kind !== 'conductor') continue;
          value[lane] += shielded.has(lane) ? 0 : 1.6;
        } else if (e.a === ROLE.SHIELD) value[lane] += e.c > 0 ? 0.5 : 0;
        else value[lane] += 2.4;
        continue;
      }
      let v = 1.3 - e.z;
      if (e.type === E.SHOT) v = lane === here ? 1.2 : 0.2;
      if (e.type === E.MINE && e.st === S.ARMED) v = 2.5;
      if (e.type === E.SIREN) v += 0.4;
      if (e.z < 0.05) v += 1.2;
      value[lane] += v;
    }
    const spikeWeight = warp ? 3 : w.phase === PHASE.VAMP ? 0.6 * k.spikes : 0.15 * k.spikes;
    for (let l = 0; l < n; l++) if (w.spikes[l] > 0.05) value[l] += w.spikes[l] * spikeWeight;
    if (warp) for (let l = 0; l < n; l++) danger[l] += w.spikes[l] > 0.02 ? w.spikes[l] * 14 : 0;

    // A fallen friend waits for a touch: worth the trip while the lane is not deadly (people do this; so do the bots).
    for (const wr of w.wrecks) {
      if (wr.idx !== ship.idx && this.rng.next() < k.revive) value[wrapLane(w, wr.lane)] += 2.6;
    }

    // A ship covers the lanes its bolts go down: a Mallet three, a Fork the two beside it.
    const cover = ship.def.tines ? [-1, 1] : ship.def.spread ? [-1, 0, 1] : [0];
    const covered = this.covered || (this.covered = new Float32Array(64));
    for (let l = 0; l < n; l++) {
      let v = 0;
      for (const o of cover) v += value[wrapLane(w, l + o)] * (o === 0 || ship.def.tines ? 1 : 0.7);
      covered[l] = v;
    }
    // Choose: the best value, minus danger, minus the trip (and anything deadly on the way).
    let best = here;
    let bestScore = -Infinity;
    for (let l = 0; l < n; l++) {
      const d = laneDelta(w.web, here, l);
      const dist = Math.abs(d);
      let path = 0;
      for (let i = 1; i < dist; i++) {
        const pl = wrapLane(w, here + Math.sign(d) * i);
        if (now[pl] >= 9) path += 4;
      }
      const score = covered[l] - danger[l] * 1.3 - dist * 0.06 - path + (l === here ? 0.15 : 0);
      if (score > bestScore) (bestScore = score), (best = l);
    }
    if (this.rng.next() < k.noise) best = this.rng.int(n);
    this.target = best;
    this.firing = this.rng.next() < k.fire || warp;

    // Hop: when staying is deadly and the lanes a step away are no better.
    if (ship.zaps >= 0 && w.step >= ship.hopCd && danger[here] >= 4) {
      const escape = danger[wrapLane(w, here + 1)] < 3 || danger[wrapLane(w, here - 1)] < 3;
      if ((!escape || danger[here] >= 9) && this.rng.next() < k.hop) {
        const fwd = danger[wrapLane(w, here + 3)];
        const back = danger[wrapLane(w, here - 3)];
        ship.dir = fwd <= back ? 1 : -1;
        if (w.web.closed || (here + ship.dir * 3 >= 0 && here + ship.dir * 3 < n)) ship.in.hop = true;
      }
    }
    // An on-the-beat hop for the multiplier, when nothing much is happening.
    if (!ship.in.hop && k.beatHop && w.step >= ship.hopCd && danger[here] < 1 && this.rng.next() < k.beatHop * 0.08) {
      const phase = w.step % STEPS_PER_BEAT;
      if (phase >= STEPS_PER_BEAT - 2 || phase <= 1) ship.in.hop = true;
    }

    // Zap: when trouble crowds the rim, or the ship is cornered.
    if (ship.zaps > 0) {
      let near = 0;
      for (const e of w.enemies) if (!e.dead && e.z < 0.2 && e.type !== E.PART && e.type !== E.SHOT && laneDist(w.web, Math.round(e.lane), here) <= 4) near++;
      const cornered = danger[here] >= 9 && danger[wrapLane(w, here + 1)] >= 9 && danger[wrapLane(w, here - 1)] >= 9;
      if ((near >= k.zapAt || cornered) && this.rng.next() < k.zapWill) ship.in.zap = true;
    }
  }
}

/** Where an enemy will be after some steps, as a lane index (-1: between lanes). Rough, as a player's eye is. */
function predictLane(w, e, steps) {
  const n = w.n;
  let lane = e.lane;
  if (e.type === E.WEAVER && e.st === S.CLIMB) {
    const t = (w.step + steps - e.t0) / (STEPS_PER_BEAT * 2);
    lane = e.a + e.b * Math.sin(t * Math.PI * 2);
  } else if (e.fs >= 0) {
    const p = (w.step + steps - e.fs) / e.fl;
    lane = p >= 1 ? e.to : e.from + (e.to - e.from) * p;
  } else if (e.type === E.PART && w.boss && (e.a === ROLE.SEGMENT || e.a === ROLE.SHIELD)) {
    // The serpent and the ring step a lane on each beat.
    const toBeat = STEPS_PER_BEAT - (w.step % STEPS_PER_BEAT);
    if (steps > toBeat) lane = e.lane + w.boss.dir * (1 + Math.floor((steps - toBeat) / STEPS_PER_BEAT));
  }
  const r = Math.round(lane);
  if (Math.abs(lane - r) > 0.3) return -1;
  return w.web.closed ? ((r % n) + n) % n : r < 0 || r >= n ? -1 : r;
}

function wrapLane(w, l) {
  if (w.web.closed) return ((l % w.n) + w.n) % w.n;
  return Math.max(0, Math.min(w.n - 1, l));
}

/** A mod pick for a bot: random, or by a simple preference for builds that clear lanes. */
// (Ordered by what the harness measures each mod adds against the final boss.)
const PREFERENCE = ['metronome', 'pierce', 'echo', 'syncopate', 'tremolo', 'magnet', 'shieldbeat', 'chain', 'spread', 'feedback', 'forte', 'bassdrop', 'counterpoint', 'encore', 'drone', 'phasehop', 'gracenote', 'undertow', 'staccato'];
export function botPick(options, rng, smart) {
  if (!options.length) return null;
  if (!smart) return options[rng.int(options.length)];
  let best = options[0];
  let bestRank = Infinity;
  for (const o of options) {
    const r = PREFERENCE.indexOf(o);
    const rank = r < 0 ? 50 + MODS.findIndex((m) => m.key === o) : r;
    if (rank < bestRank) (bestRank = rank), (best = o);
  }
  return best;
}
