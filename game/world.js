// The room's cast and the current round ("field"), shared by the host's page, every other page and the tests. Pure: no
// window, no document, no onceworlds.

import { DROP_MS, GOLD, musicState, rng, mixSeed, placeChairs } from './rules.js';
import { makeActor, stepActor, tryBump, knock } from './sim.js';
import { makeBrain, thinkBot } from './bots.js';

const NONE = [];

/** What the round looks like right now, filled from the match record (or the lobby's practice loop). */
export function makeField() {
  return {
    mode: 'none', // 'none' | 'match' | 'practice'
    ph: 'idle', // idle, music, race, out, over, between, final
    now: 0,
    mid: '',
    n: -1,
    rid: '',
    chairs: NONE,
    seats: NONE,
    stops: NONE,
    stopAt: 0,
    dropAt: Infinity, // chairs can be sat on from here
    riseAt: Infinity, // chairs fly back up from here
    until: 0,
    music: 'off', // 'play' | 'dip' | 'stop' | 'party' | 'off'
    playing: false, // a round of the knockout is on: whoever isn't in it is a ghost
    alive: new Set(),
    winner: null,
    out: null,
    step: 0,
    game: 1,
    chairsCycle: -1,
  };
}

export function syncField(F, g, now) {
  F.now = now;
  if (!g) {
    F.mode = 'none';
    F.ph = 'idle';
    F.mid = '';
    F.n = -1;
    F.rid = '';
    F.chairs = NONE;
    F.seats = NONE;
    F.stops = NONE;
    F.dropAt = Infinity;
    F.riseAt = Infinity;
    F.music = 'off';
    F.playing = false;
    F.winner = null;
    F.out = null;
    F.alive.clear();
    return F;
  }
  F.mode = 'match';
  if (F.mid !== g.mid || F.n !== g.n) {
    F.mid = g.mid;
    F.n = g.n;
    F.rid = `${g.mid}.${g.n}`;
  }
  F.ph = g.ph;
  F.chairs = g.chairs;
  F.seats = g.seats;
  F.stops = g.stops;
  F.stopAt = g.stopAt;
  F.dropAt = g.ph === 'race' ? g.stopAt + DROP_MS : Infinity;
  F.riseAt = g.ph === 'out' ? g.until - 400 : Infinity;
  F.until = g.until;
  F.winner = g.winner;
  F.out = g.out;
  F.step = g.step;
  F.game = g.game;
  F.playing = g.ph === 'music' || g.ph === 'race' || g.ph === 'out';
  F.alive.clear();
  for (const id of g.alive) F.alive.add(id);
  F.music = g.ph === 'music' ? musicState(g.stops, now) : g.ph === 'race' || g.ph === 'out' ? 'stop' : 'party';
  return F;
}

export function canSit(F, a) {
  return F.ph === 'race' && F.now >= F.dropAt && F.now < F.riseAt && F.alive.has(a.id) && !a.ghost;
}

export function botMode(F) {
  if (F.ph === 'race') return 'race';
  if (F.ph === 'music') return F.music === 'dip' ? 'dip' : 'dance';
  if (F.ph === 'out') return 'idle';
  return 'dance';
}

/**
 * The lobby's practice loop: music, a stop, a chair for everyone (and a spare), chairs away, again. It runs on the
 * platform's clock, so every page draws the same chairs at the same moments; nothing is scored. Sitting is decided
 * on each page for its own player and shown to the others through presence.
 */
export const PRACTICE = { cycle: 14000, music: 9000, hold: 13500 };

export class Practice {
  constructor(seed = 7) {
    this.seed = seed;
    this.cached = -1;
    this.spots = [];
    this.count = 4;
  }

  /** Fills `F` for the clock `clock` (ms) with `count` chairs. */
  fill(F, clock, count, ids) {
    const cycle = Math.floor(clock / PRACTICE.cycle);
    const t = clock - cycle * PRACTICE.cycle;
    const start = cycle * PRACTICE.cycle;
    if (cycle !== this.cached || this.spots.length < count) {
      this.cached = cycle;
      this.spots = placeChairs(10, [], rng(mixSeed(this.seed, cycle, 'practice')));
    }
    F.mode = 'practice';
    F.now = clock;
    F.mid = 'practice';
    F.n = cycle;
    F.rid = `practice.${cycle}`;
    F.stops = NONE;
    F.stopAt = start + PRACTICE.music;
    F.until = start + PRACTICE.cycle;
    F.riseAt = start + PRACTICE.hold;
    F.winner = null;
    F.out = null;
    F.playing = false;
    F.step = 1;
    F.game = 1;
    F.alive.clear();
    for (const id of ids) F.alive.add(id);
    if (t < PRACTICE.music) {
      F.ph = 'music';
      F.music = 'play';
      F.dropAt = Infinity;
      if (F.chairs !== NONE) {
        F.chairs = NONE;
        F.seats = NONE;
      }
    } else {
      F.ph = 'race';
      F.music = 'stop';
      F.dropAt = F.stopAt + DROP_MS;
      const n = Math.max(2, Math.min(10, count));
      if (F.chairs === NONE || F.chairs.length !== n || F.chairsCycle !== cycle) {
        F.chairs = this.spots.slice(0, n);
        F.seats = F.chairs.map(() => null);
        F.chairsCycle = cycle;
      }
    }
    return F;
  }
}

/** Everyone in the room, the round, and how the bots are run. `hooks`: claim(a, chair), knockRemote(a, other, nx, ny), landed(a, other). */
export class World {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.actors = new Map();
    this.list = [];
    this.brains = new Map();
    this.field = makeField();
    this.lastRid = '';
    this.seed = 0;
    this.V = { mode: 'dance', field: this.field, list: this.list, alive: this.field.alive };
    this.env = {
      list: this.list,
      field: this.field,
      canSit: false,
      claim: (a, i) => hooks.claim && hooks.claim(a, i),
      bonk: (a) => hooks.bonk && hooks.bonk(a),
      hit: (a, o, nx, ny) => {
        if (o.kind === 'bot' || o.kind === 'me') knock(o, nx, ny);
        else if (hooks.knockRemote) hooks.knockRemote(a, o, nx, ny);
        if (hooks.landed) hooks.landed(a, o, nx, ny);
      },
    };
  }

  get(id) {
    return this.actors.get(id) || null;
  }

  add(id, kind, x, y) {
    let a = this.actors.get(id);
    if (a) {
      a.kind = kind;
      if (kind === 'bot' || kind === 'view') this.ensureBrain(a);
      return a;
    }
    a = makeActor(id, kind, x, y);
    this.actors.set(id, a);
    this.list.push(a);
    if (kind === 'bot' || kind === 'view') this.ensureBrain(a);
    return a;
  }

  ensureBrain(a) {
    if (!this.brains.has(a.id)) {
      const B = makeBrain(a.id, this.seed);
      this.brains.set(a.id, B);
      a.speedMul = B.speedMul;
    }
  }

  remove(id) {
    const a = this.actors.get(id);
    if (!a) return;
    this.actors.delete(id);
    this.brains.delete(id);
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
  }

  clear() {
    this.actors.clear();
    this.brains.clear();
    this.list.length = 0;
  }

  /** After the field was filled: new round resets, ghosts, and who sits where for the pages we don't simulate. */
  afterField() {
    const F = this.field;
    if (F.rid !== this.lastRid) {
      this.lastRid = F.rid;
      for (const a of this.list) {
        a.hits.length = 0;
        if (a.kind === 'me' || a.kind === 'bot') {
          a.chair = -1;
          a.sat = false;
          a.claimT = 0;
        }
      }
    }
    for (const a of this.list) {
      a.ghost = F.playing && !F.alive.has(a.id);
      const i = F.seats.indexOf(a.id);
      if (a.kind === 'remote' || a.kind === 'view') {
        a.chair = i;
        a.sat = i >= 0;
      } else if (i >= 0 && a.chair < 0 && F.ph === 'race') {
        // the host has given this one a chair it doesn't remember (a reload, a new host): sit down
        a.chair = i;
        a.sat = true;
      }
    }
  }

  /** Steps one bot the host simulates. */
  stepBot(a, dt) {
    const F = this.field;
    const B = this.brains.get(a.id);
    if (!B) return;
    if (F.ph === 'over' && F.winner === a.id) {
      a.x = GOLD.x;
      a.y = GOLD.y;
      a.vx = a.vy = a.kx = a.ky = 0;
      return;
    }
    this.V.mode = botMode(F);
    thinkBot(a, B, this.V, dt);
    if (B.bump) tryBump(a);
    this.env.canSit = canSit(F, a);
    stepActor(a, B.mx, B.my, dt, this.env);
  }

  stepBots(dt) {
    for (let i = 0; i < this.list.length; i++) {
      const a = this.list[i];
      if (a.kind === 'bot') this.stepBot(a, dt);
    }
  }
}

