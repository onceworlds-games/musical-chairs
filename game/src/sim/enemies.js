// Enemy behaviours. Every enemy moves continuously but decides on the beat grid (tick boundaries), and keeps its next
// decision in its own state, so a page mirroring the host's snapshots can play it forward and land in the same place.
import { E, ENEMIES, STEPS_PER_TICK, STEPS_PER_BEAT, TICKS_PER_BAR, TICKS_PER_BEAT } from './data.js';
import { laneDelta, laneDist, wrapU, neighbour } from './web.js';

// Enemy states.
export const S = { CLIMB: 0, RIM: 1, RETREAT: 2, ARMED: 3, FLY: 4, EDGE: 5, PART: 6 };

const RIM_Z = 0.02;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

let scratch = null;

/** Creates an enemy at the far end (or where told). Returns it. */
export function spawnEnemy(w, type, lane, opts = {}) {
  // Spawns only the host makes draw from its own stream, so a mirror's shared one stays in step.
  const rng = opts.rng || w.rng;
  const def = ENEMIES[type];
  const e = w.pool.pop() || {};
  e.id = opts.id ?? w.nextId++;
  e.type = type;
  e.lane = wrapU(w.web, lane);
  e.z = opts.z ?? 1;
  e.hp = opts.hp ?? (type === E.SHOT || type === E.MINE || type === E.PART ? def.hp : def.hp * w.tough);
  e.maxHp = e.hp;
  e.st = S.CLIMB;
  e.from = e.lane;
  e.to = e.lane;
  e.fs = -1; // flip start step (-1: not flipping)
  e.fl = 0; // flip length in steps
  e.dir = opts.dir ?? (rng.chance(0.5) ? 1 : -1);
  e.next = w.tick + (opts.delay ?? 1); // tick of its next decision
  e.t0 = w.step; // birth step
  e.a = 0; // type-specific numbers
  e.b = 0;
  e.c = 0;
  e.group = opts.group ?? 0;
  e.dead = false;
  e.hitBy = -1;
  e.tb = -1; // last beat the tether burned it
  e.flash = 0; // steps of hit flash (render)
  e.px = e.lane; // previous position (render interpolation)
  e.pz = e.z;
  if (type === E.SPIKER) e.a = w.oc >= 4 ? rng.range(0.12, 0.45) : rng.range(0.28, 0.6); // the depth it climbs to
  if (type === E.WEAVER) {
    e.a = e.lane; // centre line
    e.b = rng.range(1.2, 1.9) * (rng.chance(0.5) ? 1 : -1); // amplitude, lanes
    if (!w.web.closed) e.a = Math.max(Math.abs(e.b), Math.min(w.web.n - 1 - Math.abs(e.b), e.a));
  }
  if (type === E.FUSEBALL) {
    e.st = S.EDGE;
    e.lane = wrapU(w.web, Math.floor(lane) + 0.5);
    if (!w.web.closed) e.lane = Math.min(w.web.n - 1.5, Math.max(0.5, e.lane));
    e.from = e.to = e.lane;
    e.c = 0; // beats spent on the rim
  }
  if (type === E.PULSAR) e.a = w.tick; // its pulse phase starts here
  if (type === E.BOMBER) {
    e.z = opts.z ?? 1;
    e.st = S.FLY;
    e.a = 0; // mines dropped
    e.b = rng.int(4) + 4; // lanes before it turns
  }
  if (type === E.MINE) e.a = 4; // beats on the count once armed
  if (type === E.SHOT) e.next = Infinity;
  w.enemies.push(e);
  return e;
}

/** The lane an enemy can be shot in, or -1 while it is between lanes (mid-flip, on a lane edge, faded out). */
export function hitLane(w, e) {
  if (e.dead) return -1;
  if (e.type === E.PART && e.a === 2 && e.c <= 0) return -1; // a broken shield lets bolts through
  if (e.type === E.GHOST && !ghostVisible(w, e)) return -1;
  const r = Math.round(e.lane);
  if (Math.abs(e.lane - r) > (e.type === E.FUSEBALL ? 0.2 : 0.26)) return -1;
  const n = w.web.n;
  return w.web.closed ? ((r % n) + n) % n : Math.max(0, Math.min(n - 1, r));
}

export function ghostVisible(w, e) {
  return w.step % STEPS_PER_BEAT < STEPS_PER_BEAT / 2;
}

/** The nearest living ship to a lane: { ship, d (signed lanes) } or null. */
export function nearestShip(w, lane) {
  let best = null;
  let bestD = Infinity;
  for (const s of w.ships) {
    if (s.state !== 'live') continue;
    const d = laneDelta(w.web, lane, Math.round(s.u));
    if (Math.abs(d) < Math.abs(bestD) || (Math.abs(d) === Math.abs(bestD) && best && s.idx < best.idx)) {
      bestD = d;
      best = s;
    }
  }
  return best ? { ship: best, d: bestD } : null;
}

function startFlip(w, e, dir, ticks) {
  const from = Math.round(e.lane);
  let to = from + dir;
  if (!w.web.closed && (to < 0 || to > w.web.n - 1)) {
    dir = -dir;
    to = from + dir;
    if (to < 0 || to > w.web.n - 1) return false;
  }
  e.from = from;
  e.to = to;
  e.fs = w.step;
  e.fl = Math.max(2, Math.round(ticks * STEPS_PER_TICK));
  e.dir = dir;
  return true;
}

function updateFlip(w, e) {
  if (e.fs < 0) return;
  const p = (w.step - e.fs) / e.fl;
  if (p >= 1) {
    e.lane = wrapU(w.web, e.to);
    e.fs = -1;
    return;
  }
  e.lane = e.from + (e.to - e.from) * smooth(p);
}

/** How fast things climb, in z per step, at this world's pace (and slower near the rim under Undertow). */
function climbRate(w, e, perBeat) {
  let r = (perBeat * w.pace) / STEPS_PER_BEAT;
  if (e.z < 0.25 && w.undertow > 0) r *= w.undertow >= 2 ? 0.75 : 0.85;
  return r;
}

function reachRim(w, e) {
  e.z = 0;
  e.st = S.RIM;
  e.next = w.tick + 1;
  w.rimArrival(e);
}

/** Crawl one lane toward the nearest ship (a rim crawler's beat). */
function crawl(w, e, flipTicks) {
  const target = nearestShip(w, Math.round(e.lane));
  if (!target || target.d === 0) return;
  startFlip(w, e, target.d > 0 ? 1 : -1, flipTicks);
}

/** One step of an enemy. Decisions happen when the tick advances past e.next. */
export function updateEnemy(w, e) {
  e.px = e.lane;
  e.pz = e.z;
  if (e.flash > 0) e.flash--;
  const tickNow = w.step % STEPS_PER_TICK === 0;
  const act = tickNow && w.tick >= e.next;
  const def = ENEMIES[e.type];
  const crawlEvery = w.oc >= 3 ? 2 : TICKS_PER_BEAT;
  const crawlFlip = w.oc >= 3 ? 1 : 2;
  switch (e.type) {
    case E.FLIPPER:
    case E.GHOST:
    case E.SIREN: {
      updateFlip(w, e);
      if (e.st === S.CLIMB) {
        e.z -= climbRate(w, e, def.climb);
        if (e.z <= 0) reachRim(w, e);
        else if (act) {
          const every = e.type === E.SIREN ? 0 : e.type === E.GHOST ? 8 : w.flipEvery;
          if (every > 0 && e.z > 0.1 && e.fs < 0) {
            startFlip(w, e, e.dir, 2);
            // The next turn: mostly toward the nearest ship, sometimes onward.
            const t = nearestShip(w, Math.round(e.to));
            e.dir = t && t.d !== 0 && w.rng.chance(0.6) ? (t.d > 0 ? 1 : -1) : w.rng.chance(0.7) ? e.dir : -e.dir;
          }
          if (e.type === E.FLIPPER && e.z > 0.3 && e.z < 0.92 && w.rng.chance(w.shotChance)) w.enemyShot(e);
          e.next = w.tick + (every || TICKS_PER_BEAT);
        }
      } else if (e.st === S.RIM && act && e.fs < 0) {
        crawl(w, e, e.type === E.SIREN ? 2 : crawlFlip);
        e.next = w.tick + (e.type === E.SIREN ? TICKS_PER_BEAT * 2 : crawlEvery);
      }
      break;
    }
    case E.TANKER: {
      e.z -= climbRate(w, e, def.climb);
      if (e.z <= 0) {
        e.z = 0;
        w.rimArrival(e);
        // The host splits it; a mirror waits for the pieces to arrive in the next snapshot.
        if (w.auth) {
          w.split(e);
          w.remove(e);
        } else e.z = 0;
      }
      break;
    }
    case E.SPIKER: {
      if (e.st === S.CLIMB) {
        e.z -= climbRate(w, e, def.climb);
        const lane = Math.round(e.lane);
        const h = Math.min(0.85, 1 - e.z);
        if (h > w.spikes[lane]) w.spikes[lane] = h;
        if (e.z <= e.a) e.st = S.RETREAT;
      } else {
        e.z += climbRate(w, e, def.climb * 1.3);
        if (e.z >= 1) {
          // Back at the far end it turns into a flipper and comes again.
          e.z = 1;
          e.type = E.FLIPPER;
          e.st = S.CLIMB;
          e.hp = 1;
          e.next = w.tick + 2;
          w.event('morph', e.id, e.lane, e.z);
        }
      }
      break;
    }
    case E.FUSEBALL: {
      updateFlip(w, e);
      if (e.fs >= 0) {
        // Gliding along an edge or across a lane.
        if (e.st === S.EDGE && e.b !== 0) e.z = Math.max(0, Math.min(1, e.z + e.b / e.fl));
        if (e.z <= 0 && !e.a) {
          e.a = 1;
          w.rimArrival(e);
        } else if (e.z > 0.1) e.a = 0;
      } else if (act) {
        e.next = w.tick + 2; // an eighth note
        const atEdge = Math.abs(e.lane - Math.round(e.lane)) > 0.3;
        if (e.z <= RIM_Z) {
          e.c++;
          if (e.c > 16 && atEdge) {
            // After a while on the rim it dives back down for another run.
            e.b = 0.35;
            e.fs = w.step;
            e.fl = STEPS_PER_BEAT * 2;
            e.from = e.to = e.lane;
            e.c = 0;
            break;
          }
          const t = nearestShip(w, Math.round(e.lane));
          const dir = t && t.d !== 0 ? (t.d > 0 ? 1 : -1) : e.dir;
          e.b = 0;
          halfStep(w, e, dir);
        } else if (atEdge && w.rng.chance(0.55)) {
          // Run along the edge toward the rim.
          e.b = -Math.min(e.z, 0.075 * w.pace);
          e.fs = w.step;
          e.fl = STEPS_PER_TICK * 2;
          e.from = e.to = e.lane;
        } else {
          e.b = 0;
          if (w.rng.chance(0.25)) e.dir = -e.dir;
          halfStep(w, e, e.dir);
        }
      }
      if (e.z <= RIM_Z && e.st === S.EDGE) e.z = Math.max(0, e.z);
      break;
    }
    case E.PULSAR: {
      updateFlip(w, e);
      if (e.st === S.CLIMB) {
        e.z -= climbRate(w, e, def.climb);
        if (e.z <= 0) reachRim(w, e);
      }
      if (act) {
        e.next = w.tick + 1;
        const age = w.tick - e.a;
        const period = w.oc >= 5 ? TICKS_PER_BAR : TICKS_PER_BAR * 2;
        const phase = ((age % period) + period) % period;
        if (phase === 0 && age > 0) {
          if (e.fs < 0) {
            w.pulse(e); // the lane is live for a beat
            e.b = w.tick + TICKS_PER_BEAT;
          }
        } else if (phase === period - TICKS_PER_BAR / 2 && e.fs < 0) {
          w.event('charge', e.id, Math.round(e.lane), 0); // the build-up: half a bar of warning, then the bar line
        } else if (phase === TICKS_PER_BEAT * 2 && e.fs < 0) {
          // Between pulses it may move a lane (toward a ship once on the rim).
          if (e.st === S.RIM) crawl(w, e, 2);
          else if (w.rng.chance(0.5)) startFlip(w, e, e.dir, 3);
        }
      }
      break;
    }
    case E.WEAVER: {
      if (e.st === S.CLIMB) {
        e.z -= climbRate(w, e, def.climb);
        const t = (w.step - e.t0) / (STEPS_PER_BEAT * 2);
        e.lane = wrapU(w.web, e.a + e.b * Math.sin(t * Math.PI * 2));
        if (e.z <= 0) {
          e.lane = wrapU(w.web, Math.round(e.lane));
          reachRim(w, e);
        }
      } else {
        updateFlip(w, e);
        if (act && e.fs < 0) {
          crawl(w, e, crawlFlip);
          e.next = w.tick + crawlEvery;
        }
      }
      break;
    }
    case E.BOMBER: {
      updateFlip(w, e);
      if (e.st === S.FLY) {
        if (e.z > 0.84) e.z = Math.max(0.84, e.z - 0.15 / STEPS_PER_BEAT);
        if (act && e.fs < 0) {
          e.next = w.tick + TICKS_PER_BEAT;
          if (w.tick % (TICKS_PER_BAR * 2) === 0 && w.tick > e.t0 / STEPS_PER_TICK + 4) {
            w.dropMine(e);
            e.a++;
            if (e.a >= 3) e.st = S.CLIMB; // three mines, then it dives
          } else {
            if (--e.b <= 0) {
              e.dir = -e.dir;
              e.b = w.rng.int(4) + 4;
            }
            startFlip(w, e, e.dir, 2);
          }
        }
      } else if (e.st === S.CLIMB) {
        e.z -= climbRate(w, e, def.climb * 1.4);
        if (e.z <= 0) reachRim(w, e);
      } else if (act && e.fs < 0) {
        crawl(w, e, crawlFlip);
        e.next = w.tick + crawlEvery;
      }
      break;
    }
    case E.MINE: {
      if (e.st === S.CLIMB) {
        e.z -= climbRate(w, e, def.climb);
        if (e.z <= 0) {
          e.z = 0;
          e.st = S.ARMED;
          e.next = w.tick + TICKS_PER_BEAT;
          w.event('armed', e.id, Math.round(e.lane), 4);
        }
      } else if (act) {
        e.a--;
        e.next = w.tick + TICKS_PER_BEAT;
        if (e.a <= 0) {
          w.detonate(e);
          w.remove(e);
        } else w.event('count', e.id, Math.round(e.lane), e.a);
      }
      break;
    }
    case E.SHOT: {
      e.z -= climbRate(w, e, def.climb);
      if (e.z <= 0) {
        w.shotLands(e);
        w.remove(e);
      }
      break;
    }
    case E.PART:
      // Boss parts are moved by their boss.
      break;
  }
}

/** A fuseball moves half a lane: edge to centre or centre to edge. */
function halfStep(w, e, dir) {
  let to = e.lane + dir * 0.5;
  if (!w.web.closed && (to < 0 || to > w.web.n - 1)) {
    dir = -dir;
    e.dir = dir;
    to = e.lane + dir * 0.5;
  }
  e.from = e.lane;
  e.to = to;
  e.fs = w.step;
  e.fl = STEPS_PER_TICK * 2;
}

/** Whether touching this enemy at the rim catches a ship (and with what grace). */
export function rimDanger(w, e) {
  if (e.dead || e.z > RIM_Z * 2) return false;
  switch (e.type) {
    case E.FLIPPER:
    case E.WEAVER:
    case E.SIREN:
    case E.PULSAR:
    case E.BOMBER:
    case E.FUSEBALL:
      return e.st === S.RIM || e.type === E.FUSEBALL || e.z <= RIM_Z;
    case E.GHOST:
      return ghostVisible(w, e);
    default:
      return false;
  }
}

/** Lanes an enemy currently occupies for a ship's contact check (one lane once settled; none mid-flip). */
export function contactLane(w, e) {
  if (e.fs >= 0) {
    const p = (w.step - e.fs) / e.fl;
    if (p < 0.85) return -1;
  }
  return hitLane(w, e);
}

export { laneDist, neighbour, RIM_Z };
