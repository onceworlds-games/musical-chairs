// Bots: a brain per bot that turns the round into a movement vector (and sometimes a bump). Pure: the host's page and
// the tests drive it the same way. Nothing here touches window or onceworlds.

import { W, H, OBSTACLES, rng, mixSeed, seedNum } from './rules.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function makeBrain(id, seed) {
  const r = rng(mixSeed(seedNum(seed), id, 'brain'));
  return {
    r,
    speedMul: 0.9 + r() * 0.1, // a touch slower than a player who reacts at once
    mx: 0,
    my: 0,
    bump: false,
    tx: W / 2,
    ty: H / 2,
    wait: 0,
    pause: 0,
    circle: null,
    rid: '',
    reactT: 0,
    target: -1,
    think: 0,
    bumpWait: 0,
    mode: 'dance',
    fooled: false,
    runX: 0,
    runY: 0,
  };
}

function nearObstacle(x, y, m) {
  for (const o of OBSTACLES) if (x > o.x0 - m && x < o.x1 + m && y > o.y0 - m && y < o.y1 + m) return true;
  return false;
}

function pickWander(a, B) {
  const r = B.r;
  if (r() < 0.22) {
    const cx = clamp(a.x + (r() - 0.5) * 4, 3, W - 3);
    const cy = clamp(a.y + (r() - 0.5) * 3, 2.8, H - 2.8);
    B.circle = { cx, cy, rad: 1 + r() * 0.9, ang: Math.atan2(a.y - cy, a.x - cx), dir: r() < 0.5 ? 1 : -1, t: 2.2 + r() * 2 };
    return;
  }
  for (let i = 0; i < 8; i++) {
    const x = 1.6 + r() * (W - 3.2);
    const y = 1.6 + r() * (H - 3.2);
    if (nearObstacle(x, y, 1.3)) continue;
    B.tx = x;
    B.ty = y;
    break;
  }
  B.wait = 1.2 + r() * 2.4;
  if (r() < 0.18) B.pause = 0.4 + r() * 0.6;
}

/** Dancing about the room: wander, now and then a circle, now and then a pause. */
function dance(a, B, dt, speed) {
  if (B.pause > 0) {
    B.pause -= dt;
    return;
  }
  B.wait -= dt;
  if (B.circle) {
    const c = B.circle;
    c.t -= dt;
    c.ang += c.dir * 2.1 * dt;
    B.tx = c.cx + Math.cos(c.ang) * c.rad;
    B.ty = c.cy + Math.sin(c.ang) * c.rad;
    if (c.t <= 0) {
      B.circle = null;
      B.wait = 0;
    }
  } else if (B.wait <= 0 || Math.hypot(B.tx - a.x, B.ty - a.y) < 0.4) pickWander(a, B);
  const dx = B.tx - a.x;
  const dy = B.ty - a.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.25) {
    B.mx = (dx / d) * speed;
    B.my = (dy / d) * speed;
  }
}

/** A ghost drifts about near the walls. */
function ghostWander(a, B, dt) {
  B.wait -= dt;
  if (B.wait <= 0 || Math.hypot(B.tx - a.x, B.ty - a.y) < 0.4) {
    const r = B.r;
    const side = Math.floor(r() * 4);
    if (side === 0) {
      B.tx = 0.8 + r() * 0.8;
      B.ty = 1 + r() * (H - 2);
    } else if (side === 1) {
      B.tx = W - 0.8 - r() * 0.8;
      B.ty = 1 + r() * (H - 2);
    } else if (side === 2) {
      B.tx = 1 + r() * (W - 2);
      B.ty = 0.8 + r() * 0.8;
    } else {
      B.tx = 1 + r() * (W - 2);
      B.ty = H - 0.8 - r() * 0.8;
    }
    B.wait = 2 + r() * 3;
  }
  const dx = B.tx - a.x;
  const dy = B.ty - a.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.3) {
    B.mx = (dx / d) * 0.5;
    B.my = (dy / d) * 0.5;
  }
}

/** Is another character who can still sit clearly closer to chair `i` than this one? */
function beaten(a, i, V) {
  const c = V.field.chairs[i];
  const mine = Math.hypot(c[0] - a.x, c[1] - a.y);
  for (const o of V.list) {
    if (o === a || o.ghost || o.chair >= 0 || o.sitFlag || !V.alive.has(o.id)) continue;
    if (Math.hypot(c[0] - o.x, c[1] - o.y) < mine - 0.4) return true;
  }
  return false;
}

/** The nearest free chair nobody is clearly closer to; failing that, the nearest free chair; -1 if none are free. */
function pickChair(a, V) {
  const { chairs, seats } = V.field;
  let best = -1;
  let bestD = Infinity;
  let safe = -1;
  let safeD = Infinity;
  for (let i = 0; i < chairs.length; i++) {
    if (seats[i] !== null && seats[i] !== undefined) continue;
    const d = Math.hypot(chairs[i][0] - a.x, chairs[i][1] - a.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
    if (d < safeD && !beaten(a, i, V)) {
      safeD = d;
      safe = i;
    }
  }
  return safe >= 0 ? safe : best;
}

function race(a, B, V, dt) {
  const F = V.field;
  if (B.rid !== F.rid) {
    // a new round: a moment to notice the music stopped
    B.rid = F.rid;
    B.reactT = 0.2 + B.r() * 0.4;
    B.target = -1;
    B.think = 0;
    B.bumpWait = 0.4;
  }
  if (B.reactT > 0) {
    B.reactT -= dt;
    dance(a, B, dt, 0.4);
    return;
  }
  const chairs = F.chairs;
  const seats = F.seats;
  B.think -= dt;
  B.bumpWait -= dt;
  const free = B.target >= 0 && B.target < chairs.length && (seats[B.target] === null || seats[B.target] === undefined);
  if (!free) {
    B.target = pickChair(a, V);
    B.think = 0.5;
  } else if (B.think <= 0) {
    // somebody is clearly closer to my chair: half the time I go for another
    B.think = 0.5;
    if (beaten(a, B.target, V) && B.r() < 0.5) {
      const alt = pickChair(a, V);
      if (alt >= 0) B.target = alt;
    }
  }
  if (B.target < 0) return;
  const cx = chairs[B.target][0];
  const cy = chairs[B.target][1];
  const dx = cx - a.x;
  const dy = cy - a.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.05) {
    B.mx = dx / d;
    B.my = dy / d;
  }
  // somebody between me and my chair: sometimes a hip-check
  if (a.cd <= 0 && a.bumpT <= 0 && B.bumpWait <= 0 && d > 0.8) {
    B.bumpWait = 0.45;
    for (const o of V.list) {
      if (o === a || o.ghost || o.chair >= 0 || o.sitFlag || !V.alive.has(o.id)) continue;
      const ox = o.x - a.x;
      const oy = o.y - a.y;
      const od = Math.hypot(ox, oy);
      if (od > 1.3 || od < 0.01) continue;
      if ((ox * dx + oy * dy) / (od * d) < 0.5) continue;
      if (Math.hypot(o.x - cx, o.y - cy) >= d) continue;
      if (B.r() < 0.3) B.bump = true;
      break;
    }
  }
}

/**
 * Decides what bot `a` does this step. V: { mode: 'dance' | 'dip' | 'race' | 'idle', field, list, alive }. The answer is in
 * B.mx, B.my (a movement vector, length up to 1) and B.bump (try a hip-check).
 */
export function thinkBot(a, B, V, dt) {
  B.mx = 0;
  B.my = 0;
  B.bump = false;
  const prev = B.mode;
  B.mode = V.mode;
  if (a.ghost) {
    ghostWander(a, B, dt);
    return;
  }
  if (a.chair >= 0) return;
  if (prev === 'dip' && V.mode !== 'dip' && B.fooled) {
    // the music is back: "huh?"
    B.fooled = false;
    a.bubble = '?';
    a.bubbleT = 0.9;
    B.pause = 0.6;
  }
  switch (V.mode) {
    case 'dip':
      if (prev !== 'dip') {
        B.fooled = B.r() < 0.2;
        if (B.fooled) {
          const dx = 3 + B.r() * (W - 6) - a.x;
          const dy = 2.5 + B.r() * (H - 5) - a.y;
          const d = Math.hypot(dx, dy) || 1;
          B.runX = dx / d;
          B.runY = dy / d;
        }
      }
      if (B.fooled) {
        B.mx = B.runX;
        B.my = B.runY;
      }
      break;
    case 'race':
      race(a, B, V, dt);
      break;
    case 'idle':
      break;
    default:
      dance(a, B, dt, 0.62);
  }
}
