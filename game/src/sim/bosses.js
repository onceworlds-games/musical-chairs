// Bosses: one per world, each built from mechanics that live on the bar line. Their pieces are enemies of type PART
// (so bolts, zaps and the renderer treat them like everything else); a boss keeps the HP and the patterns.
//   HYDRA      a serpent of segments sliding round the web, its heads spitting flippers on even downbeats
//   GATE       a turning ring of shields with two gaps, a core behind it, volleys down the gaps on beat 3
//   CONDUCTOR  points at lanes on beat 1, they burn on beat 3; its core opens only on beats 3 and 4
//   TIDE       water rises up half the web each bar and breaks on beat 4; the core hides in the dry half
//   MIRROR     sits across from you a beat behind and fires down its lane; later it follows you instead
//   MAESTRO    all of it, phase by phase
import { E, BOSSES, STEPS_PER_TICK, STEPS_PER_BEAT, STEPS_PER_BAR, TICKS_PER_BAR, BOSS_BARS } from './data.js';
import { spawnEnemy, nearestShip, S } from './enemies.js';
import { laneOf, wrapU, laneDelta, laneDist, opposite } from './web.js';

const ROLE = { CORE: 0, SEGMENT: 1, SHIELD: 2, MIRROR: 3 };
const MOVEMENT_BARS = 14; // the Maestro's movements last at least this long, however hard it is hit

export function makeBoss(w, kind) {
  const def = BOSSES[kind] ?? BOSSES.hydra;
  const players = Math.max(1, w.ships.length);
  const dps = w.bpm / 15; // a Plectrum's bolts per second at this tempo
  const hp = Math.round(def.secs * dps * (1 + 0.1 * w.oc) * (1 + 0.6 * (players - 1)) * (w.zone.depth ? 1 + 0.05 * w.zone.depth : 1));
  const boss = {
    kind,
    name: def.name,
    hp,
    maxHp: hp,
    phase: 0,
    active: false,
    down: false,
    enterAt: w.step,
    activeAt: w.step + STEPS_PER_BAR,
    parts: [],
    tele: [], // telegraphs for the renderer: { lanes, at (step it hits), until, kind }
    zapStep: -1,
    dir: 1,
    head: w.web.start,
    depth: 0.62,
    gap: 0,
    pattern: 0,
    side: 0,
    mirror: -1,
    trail: [],
    hurry: false,
    extra: w.oc >= 8,
    unsafe: (lane) => boss.tele.some((t) => t.lanes.includes(lane) && t.until > w.step && t.at - w.step < STEPS_PER_BEAT * 2),
  };
  w.event('boss', 0, 0, 0, 0, hp);
  setup(w, boss);
  return boss;
}

function setup(w, boss) {
  switch (boss.kind) {
    case 'hydra':
      serpent(w, boss, 6, Math.ceil(boss.maxHp / 6));
      break;
    case 'gate':
      core(w, boss, 0.9);
      ring(w, boss);
      break;
    case 'conductor':
      core(w, boss, 0.86);
      break;
    case 'tide':
      tideCore(w, boss);
      break;
    case 'mirror':
      mirrorPart(w, boss);
      break;
    case 'maestro':
      core(w, boss, 0.92);
      serpent(w, boss, 4, Math.ceil(boss.maxHp * 0.06));
      break;
  }
}

/** A part: an enemy the bolts can hit. role: what it is to the boss. */
function part(w, boss, lane, z, role, hp = 0) {
  const e = spawnEnemy(w, E.PART, lane, { z, hp: hp || 9999 });
  e.st = S.PART;
  e.a = role;
  e.c = hp; // a segment's or a shield's own hit points (0: the boss's)
  e.next = Infinity;
  boss.parts.push(e);
  return e;
}

function core(w, boss, z) {
  // The core sits at the far end across every lane: any bolt that gets there hits it.
  for (let l = 0; l < w.n; l++) part(w, boss, l, z, ROLE.CORE);
}

function serpent(w, boss, count, hp) {
  boss.head = w.web.start + Math.floor(w.n / 2);
  for (let i = 0; i < count; i++) {
    const e = part(w, boss, boss.head - i * boss.dir, boss.depth, ROLE.SEGMENT, hp);
    e.b = i; // place in the chain
  }
}

function ring(w, boss) {
  boss.gap = w.rng.int(w.n);
  const half = Math.floor(w.n / 2);
  for (let slot = 1; slot < w.n; slot++) {
    if (slot === half) continue; // the two gaps
    const e = part(w, boss, slot, 0.52, ROLE.SHIELD, 3);
    e.b = slot; // place on the ring, counted from the gap
    e.cMax = 3;
  }
  placeRing(w, boss);
}

function tideCore(w, boss) {
  boss.side = 0;
  for (let i = 0; i < 2; i++) {
    const e = part(w, boss, 0, 0.55, ROLE.CORE);
    e.b = i;
  }
  placeTideCore(w, boss);
}

function mirrorPart(w, boss) {
  // Three panes: a heart and two wings. Shots come down the heart's lane.
  boss.mirror = opposite(w.web, w.web.start);
  for (const b of [-1, 0, 1]) {
    const e = part(w, boss, boss.mirror + b, 0.82, ROLE.MIRROR);
    e.b = b;
  }
  placeMirror(w, boss);
}

function placeMirror(w, boss) {
  for (const p of boss.parts) {
    if (p.dead || p.a !== ROLE.MIRROR) continue;
    let l = boss.mirror + p.b;
    if (!w.web.closed) l = Math.max(0, Math.min(w.n - 1, l));
    p.lane = wrapU(w.web, l);
  }
}

// ------------------------------------------------------------------ the step

export function updateBoss(w, boss) {
  if (boss.down) return;
  const s = w.step;
  if (!boss.active) {
    // The entrance: pieces slide in from the far end; nothing can hurt it yet.
    const t = Math.min(1, (s - boss.enterAt) / (boss.activeAt - boss.enterAt));
    for (const p of boss.parts) p.flash = t < 1 ? 2 : 0;
    if (s >= boss.activeAt) {
      boss.active = true;
      w.event('bossin', 0, 0, 0, 0, boss.hp);
    }
  }
  if (s % STEPS_PER_TICK !== 0) {
    boss.tele = boss.tele.filter((t) => t.until > s);
    return;
  }
  const tick = w.tick;
  const inBar = tick % TICKS_PER_BAR;
  const bar = Math.floor(tick / TICKS_PER_BAR);
  if (!boss.hurry && s - boss.activeAt > BOSS_BARS * STEPS_PER_BAR) {
    boss.hurry = true;
    w.event('hurry');
  }
  boss.tele = boss.tele.filter((t) => t.until > s);
  if (!boss.active) return;
  const k = boss.kind === 'maestro' ? maestroPhase(w, boss) : boss.kind;
  switch (k) {
    case 'hydra':
      hydraTick(w, boss, inBar, bar);
      break;
    case 'gate':
      gateTick(w, boss, inBar, bar);
      break;
    case 'conductor':
      conductorTick(w, boss, inBar, bar);
      break;
    case 'tide':
      tideTick(w, boss, inBar, bar);
      break;
    case 'mirror':
      mirrorTick(w, boss, inBar, bar);
      break;
  }
  // The Maestro layers a second line over each movement.
  if (boss.kind === 'maestro') {
    if (boss.phase === 0) cue(w, boss, inBar, bar, 1);
    else if (boss.phase === 1) cue(w, boss, inBar, bar, 1);
    else if (boss.phase === 2 && bar % 2 === 1) cue(w, boss, inBar, bar, 1);
    else if (boss.phase >= 3 && bar % 2 === 1) cue(w, boss, inBar, bar, 1);
  }
}

/** A cue: the lanes around a ship light on the downbeat and burn on beat 3 (move three lanes, or hop). */
function cue(w, boss, inBar, bar, everyBars) {
  if (bar % everyBars !== 0) return;
  if (inBar === 0) {
    const lanes = patternLanes(w, boss, 'around', bar);
    boss.tele.push({ lanes, at: w.step + 8 * STEPS_PER_TICK, until: w.step + 12 * STEPS_PER_TICK, kind: 'cue' });
    w.event('baton', 0, 0, 0, lanes.length);
  } else if (inBar === 8) {
    const t = boss.tele.find((x) => x.kind === 'cue' && x.at <= w.step + 1);
    if (t) w.blast(t.lanes, STEPS_PER_BEAT);
  }
}

function every(boss, beats) {
  return boss.hurry ? Math.max(1, beats / 2) : beats;
}

// HYDRA ---------------------------------------------------------------

function hydraTick(w, boss, inBar, bar) {
  const segs = boss.parts.filter((p) => !p.dead && p.a === ROLE.SEGMENT);
  if (!segs.length) return;
  if (inBar % 4 === 0) {
    // Slide one lane along the web on every beat; the depth breathes over four bars.
    const cycle = (bar % 8) / 8;
    boss.depth = 0.62 - 0.26 * Math.sin(cycle * Math.PI);
    for (const p of segs) {
      let next = p.lane + boss.dir;
      if (!w.web.closed && (next < 0 || next > w.n - 1)) {
        boss.dir = -boss.dir;
        next = p.lane + boss.dir;
      }
      p.from = p.lane;
      p.to = next;
      p.fs = w.step;
      p.fl = STEPS_PER_TICK * 2;
      p.z = boss.depth + 0.02 * p.b;
    }
  } else {
    for (const p of segs) {
      if (p.fs >= 0) {
        const t = Math.min(1, (w.step - p.fs) / p.fl);
        p.lane = t >= 1 ? wrapU(w.web, p.to) : p.from + (p.to - p.from) * t;
        if (t >= 1) p.fs = -1;
      }
    }
  }
  // Heads (a segment with no living one ahead of it) spit a flipper on the downbeat of even bars.
  const spitBar = bar % every(boss, 2) === 0;
  if (inBar === 12 && !spitBar) {
    for (const h of heads(w, boss, segs)) boss.tele.push({ lanes: [laneOf(w.web, h.lane + boss.dir)], at: w.step + STEPS_PER_BEAT, until: w.step + STEPS_PER_BEAT, kind: 'spit' });
  }
  if (inBar === 0 && spitBar && w.enemies.length < 80) {
    for (const h of heads(w, boss, segs)) {
      const f = spawnEnemy(w, E.FLIPPER, laneOf(w.web, h.lane), { z: h.z - 0.04, dir: boss.dir });
      w.event('spawn', f.id, f.lane, f.z, E.FLIPPER);
    }
  }
}

function heads(w, boss, segs) {
  const out = [];
  for (const p of segs) {
    const ahead = segs.find((o) => o !== p && laneDist(w.web, Math.round(o.lane), Math.round(p.lane)) === 1 && laneDelta(w.web, p.lane, o.lane) * boss.dir > 0);
    if (!ahead) out.push(p);
  }
  return out.slice(0, 3);
}

// GATE ----------------------------------------------------------------

function placeRing(w, boss) {
  for (const p of boss.parts) {
    if (p.dead || p.a !== ROLE.SHIELD) continue;
    p.lane = wrapU(w.web, p.b + boss.gap);
  }
}

function gateTick(w, boss, inBar, bar) {
  if (inBar % 4 === 0) {
    // The ring turns a lane per beat and changes direction every four bars.
    if (inBar === 0 && bar % 4 === 0) boss.dir = -boss.dir;
    boss.gap = (boss.gap + boss.dir + w.n) % w.n;
    placeRing(w, boss);
  }
  // Broken shields come back after four bars.
  if (inBar === 0) {
    for (const p of boss.parts) {
      if (p.a === ROLE.SHIELD && p.c <= 0 && p.down !== undefined && w.step - p.down >= STEPS_PER_BAR * 4) {
        p.c = p.cMax;
        w.event('regrow', p.id, p.lane, p.z);
      }
    }
  }
  const volley = boss.kind === 'maestro' ? every(boss, 2) : every(boss, 4);
  const gaps = gapLanes(w, boss);
  if (inBar % (volley * 4) === 4) boss.tele.push({ lanes: gaps, at: w.step + STEPS_PER_BEAT, until: w.step + STEPS_PER_BEAT, kind: 'volley' });
  if (inBar % (volley * 4) === 8 && w.enemies.length < 85) {
    for (const l of gaps) {
      const shot = spawnEnemy(w, E.SHOT, l, { z: 0.85 });
      w.event('eshot', shot.id, l, shot.z);
    }
  }
}

function gapLanes(w, boss) {
  const half = Math.floor(w.n / 2);
  return [wrapU(w.web, boss.gap), wrapU(w.web, boss.gap + half)].map((l) => Math.round(l) % w.n);
}

// CONDUCTOR -----------------------------------------------------------

const PATTERNS = {
  conductor: ['halves', 'sweep', 'around', 'chord', 'sweep', 'around'],
  maestro: ['alternate', 'around', 'chord', 'halves', 'sweep', 'alternate'],
};

function conductorTick(w, boss, inBar, bar) {
  const len = every(boss, 4) * 4; // ticks per cycle: a bar (half a bar when it hurries)
  const at = inBar % len;
  if (at === 0) {
    const list = PATTERNS[boss.kind] || PATTERNS.conductor;
    const lanes = patternLanes(w, boss, list[boss.pattern % list.length], bar);
    boss.pattern++;
    boss.tele.push({ lanes, at: w.step + (len / 2) * STEPS_PER_TICK, until: w.step + (len / 2 + 4) * STEPS_PER_TICK, kind: 'baton' });
    w.event('baton', 0, 0, 0, lanes.length);
  }
  if (at === len / 2) {
    const t = boss.tele.find((x) => x.kind === 'baton' && x.at <= w.step + 1);
    if (t) w.blast(t.lanes, STEPS_PER_BEAT);
  }
}

function patternLanes(w, boss, pattern, bar) {
  const n = w.n;
  const out = [];
  const off = boss.pattern % 2;
  switch (pattern) {
    case 'alternate':
      for (let l = off; l < n; l += 2) out.push(l);
      break;
    case 'halves': {
      const start = (bar * 5 + boss.pattern * 3) % n;
      for (let i = 0; i < Math.floor(n / 2); i++) out.push((start + i) % n);
      break;
    }
    case 'sweep': {
      const start = (boss.pattern * Math.floor(n / 3)) % n;
      for (let i = 0; i < Math.ceil(n / 3); i++) out.push((start + i) % n);
      break;
    }
    case 'around': {
      // Right where a ship is: move three lanes, or hop.
      const t = nearestShip(w, w.web.start);
      const c = t ? laneOf(w.web, t.ship.u) : w.web.start;
      for (let d = -2; d <= 2; d++) {
        const l = c + d;
        if (w.web.closed || (l >= 0 && l < n)) out.push(((l % n) + n) % n);
      }
      break;
    }
    case 'chord':
      for (let g = 0; g < 3; g++) for (let i = 0; i < 2; i++) out.push((g * Math.floor(n / 3) + i + boss.pattern) % n);
      break;
  }
  return [...new Set(out)];
}

function conductorOpen(w) {
  // The core is open on beats 3 and 4 (the downstroke).
  return w.tick % TICKS_PER_BAR >= 8;
}

// TIDE ----------------------------------------------------------------

function placeTideCore(w, boss) {
  // The core waits in the dry half, in its middle.
  const n = w.n;
  const dryStart = boss.side ? 0 : Math.floor(n / 2);
  const mid = dryStart + Math.floor(n / 4);
  for (const p of boss.parts) if (!p.dead && p.a === ROLE.CORE && p.b !== undefined && boss.kind === 'tide') p.lane = wrapU(w.web, mid + p.b);
}

function tideTick(w, boss, inBar, bar) {
  const n = w.n;
  if (inBar === 0) {
    boss.side = bar % 2;
    const share = boss.hp < boss.maxHp * 0.5 ? 0.6 : 0.5;
    const count = Math.max(2, Math.floor(n * share));
    const start = boss.side ? Math.floor(n / 2) : 0;
    const lanes = [];
    for (let i = 0; i < count; i++) lanes.push((start + i) % n);
    boss.tide = lanes;
    const breakAt = every(boss, 4) === 4 ? 12 : 6;
    boss.tele.push({ lanes, at: w.step + breakAt * STEPS_PER_TICK, until: w.step + (breakAt + 4) * STEPS_PER_TICK, kind: 'tide' });
    if (boss.kind === 'tide') placeTideCore(w, boss);
    w.event('tide', 0, start, 0, count);
  }
  const breakAt = every(boss, 4) === 4 ? 12 : 6;
  if ((inBar === breakAt || (boss.hurry && inBar === breakAt + 8)) && boss.tide) w.blast(boss.tide, STEPS_PER_BEAT, 12);
}

// MIRROR --------------------------------------------------------------

function mirrorTick(w, boss, inBar, bar) {
  if (!boss.parts.some((p) => !p.dead && p.a === ROLE.MIRROR)) return;
  const late = boss.hp < boss.maxHp * 0.5;
  // Where the nearest ship was a beat ago: its reflection early on, its own lane later.
  const t = nearestShip(w, Math.round(boss.mirror));
  const lane = t ? laneOf(w.web, t.ship.u) : w.web.start;
  boss.trail.push(lane);
  if (boss.trail.length > 4) boss.trail.shift();
  const was = boss.trail[0];
  const goal = late ? was : opposite(w.web, was);
  const d = laneDelta(w.web, boss.mirror, goal);
  // It glides a lane per beat toward the reflection: stand beside its heart and hit a wing.
  if (d !== 0 && inBar % 4 === 0) {
    boss.mirror = wrapU(w.web, Math.round(boss.mirror) + Math.sign(d));
    placeMirror(w, boss);
  }
  const m = boss.parts.find((p) => !p.dead && p.a === ROLE.MIRROR && p.b === 0) || boss.parts.find((p) => !p.dead && p.a === ROLE.MIRROR);
  const period = every(boss, late ? 1 : 2) * 4;
  if (inBar % period === period - 2) boss.tele.push({ lanes: [laneOf(w.web, m.lane)], at: w.step + 2 * STEPS_PER_TICK, until: w.step + 2 * STEPS_PER_TICK, kind: 'aim' });
  if (inBar % period === 0 && w.enemies.length < 85) {
    const shot = spawnEnemy(w, E.SHOT, laneOf(w.web, m.lane), { z: m.z - 0.04 });
    w.event('eshot', shot.id, shot.lane, shot.z);
    if (late) {
      const echo = spawnEnemy(w, E.SHOT, laneOf(w.web, m.lane), { z: m.z + 0.06 });
      w.event('eshot', echo.id, echo.lane, echo.z);
    }
  }
}

// MAESTRO -------------------------------------------------------------

function maestroPhase(w, boss) {
  const f = boss.hp / boss.maxHp;
  const phase = f > 0.75 ? 0 : f > 0.5 ? 1 : f > 0.25 ? 2 : boss.extra && f <= 0.1 ? 4 : 3;
  if (phase !== boss.phase) {
    boss.phase = phase;
    boss.phaseAt = w.step;
    w.event('bossphase', 0, 0, 0, phase);
    // Each phase brings its own pieces and clears the last one's.
    for (const p of boss.parts) if (!p.dead && p.a !== ROLE.CORE) p.dead = true;
    boss.parts = boss.parts.filter((p) => !p.dead);
    boss.tele = [];
    if (phase === 1) ring(w, boss);
    if (phase === 3 || phase === 4) mirrorPart(w, boss);
    if (phase === 4) boss.hurry = true;
  }
  switch (phase) {
    case 0:
      return 'hydra';
    case 1:
      return 'gate';
    case 2:
      return 'conductor';
    default:
      return w.bar % 2 ? 'mirror' : 'tide';
  }
}

// ------------------------------------------------------------------ damage

/** A hit on a boss piece. amount: a number, or 'zap' / 'zapfar'. */
export function bossDamage(w, boss, p, amount, by) {
  if (!boss || boss.down || p.dead) return;
  if (!boss.active) {
    w.event('clink', p.id, p.lane, p.z);
    return;
  }
  if (amount === 'zap' || amount === 'zapfar') {
    if (boss.zapStep === w.step) return;
    boss.zapStep = w.step;
    hurt(w, boss, boss.maxHp * (amount === 'zap' ? 0.1 : 0.04), by, p);
    // A zap also clears shields and segments in its reach.
    if (amount === 'zap') for (const q of boss.parts) if (!q.dead && q.a === ROLE.SHIELD) breakShield(w, q);
    return;
  }
  p.flash = 4;
  if (p.a === ROLE.SHIELD) {
    if (p.c > 0) {
      p.c -= amount;
      w.event('clink', p.id, p.lane, p.z);
      if (p.c <= 0) breakShield(w, p);
    }
    return;
  }
  if (p.a === ROLE.CORE && (boss.kind === 'conductor' || (boss.kind === 'maestro' && boss.phase === 2)) && !conductorOpen(w)) {
    w.event('clink', p.id, p.lane, p.z);
    return;
  }
  if (p.a === ROLE.SEGMENT) {
    p.c -= amount;
    hurt(w, boss, amount, by, p);
    if (p.c <= 0 && !p.dead) {
      p.dead = true;
      w.event('kill', p.id, p.lane, p.z, E.PART, by, 0);
    }
    return;
  }
  hurt(w, boss, amount, by, p);
}

function breakShield(w, p) {
  p.c = 0;
  p.down = w.step;
  w.event('shatter', p.id, p.lane, p.z);
}

function hurt(w, boss, amount, by, p) {
  let floor = 0;
  if (boss.kind === 'maestro') {
    // Each movement plays for at least four bars: its HP stops at the next threshold until then.
    const marks = [0.75, 0.5, 0.25, 0];
    const mark = marks[Math.min(3, boss.phase)];
    if (w.step - (boss.phaseAt ?? boss.activeAt) < STEPS_PER_BAR * MOVEMENT_BARS) floor = boss.maxHp * mark + 0.5;
  }
  if (floor > 0 && boss.hp - amount < floor) {
    if (boss.hp > floor) boss.hp = floor;
    w.event('clink', p.id, p.lane, p.z);
    return;
  }
  boss.hp = Math.max(0, boss.hp - amount);
  if (w.auth && by >= 0) w.addScore(Math.round(25 * amount * w.mult), by);
  w.event('bosshit', p.id, p.lane, p.z, Math.round(boss.hp), by);
  if (boss.hp <= 0) bossDown(w, boss, by);
}

function bossDown(w, boss, by) {
  boss.down = true;
  boss.tele = [];
  for (const p of boss.parts) {
    if (p.dead) continue;
    p.dead = true;
  }
  w.stats.bossDown = true;
  const value = 10000 * ((w.zone.world % 6) + 1) * (w.overdrive ? 2 : 1);
  w.addScore(value, by);
  w.event('bossdown', 0, w.web.start, 0.8, value);
  w.vampBars = 2;
  if (w.phase === 1) w.setPhase(2);
}

export function bossPartKilled() {}

/** Whether a boss piece at this lane can be shot right now (for bots and for the renderer's open/closed look). */
export function partOpen(w, boss, p) {
  if (!boss || !boss.active) return false;
  if (p.a === ROLE.SHIELD) return p.c > 0;
  if (p.a === ROLE.CORE && (boss.kind === 'conductor' || (boss.kind === 'maestro' && boss.phase === 2))) return conductorOpen(w);
  return true;
}

export { ROLE };
