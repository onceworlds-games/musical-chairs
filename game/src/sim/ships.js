// The ships' side of a zone, mixed into World: moving round the rim, firing on the grid, bolts and what they hit,
// hops and zaps, getting caught, coming back. Methods run with `this` as the World.
import { laneOf, wrapU, laneDelta, laneDist, opposite, neighbour } from './web.js';
import { E, SHIP, STEPS_PER_TICK, STEPS_PER_BEAT, STEPS_PER_BAR, WARP_BARS } from './data.js';
import { hitLane, contactLane, rimDanger, S } from './enemies.js';
import { bossDamage } from './bosses.js';
import { PHASE, DEATH, mod } from './world-shared.js';

const BOLT_R = 0.035;

export const shipMethods = {
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
      // No charge left: the press still answers (a dull note and a word).
      if (ship.zaps <= 0) this.event('nozap', ship.idx, laneOf(this.web, ship.u));
      else if (this.auth) this.zap(ship);
      else this.event('zapask', ship.idx, laneOf(this.web, ship.u));
    }
    this.fireControl(ship);
    if (this.phase !== PHASE.WARP) this.contact(ship);
    else this.warpSpikes(ship);
  },

  hop(ship) {
    const from = laneOf(this.web, ship.u);
    const gn = mod(ship, 'gracenote');
    ship.hopCd = this.step + (gn >= 2 ? (STEPS_PER_BEAT * 3) / 4 : STEPS_PER_BEAT);
    let to = from + ship.dir * SHIP.hopLanes;
    if (!this.web.closed) to = Math.max(0, Math.min(this.n - 1, to));
    ship.u = wrapU(this.web, to);
    ship.pu = ship.u;
    ship.inv = Math.max(ship.inv, this.step + Math.round((SHIP.hopInvuln + 0.06 * gn) / this.dt));
    ship.contact = 0;
    ship.charge = 0;
    const phase = (((this.step - ship.lat) % STEPS_PER_BEAT) + STEPS_PER_BEAT) % STEPS_PER_BEAT;
    const onBeat = phase <= 5 || phase >= STEPS_PER_BEAT - 5;
    this.event('hop', ship.idx, ship.u, 0, from, onBeat ? 1 : 0);
    if (onBeat && this.auth) this.beatHop();
    // Phase Hop: the lanes crossed burn.
    const ph = mod(ship, 'phasehop');
    if (ph) this.phaseBurn(ship, from, laneOf(this.web, ship.u), ph);
  },

  beatHop() {
    if (this.bw !== this.beat) this.resetBeatWindow();
    if (this.bwHop) return;
    this.bwHop = true;
    this.bumpMult();
  },

  phaseBurn(ship, from, to, ph) {
    const d = laneDelta(this.web, from, to);
    const dir = Math.sign(d) || ship.dir;
    for (let i = 0; i <= Math.abs(d); i++) {
      const lane = laneOf(this.web, from + dir * i);
      for (const e of this.enemies) {
        if (e.dead || e.type === E.PART) continue;
        if (e.z < (ph >= 2 ? 0.25 : 0.07) && hitLane(this, e) === lane) this.damage(e, ph >= 2 ? 3 : 1.5, ship.idx, 'phase');
      }
    }
  },

  zap(ship) {
    if (ship.zaps <= 0 || ship.state !== 'live') return false;
    ship.zaps--;
    ship.bassKills = 0;
    const lane = laneOf(this.web, ship.u);
    const radius = SHIP.zapRadius + mod(ship, 'forte');
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
  },

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
        this.spawnBolt(ship, lane, { dmg: sus >= 2 ? 4.5 : 3, pierce: 99, speed: 2.2, kind: 4 });
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
  },

  shoot(ship, lane, pressed) {
    ship.lastFire = this.step;
    ship.shots++;
    const def = ship.def;
    const phase = (((this.step - ship.lat) % STEPS_PER_BEAT) + STEPS_PER_BEAT) % STEPS_PER_BEAT;
    const onBeat = phase <= 3 || phase >= STEPS_PER_BEAT - 3;
    const offBeat = Math.abs(phase - STEPS_PER_BEAT / 2) <= 3;
    let dmg = def.dmg * (mod(ship, 'tremolo') ? 0.68 : 1);
    let pierce = mod(ship, 'pierce') + (def.pierceAll ? 99 : 0) + (this.overdrive ? 1 : 0);
    let speed = def.speed * (1 + 0.25 * mod(ship, 'staccato'));
    const met = mod(ship, 'metronome');
    const syn = mod(ship, 'syncopate');
    if (met && onBeat) dmg += met >= 2 ? 1 : 0.6;
    if (syn && offBeat) (dmg += syn >= 2 ? 0.75 : 0.5), (speed *= 1.25);
    const opts = { dmg, pierce, speed, kind: 0, range: def.range };
    if (def.tines) {
      // Two tines, a lane either side, together (at the end of an open web, both down the one there is).
      const a = neighbour(this.web, lane, -1);
      const b = neighbour(this.web, lane, 1);
      this.spawnBolt(ship, a >= 0 ? a : b, opts);
      this.spawnBolt(ship, b >= 0 ? b : a, opts);
    } else this.spawnBolt(ship, lane, opts);
    if (def.spread) {
      for (const side of [-1, 1]) {
        const l = neighbour(this.web, lane, side);
        if (l >= 0) this.spawnBolt(ship, l, { ...opts, kind: 1 });
      }
    }
    const sp = mod(ship, 'spread');
    if (sp && ship.shots % (sp >= 2 ? 2 : 3) === 0) {
      // Short side bolts: they guard the neighbouring lanes near the rim.
      for (const side of [-1, 1]) {
        const l = neighbour(this.web, lane, side);
        if (l >= 0) this.spawnBolt(ship, l, { ...opts, dmg: dmg * 0.4, pierce: 0, kind: 1, range: 0.45 });
      }
    }
    if (mod(ship, 'counterpoint')) this.spawnBolt(ship, opposite(this.web, lane), { ...opts, dmg: dmg * 0.3, pierce: 0, kind: 3 });
    const echo = mod(ship, 'echo');
    if (echo && ship.echoes.length < 16) ship.echoes.push([this.step + STEPS_PER_BEAT, lane, dmg * (echo >= 2 ? 0.45 : 0.3)]);
    this.event('fire', ship.idx, lane, 0, onBeat ? 1 : offBeat ? 2 : 0, pressed ? 1 : 0);
  },

  /** Where a ship's drones sit, in lanes from it: they swing out and back over two bars. */
  droneOffsets(ship, count) {
    const t = (this.step % (STEPS_PER_BAR * 2)) / (STEPS_PER_BAR * 2);
    const reach = Math.round(2 + Math.sin(t * Math.PI * 2));
    if (count >= 2) return [-reach, reach];
    return [this.bar % 2 ? reach : -reach];
  },

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
  },

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
          b.dmg *= 0.6;
          b.hit = null;
          this.event('bounce', b.owner, lane, 1);
        } else b.dead = true;
      } else if (b.dir < 0 && b.z <= 0) b.dead = true;
    }
  },

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
  },

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
  },

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
  },

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
  },

  hitSpike(b, lane) {
    const ship = this.ships[b.owner];
    const sb = ship && mod(ship, 'spikebreaker');
    const cut = 0.065 * b.dmg * (sb ? 3 : 1);
    this.spikes[lane] = Math.max(0, this.spikes[lane] - cut);
    if (this.spikes[lane] < 0.04) this.spikes[lane] = 0;
    b.dead = true;
    this.event('spike', b.owner, lane, 1 - this.spikes[lane]);
    if (this.auth && ship) this.addScore(sb ? 20 : 3, ship.idx);
  },

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
  },

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
  },

  /** How far down the tube the ships are during the warp (0..1). */
  warpZ() {
    if (this.phase !== PHASE.WARP && this.phase !== PHASE.DONE) return 0;
    const t = Math.min(1, (this.step - this.phaseAt) / (WARP_BARS * STEPS_PER_BAR));
    return t * t * (3 - 2 * t);
  },

  /** A ship is caught. Lives are shared; in company a downed ship waits to be revived. force: its own page said so. */
  down(ship, cause, force = false) {
    if (ship.state !== 'live') return;
    if (!force && this.step < ship.inv) return;
    if (ship.shield && !force && cause !== DEATH.boss && cause !== DEATH.tide) {
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
    if (this.forgive) {
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
  },

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
  },

  /** The run is over when nobody is flying or about to fly again. */
  checkOver() {
    if (!this.auth || this.phase === PHASE.OVER || this.phase === PHASE.DONE) return;
    // A ship whose player is away (a reload, a dropped connection) still counts: they may be back in a moment.
    if (this.ships.some((s) => s.state === 'live' || s.state === 'wait' || s.state === 'away')) return;
    this.setPhase(PHASE.OVER);
    this.event('over', 0, 0, 0, this.ships.find((s) => s.cause)?.cause || 0);
  },

  nextBarStep(minGap) {
    const next = (Math.floor((this.step + minGap) / STEPS_PER_BAR) + 1) * STEPS_PER_BAR;
    return next;
  },

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
  },

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
  },
};
