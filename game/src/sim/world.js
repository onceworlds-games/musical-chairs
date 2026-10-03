// The simulation of one zone: a pure, deterministic state machine stepped 8 times per sixteenth note. No DOM, no
// clocks, no Math.random: the same zone, seed and inputs give the same result on every run (tests, the balance
// harness, the host's page and a mirror replaying a snapshot all use this code).
//
// auth: true on the page that decides (solo, the host, the harness). A mirror (auth: false) moves everything by the
// same rules but spawns only the score's scheduled enemies, keeps no score and turns its own hits into claims.
import { Rng, hash32 } from './rng.js';
import { makeWeb, laneOf, wrapU, laneDelta, laneDist, opposite, neighbour } from './web.js';
import { buildZone } from './levelgen.js';
import {
  E,
  ENEMIES,
  WORLDS,
  SHIPS,
  SHIP,
  PICKUPS,
  STEPS_PER_TICK,
  STEPS_PER_BEAT,
  STEPS_PER_BAR,
  TICKS_PER_BAR,
  TICKS_PER_BEAT,
  COUNTIN_BARS,
  VAMP_BARS,
  WARP_BARS,
  CHOIR_BONUS,
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
import { spawnEnemy, updateEnemy, hitLane, contactLane, rimDanger, S, ghostVisible } from './enemies.js';
import { makeBoss, updateBoss, bossPartKilled, bossDamage } from './bosses.js';

export const PHASE = { COUNTIN: 0, PLAY: 1, VAMP: 2, WARP: 3, DONE: 4, OVER: 5 };
const BOLT_R = 0.035;
const DEATH = { flipper: 1, shot: 2, pulsar: 3, mine: 4, spike: 5, fuseball: 6, ghost: 7, weaver: 8, siren: 9, bomber: 10, boss: 11, tide: 12 };
export const DEATH_NAMES = Object.fromEntries(Object.entries(DEATH).map(([k, v]) => [v, k.toUpperCase()]));

const mod = (ship, key) => ship.mods[key] || 0;

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
    this.hpMul = 1 + 0.25 * Math.floor((zone.world || 0) / 2);
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
      shield: mod({ mods }, 'shieldbeat') > 0,
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
  event(kind, id = 0, lane = 0, z = 0, a = 0, b = 0) {
    if (this.ev.length < 512) this.ev.push({ k: kind, id, lane, z, a, b, step: this.step });
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
    if (tickEdge && s % STEPS_PER_BEAT === 0) this.onBeat();

    // The phase machine.
    if (this.phase === PHASE.COUNTIN && this.tick >= COUNTIN_BARS * TICKS_PER_BAR) {
      this.setPhase(PHASE.PLAY);
      if (this.zone.level >= 4) this.boss = makeBoss(this, this.def.boss);
    }
    if ((this.phase === PHASE.PLAY || this.phase === PHASE.VAMP) && tickEdge) this.spawnDue();
    if (this.phase === PHASE.PLAY && !this.boss && this.tick >= this.endTick) this.setPhase(PHASE.VAMP);
    if (this.phase === PHASE.VAMP && barEdge) {
      const live = this.enemies.some((e) => !e.dead && e.type !== E.SHOT && e.type !== E.MINE);
      const bars = (s - this.phaseAt) / STEPS_PER_BAR;
      if (!live || bars >= this.vampBars) {
        this.scatter();
        this.setPhase(PHASE.WARP);
      }
    }
    if (this.phase === PHASE.WARP && s - this.phaseAt >= WARP_BARS * STEPS_PER_BAR) this.finishZone();

    if (this.boss) updateBoss(this, this.boss);

    // Ships move first, then they fire, then bolts fly, then enemies act, then contact.
    for (const ship of this.ships) this.updateShip(ship);
    this.updateBolts();
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      if (!e.dead) updateEnemy(this, e);
    }
    this.updatePickups();
    if (this.auth && this.choirs.size) this.updateChoirs();
    this.updateHazards();
    if (this.auth) this.updateCoop();
    this.compact();
    this.guideHints();
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

  onBeat() {
    // Fork's hum and the tether burn on the beat.
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
      if (sb && this.bar % (sb >= 2 ? 10 : 16) === 0 && !ship.shield) {
        ship.shield = true;
        this.event('shield', ship.idx, laneOf(this.web, ship.u));
      }
    }
  }

  // ---------------------------------------------------------------- ships

  updateShip(ship) {
    ship.pu = ship.u;
    const input = ship.in;
    if (ship.state === 'wait') {
      if (this.step >= ship.respawnAt) {
        if (ship.kind === 'puppet') {
          // Its own page picks the lane; the room just sees it back.
          ship.state = 'live';
          ship.inv = this.step + STEPS_PER_BEAT * 2;
          this.event('respawn', ship.idx, laneOf(this.web, ship.u));
        } else this.respawn(ship);
      }
      return;
    }
    if (ship.kind === 'puppet') return; // moved and judged by its own page
    if (ship.state !== 'live') {
      input.hop = input.zap = false;
      return;
    }
    // Movement toward the target lane, the short way round.
    const before = laneOf(this.web, ship.u);
    if (input.target !== null && input.target !== undefined && Number.isFinite(input.target)) {
      const target = wrapU(this.web, Math.round(input.target));
      const d = laneDelta(this.web, ship.u, target);
      const max = SHIP.speed * this.dt;
      if (Math.abs(d) > 1e-4) {
        const step = Math.abs(d) <= max ? d : Math.sign(d) * max;
        ship.u = wrapU(this.web, ship.u + step);
        ship.dir = Math.sign(d);
      } else ship.u = target;
    }
    const lane = laneOf(this.web, ship.u);
    if (lane !== before) {
      ship.charge = 0;
      if (this.phase === PHASE.WARP) this.event('move', ship.idx, lane);
    }
    // Hop: a blink three lanes on, with a moment of safety.
    if (input.hop) {
      input.hop = false;
      if (this.step >= ship.hopCd) this.hop(ship);
    }
    if (input.zap) {
      input.zap = false;
      if (this.auth) this.zap(ship);
      else if (ship.zaps > 0) this.event('zapask', ship.idx, laneOf(this.web, ship.u));
    }
    this.fireControl(ship);
    if (this.phase !== PHASE.WARP) this.contact(ship);
    else this.warpSpikes(ship);
  }

  hop(ship) {
    const from = laneOf(this.web, ship.u);
    const gn = mod(ship, 'gracenote');
    ship.hopCd = this.step + (gn >= 2 ? STEPS_PER_BEAT / 2 : STEPS_PER_BEAT);
    let to = from + ship.dir * SHIP.hopLanes;
    if (!this.web.closed) to = Math.max(0, Math.min(this.n - 1, to));
    ship.u = wrapU(this.web, to);
    ship.pu = ship.u;
    ship.inv = Math.max(ship.inv, this.step + Math.round((SHIP.hopInvuln * (1 + gn)) / this.dt));
    ship.contact = 0;
    ship.charge = 0;
    const phase = (((this.step - ship.lat) % STEPS_PER_BEAT) + STEPS_PER_BEAT) % STEPS_PER_BEAT;
    const onBeat = phase <= 5 || phase >= STEPS_PER_BEAT - 5;
    this.event('hop', ship.idx, ship.u, 0, from, onBeat ? 1 : 0);
    if (onBeat && this.auth) this.beatHop();
    // Phase Hop: the lanes crossed burn.
    const ph = mod(ship, 'phasehop');
    if (ph) this.phaseBurn(ship, from, laneOf(this.web, ship.u), ph);
  }

  beatHop() {
    if (this.bw !== this.beat) this.resetBeatWindow();
    if (this.bwHop) return;
    this.bwHop = true;
    this.bumpMult();
  }

  phaseBurn(ship, from, to, ph) {
    const d = laneDelta(this.web, from, to);
    const dir = Math.sign(d) || ship.dir;
    for (let i = 0; i <= Math.abs(d); i++) {
      const lane = laneOf(this.web, from + dir * i);
      for (const e of this.enemies) {
        if (e.dead || e.type === E.PART) continue;
        if (e.z < (ph >= 2 ? 0.3 : 0.07) && hitLane(this, e) === lane) this.damage(e, 2, ship.idx, 'phase');
      }
    }
  }

  zap(ship) {
    if (ship.zaps <= 0 || ship.state !== 'live') return false;
    ship.zaps--;
    ship.bassKills = 0;
    const lane = laneOf(this.web, ship.u);
    const radius = SHIP.zapRadius + 2 * mod(ship, 'forte');
    this.event('zap', ship.idx, lane, 0, radius);
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.type === E.PART) {
        if (this.boss && this.boss.active) bossDamage(this, this.boss, e, laneDist(this.web, Math.round(e.lane), lane) <= radius ? 'zap' : 'zapfar', ship.idx);
        continue;
      }
      if (laneDist(this.web, Math.round(e.lane), lane) <= radius) this.kill(e, ship.idx, 'zap');
      else this.damage(e, 1, ship.idx, 'zap');
    }
    // A zap also melts the spikes it covers.
    for (let i = 0; i < this.n; i++) if (laneDist(this.web, i, lane) <= radius) this.spikes[i] = Math.max(0, this.spikes[i] - 0.4);
    return true;
  }

  /** Bolts on the grid while Fire is held; a press fires at once (its note waits for the grid). */
  fireControl(ship) {
    const def = ship.def;
    // Tremolo plays sixteenth triplets; Overdrive the same, on top.
    const trem = (mod(ship, 'tremolo') ? 1.5 : 1) * (this.overdrive ? 1.5 : 1);
    const period = (STEPS_PER_TICK * def.rate) / trem;
    const held = Boolean(ship.in.fire);
    const pressed = held && !ship.wasFiring;
    const released = !held && ship.wasFiring;
    ship.wasFiring = held;
    const lane = laneOf(this.web, ship.u);
    // Echoes from a beat ago come back whether or not Fire is still held.
    while (ship.echoes.length && ship.echoes[0][0] <= this.step) {
      const [, l, dmg] = ship.echoes.shift();
      this.spawnBolt(ship, l, { dmg, kind: 2, speed: def.speed });
    }
    // Sustain: hold still for a beat, let go to loose a big bolt.
    const sus = mod(ship, 'sustain');
    if (sus) {
      if (held && ship.chargeLane === lane) ship.charge++;
      else if (held) (ship.charge = 0), (ship.chargeLane = lane);
      if (released && ship.charge >= STEPS_PER_BEAT) {
        this.spawnBolt(ship, lane, { dmg: sus >= 2 ? 6 : 4, pierce: 99, speed: 2.2, kind: 4 });
        this.event('fire', ship.idx, lane, 0, 3, 1);
      }
      if (!held) ship.charge = 0;
    }
    if (!held) return;
    const crossed = Math.floor(this.step / period) !== Math.floor((this.step - 1) / period);
    if ((pressed || crossed) && this.step - ship.lastFire >= period * 0.5) this.shoot(ship, lane, pressed);
    // Drones: Chime's two on the eighth notes, the Drone mod's on the beat.
    const drones = (def.drones || 0) + mod(ship, 'drone');
    if (drones) {
      // Chime's drones play eighths; the Drone mod's play every other beat (every beat with two).
      const every = def.drones ? STEPS_PER_BEAT / 2 : mod(ship, 'drone') >= 2 ? STEPS_PER_BEAT : STEPS_PER_BEAT * 2;
      if (this.step % every === 0) {
        for (const off of this.droneOffsets(ship, drones)) {
          if (!this.web.closed && (lane + off < 0 || lane + off > this.n - 1)) continue;
          this.spawnBolt(ship, laneOf(this.web, lane + off), { dmg: 1, pierce: 0, speed: 1.6, kind: 5 });
        }
      }
    }
  }

  shoot(ship, lane, pressed) {
    ship.lastFire = this.step;
    ship.shots++;
    const def = ship.def;
    const phase = (((this.step - ship.lat) % STEPS_PER_BEAT) + STEPS_PER_BEAT) % STEPS_PER_BEAT;
    const onBeat = phase <= 3 || phase >= STEPS_PER_BEAT - 3;
    const offBeat = Math.abs(phase - STEPS_PER_BEAT / 2) <= 3;
    let dmg = def.dmg;
    let pierce = mod(ship, 'pierce') + (def.pierceAll ? 99 : 0) + (this.overdrive ? 1 : 0);
    let speed = def.speed * (1 + 0.4 * mod(ship, 'staccato'));
    const met = mod(ship, 'metronome');
    const syn = mod(ship, 'syncopate');
    if (met && onBeat) (dmg += met >= 2 ? 3 : 2), (pierce += 1);
    if (syn && offBeat) (dmg += 1), (speed *= 1.5);
    const opts = { dmg, pierce, speed, kind: 0, range: def.range };
    if (def.tines) {
      // Two tines, a lane either side, taking turns.
      const side = ship.shots % 2 ? 1 : -1;
      const l = neighbour(this.web, lane, side);
      if (l >= 0) this.spawnBolt(ship, l, opts);
      else this.spawnBolt(ship, neighbour(this.web, lane, -side), opts);
    } else this.spawnBolt(ship, lane, opts);
    if (def.spread) {
      for (const side of [-1, 1]) {
        const l = neighbour(this.web, lane, side);
        if (l >= 0) this.spawnBolt(ship, l, { ...opts, kind: 1 });
      }
    }
    const sp = mod(ship, 'spread');
    if (sp && (sp >= 2 || ship.shots % 2 === 0)) {
      // Short side bolts: they guard the neighbouring lanes near the rim.
      for (const side of [-1, 1]) {
        const l = neighbour(this.web, lane, side);
        if (l >= 0) this.spawnBolt(ship, l, { ...opts, dmg: dmg * 0.5, pierce: 0, kind: 1, range: 0.5 });
      }
    }
    if (mod(ship, 'counterpoint')) this.spawnBolt(ship, opposite(this.web, lane), { ...opts, dmg: dmg * 0.5, kind: 3 });
    const echo = mod(ship, 'echo');
    if (echo && ship.echoes.length < 16) ship.echoes.push([this.step + STEPS_PER_BEAT, lane, dmg * (echo >= 2 ? 0.6 : 0.4)]);
    this.event('fire', ship.idx, lane, 0, onBeat ? 1 : offBeat ? 2 : 0, pressed ? 1 : 0);
  }

  /** Where a ship's drones sit, in lanes from it: they swing out and back over two bars. */
  droneOffsets(ship, count) {
    const t = (this.step % (STEPS_PER_BAR * 2)) / (STEPS_PER_BAR * 2);
    const reach = Math.round(2 + Math.sin(t * Math.PI * 2));
    if (count >= 2) return [-reach, reach];
    return [this.bar % 2 ? reach : -reach];
  }

  spawnBolt(ship, lane, { dmg = 1, pierce = 0, speed = 1.6, kind = 0, range = 1 } = {}) {
    if (this.bolts.length >= SHIP.maxBolts) return null;
    const b = this.boltPool.pop() || {};
    b.owner = ship.idx;
    b.lane = lane;
    b.z = 0;
    b.pz = -0.02; // a point-blank check covers the rim itself
    b.dir = 1;
    b.speed = speed * this.dt;
    b.dmg = dmg;
    b.pierce = pierce;
    b.kind = kind;
    b.range = Math.min(1, range);
    b.bounces = mod(ship, 'ricochet');
    b.homing = ship.def.homing ? 1 : mod(ship, 'glissando') ? 0.6 : 0;
    b.hit = null;
    b.dead = false;
    b.born = this.step;
    this.bolts.push(b);
    return b;
  }

  updateBolts() {
    for (const b of this.bolts) {
      if (b.dead) continue;
      b.pz = b.z;
      b.z += b.dir * b.speed;
      if (b.homing) this.homeBolt(b);
      const lane = laneOf(this.web, b.lane);
      if (b.dir > 0) {
        // Spikes stop bolts at their tips.
        const tip = 1 - this.spikes[lane];
        if (this.spikes[lane] > 0.01 && b.z >= tip) {
          if (this.collide(b, lane, Math.min(b.pz, tip), tip)) continue;
          this.hitSpike(b, lane);
          continue;
        }
      }
      const lo = Math.min(b.pz, b.z) - BOLT_R;
      const hi = Math.max(b.pz, b.z) + BOLT_R;
      if (this.collide(b, lane, lo, hi)) continue;
      if (b.dir > 0 && b.z >= b.range) {
        if (b.bounces > 0 && b.range >= 1) {
          b.bounces--;
          b.dir = -1;
          b.hit = null;
          this.event('bounce', b.owner, lane, 1);
        } else b.dead = true;
      } else if (b.dir < 0 && b.z <= 0) b.dead = true;
    }
  }

  homeBolt(b) {
    // Bend toward the nearest enemy within a lane and a half, a little each step.
    if (b.dir < 0) return;
    let best = null;
    let bestD = 1.6;
    for (const e of this.enemies) {
      if (e.dead || e.z < b.z) continue;
      const d = Math.abs(laneDelta(this.web, b.lane, e.lane));
      if (d < bestD && hitLane(this, e) >= 0) (bestD = d), (best = e);
    }
    if (!best) {
      const r = Math.round(b.lane);
      b.lane += (r - b.lane) * 0.2;
      return;
    }
    const d = laneDelta(this.web, b.lane, Math.round(best.lane));
    b.lane = wrapU(this.web, b.lane + Math.sign(d) * Math.min(Math.abs(d), 0.06 * b.homing));
  }

  /** Bolt against enemies in its lane between lo and hi. Returns true when the bolt is spent. */
  collide(b, lane, lo, hi) {
    for (;;) {
      let best = null;
      let bestZ = b.dir > 0 ? Infinity : -Infinity;
      for (const e of this.enemies) {
        if (e.dead || e === b.hit) continue;
        if (e.z < lo || e.z > hi) continue;
        if (hitLane(this, e) !== lane) continue;
        if (b.dir > 0 ? e.z < bestZ : e.z > bestZ) (bestZ = e.z), (best = e);
      }
      if (!best) return false;
      b.hit = best;
      this.boltHits(b, best);
      if (b.pierce > 0) {
        b.pierce--;
        lo = best.z;
        continue;
      }
      b.dead = true;
      return true;
    }
  }

  boltHits(b, e) {
    if (!this.auth) {
      this.claimHit(e, b.dmg, b.owner);
      return;
    }
    if (e.type === E.PART) {
      bossDamage(this, this.boss, e, b.dmg, b.owner);
      return;
    }
    this.damage(e, b.dmg, b.owner, 'bolt');
  }

  /** A mirror's own hit: shown at once, decided by the host (the claim goes out with the next batch). */
  claimHit(e, dmg, owner) {
    if (e.dead || !(dmg > 0)) return;
    if (this.claims.length < 64) this.claims.push([e.id, Math.round(dmg * 100) / 100, Math.round(e.lane), Math.round(e.z * 1000)]);
    e.flash = 4;
    if (e.type === E.PART) {
      this.event('hit', e.id, e.lane, e.z, owner);
      return;
    }
    e.hp -= dmg;
    if (e.hp <= 0.001) {
      e.dead = true;
      this.predicted.set(e.id, this.step);
      this.event('kill', e.id, e.lane, e.z, e.type, owner, 0);
    } else this.event('hit', e.id, e.lane, e.z, owner);
  }

  hitSpike(b, lane) {
    const ship = this.ships[b.owner];
    const sb = ship && mod(ship, 'spikebreaker');
    const cut = 0.065 * b.dmg * (sb ? 3 : 1);
    this.spikes[lane] = Math.max(0, this.spikes[lane] - cut);
    if (this.spikes[lane] < 0.04) this.spikes[lane] = 0;
    b.dead = true;
    this.event('spike', b.owner, lane, 1 - this.spikes[lane]);
    if (this.auth && ship) this.addScore(sb ? 20 : 3, ship.idx);
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
      if (bd && ship.bassKills >= (bd >= 2 ? 25 : 40) && ship.zaps < 2) {
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
      this.addRes(def.res * (1 + 0.35 * rz));
    } else {
      const fb = this.ships.some((s) => mod(s, 'feedback'));
      if (fb && this.odExtended < 10 / this.dt) {
        const add = Math.round(0.15 / this.dt);
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
          if (d === 0) this.damage(o, 2, ship.idx, 'chain');
          else if (d === 1 && db >= 2) this.damage(o, 1, ship.idx, 'chain');
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
      this.damage(best, 1, ship.idx, 'chain');
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
      this.odUntil = this.step + Math.round((OVERDRIVE_SECONDS * (1 + 0.4 * ot)) / this.dt);
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
    if (guard && this.rimGuardBar !== this.bar && e.type !== E.SHOT && e.type !== E.MINE && e.type !== E.PART) {
      this.rimGuardBar = this.bar;
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

  /** Crawlers and runners on the rim catch a ship that stays in their lane past the grace. */
  contact(ship) {
    if (ship.kind === 'puppet') return;
    const lane = laneOf(this.web, ship.u);
    let touching = 0;
    for (const e of this.enemies) {
      if (e.dead || !rimDanger(this, e)) continue;
      if (contactLane(this, e) === lane) {
        touching = e.type;
        break;
      }
    }
    if (!touching) {
      ship.contact = 0;
      return;
    }
    ship.contact++;
    if (ship.contact > SHIP.contactGraceTicks * STEPS_PER_TICK) {
      const cause = { [E.FUSEBALL]: DEATH.fuseball, [E.GHOST]: DEATH.ghost, [E.WEAVER]: DEATH.weaver, [E.SIREN]: DEATH.siren, [E.BOMBER]: DEATH.bomber, [E.PULSAR]: DEATH.pulsar }[touching] || DEATH.flipper;
      this.down(ship, cause);
    }
  }

  warpSpikes(ship) {
    if (ship.kind === 'puppet' || ship.state !== 'live') return;
    const lane = laneOf(this.web, ship.u);
    const h = this.spikes[lane];
    if (h > 0.02 && this.warpZ() >= 1 - h) {
      if (mod(ship, 'spikebreaker') && !ship.spikeSaved) {
        ship.spikeSaved = true;
        this.spikes[lane] = 0;
        this.event('spike', ship.idx, lane, 1);
        return;
      }
      this.down(ship, DEATH.spike);
    }
  }

  /** How far down the tube the ships are during the warp (0..1). */
  warpZ() {
    if (this.phase !== PHASE.WARP && this.phase !== PHASE.DONE) return 0;
    const t = Math.min(1, (this.step - this.phaseAt) / (WARP_BARS * STEPS_PER_BAR));
    return t * t * (3 - 2 * t);
  }

  /** A ship is caught. Lives are shared; in company a downed ship waits to be revived. force: its own page said so. */
  down(ship, cause, force = false) {
    if (ship.state !== 'live') return;
    if (!force && this.step < ship.inv) return;
    if (ship.shield && !force) {
      ship.shield = false;
      ship.inv = this.step + STEPS_PER_BEAT;
      this.event('shieldbreak', ship.idx, laneOf(this.web, ship.u));
      return;
    }
    ship.state = 'down';
    ship.downAt = this.step;
    ship.cause = cause;
    ship.contact = 0;
    ship.zone.downs++;
    ship.echoes.length = 0;
    this.barHit++;
    this.stats.hits++;
    this.mult = 1;
    this.event('down', ship.idx, laneOf(this.web, ship.u), 0, cause);
    if (!this.auth) return;
    if (this.practice) {
      ship.state = 'wait';
      ship.respawnAt = this.nextBarStep(STEPS_PER_BEAT);
      return;
    }
    const othersLive = this.ships.some((s) => s !== ship && s.state === 'live');
    if (othersLive) {
      // Someone can still reach the wreck: it waits two bars (for good once the lives are gone).
      this.wrecks.push({ idx: ship.idx, lane: laneOf(this.web, ship.u), until: this.lives > 0 ? this.step + STEPS_PER_BAR * 2 : Infinity });
      return;
    }
    this.loseLife(ship);
  }

  loseLife(ship) {
    if (this.lives > 0) this.lives--;
    this.event('lives', ship.idx, 0, 0, this.lives);
    if (this.lives > 0) {
      ship.state = 'wait';
      ship.respawnAt = this.nextBarStep(STEPS_PER_BEAT);
    } else {
      ship.state = 'out';
      for (const w of this.wrecks) w.until = Infinity;
    }
    this.checkOver();
  }

  /** The run is over when nobody is flying or about to fly again. */
  checkOver() {
    if (!this.auth || this.phase === PHASE.OVER || this.phase === PHASE.DONE) return;
    if (this.ships.some((s) => s.state === 'live' || s.state === 'wait')) return;
    this.setPhase(PHASE.OVER);
    this.event('over', 0, 0, 0, this.ships.find((s) => s.cause)?.cause || 0);
  }

  nextBarStep(minGap) {
    const next = (Math.floor((this.step + minGap) / STEPS_PER_BAR) + 1) * STEPS_PER_BAR;
    return next;
  }

  respawn(ship) {
    // A clear lane: the one it fell in if it is safe, else the nearest safe one.
    const fell = laneOf(this.web, ship.u);
    let best = fell;
    for (let r = 0; r <= this.n; r++) {
      const cand = [fell + r, fell - r];
      let found = -1;
      for (const c of cand) {
        if (!this.web.closed && (c < 0 || c >= this.n)) continue;
        const l = laneOf(this.web, c);
        if (this.laneSafe(l)) {
          found = l;
          break;
        }
      }
      if (found >= 0) {
        best = found;
        break;
      }
    }
    ship.u = best;
    ship.pu = best;
    ship.state = 'live';
    ship.inv = this.step + STEPS_PER_BEAT * 2;
    ship.contact = 0;
    this.event('respawn', ship.idx, best);
  }

  laneSafe(lane) {
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = laneDist(this.web, Math.round(e.lane), lane);
      if (e.z < 0.12 && d <= 1 && e.type !== E.PART) return false;
      if (e.type === E.SHOT && d === 0 && e.z < 0.35) return false;
      if (e.type === E.PULSAR && d === 0) return false;
      if (e.type === E.MINE && e.st === S.ARMED && d <= 1) return false;
    }
    for (const p of this.pulses) if (p[0] === lane) return false;
    for (const p of this.booms) if (p[0] === lane) return false;
    if (this.boss?.unsafe?.(lane)) return false;
    return true;
  }

  // ---------------------------------------------------------------- company: tethers and revives

  updateCoop() {
    const live = this.ships.filter((s) => s.state === 'live');
    // Revive: a living ship touching a wreck brings it back for free.
    if (this.wrecks.length) {
      for (const w of this.wrecks) {
        const ship = this.ships[w.idx];
        if (!ship || (ship.state !== 'down' && ship.state !== 'out')) {
          w.done = true;
          continue;
        }
        const saver = live.find((s) => laneOf(this.web, s.u) === w.lane);
        if (saver) {
          w.done = true;
          ship.state = 'live';
          ship.u = w.lane;
          ship.inv = this.step + STEPS_PER_BEAT * 2;
          this.event('revive', ship.idx, w.lane, 0, saver.idx);
        } else if (this.step >= w.until && ship.state === 'down') {
          w.done = true;
          this.loseLife(ship);
        }
      }
      this.wrecks = this.wrecks.filter((w) => !w.done);
      if (!live.length) this.checkOver();
    }
    // Tethers: a burning line between ships within three lanes of each other.
    if (live.length < 2) return;
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const un = Math.max(mod(a, 'unison'), mod(b, 'unison'));
        const d = laneDelta(this.web, a.u, b.u);
        if (Math.abs(d) > 3 + un || Math.abs(d) < 0.5) continue;
        const lo = a.u;
        for (const e of this.enemies) {
          if (e.dead || e.z > 0.09 || e.type === E.PART || e.tb === this.beat) continue;
          const de = laneDelta(this.web, lo, e.lane);
          if ((d > 0 && de >= 0 && de <= d) || (d < 0 && de <= 0 && de >= d)) {
            e.tb = this.beat;
            a.tether++;
            b.tether++;
            this.event('tether', a.idx, e.lane, e.z, b.idx);
            this.damage(e, 1 + un, a.idx, 'tether');
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- choirs

  joinChoir(e, group) {
    if (!group) return;
    let c = this.choirs.get(group);
    if (!c) {
      c = { lanes: [], until: -1, reforms: 0, done: false };
      this.choirs.set(group, c);
    }
    c.lanes.push(Math.round(e.lane));
  }

  choirKill(e) {
    const c = this.choirs.get(e.group);
    if (!c || c.done) return;
    if (c.until < 0) c.until = this.step + STEPS_PER_BAR;
    const alive = this.enemies.some((o) => !o.dead && o.type === E.SIREN && o.group === e.group);
    if (!alive) {
      c.done = true;
      this.stats.choirs++;
      const value = CHOIR_BONUS * this.mult * (this.overdrive ? 2 : 1);
      this.addScore(value, e.hitBy);
      this.addRes(10);
      this.event('choir', e.group, e.lane, e.z, value);
    }
  }

  updateChoirs() {
    for (const [group, c] of this.choirs) {
      if (c.done || c.until < 0 || this.step < c.until) continue;
      const living = this.enemies.filter((o) => !o.dead && o.type === E.SIREN && o.group === group);
      if (!living.length) continue;
      c.until = -1;
      if (c.reforms >= 3) {
        c.done = true;
        continue;
      }
      c.reforms++;
      const z = Math.max(...living.map((o) => o.z));
      const taken = new Set(living.map((o) => Math.round(o.lane)));
      for (const lane of c.lanes) {
        if (taken.has(lane) || this.enemies.length >= 90) continue;
        const s = spawnEnemy(this, E.SIREN, lane, { z, group });
        this.event('spawn', s.id, lane, z, E.SIREN);
      }
      this.event('reform', group, c.lanes[0], z);
    }
  }

  // ---------------------------------------------------------------- pickups

  dropPickup(e) {
    if (!this.auth || this.pickups.length >= 6) return;
    const r = this.rng.next();
    const kind = r < 0.45 ? PICKUPS.ZAP : r < 0.88 ? PICKUPS.TEMPO : PICKUPS.LIFE;
    this.pickups.push({ id: this.nextId++, kind, lane: Math.round(e.lane), z: Math.max(0.05, e.z), dead: false, pz: e.z, pl: Math.round(e.lane) });
  }

  updatePickups() {
    for (const p of this.pickups) {
      if (p.dead) continue;
      p.pz = p.z;
      p.pl = p.lane;
      p.z -= 0.4 / STEPS_PER_BEAT;
      // Magnet pulls it toward the nearest ship that has one.
      for (const s of this.ships) {
        const m = mod(s, 'magnet');
        if (!m || s.state !== 'live') continue;
        const d = laneDelta(this.web, p.lane, laneOf(this.web, s.u));
        if (Math.abs(d) <= (m >= 2 ? this.n : 3) && d !== 0 && this.step % 8 === 0) p.lane = laneOf(this.web, p.lane + Math.sign(d));
      }
      if (p.z <= 0.02) {
        p.dead = true;
        if (!this.auth) continue;
        const ship = this.ships.find((s) => s.state === 'live' && laneOf(this.web, s.u) === laneOf(this.web, p.lane));
        if (ship) this.collect(ship, p);
      }
    }
    if (this.pickups.length > 8 || this.pickups.some((p) => p.dead)) this.pickups = this.pickups.filter((p) => !p.dead);
  }

  collect(ship, p) {
    if (p.kind === PICKUPS.ZAP) ship.zaps = Math.min(2, ship.zaps + 1);
    else if (p.kind === PICKUPS.LIFE) {
      if (this.lives < SHIP.maxLives) this.lives++;
      else this.addScore(5000, ship.idx);
    } else this.addRes(25);
    this.event('pickup', ship.idx, p.lane, 0, p.kind);
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
      const keep = [];
      for (const e of this.enemies) {
        if (e.dead) {
          if (this.pool.length < 128) this.pool.push(e);
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

function popcount(x) {
  let c = 0;
  while (x) (c += x & 1), (x >>>= 1);
  return c;
}

export { DEATH, mod };
