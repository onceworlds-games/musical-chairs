// Company and pickups, mixed into World: revives, tethers between neighbours, choirs that must fall together, and
// the notes that climb from a kill to whoever catches them. Methods run with `this` as the World.
import { laneOf, laneDelta } from './web.js';
import { E, PICKUPS, SHIP, STEPS_PER_BAR, STEPS_PER_BEAT, CHOIR_BONUS } from './data.js';
import { spawnEnemy } from './enemies.js';
import { mod } from './world-shared.js';

export const coopMethods = {
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
  },

  joinChoir(e, group) {
    if (!group) return;
    let c = this.choirs.get(group);
    if (!c) {
      c = { lanes: [], until: -1, reforms: 0, done: false };
      this.choirs.set(group, c);
    }
    c.lanes.push(Math.round(e.lane));
  },

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
  },

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
        const s = spawnEnemy(this, E.SIREN, lane, { z, group, rng: this.hrng });
        this.event('spawn', s.id, lane, z, E.SIREN);
      }
      this.event('reform', group, c.lanes[0], z);
    }
  },

  dropPickup(e) {
    if (!this.auth || this.pickups.length >= 6) return;
    const r = this.hrng.next();
    const kind = r < 0.45 ? PICKUPS.ZAP : r < 0.88 ? PICKUPS.TEMPO : PICKUPS.LIFE;
    this.pickups.push({ id: this.nextId++, kind, lane: Math.round(e.lane), z: Math.max(0.05, e.z), dead: false, pz: e.z, pl: Math.round(e.lane) });
  },

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
  },

  collect(ship, p) {
    if (p.kind === PICKUPS.ZAP) ship.zaps = Math.min(2, ship.zaps + 1);
    else if (p.kind === PICKUPS.LIFE) {
      if (this.lives < SHIP.maxLives) this.lives++;
      else this.addScore(5000, ship.idx);
    } else this.addRes(25);
    this.event('pickup', ship.idx, p.lane, 0, p.kind);
  },
};
