// The room, the match and the host. `connect` joins at once (or gives a local stand-in when the page was opened on its own);
// `Session` is what the host's page runs: the Engine, the bots' snapshots and the messages players send (a sit, a bump).
// It follows templates/party/game.js: one record `g` in room state, written only by the host; deadlines in match time;
// `adopt()` is safe to call as often as you like, and a new host carries on from the room's copy.

import { Engine, makeRoster } from './rules.js';
import { knock } from './sim.js';
import { r1, r2 } from './gfx.js';

export const SETTINGS = [{ id: 'rounds', label: 'Games', options: [1, 2, 3], default: 2 }];

export async function connect(ow) {
  if (ow && ow.rooms && typeof ow.rooms.join === 'function') {
    try {
      return await ow.rooms.join({ maxPlayers: 10, minPlayers: 1, lobby: 'bar', settings: SETTINGS });
    } catch (err) {
      console.warn('[musical-chairs] could not join a room, playing on my own', err);
    }
  }
  return new SoloRoom();
}

/** A room for one player, for a page opened outside Onceworlds: the same surface the game uses, a simple match cycle. */
export class SoloRoom {
  constructor() {
    this.stub = true;
    this.me = { id: 'you', name: 'You', presence: null, team: 0 };
    this.players = new Map([[this.me.id, this.me]]);
    this.state = {};
    this.host = this.me.id;
    this.connected = true;
    this.kind = 'solo';
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.chosen = { rounds: 2 };
    this.listeners = new Map();
    this.timer = null;
    this.t0 = Date.now();
  }
  get isHost() {
    return true;
  }
  get online() {
    return [this.me];
  }
  get participants() {
    return this.match.phase === 'lobby' ? [] : [this.me];
  }
  get spectating() {
    return false;
  }
  get running() {
    return this.match.phase === 'playing';
  }
  get settings() {
    return this.chosen;
  }
  get allReady() {
    return true;
  }
  matchNow() {
    return this.match.phase === 'playing' ? Date.now() - this.match.startedAt : 0;
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }
  emit(event, ...args) {
    for (const fn of this.listeners.get(event) || []) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }
  setPresence(d) {
    this.me.presence = d;
  }
  presenceAt(id) {
    return id === this.me.id ? this.me.presence : null;
  }
  setState(k, v) {
    if (v === null || v === undefined) delete this.state[k];
    else this.state[k] = v;
  }
  send() {}
  setReady(v) {
    if (v) this.me.ready = true;
    else delete this.me.ready;
  }
  clearReady() {
    delete this.me.ready;
  }
  hideLobby() {}
  setSetting(id, v) {
    if (id === 'rounds' && [1, 2, 3].includes(v)) {
      this.chosen = { rounds: v };
      this.emit('settings', this.chosen);
    }
  }
  startMatch() {
    if (this.match.phase !== 'lobby') return;
    const n = this.match.n + 1;
    this.match = { phase: 'starting', n, min: 1, id: `solo${n}`, seed: Math.floor(Math.random() * 4294967296), participants: [this.me.id], startsAt: Date.now() + 3000 };
    this.emit('starting', this.match);
    this.timer = setTimeout(() => {
      const prev = this.match;
      this.match = { ...prev, phase: 'playing', startedAt: Date.now() };
      delete this.match.startsAt;
      this.emit('matchstart', this.match);
    }, 3000);
  }
  endMatch() {
    clearTimeout(this.timer);
    if (this.match.phase === 'lobby') return;
    const prev = this.match;
    this.match = { phase: 'lobby', n: prev.n, min: 1 };
    this.emit('matchend', this.match, prev);
  }
  admit() {}
  leave() {}
}

export class Session {
  /**
   * `world` is the cast (world.js). `hooks.knockMe(nx, ny, fromId)` hands a bump to this page's own character; `hooks.canBump(id)`
   * says whether a player may bump right now.
   */
  constructor(room, world, hooks = {}) {
    this.room = room;
    this.world = world;
    this.hooks = hooks;
    this.engine = null;
    this.dirty = false;
    this.lastWrite = 0;
    this.lastPh = '';
    this.lastN = -1;
    this.lastBots = 0;
    this.endTry = 0;
    this.snaps = [];
    this.seenB = null;
    this.sent = { rid: '', chair: -1, at: 0 };
    this.bumpAt = new Map();
    this.tallyAt = new Map();
    this.bots = new Set();
    this.view = {
      pos: (id) => world.get(id),
      gone: (id) => !this.bots.has(id) && !room.players.has(id),
    };
    room.on('message', (d, from, at, mt) => this.onMessage(d, from, mt));
  }

  /** The room's record of this match (checked), or null. */
  get rid() {
    const g = this.engine && this.engine.g;
    return g ? `${g.mid}.${g.n}` : '';
  }

  /** This page runs the match right now. */
  get active() {
    const room = this.room;
    return Boolean(this.engine) && room.isHost && room.running && this.engine.g.mid === room.match.id && this.engine.g.by === room.me.id;
  }

  begin() {
    const room = this.room;
    const m = room.match;
    const roster = makeRoster(m.participants || [], m.seed);
    this.engine = Engine.create({ mid: m.id, by: room.me.id, seed: m.seed, roster, games: room.settings.rounds, now: room.matchNow() });
    this.afterEngine();
    this.write();
  }

  /** Carries on as the host: from the room's copy of the match, or from scratch if there isn't one. Safe to call again and again. */
  adopt() {
    const room = this.room;
    if (!room.isHost || !room.running) return;
    const m = room.match;
    if (this.engine && this.engine.g.mid === m.id && this.engine.g.by === room.me.id) return;
    const e = Engine.adopt(room.state.g, m.id, room.me.id);
    if (!e) return this.begin();
    this.engine = e;
    this.afterEngine();
    this.write();
  }

  afterEngine() {
    this.bots = new Set(this.engine.g.roster.filter((r) => r.b).map((r) => r.id));
    this.dirty = false;
    this.endTry = 0;
  }

  /** No longer the host (or the match is over): forget the engine, so a later promotion reads the room's copy. */
  drop() {
    this.engine = null;
  }

  write() {
    const g = this.engine.g;
    this.room.setState('g', JSON.parse(JSON.stringify(g)));
    this.lastWrite = performance.now();
    this.dirty = false;
    this.lastPh = g.ph;
    this.lastN = g.n;
  }

  /** One step of the host's page: move the match on and write the record when it changed (at most about 10 times a second). */
  tick(now) {
    const room = this.room;
    if (!room.isHost || !room.running) return;
    if (!this.engine || this.engine.g.mid !== room.match.id || this.engine.g.by !== room.me.id) {
      this.adopt();
      if (!this.engine) return;
    }
    if (this.engine.update(now, this.view)) this.dirty = true;
    const g = this.engine.g;
    const t = performance.now();
    if (this.dirty && (g.ph !== this.lastPh || g.n !== this.lastN || t - this.lastWrite >= 90)) this.write();
    if (this.engine.isOver(now) && t - this.endTry > 2000) {
      this.endTry = t;
      room.endMatch();
    }
  }

  // ---------------------------------------------------------------- what players say to the host

  /** This page's own character (or one of the host's bots) touched a free chair. */
  claim(a, chair) {
    const room = this.room;
    const mt = room.matchNow();
    if (this.active) this.engine.claim(a.id, chair, mt, mt, this.view);
    else if (a.kind === 'me' && room.host !== room.me.id) {
      room.send({ t: 'sit', rid: this.rid || this.currentRid(), chair }, { to: room.host });
      this.sent = { rid: this.currentRid(), chair, at: performance.now() };
    }
  }

  /** Non-hosts keep the round id from the room's record. */
  currentRid() {
    const g = this.room.state.g;
    return g && g.mid === this.room.match.id && typeof g.n === 'number' ? `${g.mid}.${g.n}` : '';
  }

  /** Ask again for a chair the host hasn't confirmed (a message can be lost). */
  resend(a) {
    const room = this.room;
    if (this.active || a.kind !== 'me' || room.host === room.me.id) return;
    const rid = this.currentRid();
    const t = performance.now();
    if (rid && this.sent.rid === rid && this.sent.chair === a.chair && t - this.sent.at > 450) {
      this.sent.at = t;
      room.send({ t: 'sit', rid, chair: a.chair }, { to: room.host });
    }
  }

  /** My character's bump landed on `target`. */
  bump(target, nx, ny) {
    const room = this.room;
    const rid = this.active ? this.rid : this.currentRid();
    if (target.kind === 'bot' || target.kind === 'view') {
      if (this.active) {
        const bot = this.world.get(target.id);
        if (bot) knock(bot, nx, ny);
        this.engine.noteBump(room.me.id);
      } else room.send({ t: 'bump', rid, to: target.id, dx: r2(nx), dy: r2(ny) }, { to: room.host });
    } else if (target.kind === 'remote') {
      room.send({ t: 'bump', rid, to: target.id, dx: r2(nx), dy: r2(ny) }, { to: target.id });
      if (this.active) this.engine.noteBump(room.me.id);
      else if (room.match.phase === 'playing' && room.host !== room.me.id) room.send({ t: 'tally', rid }, { to: room.host });
    }
  }

  /** One of the host's bots bumped a human (the host says so on the bot's behalf). */
  botBump(bot, human, nx, ny) {
    this.room.send({ t: 'bump', rid: this.rid, to: human.id, by: bot.id, dx: r2(nx), dy: r2(ny) }, { to: human.id });
  }

  onMessage(d, from, mt) {
    if (!d || typeof d !== 'object' || !from || typeof from.id !== 'string') return;
    const room = this.room;
    try {
      if (d.t === 'sit') {
        if (this.active && d.rid === this.rid) this.engine.claim(from.id, d.chair, typeof mt === 'number' ? mt : room.matchNow(), room.matchNow(), this.view);
      } else if (d.t === 'tally') {
        if (this.active && d.rid === this.rid && this.rateOk(this.tallyAt, from.id, 600)) this.engine.noteBump(from.id);
      } else if (d.t === 'bump') this.onBump(d, from);
    } catch (err) {
      console.warn('[musical-chairs] a message could not be handled', err);
    }
  }

  rateOk(map, id, ms) {
    const t = performance.now();
    if (t - (map.get(id) || 0) < ms) return false;
    map.set(id, t);
    return true;
  }

  onBump(d, from) {
    const room = this.room;
    const me = room.me.id;
    const rid = this.active ? this.rid : this.currentRid();
    const lobby = room.match.phase === 'lobby';
    if (!lobby && (!rid || d.rid !== rid)) return;
    if (typeof d.to !== 'string' || !Number.isFinite(d.dx) || !Number.isFinite(d.dy) || Math.abs(d.dx) > 1.5 || Math.abs(d.dy) > 1.5) return;
    const len = Math.hypot(d.dx, d.dy);
    if (len < 0.2) return;
    const nx = d.dx / len;
    const ny = d.dy / len;
    // who bumped: the sender, or (from the host only) one of its bots
    const byBot = typeof d.by === 'string' && from.id === room.host && this.bots.has(d.by);
    const attackerId = byBot ? d.by : from.id;
    const attacker = this.world.get(attackerId);
    if (!attacker || attacker.ghost || attacker.chair >= 0) return;
    if (!byBot && !this.rateOk(this.bumpAt, from.id, 700)) return;
    if (!lobby && !this.world.field.alive.has(attackerId)) return;
    const targetId = d.to;
    if (targetId === me) {
      const mine = this.world.get(me);
      if (!mine || Math.hypot(mine.x - attacker.x, mine.y - attacker.y) > 2.8) return;
      if (this.hooks.knockMe) this.hooks.knockMe(nx, ny, attackerId);
    } else if (this.active && this.bots.has(targetId)) {
      const bot = this.world.get(targetId);
      if (!bot || Math.hypot(bot.x - attacker.x, bot.y - attacker.y) > 2.8) return;
      if (knock(bot, nx, ny)) this.engine.noteBump(attackerId);
    }
  }

  // ---------------------------------------------------------------- the bots' positions

  /** The host shares where its bots are, about 12 times a second. */
  publishBots(now) {
    if (!this.active) return;
    const t = performance.now();
    if (t - this.lastBots < 80) return;
    this.lastBots = t;
    const p = [];
    for (const e of this.engine.g.roster) {
      if (!e.b) continue;
      const a = this.world.get(e.id);
      if (!a) p.push([0, 0, 0, 0, 0]);
      else p.push([r2(a.x), r2(a.y), r1(a.vx + a.kx), r1(a.vy + a.ky), (a.bumpT > 0 ? 1 : 0) + (a.bubble === '?' ? 2 : 0)]);
    }
    this.room.setState('b', { mid: this.engine.g.mid, rid: this.rid, t: Math.round(now), p });
  }

  /** Reads the host's latest bot positions (everyone but the host). */
  readBots() {
    const room = this.room;
    const b = room.state.b;
    if (!b || b === this.seenB) return;
    this.seenB = b;
    if (typeof b !== 'object' || b.mid !== room.match.id || typeof b.t !== 'number' || !Number.isFinite(b.t) || !Array.isArray(b.p) || b.p.length > 12) return;
    const p = [];
    for (const e of b.p) {
      if (!Array.isArray(e) || e.length < 4 || !e.slice(0, 4).every((v) => typeof v === 'number' && Number.isFinite(v))) p.push([0, 0, 0, 0, 0]);
      else p.push([e[0], e[1], e[2], e[3], typeof e[4] === 'number' ? e[4] : 0]);
    }
    const last = this.snaps[this.snaps.length - 1];
    if (last && b.t <= last.t) {
      if (b.t < last.t - 3000) this.snaps.length = 0; // the clock went back: a new match or a new host
      else return;
    }
    this.snaps.push({ t: b.t, p });
    if (this.snaps.length > 6) this.snaps.shift();
  }

  clearSnaps() {
    this.snaps.length = 0;
    this.seenB = null;
  }

  /** Puts the bots the host simulates where they were `delay` ms ago on the host's clock, between its two snapshots. */
  applyBots(now, botIds, delay = 120) {
    const s = this.snaps;
    if (s.length === 0) return false;
    const rt = now - delay;
    let a = s[0];
    let b = s[0];
    let k = 0;
    if (rt >= s[s.length - 1].t) {
      a = b = s[s.length - 1];
      k = Math.min(0.15, (rt - b.t) / 1000);
      for (let i = 0; i < botIds.length; i++) this.place(botIds[i], a.p[i], a.p[i], 0, k);
      return true;
    }
    for (let i = s.length - 2; i >= 0; i--) {
      if (s[i].t <= rt) {
        a = s[i];
        b = s[i + 1];
        break;
      }
    }
    const f = a === b ? 0 : Math.max(0, Math.min(1, (rt - a.t) / Math.max(1, b.t - a.t)));
    for (let i = 0; i < botIds.length; i++) this.place(botIds[i], a.p[i], b.p[i], f, 0);
    return true;
  }

  place(id, p, q, f, extra) {
    const a = this.world.get(id);
    if (!a || !p || !q) return;
    if (a.kind !== 'view') return;
    const jump = Math.hypot(q[0] - p[0], q[1] - p[1]) > 4;
    const w = jump ? 1 : f;
    a.x = p[0] + (q[0] - p[0]) * w + q[2] * extra;
    a.y = p[1] + (q[1] - p[1]) * w + q[3] * extra;
    a.vx = q[2];
    a.vy = q[3];
    a.kx = 0;
    a.ky = 0;
    const speed = Math.hypot(q[2], q[3]);
    if (speed > 0.4) {
      a.fx = q[2] / speed;
      a.fy = q[3] / speed;
    }
    a.bumpT = q[4] & 1 ? 0.1 : 0;
    const huh = (q[4] & 2) !== 0;
    if (huh && !a.qPrev) {
      a.bubble = '?';
      a.bubbleT = 0.9;
    }
    a.qPrev = huh;
  }
}
