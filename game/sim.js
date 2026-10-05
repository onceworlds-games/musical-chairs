// Pure movement and contact rules for one character: the same code runs a player on their own page and the bots on
// the host's page. Units are room units and seconds; nothing here touches window or onceworlds.

import { W, H, RADIUS, OBSTACLES, hashStr } from './rules.js';

export const MAX_SPEED = 5.5;
export const ACCEL = 35;
export const BRAKE = 60;
export const TURN = 55; // reversing is quicker than speeding up
export const GHOST_SPEED = 4.6;
export const BUMP_TIME = 0.2;
export const BUMP_CD = 1.2;
export const BUMP_REACH = 1.1;
export const KNOCK_DIST = 1.2; // a bump sends a character this far
export const KNOCK_DECAY = 8; // knock speed fades at this rate
export const KNOCK_SPEED = 10.27; // so a character at 60 steps a second travels KNOCK_DIST
export const LUNGE = 4.8; // the bumper hops forward a little
export const PUSH_RATE = 12; // soft push apart
export const SIT_R = 0.72; // touching a chair this close sits you down
export const CLAIM_TIMEOUT = 1.6; // a sit the host never confirmed is given up after this
export const WOBBLE = 1.0; // the fake-out penalty

export function makeActor(id, kind, x, y) {
  return {
    id,
    kind, // 'me' (this page), 'bot' (the host simulates it), 'remote' (another page's player) or 'view' (a bot the host simulates)
    x,
    y,
    vx: 0,
    vy: 0,
    kx: 0, // knock: a push that fades
    ky: 0,
    fx: 0, // facing
    fy: 1,
    bumpT: 0, // time left in a bump
    cd: 0, // time until the next bump
    wob: 0, // the fake-out penalty
    ghost: false, // out of the game: no collisions
    chair: -1, // the chair this one sits on (or has asked for)
    claimT: 0,
    sat: false, // the host has given it the chair
    sitFlag: false, // a remote page says it sits
    qPrev: false, // a bot's "?" flag the last time it was read from a snapshot
    hits: [], // who this bump has already hit
    speedMul: 1,
    bubble: '',
    bubbleT: 0,
    name: '',
    color: '#ffffff',
    v: {}, // how it looks (draw.js)
  };
}

/** Starts a hip-check if it's allowed right now. */
export function tryBump(a) {
  if (a.ghost || a.chair >= 0 || a.cd > 0 || a.bumpT > 0 || a.wob > 0) return false;
  a.bumpT = BUMP_TIME;
  a.cd = BUMP_CD;
  a.hits.length = 0;
  a.kx += a.fx * LUNGE;
  a.ky += a.fy * LUNGE;
  return true;
}

/** A bump lands: a push of KNOCK_DIST along (nx, ny). A sitting character is never pushed. */
export function knock(o, nx, ny) {
  if (o.chair >= 0 || o.ghost) return false;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
  o.kx += nx * KNOCK_SPEED;
  o.ky += ny * KNOCK_SPEED;
  return true;
}

/**
 * One fixed step. (mx, my) is where the character wants to go (length up to 1). `env`:
 *   list: every actor (for pushing apart and bump hits), field: the round (chairs, seats), canSit: may this one take a
 *   chair now, claim(a, chairIndex), hit(a, other, nx, ny), bonk(a): what happens when those occur (all optional).
 */
export function stepActor(a, mx, my, dt, env) {
  if (a.cd > 0) a.cd = Math.max(0, a.cd - dt);
  if (a.wob > 0) a.wob = Math.max(0, a.wob - dt);
  if (a.bumpT > 0) a.bumpT = Math.max(0, a.bumpT - dt);
  if (a.bubbleT > 0) {
    a.bubbleT -= dt;
    if (a.bubbleT <= 0) a.bubble = '';
  }
  if (a.chair >= 0) {
    seatStep(a, dt, env);
    if (a.chair >= 0) return;
  }

  // steering
  let len = Math.hypot(mx, my);
  if (!(len >= 0)) {
    mx = 0;
    my = 0;
    len = 0;
  }
  if (len > 1) {
    mx /= len;
    my /= len;
    len = 1;
  }
  const top = (a.ghost ? GHOST_SPEED : MAX_SPEED * a.speedMul) * (a.wob > 0 ? 0.7 : 1);
  const tx = mx * top;
  const ty = my * top;
  const dvx = tx - a.vx;
  const dvy = ty - a.vy;
  const dvl = Math.hypot(dvx, dvy);
  const rate = len > 0.05 ? (a.vx * tx + a.vy * ty < 0 ? TURN : ACCEL) : BRAKE;
  const maxDv = rate * dt;
  if (dvl <= maxDv) {
    a.vx = tx;
    a.vy = ty;
  } else {
    a.vx += (dvx / dvl) * maxDv;
    a.vy += (dvy / dvl) * maxDv;
  }
  if (len > 0.1) {
    a.fx = mx / len;
    a.fy = my / len;
  }
  const decay = Math.exp(-KNOCK_DECAY * dt);
  a.kx *= decay;
  a.ky *= decay;
  a.x += (a.vx + a.kx) * dt;
  a.y += (a.vy + a.ky) * dt;

  if (!a.ghost) {
    for (let i = 0; i < OBSTACLES.length; i++) pushOutRect(a, OBSTACLES[i]);
    if (env && env.list) pushApart(a, env.list, dt);
  }
  // walls
  if (a.x < RADIUS) {
    a.x = RADIUS;
    if (a.vx < 0) a.vx = 0;
    if (a.kx < 0) a.kx = 0;
  } else if (a.x > W - RADIUS) {
    a.x = W - RADIUS;
    if (a.vx > 0) a.vx = 0;
    if (a.kx > 0) a.kx = 0;
  }
  if (a.y < RADIUS) {
    a.y = RADIUS;
    if (a.vy < 0) a.vy = 0;
    if (a.ky < 0) a.ky = 0;
  } else if (a.y > H - RADIUS) {
    a.y = H - RADIUS;
    if (a.vy > 0) a.vy = 0;
    if (a.ky > 0) a.ky = 0;
  }
  if (a.ghost || !env) return;

  // a bump in progress knocks whoever it touches, once each
  if (a.bumpT > 0 && env.list) {
    const list = env.list;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o === a || o.ghost || o.chair >= 0 || o.sitFlag || a.hits.includes(o.id)) continue;
      const dx = o.x - a.x;
      const dy = o.y - a.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= BUMP_REACH * BUMP_REACH) continue;
      const d = Math.sqrt(d2);
      a.hits.push(o.id);
      if (env.hit) env.hit(a, o, d > 1e-6 ? dx / d : a.fx, d > 1e-6 ? dy / d : a.fy);
    }
  }

  // touching a free chair sits you down (and asks the host for it)
  if (env.canSit && env.field) {
    const chairs = env.field.chairs;
    const seats = env.field.seats;
    let best = -1;
    let bd = SIT_R * SIT_R;
    for (let i = 0; i < chairs.length; i++) {
      if (seats[i] !== null && seats[i] !== undefined) continue;
      const dx = a.x - chairs[i][0];
      const dy = a.y - chairs[i][1];
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = i;
      }
    }
    if (best >= 0) {
      a.chair = best;
      a.claimT = 0;
      a.sat = false;
      a.vx *= 0.3;
      a.vy *= 0.3;
      if (env.claim) env.claim(a, best);
    }
  }
}

function seatStep(a, dt, env) {
  const field = env && env.field;
  const c = field && field.chairs[a.chair];
  a.claimT += dt;
  if (!c) {
    // the chairs went away: stand up
    a.chair = -1;
    a.sat = false;
    return;
  }
  const occ = field.seats[a.chair];
  if (occ === a.id) a.sat = true;
  else if (occ !== null && occ !== undefined) {
    // somebody else was faster: pushed off with a bonk
    a.chair = -1;
    a.sat = false;
    a.claimT = 0;
    let dx = a.x - c[0];
    let dy = a.y - c[1];
    let d = Math.hypot(dx, dy);
    if (d < 0.05) {
      dx = -a.fx;
      dy = -a.fy;
      d = Math.hypot(dx, dy) || 1;
    }
    a.kx += (dx / d) * 9;
    a.ky += (dy / d) * 9;
    if (env.bonk) env.bonk(a);
    return;
  } else if (a.claimT > CLAIM_TIMEOUT) {
    a.chair = -1;
    a.sat = false;
    return;
  }
  const k = 1 - Math.exp(-18 * dt);
  a.x += (c[0] - a.x) * k;
  a.y += (c[1] - a.y) * k;
  a.vx = 0;
  a.vy = 0;
  a.kx = 0;
  a.ky = 0;
}

function pushOutRect(a, o) {
  const cx = a.x < o.x0 ? o.x0 : a.x > o.x1 ? o.x1 : a.x;
  const cy = a.y < o.y0 ? o.y0 : a.y > o.y1 ? o.y1 : a.y;
  const dx = a.x - cx;
  const dy = a.y - cy;
  const d2 = dx * dx + dy * dy;
  if (d2 >= RADIUS * RADIUS) return;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    a.x = cx + nx * RADIUS;
    a.y = cy + ny * RADIUS;
    const vn = a.vx * nx + a.vy * ny;
    if (vn < 0) {
      a.vx -= vn * nx;
      a.vy -= vn * ny;
    }
    const kn = a.kx * nx + a.ky * ny;
    if (kn < 0) {
      a.kx -= kn * nx;
      a.ky -= kn * ny;
    }
    return;
  }
  // the centre is inside: leave by the nearest side that isn't a wall
  const sides = [];
  if (o.open.includes('l')) sides.push([a.x - o.x0, 'l']);
  if (o.open.includes('r')) sides.push([o.x1 - a.x, 'r']);
  if (o.open.includes('b')) sides.push([o.y1 - a.y, 'b']);
  sides.sort((p, q) => p[0] - q[0]);
  const side = sides.length ? sides[0][1] : 'b';
  if (side === 'l') a.x = o.x0 - RADIUS;
  else if (side === 'r') a.x = o.x1 + RADIUS;
  else a.y = o.y1 + RADIUS;
}

function pushApart(a, list, dt) {
  const min = RADIUS * 2;
  const k = Math.min(1, PUSH_RATE * dt);
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === a || o.ghost) continue;
    let dx = a.x - o.x;
    let dy = a.y - o.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2);
    let nx;
    let ny;
    if (d < 1e-6) {
      // exactly on top of each other: split by a direction both pages agree on
      const ang = (hashStr(a.id < o.id ? a.id + o.id : o.id + a.id) % 628) / 100;
      const sign = a.id < o.id ? 1 : -1;
      nx = Math.cos(ang) * sign;
      ny = Math.sin(ang) * sign;
    } else {
      nx = dx / d;
      ny = dy / d;
    }
    const push = (min - d) * k;
    a.x += nx * push;
    a.y += ny * push;
  }
}
