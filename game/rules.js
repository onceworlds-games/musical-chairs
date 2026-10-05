// Pure rules of Musical Chairs: the room, the numbers, rosters, the music schedule, chair placement, scoring and the
// match Engine that the host's page runs. Nothing here touches window, document or onceworlds, so node tests import it.

export const W = 20; // the room, in units
export const H = 12;
export const RADIUS = 0.4; // a character
export const TABLE = 8; // bots fill the match to this many
export const MAX_PLAYERS = 10;
export const GOLD = { x: 10, y: 6.2 }; // the winner's golden chair, on the rug

// Solid things at the room's edges: the DJ speaker and the cake table. `open` is the sides a character can leave by.
export const OBSTACLES = [
  { kind: 'speaker', x0: 0, y0: 0, x1: 2.6, y1: 2.2, open: 'rb' },
  { kind: 'cake', x0: 16.6, y0: 0, x1: 20, y1: 1.9, open: 'lb' },
];

export const DROP_MS = 350; // a chair falls this long, then it can be claimed
export const DIP_MS = 400; // a fake-out
export const OUT_MS = 1500; // who's out is shown
export const OVER_MS = 3200; // the winner of a game
export const BETWEEN_MS = 4000; // the scoreboard between games
export const FINAL_MS = 9000; // the podium
export const SAFETY_MS = 15000; // nobody touched a chair this long after a stop: the farthest one is out
export const HOLD_MS = 80; // a claim waits this long for an earlier one still on its way
export const FAKE_FROM_STEP = 3;
export const FAKE_P = 0.2;
export const PLACE_POINTS = [10, 7, 5, 4, 3, 2];
export const GAMES = [1, 2, 3];

export const BOT_NAMES = ['Pip', 'Ziggy', 'Bubbles', 'Noodle', 'Pickles', 'Mochi', 'Sprout', 'Bean', 'Waffles', 'Taco', 'Biscuit', 'Peanut', 'Jelly', 'Nugget'];
export const COLORS = ['#ff4d4d', '#ff9f1c', '#ffd93d', '#6bd425', '#1fbf75', '#18c7d9', '#2e86ff', '#7a5cff', '#ff5cc8', '#ff7a59', '#00a896', '#c77dff'];
export const CHAIR_COLORS = ['#ff4757', '#2f9bff', '#ffc312', '#2ed573', '#a55eea', '#ff7f32', '#ff6bb5', '#1dd1c1', '#a4de02', '#ff4757'];
export const colorOf = (i) => COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];

// ---------------------------------------------------------------- seeded randomness

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Any seed the room hands out (a number, or something odd) as an unsigned 32-bit integer. */
export function seedNum(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.floor(Math.abs(v)) >>> 0;
  return hashStr(String(v));
}

export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mixSeed(...parts) {
  let h = 0x9e3779b9;
  for (const p of parts) {
    const v = typeof p === 'number' ? p >>> 0 : hashStr(String(p));
    h = (Math.imul(h ^ v, 0x85ebca6b) ^ (h >>> 13)) >>> 0;
  }
  return h >>> 0;
}

export function shuffle(arr, r) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const round2 = (v) => Math.round(v * 100) / 100;
const clampInt = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d);

// ---------------------------------------------------------------- roster

/** Humans plus bots up to the table's size, in a seeded order. Every page computes the same one from the same inputs. */
export function makeRoster(humans, seed, table = TABLE) {
  const r = rng(mixSeed(seedNum(seed), 'roster'));
  const list = [];
  const seen = new Set();
  for (const id of humans) {
    if (typeof id !== 'string' || seen.has(id) || list.length >= MAX_PLAYERS) continue;
    seen.add(id);
    list.push({ id });
  }
  const names = shuffle(BOT_NAMES, r);
  const need = Math.max(0, table - list.length);
  for (let i = 0; i < need; i++) list.push({ id: `bot${i + 1}`, b: 1, n: names[i % names.length] });
  return shuffle(list, r);
}

/** Where roster entry `i` of `n` stands when a match gathers: a ring round the rug. */
export function spawnPoint(i, n) {
  const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
  return { x: round2(W / 2 + Math.cos(a) * 6.6), y: round2(H / 2 + 0.3 + Math.sin(a) * 3.6) };
}

// ---------------------------------------------------------------- the music schedule

export function musicRange(step) {
  return step <= 2 ? [5000, 12000] : [3000, 9000];
}

/**
 * When the music stops in a step, as [matchMs, fake] pairs: any number of fake-outs (from the 3rd step, 20% each, at
 * most two in a row) and then the real stop. All of it is decided at the start of the step and written to the room.
 */
export function makeStops(step, now, r) {
  const [lo, hi] = musicRange(step);
  const stops = [];
  let t = now;
  for (let i = 0; i < 3; i++) {
    t += lo + Math.floor(r() * (hi - lo));
    const fake = step >= FAKE_FROM_STEP && i < 2 && r() < FAKE_P;
    stops.push([Math.round(t), fake ? 1 : 0]);
    if (!fake) break;
    t += DIP_MS;
  }
  return stops;
}

/** 'play' while the music goes, 'dip' during a fake-out, 'stop' after the real stop. */
export function musicState(stops, now) {
  for (let i = 0; i < stops.length; i++) {
    const at = stops[i][0];
    if (now < at) return 'play';
    if (stops[i][1]) {
      if (now < at + DIP_MS) return 'dip';
    } else return 'stop';
  }
  return 'stop';
}

/** How long ago (ms) the latest fake-out ended, or Infinity. */
export function sinceDip(stops, now) {
  let since = Infinity;
  for (const [at, fake] of stops) if (fake && now >= at + DIP_MS) since = Math.min(since, now - (at + DIP_MS));
  return since;
}

// ---------------------------------------------------------------- chairs

const MARGIN = 1.1;

function spotOk(x, y, chairs, pts, minChair, minPlayer) {
  if (x < MARGIN || x > W - MARGIN || y < MARGIN || y > H - MARGIN) return false;
  for (const o of OBSTACLES) if (x > o.x0 - 0.9 && x < o.x1 + 0.9 && y > o.y0 - 0.9 && y < o.y1 + 0.9) return false;
  for (const c of chairs) if (Math.hypot(c[0] - x, c[1] - y) < minChair) return false;
  for (let i = 0; i < pts.length; i += 2) if (Math.hypot(pts[i] - x, pts[i + 1] - y) < minPlayer) return false;
  return true;
}

/**
 * `count` chair spots spread over the room: at least 1.5 apart and 1.2 from every player (where they stand and where
 * they are heading), relaxed in steps only if the room is somehow too crowded for that.
 */
export function placeChairs(count, players, r) {
  const pts = [];
  for (const p of players) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    pts.push(p.x, p.y, p.x + (p.vx || 0) * 0.3, p.y + (p.vy || 0) * 0.3);
  }
  const tiers = [[1.5, 1.2], [1.3, 1.0], [1.1, 0.8], [0.9, 0.55]];
  const out = [];
  for (let k = 0; k < count; k++) {
    let pick = null;
    for (const [minChair, minPlayer] of tiers) {
      let best = null;
      let bestScore = -1;
      let found = 0;
      for (let tries = 0; tries < 90 && found < 10; tries++) {
        const x = round2(MARGIN + r() * (W - 2 * MARGIN));
        const y = round2(MARGIN + r() * (H - 2 * MARGIN));
        if (!spotOk(x, y, out, pts, minChair, minPlayer)) continue;
        found++;
        let score = 9;
        for (const c of out) score = Math.min(score, Math.hypot(c[0] - x, c[1] - y));
        score += r() * 0.25;
        if (score > bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
      if (best) {
        pick = best;
        break;
      }
    }
    if (!pick) pick = fallbackSpot(out);
    out.push(pick);
  }
  return out;
}

function fallbackSpot(chairs) {
  let best = [W / 2, H / 2];
  let bestScore = -1;
  for (let x = MARGIN; x <= W - MARGIN; x += 0.5) {
    for (let y = MARGIN; y <= H - MARGIN; y += 0.5) {
      if (!spotOk(x, y, [], [], 0, 0)) continue;
      let score = 99;
      for (const c of chairs) score = Math.min(score, Math.hypot(c[0] - x, c[1] - y));
      if (score > bestScore) {
        bestScore = score;
        best = [round2(x), round2(y)];
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- scoring

export const pointsFor = (place) => PLACE_POINTS[place - 1] ?? 1;

/** Everyone, best first: points, then game wins, then the place in the last game, then roster order. */
export function rankPlayers(g) {
  const idx = new Map(g.roster.map((r, i) => [r.id, i]));
  return g.roster
    .map((r) => r.id)
    .sort((a, b) => (g.scores[b] ?? 0) - (g.scores[a] ?? 0) || (g.wins[b] ?? 0) - (g.wins[a] ?? 0) || (g.last[a] ?? 99) - (g.last[b] ?? 99) || idx.get(a) - idx.get(b));
}

/** The fun awards: the fastest average sit (two sits at least) and the most bumps that landed. */
export function awardsOf(g) {
  let speedy = null;
  let bumper = null;
  for (const { id } of g.roster) {
    const st = g.st[id];
    if (!st) continue;
    if (st[0] >= 2) {
      const avg = st[1] / st[0];
      if (!speedy || avg < speedy.avg) speedy = { id, avg };
    }
    if (st[2] >= 1 && (!bumper || st[2] > bumper.n)) bumper = { id, n: st[2] };
  }
  return { speedy, bumper };
}

// ---------------------------------------------------------------- the state record

const PHASES = ['music', 'race', 'out', 'over', 'between', 'final'];

/**
 * The room's copy of the match, checked: games are untrusted, so a page draws (and a new host continues) only from a
 * record that has the right shape. Null when it isn't this match's or is malformed.
 */
export function sanitizeG(raw, mid) {
  if (!raw || typeof raw !== 'object' || raw.mid !== mid || !PHASES.includes(raw.ph)) return null;
  const idOk = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
  const num = (v, lo, hi, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  if (!idOk(raw.by) || !Array.isArray(raw.roster) || raw.roster.length < 1 || raw.roster.length > 12) return null;
  const ids = new Set();
  const roster = [];
  for (const r of raw.roster) {
    if (!r || !idOk(r.id) || ids.has(r.id)) return null;
    ids.add(r.id);
    roster.push(r.b ? { id: r.id, b: 1, n: typeof r.n === 'string' ? r.n.slice(0, 16) : 'Bot' } : { id: r.id });
  }
  const idList = (a, max = 12) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && ids.has(x)).slice(0, max) : []);
  const idOrNull = (v) => (typeof v === 'string' && ids.has(v) ? v : null);
  const idMap = (m, lo, hi) => {
    const out = {};
    if (m && typeof m === 'object') for (const id of ids) if (typeof m[id] === 'number' && Number.isFinite(m[id])) out[id] = num(m[id], lo, hi);
    return out;
  };
  const chairs = [];
  if (Array.isArray(raw.chairs)) {
    for (const c of raw.chairs.slice(0, 11)) {
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
      chairs.push([num(c[0], 0.5, W - 0.5, W / 2), num(c[1], 0.5, H - 0.5, H / 2)]);
    }
  }
  const seats = chairs.map((_, i) => (Array.isArray(raw.seats) ? idOrNull(raw.seats[i]) : null));
  const stops = [];
  if (Array.isArray(raw.stops)) {
    for (const s of raw.stops.slice(0, 4)) {
      if (Array.isArray(s) && typeof s[0] === 'number' && Number.isFinite(s[0])) stops.push([num(s[0], 0, 1e10), s[1] ? 1 : 0]);
    }
  }
  if (raw.ph === 'music' && (stops.length === 0 || stops[stops.length - 1][1])) return null;
  const st = {};
  if (raw.st && typeof raw.st === 'object') {
    for (const id of ids) {
      const v = raw.st[id];
      if (Array.isArray(v)) st[id] = [num(v[0], 0, 9999), num(v[1], 0, 1e8), num(v[2], 0, 9999)];
    }
  }
  const games = clampInt(raw.games, 1, 3, 2);
  return {
    mid,
    by: raw.by,
    seed: seedNum(raw.seed),
    roster,
    games,
    game: clampInt(raw.game, 1, games, 1),
    n: clampInt(raw.n, 0, 99999, 0),
    step: clampInt(raw.step, 0, 99, 0),
    ph: raw.ph,
    until: num(raw.until, 0, 1e10),
    stops,
    stopAt: num(raw.stopAt, 0, 1e10),
    chairs,
    seats,
    sat: idMap(raw.sat, 0, 1e6),
    out: idOrNull(raw.out),
    winner: idOrNull(raw.winner),
    alive: idList(raw.alive),
    elim: idList(raw.elim),
    scores: idMap(raw.scores, 0, 99999),
    gp: idMap(raw.gp, 0, 99999),
    wins: idMap(raw.wins, 0, 99),
    last: idMap(raw.last, 1, 99),
    st,
    rank: idList(raw.rank),
  };
}

// ---------------------------------------------------------------- the match, as the host runs it

/**
 * The whole knockout: music, stops, chairs, claims, who's out, points. It lives in one plain record (`g`) that is
 * written to the room, so a new host builds an Engine from the room's copy and carries on. `now` is always the match
 * clock (room.matchNow()). `view` says where characters stand (`pos(id)` gives {x, y, vx, vy} or null) and who has
 * left for good (`gone(id)`).
 */
export class Engine {
  constructor(g) {
    this.g = g;
    this.claims = []; // waiting claims, in the host's memory only: a page asks again if one is lost
    this.dirty = false;
  }

  static create({ mid, by, seed, roster, games, now }) {
    const ids = roster.map((r) => r.id);
    const g = {
      mid,
      by,
      seed: seedNum(seed),
      roster,
      games: clampInt(games, 1, 3, 2),
      game: 1,
      n: 0,
      step: 0,
      ph: 'music',
      until: 0,
      stops: [],
      stopAt: 0,
      chairs: [],
      seats: [],
      sat: {},
      out: null,
      winner: null,
      alive: ids.slice(),
      elim: [],
      scores: Object.fromEntries(ids.map((id) => [id, 0])),
      gp: {},
      wins: {},
      last: {},
      st: {},
      rank: [],
    };
    const engine = new Engine(g);
    engine.beginStep(now);
    return engine;
  }

  /** Continues from the room's copy (null if it isn't a valid record of this match). */
  static adopt(raw, mid, by) {
    const g = sanitizeG(raw, mid);
    if (!g) return null;
    g.by = by;
    return new Engine(g);
  }

  get rid() {
    return `${this.g.mid}.${this.g.n}`;
  }

  isOver(now) {
    return this.g.ph === 'final' && now >= this.g.until;
  }

  beginStep(now) {
    const g = this.g;
    g.n++;
    g.step++;
    g.ph = 'music';
    g.stops = makeStops(g.step, now, rng(mixSeed(g.seed, g.n, 'stops')));
    g.until = g.stops[g.stops.length - 1][0];
    g.stopAt = 0;
    g.chairs = [];
    g.seats = [];
    g.sat = {};
    g.out = null;
    this.claims = [];
  }

  /** Moves the match on. True when the record changed (the host writes it). */
  update(now, view) {
    const g = this.g;
    let changed = this.dirty;
    this.dirty = false;
    switch (g.ph) {
      case 'music':
        if (now >= g.until) changed = this.drop(now, view) || changed;
        break;
      case 'race':
        changed = this.race(now, view) || changed;
        break;
      case 'out':
        if (now >= g.until) {
          if (g.alive.length <= 1) this.finishGame(now);
          else this.beginStep(now);
          changed = true;
        }
        break;
      case 'over':
        if (now >= g.until) {
          if (g.game < g.games) {
            g.ph = 'between';
            g.until = now + BETWEEN_MS;
          } else {
            g.ph = 'final';
            g.until = now + FINAL_MS;
          }
          changed = true;
        }
        break;
      case 'between':
        if (now >= g.until) {
          this.nextGame(now, view);
          changed = true;
        }
        break;
      default:
        break;
    }
    return changed;
  }

  eliminate(id) {
    const g = this.g;
    g.alive = g.alive.filter((x) => x !== id);
    g.elim.push(id);
  }

  drop(now, view) {
    const g = this.g;
    for (const id of g.alive.slice()) if (view.gone(id)) this.eliminate(id);
    if (g.alive.length <= 1) {
      this.finishGame(now);
      return true;
    }
    const players = g.alive.map((id) => view.pos(id)).filter(Boolean);
    g.chairs = placeChairs(g.alive.length - 1, players, rng(mixSeed(g.seed, g.n, 'chairs')));
    g.seats = g.chairs.map(() => null);
    g.sat = {};
    g.stopAt = g.until;
    g.ph = 'race';
    g.until = g.stopAt + SAFETY_MS;
    this.claims = [];
    return true;
  }

  race(now, view) {
    const g = this.g;
    const changed = this.resolveClaims(now);
    if (!g.seats.includes(null)) {
      const left = g.alive.filter((id) => !g.seats.includes(id));
      this.knockOut(left.length ? left[0] : g.alive[g.alive.length - 1], now);
      return true;
    }
    if (now >= g.until) {
      this.knockOut(this.farthest(view), now);
      return true;
    }
    return changed;
  }

  /** Nobody is moving: the one standing farthest from every free chair goes. */
  farthest(view) {
    const g = this.g;
    let loser = null;
    let far = -1;
    for (const id of g.alive) {
      if (g.seats.includes(id)) continue;
      const p = view.pos(id);
      let d = Infinity;
      if (p) {
        d = Infinity;
        g.chairs.forEach((c, i) => {
          if (g.seats[i] === null) d = Math.min(d, Math.hypot(p.x - c[0], p.y - c[1]));
        });
      }
      if (!p) d = 1e9;
      if (d > far) {
        far = d;
        loser = id;
      }
    }
    return loser ?? g.alive[g.alive.length - 1];
  }

  knockOut(id, now) {
    const g = this.g;
    this.eliminate(id);
    g.out = id;
    g.ph = 'out';
    g.until = now + OUT_MS;
    this.claims = [];
  }

  /** Claims go to the earliest on the match clock, once none earlier can still be on its way. */
  claim(id, chair, mt, now, view) {
    const g = this.g;
    if (g.ph !== 'race' || !g.alive.includes(id) || g.seats.includes(id)) return false;
    if (!Number.isInteger(chair) || chair < 0 || chair >= g.chairs.length || g.seats[chair] !== null) return false;
    if (typeof mt !== 'number' || !Number.isFinite(mt) || mt < g.stopAt + DROP_MS - 150) return false;
    const p = view && view.pos(id);
    if (p) {
      const c = g.chairs[chair];
      if (Math.hypot(p.x - c[0], p.y - c[1]) > 3) return false;
    }
    if (this.claims.length >= 40) return false;
    this.claims.push({ id, chair, mt: Math.min(mt, now) });
    return true;
  }

  resolveClaims(now) {
    const g = this.g;
    if (this.claims.length === 0) return false;
    this.claims.sort((a, b) => a.mt - b.mt);
    const waiting = new Set();
    const keep = [];
    let changed = false;
    for (const c of this.claims) {
      if (g.seats[c.chair] !== null || g.seats.includes(c.id)) continue;
      if (waiting.has(c.chair) || now - c.mt < HOLD_MS) {
        waiting.add(c.chair);
        keep.push(c);
        continue;
      }
      g.seats[c.chair] = c.id;
      const ms = Math.max(0, Math.round(c.mt - (g.stopAt + DROP_MS)));
      g.sat[c.id] = ms;
      const st = this.stats(c.id);
      st[0] += 1;
      st[1] += ms;
      changed = true;
    }
    this.claims = keep;
    return changed;
  }

  stats(id) {
    const g = this.g;
    if (!g.st[id]) g.st[id] = [0, 0, 0];
    return g.st[id];
  }

  /** A bump landed (the bumper says so, or the host's own bot did). */
  noteBump(id) {
    if (!this.g.roster.some((r) => r.id === id)) return;
    this.stats(id)[2] += 1;
    this.dirty = true;
  }

  finishGame(now) {
    const g = this.g;
    const survivors = g.alive.slice(0, 1);
    const order = g.elim.slice();
    if (survivors.length === 0 && order.length) survivors.push(order.pop());
    const winner = survivors[0] ?? null;
    const total = order.length + survivors.length;
    g.gp = {};
    const give = (id, place) => {
      const pts = pointsFor(place);
      g.scores[id] = (g.scores[id] ?? 0) + pts;
      g.gp[id] = pts;
      g.last[id] = place;
    };
    if (winner) {
      give(winner, 1);
      g.wins[winner] = (g.wins[winner] ?? 0) + 1;
    }
    order.forEach((id, i) => give(id, total - i));
    g.winner = winner;
    g.alive = winner ? [winner] : [];
    g.chairs = [];
    g.seats = [];
    g.rank = rankPlayers(g);
    g.ph = 'over';
    g.until = now + OVER_MS;
    this.claims = [];
  }

  nextGame(now, view) {
    const g = this.g;
    g.game++;
    g.step = 0;
    g.elim = [];
    g.out = null;
    g.winner = null;
    g.gp = {};
    g.alive = g.roster.map((r) => r.id).filter((id) => !view.gone(id));
    if (g.alive.length < 2) {
      g.rank = rankPlayers(g);
      g.ph = 'final';
      g.until = now + FINAL_MS;
      return;
    }
    this.beginStep(now);
  }
}
