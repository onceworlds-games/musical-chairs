// The room and the run. A zone is one platform match: the lobby between zones is the hub (no run), the draft (a run
// going on) or the results (a run over), drawn by the game with the platform's Ready / Start strip under it. Nothing
// here keeps the game's phase in a variable: it is derived every frame from room.match and the run record the host
// writes in room state ('run'), so a reload, a dropped connection or a new host heals itself.
//
// During a zone the host's page runs the simulation (auth) and publishes snapshots ('snap'); everyone else mirrors
// it, flies their own ship, and sends their hits, hops, zaps and falls to the host in small batches.
import { platform } from '../platform.js';
import { World, PHASE } from '../sim/world.js';
import { spawnEnemy } from '../sim/enemies.js';
import { makeBoss } from '../sim/bosses.js';
import { zoneFor, zoneCount, draftOptions, cleanMods, addMod, dailyFor, dayOf, MODES, TEMPOS, clampInt, zoneLabel } from '../sim/run.js';
import { SHIPS, SHIP, WORLDS, MODS, LEVELS_PER_WORLD } from '../sim/data.js';
import { encode, clean, apply, batch, readBatch } from './sync.js';
import { laneOf, laneDist } from '../sim/web.js';

export const JOIN = { private: true, maxPlayers: 4, minPlayers: 1, lobby: 'bar', countdown: 0 };
const SNAP_MS = 160;
const BATCH_MS = 90;
const PRESENCE_MS = 66;
const HUB_DEFAULT = { mode: 'run', oc: 0, pw: 0, pl: 1, pt: 1 };

const str = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The hub's settings from room state (anyone could have written it): known values only. */
export function cleanHub(raw) {
  const h = { ...HUB_DEFAULT };
  if (!raw || typeof raw !== 'object') return h;
  if (MODES.includes(raw.mode)) h.mode = raw.mode;
  h.oc = clampInt(raw.oc, 0, 8, 0);
  h.pw = clampInt(raw.pw, 0, WORLDS.length - 1, 0);
  h.pl = clampInt(raw.pl, 1, LEVELS_PER_WORLD, 1);
  h.pt = clampInt(raw.pt, 0, TEMPOS.length - 1, 2);
  return h;
}

/** The run record from room state, checked. */
export function cleanRun(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1 || typeof raw.rid !== 'string') return null;
  if (!MODES.includes(raw.mode)) return null;
  const players = {};
  if (raw.players && typeof raw.players === 'object') {
    for (const [id, p] of Object.entries(raw.players).slice(0, 12)) {
      if (typeof id !== 'string' || id.length > 64 || !p || typeof p !== 'object') continue;
      players[id] = {
        n: str(p.n, 24),
        ship: clampInt(p.ship, 0, SHIPS.length - 1, 0),
        mods: cleanMods(p.mods),
        kills: clampInt(p.kills, 0, 1e6, 0),
        score: clampInt(p.score, 0, 99_999_999, 0),
        chords: clampInt(p.chords, 0, 1e5, 0),
        tether: clampInt(p.tether, 0, 1e5, 0),
        joined: clampInt(p.joined, 0, 1e4, 0),
      };
    }
  }
  const run = {
    v: 1,
    rid: raw.rid.slice(0, 80),
    mode: raw.mode,
    seed: clampInt(raw.seed, 0, 4294967295, 1),
    oc: clampInt(raw.oc, 0, 8, 0),
    idx: clampInt(raw.idx, 0, 9999, 0),
    status: ['play', 'draft', 'over'].includes(raw.status) ? raw.status : 'over',
    mid: str(raw.mid, 80),
    lives: clampInt(raw.lives, 0, SHIP.maxLives + 2, 0),
    score: clampInt(raw.score, 0, 99_999_999, 0),
    mult: clampInt(raw.mult, 1, 12, 1),
    res: clampInt(raw.res, 0, 100, 0),
    roster: Array.isArray(raw.roster) ? raw.roster.filter((x) => typeof x === 'string' && players[x]).slice(0, 4) : [],
    players,
    guided: raw.guided === true,
    daily: null,
    practice: null,
    result: null,
    stats: raw.stats && typeof raw.stats === 'object' ? { bosses: clampInt(raw.stats.bosses, 0, 999, 0), flawless: clampInt(raw.stats.flawless, 0, 999, 0) } : { bosses: 0, flawless: 0 },
  };
  if (run.mode === 'daily') {
    const day = clampInt(raw.daily?.day, 0, 1e7, 0);
    run.daily = dailyFor(day);
  }
  if (run.mode === 'practice') {
    const p = raw.practice || {};
    run.practice = { world: clampInt(p.world, 0, WORLDS.length - 1, 0), level: clampInt(p.level, 1, LEVELS_PER_WORLD, 1), tempo: TEMPOS.includes(p.tempo) ? p.tempo : 1 };
  }
  if (raw.result && typeof raw.result === 'object') {
    const r = raw.result;
    run.result = {
      cleared: r.cleared === true,
      cause: clampInt(r.cause, 0, 20, 0),
      zone: str(r.zone, 12),
      depth: clampInt(r.depth, 0, 9999, 0),
      ended: r.ended === true,
    };
  }
  return run;
}

export class Session {
  constructor(app) {
    this.app = app; // { profile(), onZoneEvent(e, local), onRunOver(run), music, me... }
    this.room = null;
    this.closed = null; // a close reason
    this.offs = [];
    this.world = null;
    this.worldMid = null;
    this.meIdx = -1;
    this.authority = false;
    this.snapAt = 0;
    this.batchAt = 0;
    this.presenceAt = 0;
    this.evSeq = 0;
    this.evq = [];
    this.lastSeenSeq = -1;
    this.lastSnapStep = -1;
    this.pendingHops = [];
    this.pendingZap = false;
    this.pendingDown = 0;
    this.myShip = 0;
    this.myTint = 0;
    this.screen = 'title';
    this.joining = false;
    this.ending = null; // the mid the host has asked to end
    this.recorded = new Set();
  }

  // ---------------------------------------------------------------- joining

  async connect() {
    if (this.joining) return;
    this.joining = true;
    this.closed = null;
    for (const off of this.offs) off();
    this.offs = [];
    const room = await platform.join(JOIN);
    this.joining = false;
    if (!room) {
      this.closed = 'disconnected';
      return;
    }
    this.room = room;
    const on = (ev, fn) => {
      try {
        const off = room.on(ev, fn);
        if (typeof off === 'function') this.offs.push(off);
      } catch {}
    };
    on('message', (data, from) => this.onMessage(data, from));
    on('close', (reason) => {
      this.closed = typeof reason === 'string' ? reason : 'disconnected';
      this.dropWorld();
    });
    on('matchend', () => {
      this.ending = null;
      this.app.onMatchEnd?.();
    });
    on('matchstart', () => this.app.onMatchStart?.());
    on('host', () => this.reconcile());
    on('reconnect', () => this.reconcile());
    // A guest reloaded mid-zone: their ship comes back where it was.
    const me = room.players?.get?.(room.me.id)?.presence;
    if (me && Number.isFinite(me.sh)) this.myShip = clampInt(me.sh, 0, SHIPS.length - 1, 0);
  }

  get isHost() {
    return Boolean(this.room && this.room.isHost && this.room.connected !== false);
  }
  get solo() {
    if (!this.room) return true;
    return (this.room.online?.length ?? 1) <= 1;
  }
  get match() {
    return this.room?.match || { phase: 'lobby', n: 0 };
  }
  get run() {
    return cleanRun(this.room?.state?.run);
  }
  get hub() {
    return cleanHub(this.room?.state?.hub);
  }

  /** What the lobby shows: the hub, the draft between zones, or a finished run's results. */
  lobbyScreen() {
    const run = this.run;
    if (!run) return 'hub';
    if (run.status === 'draft') return 'draft';
    if (run.status === 'over') return 'results';
    return 'hub';
  }

  /** Song time of the zone in seconds (the room's match clock: the same for everyone, still while paused). */
  songTime() {
    if (!this.room || this.match.phase !== 'playing') return 0;
    const t = this.room.matchNow?.();
    return Number.isFinite(t) ? t / 1000 : 0;
  }

  // ---------------------------------------------------------------- every frame

  update() {
    const room = this.room;
    if (!room || this.closed) return;
    this.reconcile();
    const now = performance.now();
    if (now - this.presenceAt > PRESENCE_MS) {
      this.presenceAt = now;
      this.sendPresence();
    }
  }

  /** Derive what should be happening and make it so. */
  reconcile() {
    const room = this.room;
    if (!room) return;
    const m = this.match;
    const run = this.run;
    const host = this.isHost;
    if (host) this.hostDuties(m, run);
    if (m.phase !== 'playing') {
      if (this.world) this.dropWorld();
      return;
    }
    // Playing: are we in this zone, watching it, or waiting for its record?
    if (!run || run.mid !== m.id || run.status !== 'play') {
      if (this.world && this.worldMid !== m.id) this.dropWorld();
      return;
    }
    const me = room.me.id;
    const idx = run.roster.indexOf(me);
    if (!this.world || this.worldMid !== m.id) this.buildWorld(run, idx);
    // Authority follows the host role, every frame.
    const auth = host && idx >= 0;
    const watchingHost = host && idx < 0;
    if (this.world) {
      if (auth !== this.world.auth) this.switchAuthority(auth);
      if (!auth && !watchingHost) this.takeSnapshot();
      if (watchingHost) this.takeSnapshot();
    }
  }

  // ---------------------------------------------------------------- the host

  hostDuties(m, run) {
    const room = this.room;
    if (m.phase === 'lobby') {
      // A zone's match ended without the zone being over (a host who vanished, an outside end): the run is over.
      if (run && run.status === 'play') {
        run.status = 'over';
        run.result = { cleared: false, cause: 0, zone: zoneLabel(zoneFor(run, run.idx)), depth: run.idx, ended: true };
        this.writeRun(run);
      }
      if (!room.state?.hub) this.setHub({});
      return;
    }
    if (m.phase !== 'playing') return;
    // Friends may drop in between zones: keep the door open while a zone plays (they watch until the next one).
    if (room.open === false && performance.now() - (this.openAt || 0) > 3000) {
      this.openAt = performance.now();
      try {
        room.setOpen(true);
      } catch {}
    }
    if (!run || run.status === 'over' || (run.status === 'draft' && run.mid !== m.id)) {
      this.beginZone(m, run && run.status === 'draft' ? run : null);
      return;
    }
    if (run.mid === m.id && run.status !== 'play' && this.ending !== m.id) {
      // The zone is over in the record but the match still runs (a host that changed at the last moment).
      this.ending = m.id;
      room.endMatch();
    }
    // The host role landed on someone who only watches: hand it to a player in the zone.
    if (run.mid === m.id && run.status === 'play' && !run.roster.includes(room.me.id)) {
      const next = run.roster.find((id) => room.players.get(id)?.connected !== false);
      if (next && performance.now() - (this.handAt || 0) > 2000) {
        this.handAt = performance.now();
        try {
          room.transferHost(next);
        } catch {}
      }
    }
  }

  /** The host starts a zone: a new run from the hub, or the next zone of the run in its draft. */
  beginZone(m, prev) {
    const room = this.room;
    const hub = this.hub;
    const profile = this.app.profile;
    let run = prev;
    if (!run) {
      const mode = hub.mode;
      const day = dayOf(platform.now());
      run = {
        v: 1,
        rid: String(m.id),
        mode,
        seed: mode === 'daily' ? dailyFor(day).seed : m.seed >>> 0 || 1,
        oc: mode === 'run' || mode === 'descent' ? Math.min(hub.oc, 8) : 0,
        idx: 0,
        status: 'play',
        mid: m.id,
        lives: 0,
        score: 0,
        mult: 1,
        res: 0,
        roster: [],
        players: {},
        guided: mode === 'run' && profile.first && this.solo,
        daily: mode === 'daily' ? { day } : null,
        practice: mode === 'practice' ? { world: hub.pw, level: hub.pl, tempo: TEMPOS[hub.pt] ?? 1 } : null,
        stats: { bosses: 0, flawless: 0 },
      };
      run.lives = run.oc >= 6 ? 2 : SHIP.lives;
    }
    // Who plays this zone: the match's players, first those already in the run, then newcomers (four at most).
    const ids = (m.participants || []).filter((id) => typeof id === 'string' && room.players.has(id));
    ids.sort((a, b) => (run.players[a]?.joined ?? 9999) - (run.players[b]?.joined ?? 9999) || a.localeCompare(b));
    const roster = ids.slice(0, 4);
    const daily = run.mode === 'daily' ? dailyFor(run.daily?.day ?? dayOf(platform.now())) : null;
    const coopBefore = (run.roster?.length || 1) > 1;
    for (const id of roster) {
      const pick = this.pickOf(id);
      const player = room.players.get(id);
      let p = run.players[id];
      if (!p) {
        const ship = daily ? daily.ship : clampInt(pick?.s ?? player?.presence?.sh, 0, SHIPS.length - 1, 0);
        p = { n: str(player?.name, 24), ship, mods: {}, kills: 0, score: 0, chords: 0, tether: 0, joined: run.idx };
        if (daily) for (const k of daily.mods) p.mods = addMod(p.mods, k);
        run.players[id] = p;
      } else if (prev) {
        // Their pick from the draft (checked against what they were offered).
        const key = `${run.rid}.${run.idx}`;
        if (pick && pick.k === key && typeof pick.m === 'string') {
          const offered = draftOptions(run, id, run.idx - 1, p.mods, coopBefore);
          if (offered.includes(pick.m)) {
            p.mods = addMod(p.mods, pick.m);
            if (pick.m === 'encore') run.lives = Math.min(SHIP.maxLives + 2, run.lives + 1);
          }
        }
      }
      p.n = str(player?.name, 24) || p.n;
    }
    run.roster = roster;
    run.mid = m.id;
    run.status = 'play';
    run.result = null;
    this.writeRun(run);
    try {
      room.setState('snap', null);
    } catch {}
    this.evq = [];
    this.lastSeenSeq = -1;
  }

  pickOf(id) {
    try {
      const v = id === this.room.me.id ? this.room.private : this.room.privateOf(id);
      const ld = v?.ld;
      if (!ld || typeof ld !== 'object') return null;
      return { k: str(ld.k, 100), m: str(ld.m, 20), s: clampInt(ld.s, 0, SHIPS.length - 1, 0) };
    } catch {
      return null;
    }
  }

  writeRun(run) {
    const out = { ...run };
    if (run.mode === 'daily') out.daily = { day: run.daily?.day ?? 0 };
    out.t = platform.now();
    try {
      this.room.setState('run', out);
    } catch (err) {
      console.warn(err);
    }
  }

  setHub(changes) {
    if (!this.isHost) return;
    const next = cleanHub({ ...this.hub, ...changes });
    try {
      this.room.setState('hub', next);
      // Anyone who readied sees the change before they agree to it.
      if (Object.keys(changes).length) this.room.clearReady?.();
    } catch {}
  }

  /** The host's page finished a zone (cleared, or everyone fell). */
  finishZone() {
    const w = this.world;
    const room = this.room;
    const run = this.run;
    if (!w || !run || !this.isHost || run.mid !== this.worldMid || run.status !== 'play') return;
    run.lives = w.lives;
    run.score = Math.round(w.score);
    run.mult = w.mult;
    run.res = Math.round(w.res);
    for (const ship of w.ships) {
      const p = run.players[ship.id];
      if (!p) continue;
      p.kills += ship.zone.kills;
      p.score += Math.round(ship.score);
      p.chords += ship.chords;
      p.tether += ship.tether;
      ship.zone.kills = 0;
      ship.score = 0;
      ship.chords = 0;
      ship.tether = 0;
    }
    const zone = w.zone;
    if (w.phase === PHASE.DONE) {
      if (zone.level >= 4) run.stats.bosses++;
      if (w.stats.flawless) run.stats.flawless++;
      if (run.mode === 'practice') {
        run.status = 'over';
        run.result = { cleared: true, cause: 0, zone: zoneLabel(zone), depth: 1 };
      } else if (run.idx + 1 >= zoneCount(run)) {
        run.status = 'over';
        run.result = { cleared: true, cause: 0, zone: zoneLabel(zone), depth: run.idx + 1 };
      } else {
        run.status = 'draft';
        run.idx += 1;
      }
    } else {
      run.status = 'over';
      const cause = w.ships.find((s) => s.cause)?.cause || 0;
      run.result = { cleared: false, cause, zone: zoneLabel(zone), depth: run.idx };
    }
    this.publishSnapshot(true);
    this.writeRun(run);
    this.ending = run.mid;
    room.endMatch();
  }

  // ---------------------------------------------------------------- the zone's world

  buildWorld(run, idx) {
    const room = this.room;
    const zone = zoneFor(run, run.idx);
    const players = run.roster.map((id, i) => {
      const p = run.players[id];
      return { id, ship: p.ship, mods: p.mods, kind: id === room.me.id ? 'driven' : 'puppet', lat: 0 };
    });
    const w = new World({ zone, players, carry: { lives: run.lives, score: run.score, mult: run.mult, res: run.res }, auth: false });
    this.world = w;
    this.worldMid = run.mid;
    this.meIdx = idx;
    this.lastSnapStep = -1;
    this.lastSeenSeq = -1;
    this.claimsSent = 0;
    // A page that arrives mid-zone (a reload, a watcher): take the room's word for where everything is.
    this.takeSnapshot(true);
    if (idx >= 0) {
      const mine = w.ships[idx];
      const pres = room.players?.get?.(room.me.id)?.presence;
      if (pres && pres.m === run.mid && Number.isFinite(pres.u)) {
        mine.u = mine.pu = Math.max(0, Math.min(w.n - 1, Math.round(pres.u / 100)));
      }
    }
    this.app.onZoneStart?.(w, zone, run);
  }

  switchAuthority(auth) {
    const w = this.world;
    if (!w) return;
    w.auth = auth;
    if (auth) {
      // A new host picks up the zone where the last snapshot left it.
      w.predicted.clear();
      w.claims.length = 0;
      for (const s of w.ships) if (s.idx !== this.meIdx) s.kind = 'puppet';
    }
  }

  dropWorld() {
    if (this.world) this.app.onZoneEnd?.(this.world);
    this.world = null;
    this.worldMid = null;
    this.meIdx = -1;
  }

  /** A mirror takes the host's latest snapshot (once per new snapshot). */
  takeSnapshot(force = false) {
    const w = this.world;
    if (!w) return;
    const snap = clean(this.room.state?.snap, w.n);
    if (!snap || snap.m !== this.worldMid) return;
    if (!force && snap.s === this.lastSnapStep) return;
    this.lastSnapStep = snap.s;
    // Play the host's events this page has not seen (others' kills, chords, falls) as sound and light.
    for (const ev of snap.ev) {
      if (ev[0] <= this.lastSeenSeq) continue;
      this.lastSeenSeq = ev[0];
      if (!force) this.app.onRemoteEvent?.(ev, w);
    }
    if (this.lastSeenSeq < 0 && snap.ev.length) this.lastSeenSeq = snap.ev[snap.ev.length - 1][0];
    const target = w.step;
    apply(w, snap, this.meIdx, spawnEnemy, 48, makeBoss);
    // Catch up from the snapshot's moment to where this page's clock is (movement only; the host decides the rest).
    let guard = 0;
    w.replaying = true;
    while (w.step < target && guard++ < 240) w.update();
    w.replaying = false;
    if (this.meIdx >= 0) w.ev = w.ev.filter((e) => e.k === 'down' || e.k === 'fire' || e.k === 'hop');
    else w.ev.length = 0;
  }

  /** Host: the zone as it is now, for everyone else. */
  publishSnapshot(force = false) {
    const w = this.world;
    if (!w || !w.auth || !this.room) return;
    const now = performance.now();
    if (!force && now - this.snapAt < SNAP_MS) return;
    this.snapAt = now;
    try {
      this.room.setState('snap', encode(w, this.worldMid, this.evq));
    } catch (err) {
      console.warn(err);
    }
  }

  /** Host: an event worth showing on every page goes in the snapshot's ring. */
  shareEvent(kind, a = 0, b = 0, c = 0, d = 0, e = 0) {
    this.evSeq++;
    this.evq.push([this.evSeq, kind, a, b, c, d, e]);
    if (this.evq.length > 32) this.evq.shift();
  }

  // ---------------------------------------------------------------- messages

  onMessage(data, from) {
    if (!this.isHost || !this.world || !this.world.auth) return;
    const w = this.world;
    const fromId = typeof from === 'string' ? from : from?.id;
    const idx = w.ships.findIndex((s) => s.id === fromId);
    if (idx < 0) return;
    const b = readBatch(data, w.n);
    if (!b || b.m !== this.worldMid) return; // a message from another zone
    const ship = w.ships[idx];
    const limit = 64;
    let used = 0;
    for (const [id, dmg, lane, z] of b.claims) {
      if (used++ >= limit) break;
      const e = w.enemies.find((x) => x.id === id && !x.dead);
      if (!e) continue;
      // The claim must be about where the enemy is (give a lane and a bit of depth for the trip over the wire).
      if (laneDist(w.web, Math.round(e.lane), lane) > 1) continue;
      if (Math.abs(e.z - z) > 0.3) continue;
      const cap = Math.min(8, Math.max(2.5, ship.def.dmg * 4));
      w.damage(e, Math.min(dmg, cap), idx, 'bolt');
    }
    for (const [, , onBeat] of b.hops) if (onBeat) w.beatHop();
    if (b.zap) {
      ship.u = this.remoteU(fromId, ship.u, w);
      w.zap(ship);
    }
    if (b.down && ship.state === 'live') w.down(ship, b.down, true);
  }

  remoteU(id, fallback, w) {
    try {
      const at = this.room.presenceAt(id);
      if (at && Number.isFinite(at.u)) return Math.max(0, Math.min(w.n - 1, at.u / 100));
    } catch {}
    return fallback;
  }

  /** Every frame (host and mirror): puppets follow their pages' presence. */
  steerPuppets() {
    const w = this.world;
    if (!w) return;
    for (const ship of w.ships) {
      if (ship.kind !== 'puppet') continue;
      let at = null;
      try {
        at = this.room.presenceAt(ship.id, { snap: 4 });
      } catch {}
      if (at && Number.isFinite(at.u) && at.m === this.worldMid) {
        const u = at.u / 100;
        ship.pu = ship.u;
        ship.u = w.web.closed ? ((u % w.n) + w.n) % w.n : Math.max(0, Math.min(w.n - 1, u));
        ship.in.fire = at.f === 1;
      }
      const p = this.room.players?.get?.(ship.id);
      ship.gone = !p || p.connected === false;
    }
  }

  /** Mirror: send this page's hits and moments to the host. */
  sendBatch(force = false) {
    const w = this.world;
    if (!w || w.auth || !this.room || this.meIdx < 0) return;
    const now = performance.now();
    if (!force && now - this.batchAt < BATCH_MS) return;
    const hasNews = w.claims.length || this.pendingHops.length || this.pendingZap || this.pendingDown;
    if (!hasNews) return;
    this.batchAt = now;
    const msg = batch(this.worldMid, w.step, w.claims, this.pendingHops, this.pendingZap, this.pendingDown);
    w.claims.length = 0;
    this.pendingHops = [];
    this.pendingZap = false;
    this.pendingDown = 0;
    try {
      if (this.room.host) this.room.send(msg, { to: this.room.host });
    } catch {}
  }

  sendPresence() {
    const room = this.room;
    const w = this.world;
    const ship = w && this.meIdx >= 0 ? w.ships[this.meIdx] : null;
    const p = {
      s: this.screen,
      sh: this.myShip,
      ti: this.myTint,
      tr: this.myTrail || 0,
      m: this.worldMid || '',
      u: ship ? Math.round(ship.u * 100) : 0,
      f: ship && ship.in.fire && ship.state === 'live' ? 1 : 0,
      a: ship ? ['live', 'down', 'wait', 'out'].indexOf(ship.state) : -1,
      dp: this.draftPicked ? 1 : 0,
    };
    try {
      room.setPresence(p);
    } catch {}
  }

  // ---------------------------------------------------------------- choices

  pickShip(i) {
    this.myShip = clampInt(i, 0, SHIPS.length - 1, 0);
    this.writePick();
  }

  pickMod(key) {
    const run = this.run;
    if (!run || run.status !== 'draft') return false;
    this.pickedMod = key;
    this.pickedKey = `${run.rid}.${run.idx}`;
    this.draftPicked = true;
    this.writePick();
    // A pick is a guest's "ready" (they can still change it, or un-ready on the strip).
    if (!this.isHost) {
      try {
        this.room.setReady(true);
      } catch {}
    }
    return true;
  }

  writePick() {
    try {
      this.room?.setPrivate('ld', { k: this.pickedKey || '', m: this.pickedMod || '', s: this.myShip });
    } catch {}
  }

  /** Host: Start (the platform strip does this too). */
  start() {
    const room = this.room;
    if (!room || !this.isHost || this.match.phase !== 'lobby') return false;
    if (room.canStart === false) return false;
    try {
      room.startMatch({ countdown: 0 });
      return true;
    } catch {
      return false;
    }
  }

  setReady(on) {
    try {
      this.room?.setReady(on);
    } catch {}
  }

  /** Host: give up the run (from the pause card): the zone ends as a loss. */
  quitRun() {
    if (!this.isHost || !this.world) return;
    const w = this.world;
    w.setPhase(PHASE.OVER);
    for (const s of w.ships) if (s.state === 'live') s.state = 'out';
    this.finishZone();
  }

  /** Host: back to the hub from the results (clears the finished run). */
  toHub() {
    if (!this.isHost || this.match.phase !== 'lobby') return;
    try {
      this.room.setState('run', null);
      this.room.setState('snap', null);
    } catch {}
  }

  pause(on) {
    try {
      this.room?.pauseMatch(on);
    } catch {}
  }

  /** The record of a run already folded into this player's profile (one per run id). */
  shouldRecord(rid) {
    if (this.recorded.has(rid)) return false;
    this.recorded.add(rid);
    return true;
  }
}

export { laneOf, MODS };
