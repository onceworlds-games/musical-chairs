// What the host tells everyone about a zone, and how a page that is not the host applies it. The host publishes a
// snapshot (room state 'snap') a few times a second: every enemy's full state as integers, the spikes, pickups, the
// boss, each ship's state as the room sees it, and the last few events. A mirror replaces its enemies with the
// snapshot's and plays them forward with the same rules until the next one. Everything read from the room is
// checked: wrong types, absurd numbers and oversized arrays are dropped, never trusted.
import { E, ENEMIES } from '../sim/data.js';

export const SNAP_VERSION = 1;
const ENEMY_FIELDS = 17;
const MAX_ENEMIES = 140;
const SHIP_STATES = ['live', 'down', 'wait', 'out', 'away'];

const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const int = (v, lo, hi, d = 0) => Math.round(num(v, lo, hi, d));

/** The host's snapshot of a world. seq: the newest event number; events: [[seq, kind, a, b, c, d]]. */
export function encode(w, mid, events) {
  const s = w.step;
  const e = [];
  for (const x of w.enemies) {
    if (x.dead) continue;
    if (e.length >= MAX_ENEMIES * ENEMY_FIELDS) break;
    e.push(
      x.id,
      x.type,
      Math.round(x.lane * 1000),
      Math.round(x.z * 10000),
      Math.round(x.hp * 100),
      x.st,
      Math.round(x.from * 1000),
      Math.round(x.to * 1000),
      x.fs < 0 ? -1 : s - x.fs,
      x.fl,
      x.dir,
      Number.isFinite(x.next) ? x.next - w.tick : 99999,
      Math.round(x.a * 1000),
      Math.round(x.b * 1000),
      Math.round(x.c * 100),
      x.group || 0,
      s - x.t0,
    );
  }
  const boss = w.boss
    ? {
        k: w.boss.kind,
        hp: Math.round(w.boss.hp * 10),
        mx: Math.round(w.boss.maxHp * 10),
        ph: w.boss.phase,
        ac: w.boss.active ? 1 : 0,
        dn: w.boss.down ? 1 : 0,
        dr: w.boss.dir,
        gp: w.boss.gap,
        mi: Math.round(w.boss.mirror * 1000),
        sd: w.boss.side,
        pt: w.boss.pattern,
        hu: w.boss.hurry ? 1 : 0,
        hd: w.boss.head,
        dp: Math.round(w.boss.depth * 1000),
        ea: s - w.boss.enterAt,
        aa: w.boss.activeAt - s,
        pa: w.boss.phaseAt === undefined ? null : s - w.boss.phaseAt,
        te: w.boss.tele.slice(0, 8).map((t) => [t.at - s, t.until - s, t.kind, t.lanes.slice(0, 24)]),
        pp: w.boss.parts.filter((p) => !p.dead).map((p) => p.id),
      }
    : null;
  return {
    v: SNAP_VERSION,
    m: mid,
    s,
    ph: w.phase,
    pa: s - w.phaseAt,
    sc: Math.round(w.score),
    mu: w.mult,
    re: Math.round(w.res * 10),
    od: w.odUntil > s ? w.odUntil - s : 0,
    lv: w.lives,
    e,
    sp: Array.from(w.spikes, (h) => Math.round(h * 1000)),
    pk: w.pickups.filter((p) => !p.dead).flatMap((p) => [p.id, p.kind, p.lane, Math.round(p.z * 1000)]),
    sh: w.ships.map((x) => [SHIP_STATES.indexOf(x.state), x.respawnAt > s ? x.respawnAt - s : 0, x.zaps, x.shield ? 1 : 0, x.inv > s ? x.inv - s : 0, x.cause || 0]),
    wr: w.wrecks.map((x) => [x.idx, x.lane, Number.isFinite(x.until) ? x.until - s : -1]),
    pu: w.pulses.map((p) => [p[0], p[1] - s]),
    bm: w.booms.map((p) => [p[0], p[1] - s, p[2] || 0]),
    r: w.rng.s,
    nid: w.nextId,
    si: w.spawnIdx,
    bo: boss,
    st: { k: w.stats.kills, r: w.stats.rim, h: w.stats.hits, c: w.stats.chords, p: w.stats.perfect, o: w.stats.od, t: w.stats.tether, x: w.stats.maxMult, b: w.stats.bossDown ? 1 : 0 },
    ev: events.slice(-24),
  };
}

/** Checks a snapshot from room state. Returns a clean copy, or null if it is not one. */
export function clean(raw, n) {
  if (!raw || typeof raw !== 'object' || raw.v !== SNAP_VERSION || typeof raw.m !== 'string' || raw.m.length > 80) return null;
  const s = int(raw.s, 0, 1e8, -1);
  if (s < 0) return null;
  const e = Array.isArray(raw.e) ? raw.e.slice(0, MAX_ENEMIES * ENEMY_FIELDS) : [];
  if (e.length % ENEMY_FIELDS !== 0 || e.some((x) => typeof x !== 'number' || !Number.isFinite(x))) return null;
  const sp = Array.isArray(raw.sp) ? raw.sp.slice(0, n).map((h) => int(h, 0, 860, 0) / 1000) : [];
  return {
    m: raw.m,
    s,
    ph: int(raw.ph, 0, 5, 1),
    pa: int(raw.pa, 0, 1e7, 0),
    sc: int(raw.sc, 0, 99_999_999, 0),
    mu: int(raw.mu, 1, 12, 1),
    re: num(raw.re, 0, 1000, 0) / 10,
    od: int(raw.od, 0, 100000, 0),
    lv: int(raw.lv, 0, 9, 0),
    e,
    sp,
    pk: Array.isArray(raw.pk) ? raw.pk.slice(0, 40).map((x) => num(x, -1e7, 1e7, 0)) : [],
    sh: Array.isArray(raw.sh) ? raw.sh.slice(0, 4).map((x) => (Array.isArray(x) ? x.slice(0, 6).map((y) => int(y, -1, 1e6, 0)) : [0, 0, 0, 0, 0, 0])) : [],
    wr: Array.isArray(raw.wr) ? raw.wr.slice(0, 4).map((x) => (Array.isArray(x) ? x.slice(0, 3).map((y) => int(y, -1, 1e6, 0)) : [0, 0, 0])) : [],
    pu: Array.isArray(raw.pu) ? raw.pu.slice(0, 24).map((x) => (Array.isArray(x) ? [int(x[0], 0, n - 1, 0), int(x[1], -100, 1000, 0)] : [0, 0])) : [],
    bm: Array.isArray(raw.bm) ? raw.bm.slice(0, 48).map((x) => (Array.isArray(x) ? [int(x[0], 0, n - 1, 0), int(x[1], -100, 1000, 0), int(x[2], 0, 20, 0)] : [0, 0, 0])) : [],
    r: int(raw.r, 0, 4294967295, 1),
    nid: int(raw.nid, 0, 1e9, 100000),
    si: int(raw.si, 0, 1e5, 0),
    bo: raw.bo && typeof raw.bo === 'object' ? raw.bo : null,
    st: raw.st && typeof raw.st === 'object' ? raw.st : {},
    ev: Array.isArray(raw.ev) ? raw.ev.slice(-24).filter((x) => Array.isArray(x) && x.length <= 8) : [],
  };
}

/**
 * Puts a (clean) snapshot into a mirror world. me: the local ship's index (its position stays its own).
 * predictedFor: steps a locally predicted kill stays hidden while the host catches up.
 */
export function apply(w, snap, me, spawnEnemy, predictedFor = 40, makeBoss = null) {
  const s = snap.s;
  w.step = s;
  w.tick = Math.floor(s / 8);
  w.phase = snap.ph;
  w.phaseAt = s - snap.pa;
  w.score = snap.sc;
  w.mult = snap.mu;
  w.res = snap.re;
  w.odUntil = snap.od > 0 ? s + snap.od : -1;
  w.lives = snap.lv;
  w.nextId = snap.nid;
  w.spawnIdx = Math.max(0, Math.min(w.spawns.length, snap.si));
  for (let i = 0; i < w.n && i < snap.sp.length; i++) w.spikes[i] = snap.sp[i];
  // Enemies: the snapshot's, except those this page has just destroyed (the host will agree in a moment).
  for (const x of w.enemies) {
    x.dead = true;
    if (w.pool.length < 128 && x.type !== E.PART) w.pool.push(x);
  }
  w.enemies = [];
  const parts = new Map();
  const ex = snap.e;
  for (let i = 0; i < ex.length; i += ENEMY_FIELDS) {
    const id = ex[i];
    const type = ex[i + 1];
    if (!ENEMIES[type]) continue;
    const killed = w.predicted.get(id);
    if (killed !== undefined && s - killed < predictedFor) continue;
    const e = spawnEnemy(w, type, 0, { id, z: ex[i + 3] / 10000 });
    e.lane = ex[i + 2] / 1000;
    if (!(e.lane >= -1 && e.lane <= w.n + 1)) e.lane = 0;
    e.z = Math.max(0, Math.min(1, e.z));
    e.hp = ex[i + 4] / 100;
    e.st = ex[i + 5];
    e.from = ex[i + 6] / 1000;
    e.to = ex[i + 7] / 1000;
    e.fs = ex[i + 8] < 0 ? -1 : s - ex[i + 8];
    e.fl = Math.max(2, ex[i + 9]);
    e.dir = ex[i + 10] < 0 ? -1 : 1;
    e.next = ex[i + 11] >= 99999 ? Infinity : w.tick + ex[i + 11];
    e.a = ex[i + 12] / 1000;
    e.b = ex[i + 13] / 1000;
    e.c = ex[i + 14] / 100;
    e.group = ex[i + 15];
    e.t0 = s - ex[i + 16];
    e.px = e.lane;
    e.pz = e.z;
    if (type === E.PART) parts.set(id, e);
  }
  // Old predictions fall away.
  for (const [id, step] of w.predicted) if (s - step >= predictedFor) w.predicted.delete(id);
  w.pickups = [];
  for (let i = 0; i + 3 < snap.pk.length; i += 4) {
    w.pickups.push({ id: snap.pk[i], kind: snap.pk[i + 1], lane: snap.pk[i + 2], z: snap.pk[i + 3] / 1000, dead: false, pz: snap.pk[i + 3] / 1000, pl: snap.pk[i + 2] });
  }
  w.pulses = snap.pu.map((p) => [p[0], s + p[1]]);
  w.booms = snap.bm.map((p) => [p[0], s + p[1], p[2]]);
  w.wrecks = snap.wr.map((x) => ({ idx: x[0], lane: x[1], until: x[2] < 0 ? Infinity : s + x[2] }));
  // Ships: the room's view of each, except where this page knows better about its own.
  snap.sh.forEach((x, idx) => {
    const ship = w.ships[idx];
    if (!ship) return;
    const state = SHIP_STATES[x[0]] || 'live';
    ship.zaps = x[2];
    ship.cause = x[5] || ship.cause;
    if (idx === me) {
      // This page decides when its ship is caught; the room decides when it comes back.
      if (ship.state === 'down' && (state === 'wait' || state === 'live' || state === 'out')) {
        ship.state = state;
        if (state === 'wait') ship.respawnAt = s + x[1];
        if (state === 'live') ship.inv = s + Math.max(x[4], 32);
      } else if (ship.state === 'wait' && state === 'live') {
        ship.state = 'live';
        ship.inv = s + Math.max(x[4], 32);
      } else if (ship.state === 'wait') ship.respawnAt = s + x[1];
      return; // its shield is its own: it forms on the bar line here too, and breaks here
    }
    ship.state = state;
    ship.respawnAt = s + x[1];
    ship.shield = x[3] === 1;
    ship.inv = s + x[4];
  });
  // The boss.
  if (snap.bo && w.boss) {
    const b = snap.bo;
    const bo = w.boss;
    bo.hp = num(b.hp, 0, 1e7, bo.hp * 10) / 10;
    bo.maxHp = Math.max(1, num(b.mx, 1, 1e7, bo.maxHp * 10) / 10);
    bo.phase = int(b.ph, 0, 4, 0);
    bo.active = b.ac === 1;
    bo.down = b.dn === 1;
    bo.dir = b.dr === -1 ? -1 : 1;
    bo.gap = int(b.gp, 0, w.n - 1, 0);
    bo.mirror = num(b.mi, -1000, 100000, 0) / 1000;
    bo.side = int(b.sd, 0, 1, 0);
    bo.pattern = int(b.pt, 0, 1e6, 0);
    bo.hurry = b.hu === 1;
    bo.head = int(b.hd, -100, 1000, 0);
    bo.depth = num(b.dp, 0, 1000, 620) / 1000;
    bo.enterAt = s - int(b.ea, 0, 1e7, 0);
    bo.activeAt = s + int(b.aa, -1e7, 1e7, 0);
    if (b.pa !== null && b.pa !== undefined) bo.phaseAt = s - int(b.pa, 0, 1e7, 0);
    bo.tele = Array.isArray(b.te)
      ? b.te.slice(0, 8).map((t) => ({
          at: s + int(t?.[0], -1000, 10000, 0),
          until: s + int(t?.[1], -1000, 10000, 0),
          kind: typeof t?.[2] === 'string' ? t[2].slice(0, 8) : 'baton',
          lanes: Array.isArray(t?.[3]) ? t[3].slice(0, 24).map((l) => int(l, 0, w.n - 1, 0)) : [],
        }))
      : [];
    bo.parts = [];
    if (Array.isArray(b.pp)) for (const id of b.pp) if (parts.has(id)) bo.parts.push(parts.get(id));
  } else if (snap.bo && !w.boss && typeof snap.bo.k === 'string' && makeBoss) {
    // A mirror that arrives mid-fight: a bare boss now, its pieces and numbers from the next snapshot.
    w.boss = makeBoss(w, snap.bo.k, true);
  }
  const st = snap.st || {};
  w.stats.kills = int(st.k, 0, 1e6, w.stats.kills);
  w.stats.rim = int(st.r, 0, 1e6, w.stats.rim);
  w.stats.hits = int(st.h, 0, 1e6, w.stats.hits);
  w.stats.chords = int(st.c, 0, 1e6, w.stats.chords);
  w.stats.perfect = int(st.p, 0, 1e6, w.stats.perfect);
  w.stats.od = int(st.o, 0, 1e6, w.stats.od);
  w.stats.tether = int(st.t, 0, 1e6, w.stats.tether);
  w.stats.maxMult = int(st.x, 1, 12, w.stats.maxMult);
  w.stats.bossDown = st.b === 1;
  // Last: rebuilding the enemies above draws from the stream; from here on it matches the host's, draw for draw.
  w.rng.s = snap.r >>> 0 || 1;
}

/** A client's batch for the host: hit claims, hops, a zap or a fall. Shape-checked by the host with readBatch. */
export function batch(mid, step, claims, hops, zap, down) {
  const out = { t: 'c', m: mid, k: step };
  if (claims.length) out.h = claims.slice(0, 48);
  if (hops.length) out.o = hops.slice(0, 8);
  if (zap) out.Z = 1;
  if (down) out.d = down;
  return out;
}

/** The host's reading of a client's batch: only well-formed parts survive. */
export function readBatch(raw, n) {
  if (!raw || typeof raw !== 'object' || raw.t !== 'c' || typeof raw.m !== 'string') return null;
  const claims = [];
  if (Array.isArray(raw.h)) {
    for (const c of raw.h.slice(0, 48)) {
      if (!Array.isArray(c) || c.length !== 4) continue;
      const [id, dmg, lane, z] = c;
      if (![id, dmg, lane, z].every((x) => typeof x === 'number' && Number.isFinite(x))) continue;
      if (dmg <= 0 || dmg > 8 || lane < 0 || lane >= n || z < -50 || z > 1050) continue;
      claims.push([Math.round(id), dmg, Math.round(lane), z / 1000]);
    }
  }
  const hops = [];
  if (Array.isArray(raw.o)) {
    for (const h of raw.o.slice(0, 8)) {
      if (!Array.isArray(h) || h.length !== 3 || !h.every((x) => typeof x === 'number' && Number.isFinite(x))) continue;
      hops.push([int(h[0], 0, n - 1, 0), int(h[1], 0, n - 1, 0), h[2] === 1 ? 1 : 0]);
    }
  }
  return {
    m: raw.m,
    k: int(raw.k, 0, 1e8, 0),
    claims,
    hops,
    zap: raw.Z === 1,
    down: Number.isInteger(raw.d) && raw.d > 0 && raw.d < 20 ? raw.d : 0,
  };
}
