// The simulation of one zone: a pure, deterministic state machine stepped 8 times per sixteenth note. No DOM, no
// clocks, no Math.random: the same zone, seed and inputs give the same result on every run (tests, the balance
// harness, the host's page and a mirror replaying a snapshot all use this code).
//
// auth: true on the page that decides (solo, the host, the harness). A mirror (auth: false) moves everything by the
// same rules but spawns only the score's scheduled enemies, keeps no score and turns its own hits into claims.
import { Rng, hash32 } from './rng.js';
import { makeWeb, laneOf, wrapU, laneDist, neighbour } from './web.js';
import { buildZone } from './levelgen.js';
import {
  E,
  ENEMIES,
  WORLDS,
  SHIPS,
  SHIP,
  STEPS_PER_TICK,
  STEPS_PER_BEAT,
  STEPS_PER_BAR,
  TICKS_PER_BAR,
  COUNTIN_BARS,
  VAMP_BARS,
  WARP_BARS,
  CHORD_POINTS,
  PERFECT_BAR_POINTS,
  FLAWLESS_POINTS,
  ZONE_POINTS,
  RESONANCE_MAX,
  OVERDRIVE_SECONDS,
  MULT_CAP,
  OC_BPM,
  stepSeconds,
} from './data.js';
import { spawnEnemy, updateEnemy, hitLane, S } from './enemies.js';
import { makeBoss, updateBoss, bossDamage } from './bosses.js';
import { shipMethods } from './ships.js';
import { PHASE, DEATH, DEATH_NAMES, mod } from './world-shared.js';
import { coopMethods } from './coop.js';



export class World {
  /**
   * zone: { world, level (1-3; 4 boss), bpm, shape, n, seed, oc, mode, guided, depth, practice }
   * players: [{ id, ship (index into SHIPS), mods: { key: count }, kind: 'driven' | 'puppet' | 'bot', lat }]
   * carry: { lives, score, mult, res, zaps: [per player] } from the run so far.
   */
  constructor({ zone, players, carry = {}, auth = true }) {
    this.zone = zone;
    this.auth = auth;
    const world = WORLDS[zone.world] ?? WORLDS[0];
    this.def = world;
    this.web = makeWeb(zone.shape || world.shapes[0], zone.n);
    this.n = this.web.n;
    this.oc = zone.oc || 0;
    this.bpm = Math.max(60, Math.min(200, zone.bpm || world.bpm + this.oc * OC_BPM));
    this.dt = stepSeconds(this.bpm);
    this.pace = world.pace * (1 + 0.02 * Math.max(0, zone.depth || 0)) * (zone.practicePace || 1);
    this.flipEvery = world.pace >= 1.15 ? 3 : 4; // ticks between a climbing flipper's turns
    this.shotChance = zone.guided || (zone.world === 0 && zone.level === 1) ? 0 : Math.min(0.35, (world.shots || 0) * (this.oc >= 2 ? 1.8 : 1) * (zone.level >= 3 ? 1.2 : 1));
    // Deeper worlds' enemies take more hitting (fractions matter: 1.25 needs two plain bolts, or one heavy one).
    this.tough = (world.tough || 1) + 0.03 * Math.max(0, zone.depth || 0);
    this.rng = new Rng(hash32('sim', zone.seed, zone.world, zone.level, zone.depth || 0));
    zone.n = this.n;
    zone.closed = this.web.closed;
    zone.start = this.web.start;
    const built = buildZone(zone);
    this.spawns = built.spawns;
    this.endTick = built.endTick;
    this.spawnIdx = 0;
    this.step = 0;
    this.tick = 0;
    this.phase = PHASE.COUNTIN;
    this.phaseAt = 0; // step the phase began
    this.enemies = [];
    this.pool = [];
    this.bolts = [];
    this.boltPool = [];
    this.pickups = [];
    this.spikes = new Float32Array(this.n);
    this.nextId = 100000; // ids of everything the score didn't schedule (splits, shots, mines)
    this.ev = []; // events since the last drain
    this.choirs = new Map();
    this.pulses = []; // [lane, untilStep]
    this.booms = []; // [lane, untilStep] (mines, boss blasts): rim lanes that are deadly for a moment
    this.boss = null;
    this.vampBars = VAMP_BARS;
    this.claims = []; // a mirror's own hits, for the host to judge: [id, dmg, lane, z1000]
    this.predicted = new Map(); // id -> step: enemies a mirror has killed and hides until the host agrees
    // Shared run state (the host's in co-op).
    this.lives = carry.lives ?? (this.oc >= 6 ? 2 : SHIP.lives);
    this.score = carry.score ?? 0;
    this.mult = carry.mult ?? 1;
    this.res = carry.res ?? 0;
    this.odUntil = -1;
    this.odExtended = 0;
    this.practice = Boolean(zone.practice);
    this.forgive = Boolean(zone.practice || zone.guided); // practice and the guided first zone cost no ships
    // Bookkeeping for multiplier, chords and Perfect Bars.
    this.bw = -1;
    this.bwKills = 0;
    this.bwLanes = [];
    this.bwPlayers = 0;
    this.bwMult = false;
    this.bwChord = 0;
    this.bwHop = false;
    this.barKills = 0;
    this.barRim = 0;
    this.barHit = 0;
    this.barFirstKill = new Set();
    this.rimGuardBar = -1;
    this.stats = { kills: 0, rim: 0, hits: 0, chords: 0, perfect: 0, choirs: 0, maxMult: this.mult, od: 0, flawless: false, bossDown: false, tether: 0 };
    this.hinted = new Set();
    this.killsTotal = 0;
    // Ships.
    this.ships = players.map((p, i) => this.makeShip(p, i, carry));
    this.undertow = Math.max(0, ...this.ships.map((s) => mod(s, 'undertow')));
    this.wrecks = [];
  }

  makeShip(p, idx, carry) {
    const def = SHIPS[p.ship] ?? SHIPS[0];
    const mods = { ...(p.mods || {}) };
    const startU = wrapU(this.web, this.web.start + (idx === 0 ? 0 : idx % 2 ? Math.ceil(idx / 2) * 3 : -Math.ceil(idx / 2) * 3));
    return {
      idx,
      id: p.id ?? `p${idx}`,
      kind: p.kind || 'driven',
      type: p.ship ?? 0,
      def,
      mods,
      u: startU,
      pu: startU,
      in: { target: null, fire: false, hop: false, zap: false },
      dir: 1,
      state: 'live',
      downAt: -1,
      respawnAt: -1,
      cause: 0,
      inv: STEPS_PER_BEAT,
      hopCd: 0,
      zaps: 1, // a zap a zone; pickups and Bass Drop add a second
      shield: false, // Shield Beat's first shield forms on its bar line
      charge: 0,
      chargeLane: -1,
      wasFiring: false,
      lastFire: -100,
      lastGrid: -1,
      contact: 0,
      contactCause: 0,
      echoes: [],
      kills: 0,
      score: 0,
      chords: 0,
      tether: 0,
      bassKills: 0,
      lat: p.lat || 0,
      pressedAt: -1,
      shots: 0,
      zone: { kills: 0, downs: 0 },
    };
  }

  // ---------------------------------------------------------------- events

  /** Records an event for the renderer, the audio and the network: [kind, id, lane, z, a, b]. */
  event(kind, id = 0, lane = 0, z = 0, a = 0, b = 0, c = 0) {
    if (this.ev.length < 512) this.ev.push({ k: kind, id, lane, z, a, b, c, step: this.step });
  }

  drain() {
    const out = this.ev;
    this.ev = [];
    return out;
  }

  hint(kind, ship) {
    if (!this.zone.guided && !this.zone.hints) return;
    if (this.hinted.has(kind) || ship.kind !== 'driven') return;
    this.hinted.add(kind);
    this.event('hint', 0, laneOf(this.web, ship.u), 0, kind);
  }

  // ---------------------------------------------------------------- the clock

  get beat() {
    return Math.floor(this.step / STEPS_PER_BEAT);
  }
  get bar() {
    return Math.floor(this.step / STEPS_PER_BAR);
  }
  get overdrive() {
    return this.odUntil > this.step;
  }
  get seconds() {
    return this.step * this.dt;
  }

  /** Advance one step (an eighth of a sixteenth note). */
  update() {
    const s = ++this.step;
    const tickEdge = s % STEPS_PER_TICK === 0;
    if (tickEdge) this.tick = s / STEPS_PER_TICK;
    const barEdge = s % STEPS_PER_BAR === 0;
    if (barEdge) this.onBar();
    if (tickEdge && s % (STEPS_PER_BEAT / 2) === 0) this.hum();

    // The phase machine.
    if (this.phase === PHASE.COUNTIN && this.tick >= COUNTIN_BARS * TICKS_PER_BAR) {
      this.setPhase(PHASE.PLAY);
      if (this.zone.level >= 4 && !this.boss) this.boss = makeBoss(this, this.def.boss);
    }
    if ((this.phase === PHASE.PLAY || this.phase === PHASE.VAMP) && tickEdge) this.spawnDue();
    if (this.phase === PHASE.PLAY && !this.boss && this.tick >= this.endTick && this.auth) this.setPhase(PHASE.VAMP);
    if (this.phase === PHASE.VAMP && barEdge && this.auth) {
      const live = this.enemies.some((e) => !e.dead && e.type !== E.SHOT && e.type !== E.MINE);
      const bars = (s - this.phaseAt) / STEPS_PER_BAR;
      if (!live || bars >= this.vampBars) {
        this.scatter();
        this.setPhase(PHASE.WARP);
      }
    }
    if (this.phase === PHASE.WARP && s - this.phaseAt >= WARP_BARS * STEPS_PER_BAR && this.auth) this.finishZone();

    if (this.boss) updateBoss(this, this.boss);

    // Ships move first, then they fire, then bolts fly, then enemies act, then contact. A mirror catching up to a
    // snapshot replays only the world: its own ship and bolts already lived through these steps.
    if (!this.replaying) {
      for (const ship of this.ships) this.updateShip(ship);
      this.updateBolts();
    }
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.dead) updateEnemy(this, e);
    }
    this.updatePickups();
    if (this.auth && this.choirs.size) this.updateChoirs();
    if (!this.replaying) this.updateHazards();
    else {
      this.pulses = this.pulses.filter((p) => p[1] > this.step);
      this.booms = this.booms.filter((p) => p[1] > this.step);
    }
    if (this.auth) this.updateCoop();
    this.compact();
    if (!this.replaying) this.guideHints();
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseAt = this.step;
    this.event('phase', 0, 0, 0, phase);
  }

  spawnDue() {
    while (this.spawnIdx < this.spawns.length && this.spawns[this.spawnIdx].tick <= this.tick) {
      const sp = this.spawns[this.spawnIdx];
      const id = this.spawnIdx + 1;
      this.spawnIdx++;
      if (this.boss && this.boss.down) continue;
      if (sp.tick < this.tick - TICKS_PER_BAR) continue; // far in the past (a late mirror): the snapshot brings it
      let type = sp.type;
      // Fairness caps, applied where the spawn happens so no score can break them.
      if (type === E.PULSAR && this.countType(E.PULSAR) >= Math.max(1, Math.floor(this.n / 6))) type = E.FLIPPER;
      if (type === E.SPIKER && this.spikedLanes() >= Math.floor(this.n / 2)) type = E.FLIPPER;
      if (type === E.BOMBER && this.countType(E.BOMBER) >= 2) type = E.TANKER;
      if (this.enemies.length >= 90) continue;
      const e = spawnEnemy(this, type, sp.lane, { id, group: sp.group });
      if (type === E.SIREN) this.joinChoir(e, sp.group);
      this.event('spawn', e.id, sp.lane, 1, type);
    }
  }

  countType(type) {
    let c = 0;
    for (const e of this.enemies) if (!e.dead && e.type === type) c++;
    return c;
  }

  spikedLanes() {
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.spikes[i] > 0.3) c++;
    return c;
  }

  onBeat() {}

  /** Fork's hum: on every eighth note it burns whatever sits on the rim in its own lane. */
  hum() {
    for (const ship of this.ships) {
      if (ship.state !== 'live' || !ship.in.fire || !ship.def.tines || ship.kind === 'puppet') continue;
      const lane = laneOf(this.web, ship.u);
      for (const e of this.enemies) if (!e.dead && e.z < 0.08 && hitLane(this, e) === lane) this.damage(e, 1, ship.idx, 'hum');
    }
  }

  onBar() {
    const finished = this.bar - 1;
    if (this.auth && (this.phase === PHASE.PLAY || this.phase === PHASE.VAMP) && finished >= COUNTIN_BARS) {
      if (this.barKills > 0 && this.barRim === 0 && this.barHit === 0) {
        this.stats.perfect++;
        this.addScore(PERFECT_BAR_POINTS * this.mult, -1);
        this.addRes(6);
        this.event('perfect', 0, 0, 0, finished, PERFECT_BAR_POINTS * this.mult);
      }
    }
    this.barKills = 0;
    this.barRim = 0;
    this.barHit = 0;
    this.barFirstKill.clear();
    // Shield Beat: a shield forms every 8 bars (4 with two).
    for (const ship of this.ships) {
      const sb = mod(ship, 'shieldbeat');
      if (sb && this.bar % (sb >= 2 ? 24 : 32) === 0 && this.bar > 0 && !ship.shield) {
        ship.shield = true;
        this.event('shield', ship.idx, laneOf(this.web, ship.u));
      }
    }
  }

  // ---------------------------------------------------------------- damage, kills, score

  damage(e, amount, by, cause) {
    if (e.dead || !(amount > 0)) return;
    if (!this.auth) {
      // A mirror only claims what its own ship did; everything else is the host's to decide.
      const ship = this.ships[by];
      if (ship && ship.kind !== 'puppet') this.claimHit(e, amount, by);
      return;
    }
    if (e.type === E.PART) {
      if (this.boss) bossDamage(this, this.boss, e, amount, by);
      return;
    }
    e.hp -= amount;
    e.flash = 4;
    e.hitBy = by;
    if (e.hp <= 0.001) this.kill(e, by, cause);
    else this.event('hit', e.id, e.lane, e.z, by);
  }

  kill(e, by, cause) {
    if (e.dead) return;
    if (e.type === E.PART) {
      if (this.boss) bossDamage(this, this.boss, e, 999, by);
      return;
    }
    e.dead = true;
    const def = ENEMIES[e.type];
    const lane = Math.round(e.lane);
    const minor = e.type === E.SHOT; // shooting down a shot pays a little and counts for nothing else
    this.killsTotal++;
    if (!minor) {
      this.stats.kills++;
      this.barKills++;
    }
    let pts = def.points;
    if (e.type === E.FUSEBALL) pts = e.z < 0.33 ? 250 : e.z < 0.66 ? 500 : 750;
    const ship = by >= 0 ? this.ships[by] : null;
    if (ship) {
      ship.kills++;
      ship.zone.kills++;
      ship.bassKills++;
      const bd = mod(ship, 'bassdrop');
      if (bd && ship.bassKills >= (bd >= 2 ? 40 : 60) && ship.zaps < 2) {
        ship.zaps++;
        ship.bassKills = 0;
        this.event('recharge', ship.idx, laneOf(this.web, ship.u), 0, ship.zaps);
      }
    }
    if (cause === 'tether') this.stats.tether++;
    const od = this.overdrive;
    const value = Math.round(pts * this.mult * (od ? 2 : 1));
    this.addScore(value, by);
    this.event('kill', e.id, e.lane, e.z, e.type, by, value);
    if (minor) return;
    // Beat window: two kills in one beat lift the multiplier; three lanes make a chord.
    if (this.bw !== this.beat) this.resetBeatWindow();
    this.bwKills++;
    if (!this.bwLanes.includes(lane)) this.bwLanes.push(lane);
    if (by >= 0) this.bwPlayers |= 1 << by;
    if (this.bwKills >= 2 && !this.bwMult) {
      this.bwMult = true;
      this.bumpMult();
    }
    if (this.bwLanes.length >= 3 && this.bwLanes.length > this.bwChord) this.chord(e, by);
    // Resonance and Overdrive.
    if (!od) {
      const rz = Math.max(0, ...this.ships.map((s) => mod(s, 'resonator')));
      this.addRes(def.res * (1 + 0.2 * rz));
    } else {
      const fb = this.ships.some((s) => mod(s, 'feedback'));
      if (fb && this.odExtended < 6 / this.dt) {
        const add = Math.round(0.1 / this.dt);
        this.odUntil += add;
        this.odExtended += add;
      }
    }
    // Type-specific aftermath.
    if (e.type === E.TANKER && cause !== 'zap') this.split(e);
    if (e.type === E.SIREN) this.choirKill(e);
    if (e.type === E.TANKER && this.rng.chance(0.3)) this.dropPickup(e);
    else if (this.killsTotal % 28 === 0) this.dropPickup(e);
    // Mods that ride on kills.
    if (ship && cause !== 'chain') {
      const ch = mod(ship, 'chain');
      if (ch) this.chainFrom(e, ship, ch);
      const db = mod(ship, 'downbeat');
      if (db && !this.barFirstKill.has(ship.idx)) {
        this.barFirstKill.add(ship.idx);
        this.event('downbeat', ship.idx, lane, e.z);
        for (const o of this.enemies) {
          if (o.dead || o === e || o.type === E.PART) continue;
          const d = laneDist(this.web, Math.round(o.lane), lane);
          if (d === 0) this.damage(o, db >= 2 ? 1.5 : 1, ship.idx, 'chain');
        }
      }
    }
  }

  chainFrom(e, ship, arcs) {
    let from = e;
    const hit = new Set([e]);
    for (let i = 0; i < arcs; i++) {
      let best = null;
      let bestD = Infinity;
      for (const o of this.enemies) {
        if (o.dead || hit.has(o) || o.type === E.PART || o.type === E.SHOT) continue;
        const dl = laneDist(this.web, Math.round(o.lane), Math.round(from.lane));
        if (dl > 1) continue;
        const d = dl + Math.abs(o.z - from.z) * 3;
        if (Math.abs(o.z - from.z) <= 0.25 && d < bestD) (bestD = d), (best = o);
      }
      if (!best) return;
      hit.add(best);
      this.event('arc', ship.idx, from.lane, from.z, best.lane * 1000 + Math.round(best.z * 999), 0);
      this.damage(best, 0.5, ship.idx, 'chain');
      from = best;
    }
  }

  resetBeatWindow() {
    this.bw = this.beat;
    this.bwKills = 0;
    this.bwLanes = [];
    this.bwPlayers = 0;
    this.bwMult = false;
    this.bwChord = 0;
    this.bwHop = false;
  }

  bumpMult() {
    const cap = MULT_CAP + 2 * Math.max(0, ...this.ships.map((s) => mod(s, 'crescendo')));
    if (this.mult < cap) {
      this.mult++;
      this.stats.maxMult = Math.max(this.stats.maxMult, this.mult);
      this.event('mult', 0, 0, 0, this.mult);
    }
  }

  chord(e, by) {
    const lanes = this.bwLanes.length;
    const prev = this.bwChord;
    this.bwChord = lanes;
    const players = popcount(this.bwPlayers);
    const harm = Math.max(0, ...this.ships.map((s) => mod(s, 'harmonic')));
    const per = CHORD_POINTS * (1 + harm);
    const value = Math.round(per * (lanes - Math.max(2, prev)) * this.mult * (this.overdrive ? 2 : 1) * (players >= 3 ? 2 : 1));
    this.addScore(value, by);
    if (prev < 3) {
      this.stats.chords++;
      this.addRes(8);
      for (const s of this.ships) if (this.bwPlayers & (1 << s.idx)) s.chords++;
      if (Math.max(0, ...this.ships.map((s) => mod(s, 'crescendo'))) > 0) this.bumpMult();
    }
    this.event('chord', 0, e.lane, e.z, lanes, players);
    // The Chord Burst: whatever sits next to the chord's notes takes a hit.
    if (prev < 3) {
      const burst = this.bwLanes.slice();
      for (const o of this.enemies) {
        if (o.dead || o.type === E.PART) continue;
        const lane = Math.round(o.lane);
        if (burst.some((l) => laneDist(this.web, l, lane) <= 1) && Math.abs(o.z - e.z) < 0.22) this.damage(o, 1, by, 'chain');
      }
    }
  }

  addScore(value, by) {
    if (!this.auth || !(value > 0)) return;
    this.score = Math.min(99_999_999, this.score + value);
    if (by >= 0 && this.ships[by]) this.ships[by].score += value;
  }

  addRes(amount) {
    if (!this.auth || this.overdrive) return;
    this.res = Math.min(RESONANCE_MAX, this.res + amount);
    if (this.res >= RESONANCE_MAX) {
      const ot = Math.max(0, ...this.ships.map((s) => mod(s, 'overtone')));
      this.odUntil = this.step + Math.round((OVERDRIVE_SECONDS * (1 + 0.25 * ot)) / this.dt);
      this.odExtended = 0;
      this.res = 0;
      this.stats.od++;
      this.event('overdrive', 0, 0, 0, this.odUntil);
    }
  }

  // ---------------------------------------------------------------- hazards

  rimArrival(e) {
    this.barRim++;
    this.stats.rim++;
    this.event('rim', e.id, e.lane, 0, e.type);
    // Rim Guard: the first to arrive each bar meets a spark.
    if (!this.auth) return;
    const guard = this.ships.find((s) => mod(s, 'rimguard') && s.state === 'live');
    if (guard && Math.floor(this.bar / 2) !== this.rimGuardBar && e.type !== E.SHOT && e.type !== E.MINE && e.type !== E.PART) {
      this.rimGuardBar = Math.floor(this.bar / 2);
      this.event('spark', guard.idx, e.lane, 0);
      this.kill(e, guard.idx, 'guard');
    }
  }

  split(e) {
    const cargo = this.def.cargo || E.FLIPPER;
    const lane = Math.round(e.lane);
    for (const side of [-1, 1]) {
      if (this.enemies.length >= 90) break;
      const c = spawnEnemy(this, cargo, lane, { z: Math.max(0, e.z), dir: side, delay: 0 });
      if (!this.web.closed && neighbour(this.web, lane, side) < 0) c.dir = -side;
      if (c.z <= 0) {
        c.z = 0;
        c.st = S.RIM;
      }
      // They leave sideways at once.
      c.from = lane;
      c.to = lane + c.dir;
      if (!this.web.closed) c.to = Math.max(0, Math.min(this.n - 1, c.to));
      c.fs = this.step;
      c.fl = STEPS_PER_TICK * 2;
      this.event('spawn', c.id, lane, c.z, cargo);
    }
  }

  enemyShot(e) {
    if (this.enemies.length >= 90 || !this.auth) return;
    const s = spawnEnemy(this, E.SHOT, Math.round(e.lane), { z: e.z - 0.03 });
    this.event('eshot', s.id, s.lane, s.z);
  }

  dropMine(e) {
    if (!this.auth || this.enemies.length >= 90) return;
    const m = spawnEnemy(this, E.MINE, Math.round(e.lane), { z: e.z - 0.02 });
    this.event('drop', m.id, m.lane, m.z);
  }

  pulse(e) {
    const lane = Math.round(e.lane);
    this.pulses.push([((lane % this.n) + this.n) % this.n, this.step + STEPS_PER_BEAT]);
    this.event('pulse', e.id, lane, e.z);
  }

  detonate(e) {
    const lane = Math.round(e.lane);
    for (let d = -1; d <= 1; d++) {
      const l = neighbour(this.web, lane, d);
      if (l >= 0) this.booms.push([l, this.step + STEPS_PER_TICK, DEATH.mine]);
    }
    this.event('boom', e.id, lane, 0);
  }

  /** A boss's blast down some lanes: deadly at the rim for a while. */
  blast(lanes, steps, cause = DEATH.boss) {
    for (const l of lanes) if (l >= 0 && l < this.n) this.booms.push([l, this.step + steps, cause]);
  }

  shotLands(e) {
    const lane = Math.round(e.lane);
    for (const ship of this.ships) {
      if (ship.state !== 'live' || ship.kind === 'puppet') continue;
      if (laneOf(this.web, ship.u) === lane) this.down(ship, DEATH.shot);
    }
  }

  updateHazards() {
    // Pulsar lanes and blasts: deadly at the rim while they last.
    if (this.pulses.length) this.pulses = this.pulses.filter((p) => p[1] > this.step);
    if (this.booms.length) this.booms = this.booms.filter((p) => p[1] > this.step);
    if (!this.pulses.length && !this.booms.length) return;
    for (const ship of this.ships) {
      if (ship.state !== 'live' || ship.kind === 'puppet') continue;
      const lane = laneOf(this.web, ship.u);
      for (const p of this.pulses) if (p[0] === lane) this.down(ship, DEATH.pulsar);
      for (const p of this.booms) if (p[0] === lane) this.down(ship, p[2] || DEATH.mine);
    }
  }

  // ---------------------------------------------------------------- the end of a zone

  scatter() {
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.dead = true;
      this.event('scatter', e.id, e.lane, e.z, e.type);
    }
  }

  finishZone() {
    if (this.phase === PHASE.DONE) return;
    if (this.auth && !this.practice) {
      const flawless = this.stats.hits === 0 && this.stats.rim === 0;
      this.stats.flawless = flawless;
      const lvl = Math.min(3, this.zone.level);
      const bonus = ZONE_POINTS * ((this.zone.world % 6) + 1) * lvl + (flawless ? FLAWLESS_POINTS * ((this.zone.world % 6) + 1) : 0);
      this.addScore(bonus, -1);
      if (flawless) this.event('flawless', 0, 0, 0, FLAWLESS_POINTS * ((this.zone.world % 6) + 1));
      if (this.zone.level >= 4 && this.lives < SHIP.maxLives) {
        // A world cleared: one more ship.
        this.lives++;
        this.event('life', 0, 0, 0, this.lives);
      }
    }
    this.setPhase(PHASE.DONE);
    this.event('clear', 0, 0, 0, this.stats.flawless ? 1 : 0);
  }

  compact() {
    if (this.enemies.some((e) => e.dead)) {
      // A boss lets go of its fallen pieces before anything can reuse them.
      if (this.boss) this.boss.parts = this.boss.parts.filter((p) => !p.dead);
      const keep = [];
      for (const e of this.enemies) {
        if (e.dead) {
          if (this.pool.length < 128 && e.type !== E.PART) this.pool.push(e);
        } else keep.push(e);
      }
      this.enemies = keep;
    }
    if (this.bolts.some((b) => b.dead)) {
      const keep = [];
      for (const b of this.bolts) {
        if (b.dead) {
          if (this.boltPool.length < 256) this.boltPool.push(b);
        } else keep.push(b);
      }
      this.bolts = keep;
    }
  }

  remove(e) {
    e.dead = true;
  }

  // ---------------------------------------------------------------- teaching moments (guided zone only)

  guideHints() {
    if (!this.zone.guided || this.step % 16 !== 0) return;
    const ship = this.ships.find((s) => s.kind === 'driven' && s.state === 'live');
    if (!ship) return;
    const lane = laneOf(this.web, ship.u);
    const climbing = this.enemies.filter((e) => !e.dead && e.z > 0.05 && e.type !== E.SHOT);
    if (climbing.length && !ship.in.fire) this.hint('fire', ship);
    if (climbing.length && !climbing.some((e) => hitLane(this, e) === lane) && this.step > 4 * STEPS_PER_BAR) this.hint('move', ship);
    if (this.spikedLanes() > 0 && this.step > 6 * STEPS_PER_BAR) this.hint('spike', ship);
    if (this.enemies.some((e) => !e.dead && e.st === S.RIM && laneDist(this.web, Math.round(e.lane), lane) <= 2)) this.hint('hop', ship);
    if (this.enemies.filter((e) => !e.dead && e.z < 0.35).length >= 3 && ship.zaps > 0) this.hint('zap', ship);
    if (this.phase === PHASE.WARP && this.spikes[lane] > 0.05) this.hint('dodge', ship);
  }

}

Object.assign(World.prototype, shipMethods, coopMethods);

function popcount(x) {
  let c = 0;
  while (x) (c += x & 1), (x >>>= 1);
  return c;
}

export { PHASE, DEATH, DEATH_NAMES, mod };
