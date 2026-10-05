// The party room and everyone in it, drawn with Canvas 2D: flat bright colours, thick dark outlines, solid offset shadows.
// One renderer for the game and for the store pictures. `S` is the scene the caller keeps up to date:
//   w, h, pr         the canvas in css pixels and its pixel ratio (only the floor cache needs pr)
//   cam              { s, ox, oy }: pixels per room unit and where the room's corner is (see fitCamera)
//   t                seconds since the page began (animation); beat: beats of music so far (frozen while it is silent)
//   world, fx        the cast and the round (world.js), the particles (fx.js)
//   people           Map id -> { id, name, color, bot, img, ready } (names, colours, avatar images)
//   meId, youT       who is "YOU", and seconds since the round began (the arrow shows for 3 s)
//   dim, flash       0-1 overlays after a stop; reduced: the player wants less motion; floor: the cached background

import { W, H, OBSTACLES, GOLD, CHAIR_COLORS, DROP_MS, rng } from './rules.js';
import { BUMP_TIME } from './sim.js';
import { INK, SHADOW, clamp, ease, pop, label, font, shade, roundRect, circle, ellipse, fillStroke, checkBadge, fitName, starPath } from './gfx.js';

export const PAD = { l: 0.9, r: 0.9, t: 1.4, b: 0.9 };
export const BOTTOM_RESERVE = 26; // px kept for the platform's strip and the thumbs
export const ACTOR = 1.2; // a character is drawn this much bigger than its collision circle
export const BG = '#2a1a5e';

export function fitCamera(w, h) {
  const availH = Math.max(80, h - BOTTOM_RESERVE);
  const worldW = W + PAD.l + PAD.r;
  const worldH = H + PAD.t + PAD.b;
  const s = Math.max(8, Math.min(w / worldW, availH / worldH));
  return { s, ox: (w - W * s) / 2, oy: (availH - worldH * s) / 2 + PAD.t * s };
}

const hashId = (id) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
};

// ---------------------------------------------------------------- the room (cached)

export function buildFloor(S) {
  const { w, h, cam } = S;
  const pr = S.pr || 1;
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * pr));
  cv.height = Math.max(1, Math.round(h * pr));
  const g = cv.getContext('2d');
  g.scale(pr, pr);
  const s = cam.s;
  const X = (x) => cam.ox + x * s;
  const Y = (y) => cam.oy + y * s;
  const r = rng(42);

  // wallpaper
  g.fillStyle = '#5a35e0';
  g.fillRect(0, 0, w, h);
  const sw = 1.1 * s;
  g.fillStyle = '#6b47f2';
  for (let x = (cam.ox % (sw * 2)) - sw * 2; x < w; x += sw * 2) g.fillRect(x, 0, sw, h);
  g.fillStyle = '#3d1f9a';
  g.fillRect(0, Y(H) + 0.35 * s, w, h);

  // baseboard and floor
  const bb = 0.24 * s;
  roundRect(g, X(0) - bb, Y(0) - bb, W * s + bb * 2, H * s + bb * 2, bb * 0.7);
  g.fillStyle = '#331785';
  g.fill();
  g.save();
  g.beginPath();
  g.rect(X(0), Y(0), W * s, H * s);
  g.clip();
  const plankH = 0.62;
  for (let row = 0, y = 0; y < H; row++, y += plankH) {
    g.fillStyle = row % 2 ? '#e8b476' : '#f0be84';
    g.fillRect(X(0), Y(y), W * s, plankH * s + 1);
    g.fillStyle = 'rgba(125,72,30,0.38)';
    g.fillRect(X(0), Y(y), W * s, Math.max(1.5, 0.05 * s));
    let x = -r() * 2.5;
    while (x < W) {
      x += 2.2 + r() * 2.6;
      g.fillRect(X(x), Y(y), Math.max(1.5, 0.05 * s), plankH * s);
    }
    g.strokeStyle = 'rgba(150,95,45,0.2)';
    g.lineWidth = 1;
    for (let k = 0; k < 4; k++) {
      const gx = r() * W;
      const gy = y + 0.12 + r() * 0.4;
      g.beginPath();
      g.moveTo(X(gx), Y(gy));
      g.lineTo(X(gx + 0.6 + r() * 1.2), Y(gy + (r() - 0.5) * 0.06));
      g.stroke();
    }
  }
  // the big round rug
  const rug = [[3.95, '#ff5c8a'], [3.55, '#ffd23f'], [2.9, '#2ec4b6'], [2.2, '#ff5c8a'], [1.5, '#fff0c9']];
  g.save();
  g.fillStyle = SHADOW;
  circle(g, X(GOLD.x) + 0.12 * s, Y(GOLD.y) + 0.12 * s, 3.95 * s);
  g.fill();
  rug.forEach(([rad, col], i) => {
    circle(g, X(GOLD.x), Y(GOLD.y), rad * s);
    fillStroke(g, col, i === 0 ? Math.max(3, 0.1 * s) : 0);
  });
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = Math.max(2, 0.07 * s);
  g.setLineDash([0.28 * s, 0.22 * s]);
  circle(g, X(GOLD.x), Y(GOLD.y), 3.7 * s);
  g.stroke();
  g.setLineDash([]);
  starPath(g, X(GOLD.x), Y(GOLD.y), 1.05 * s, 8, 0.55);
  g.fillStyle = '#ffd23f';
  g.fill();
  g.lineWidth = Math.max(2, 0.06 * s);
  g.strokeStyle = INK;
  g.stroke();
  g.restore();
  // confetti on the floor
  const cols = ['#ff4757', '#ffc312', '#2ed573', '#2f9bff', '#a55eea', '#ff6bb5', '#1dd1c1'];
  for (let i = 0; i < 90; i++) {
    g.save();
    g.translate(X(r() * W), Y(r() * H));
    g.rotate(r() * 6.3);
    g.globalAlpha = 0.85;
    g.fillStyle = cols[i % cols.length];
    g.fillRect(-0.09 * s, -0.05 * s, 0.18 * s, 0.1 * s);
    g.restore();
  }
  // the walls' shade on the floor
  const shadeEdge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, 'rgba(45,15,90,0.38)');
    gr.addColorStop(1, 'rgba(45,15,90,0)');
    g.fillStyle = gr;
    g.fillRect(rx, ry, rw, rh);
  };
  shadeEdge(0, Y(0), 0, Y(0.9), X(0), Y(0), W * s, 0.9 * s);
  shadeEdge(X(0), 0, X(0.7), 0, X(0), Y(0), 0.7 * s, H * s);
  shadeEdge(X(W), 0, X(W - 0.7), 0, X(W - 0.7), Y(0), 0.7 * s, H * s);
  shadeEdge(0, Y(H), 0, Y(H - 0.7), X(0), Y(H - 0.7), W * s, 0.7 * s);
  g.restore();

  // bunting on the back wall
  for (const [y0, sag, off] of [[-0.55, 0.45, 0], [-1.05, 0.35, 0.45]]) {
    g.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const px = X(-0.4 + t * (W + 0.8));
      const py = Y(y0 + sag * 4 * t * (1 - t));
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.lineWidth = Math.max(1.5, 0.05 * s);
    g.strokeStyle = INK;
    g.stroke();
    for (let i = 0; i < 22; i++) {
      const t = (0.5 + i + off) / 23;
      if (t > 0.99) continue;
      const px = X(-0.4 + t * (W + 0.8));
      const py = Y(y0 + sag * 4 * t * (1 - t));
      g.beginPath();
      g.moveTo(px - 0.25 * s, py);
      g.lineTo(px + 0.25 * s, py);
      g.lineTo(px, py + 0.5 * s);
      g.closePath();
      fillStroke(g, ['#ff4757', '#ffc312', '#2ed573', '#2f9bff', '#ff6bb5'][(i + (off ? 2 : 0)) % 5], Math.max(1.5, 0.045 * s));
    }
  }
  return cv;
}

// ---------------------------------------------------------------- lights, speaker, cake, balloons

const LIGHT_COLS = ['#ff4fa3', '#33e0ff', '#ffe14d', '#8cff4d'];

function drawLights(ctx, S) {
  const F = S.world.field;
  const { cam } = S;
  let on = 0.35;
  if (F.music === 'play' || F.music === 'party') on = 1;
  else if (F.music === 'dip') on = 0;
  const amp = S.reduced ? 0.08 : 0.28;
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 10; i++) {
      const pulse = Math.pow(0.5 + 0.5 * Math.cos(S.beat * Math.PI * 2 + (i + j * 1.7) * 0.9), 2);
      ctx.globalAlpha = (0.06 + amp * pulse) * on;
      ctx.fillStyle = LIGHT_COLS[(i + j) % 4];
      ctx.fillRect(cam.ox + i * 2 * cam.s + 1, cam.oy + j * 2 * cam.s + 1, 2 * cam.s - 2, 2 * cam.s - 2);
    }
  }
  ctx.globalAlpha = 1;
}

function kick(S) {
  return Math.pow(1 - (S.beat % 1), 3);
}

function drawSpeaker(ctx, S) {
  const { cam } = S;
  const s = cam.s;
  const o = OBSTACLES[0];
  const x = cam.ox + o.x0 * s;
  const y = cam.oy + o.y0 * s;
  const w = (o.x1 - o.x0) * s;
  const h = (o.y1 - o.y0) * s;
  const pulse = S.world.field.music === 'play' || S.world.field.music === 'party' ? kick(S) : 0;
  ctx.save();
  roundRect(ctx, x + 0.1 * s, y + 0.12 * s, w, h, 0.28 * s);
  ctx.fillStyle = SHADOW;
  ctx.fill();
  roundRect(ctx, x - 0.2 * s, y - 0.2 * s, w + 0.2 * s, h + 0.2 * s, 0.28 * s);
  fillStroke(ctx, '#3a2c66', Math.max(3, 0.09 * s));
  const cone = (cx, cy, r, amt) => {
    circle(ctx, x + cx * s, y + cy * s, r * s);
    fillStroke(ctx, '#1d1438', Math.max(2.5, 0.07 * s));
    circle(ctx, x + cx * s, y + cy * s, r * 0.72 * s * (1 + amt * pulse));
    fillStroke(ctx, '#5b4a99', Math.max(2, 0.05 * s));
    circle(ctx, x + cx * s, y + cy * s, r * 0.28 * s * (1 + amt * pulse));
    fillStroke(ctx, '#2a1f4d', 0);
  };
  cone(1.3, 1.45, 0.6, 0.12);
  cone(1.3, 0.55, 0.28, 0.2);
  const blink = S.world.field.music === 'play' && Math.floor(S.beat * 2) % 2 === 0;
  circle(ctx, x + 2.2 * s, y + 0.35 * s, 0.1 * s);
  fillStroke(ctx, blink ? '#ff4fa3' : '#7a3a66', Math.max(1.5, 0.03 * s));
  ctx.restore();
}

function drawCake(ctx, S) {
  const { cam } = S;
  const s = cam.s;
  const o = OBSTACLES[1];
  const x = cam.ox + o.x0 * s;
  const y = cam.oy + o.y0 * s;
  const w = (o.x1 - o.x0) * s;
  const h = (o.y1 - o.y0) * s;
  ctx.save();
  roundRect(ctx, x + 0.1 * s, y + 0.12 * s, w + 0.2 * s, h, 0.2 * s);
  ctx.fillStyle = SHADOW;
  ctx.fill();
  // the table with its cloth
  roundRect(ctx, x, y - 0.2 * s, w + 0.2 * s, h + 0.2 * s - 0.0, 0.2 * s);
  fillStroke(ctx, '#ff6b81', Math.max(3, 0.09 * s));
  ctx.save();
  roundRect(ctx, x, y - 0.2 * s, w + 0.2 * s, h + 0.2 * s, 0.2 * s);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 8; i++) ctx.fillRect(x + (i * 0.46 + 0.1) * s, y - 0.2 * s, 0.22 * s, h + 0.4 * s);
  ctx.restore();
  // the cake: two tiers, icing, candles
  const cx = x + w * 0.5;
  const cy = y + 0.95 * s;
  ellipse(ctx, cx + 0.06 * s, cy + 0.2 * s, 0.85 * s, 0.38 * s);
  ctx.fillStyle = SHADOW;
  ctx.fill();
  ellipse(ctx, cx, cy + 0.12 * s, 0.8 * s, 0.38 * s);
  fillStroke(ctx, '#fff1d6', Math.max(2.5, 0.07 * s));
  ellipse(ctx, cx, cy - 0.06 * s, 0.8 * s, 0.36 * s);
  fillStroke(ctx, '#ff9ecd', Math.max(2.5, 0.07 * s));
  ellipse(ctx, cx, cy - 0.34 * s, 0.46 * s, 0.24 * s);
  fillStroke(ctx, '#fff1d6', Math.max(2.5, 0.06 * s));
  ellipse(ctx, cx, cy - 0.42 * s, 0.46 * s, 0.22 * s);
  fillStroke(ctx, '#ff9ecd', Math.max(2.5, 0.06 * s));
  for (let i = -1; i <= 1; i++) {
    const px = cx + i * 0.2 * s;
    const py = cy - 0.5 * s;
    ctx.fillStyle = ['#2f9bff', '#ffc312', '#2ed573'][i + 1];
    ctx.fillRect(px - 0.04 * s, py - 0.22 * s, 0.08 * s, 0.26 * s);
    const fl = 0.9 + 0.2 * Math.sin(S.t * 9 + i * 2);
    ellipse(ctx, px, py - 0.3 * s, 0.07 * s * fl, 0.12 * s * fl);
    ctx.fillStyle = '#ffb703';
    ctx.fill();
  }
  ctx.restore();
}

// Anchors on the walls: x, y of the knot, which wall they hang off, a colour and a phase.
const BALLOONS = [
  [3.4, 0, 't', '#ff4757', 0], [4.5, 0, 't', '#ffc312', 1.3], [15.6, 0, 't', '#2f9bff', 2.1], [16.4, 0, 't', '#2ed573', 3.4],
  [0, 3.8, 'l', '#a55eea', 0.7], [0, 6.2, 'l', '#ff6bb5', 2.7], [0, 8.6, 'l', '#ffc312', 4.1], [0, 10.6, 'l', '#2ed573', 5.2],
  [W, 3.2, 'r', '#ff7f32', 1.1], [W, 5.8, 'r', '#2f9bff', 3.1], [W, 8.4, 'r', '#ff4757', 4.6], [W, 10.6, 'r', '#1dd1c1', 0.4],
  [3.2, H, 'b', '#ff4757', 2.2], [6.6, H, 'b', '#2f9bff', 0.3], [10.4, H, 'b', '#ffc312', 3.9], [13.6, H, 'b', '#a55eea', 1.7], [17, H, 'b', '#2ed573', 5],
];

function drawBalloons(ctx, S) {
  const { cam } = S;
  const s = cam.s;
  const bobAmp = S.reduced ? 0.02 : 0.08;
  for (const [ax, ay, wall, color, ph] of BALLOONS) {
    const sway = Math.sin(S.t * 1.4 + ph) * bobAmp;
    const bob = Math.cos(S.t * 1.1 + ph) * bobAmp;
    let bx = ax;
    let by = ay;
    if (wall === 't') {
      bx += sway * 2;
      by = ay - 0.68 + bob;
    } else if (wall === 'b') {
      bx += sway * 2;
      by = ay + 0.55 + bob;
    } else if (wall === 'l') {
      bx = ax - 0.5 + bob;
      by += sway * 2;
    } else {
      bx = ax + 0.5 + bob;
      by += sway * 2;
    }
    const px = cam.ox + bx * s;
    const py = cam.oy + by * s;
    ctx.beginPath();
    ctx.moveTo(cam.ox + ax * s, cam.oy + ay * s);
    ctx.quadraticCurveTo(cam.ox + (ax + bx) * 0.5 * s + sway * s, cam.oy + (ay + by) * 0.5 * s, px, py);
    ctx.lineWidth = Math.max(1.2, 0.03 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.stroke();
    ellipse(ctx, px + 0.05 * s, py + 0.06 * s, 0.33 * s, 0.4 * s);
    ctx.fillStyle = SHADOW;
    ctx.fill();
    ellipse(ctx, px, py, 0.33 * s, 0.4 * s);
    fillStroke(ctx, color, Math.max(2, 0.06 * s));
    ellipse(ctx, px - 0.1 * s, py - 0.14 * s, 0.08 * s, 0.12 * s, -0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fill();
  }
}

// ---------------------------------------------------------------- chairs

export function chairSprite(ctx, k, color, scale = 1) {
  const o = Math.max(2, 0.06 * k);
  ctx.save();
  ctx.scale(scale, scale);
  // legs
  ctx.fillStyle = shade(color, -0.45);
  for (const [lx, ly] of [[-0.38, 0.3], [0.38, 0.3], [-0.38, -0.32], [0.38, -0.32]]) {
    roundRect(ctx, (lx - 0.07) * k, (ly - 0.04) * k, 0.14 * k, 0.26 * k, 0.04 * k);
    fillStroke(ctx, shade(color, -0.45), o * 0.8);
  }
  // backrest
  roundRect(ctx, -0.52 * k, -0.64 * k, 1.04 * k, 0.32 * k, 0.12 * k);
  fillStroke(ctx, shade(color, -0.18), o);
  // seat
  roundRect(ctx, -0.5 * k, -0.4 * k, 1.0 * k, 0.84 * k, 0.2 * k);
  fillStroke(ctx, color, o);
  roundRect(ctx, -0.36 * k, -0.28 * k, 0.72 * k, 0.5 * k, 0.14 * k);
  ctx.fillStyle = shade(color, 0.28);
  ctx.fill();
  ctx.restore();
}

function drawChair(ctx, S, i, c, airborne) {
  const F = S.world.field;
  const { cam } = S;
  const s = cam.s;
  const sinceStop = F.now - F.stopAt;
  let p = clamp(sinceStop / DROP_MS, 0, 1);
  let h = (1 - ease.inQuad(p)) * 9;
  let bounce = 0;
  let squash = 1;
  if (sinceStop > DROP_MS) {
    const lt = (sinceStop - DROP_MS) / 1000;
    bounce = 0.5 * Math.exp(-7 * lt) * Math.abs(Math.sin(lt * 15));
    squash = 1 - 0.22 * Math.exp(-9 * lt) * Math.cos(lt * 22);
  }
  let shadowK = 0.4 + 0.6 * p;
  if (F.riseAt < Infinity && F.now > F.riseAt) {
    const rp = clamp((F.now - F.riseAt) / 400, 0, 1);
    h = ease.inCubic(rp) * 9;
    bounce = 0;
    squash = 1 + 0.12 * Math.sin(rp * Math.PI);
    shadowK = 1 - rp * 0.6;
    p = 1 - rp;
  }
  const inAir = h > 0.02;
  if (inAir !== airborne) return;
  const x = cam.ox + c[0] * s;
  const y = cam.oy + c[1] * s;
  const color = CHAIR_COLORS[i % CHAIR_COLORS.length];
  // the shadow stays on the floor and grows as the chair comes down
  ctx.save();
  ellipse(ctx, x + 0.1 * s, y + 0.3 * s, 0.62 * s * shadowK, 0.3 * s * shadowK);
  ctx.globalAlpha = 0.12 + 0.25 * p;
  ctx.fillStyle = '#1e0a3c';
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(x, y - (h + bounce) * s);
  ctx.scale(1 + (1 - squash) * 0.8, squash);
  chairSprite(ctx, s, color);
  ctx.restore();
}

function drawGolden(ctx, S) {
  const { cam } = S;
  const s = cam.s;
  const x = cam.ox + GOLD.x * s;
  const y = cam.oy + GOLD.y * s;
  const age = clamp(S.goldAge ?? 1, 0, 1);
  ctx.save();
  ellipse(ctx, x + 0.14 * s, y + 0.5 * s, 1.0 * s, 0.45 * s);
  ctx.fillStyle = SHADOW;
  ctx.fill();
  ctx.translate(x, y - (1 - ease.outBack(age)) * 3 * s);
  ctx.scale(1.5, 1.5);
  chairSprite(ctx, s, '#ffcf33');
  ctx.restore();
  // sparkles round it
  for (let i = 0; i < 6; i++) {
    const a = S.t * 1.3 + (i * Math.PI * 2) / 6;
    const tw = 0.5 + 0.5 * Math.sin(S.t * 6 + i * 2);
    starPath(ctx, x + Math.cos(a) * 1.5 * s, y - 0.2 * s + Math.sin(a) * 1.0 * s, 0.14 * s * (0.6 + tw * 0.6), 4, 0.35, a);
    ctx.fillStyle = '#fff7c2';
    ctx.fill();
  }
}

// ---------------------------------------------------------------- characters

function vis(a) {
  const v = a.v;
  if (v.sy === undefined) {
    v.sy = 1;
    v.svy = 0;
    v.run = 0;
    v.tilt = 0;
    v.satT = 0;
    v.wasSat = false;
    v.hurt = 9;
    v.phase = (hashId(a.id) % 100) / 100;
    v.bubbleAge = 0;
  }
  return v;
}

/** The squash and stretch springs, the walk cycle and the little timers. Call once a frame for every actor. */
export function updateVis(a, dt, S) {
  const v = vis(a);
  const speed = Math.hypot(a.vx, a.vy);
  v.svy += ((1 - v.sy) * 300 - v.svy * 16) * dt;
  v.sy += v.svy * dt;
  v.sy = clamp(v.sy, 0.5, 1.5);
  v.run += speed * dt * 1.25;
  v.tilt += (clamp(a.vx * 0.03, -0.18, 0.18) - v.tilt) * Math.min(1, 14 * dt);
  const sat = a.sat || a.sitFlag;
  if (sat && !v.wasSat) {
    v.satT = 0;
    squash(a, 0.32);
  }
  v.wasSat = sat;
  v.satT += dt;
  v.hurt += dt;
  v.bubbleAge = a.bubble ? v.bubbleAge + dt : 0;
  if (Math.hypot(a.kx, a.ky) > 3 && v.hurt > 0.5) {
    v.hurt = 0;
  }
  if (S && speed > 2.5 && !a.ghost && a.chair < 0 && S.world.field.ph !== 'out' && Math.random() < 6 * dt) S.fx.dust(a.x, a.y + 0.25, a.vx, a.vy);
}

export function squash(a, amount) {
  const v = vis(a);
  v.sy = 1 - amount;
  v.svy = 0;
}

function faceOf(id) {
  const h = hashId(id);
  return { eye: h % 3, mouth: (h >> 3) % 3, ant: ['#ffd23f', '#ff6bb5', '#2ed573', '#2f9bff'][(h >> 5) % 4] };
}

/** A head at (0, cy) of radius r in the current transform: the avatar if it is loaded, else a generated face. */
function drawHead(ctx, k, person, a, expr, cy, r, t) {
  const img = person && person.img;
  const o = Math.max(2.2, 0.075 * k);
  const loaded = img && img.complete && img.naturalWidth > 0;
  if (loaded) {
    ctx.save();
    circle(ctx, 0, cy * k, r * k);
    ctx.fillStyle = '#ffe2c0';
    ctx.fill();
    ctx.clip();
    try {
      ctx.drawImage(img, -r * 1.12 * k, (cy - r * 1.1) * k, r * 2.24 * k, r * 2.24 * k);
    } catch (err) {
      /* an image that won't draw leaves the plain head */
    }
    ctx.restore();
    circle(ctx, 0, cy * k, r * k);
    ctx.lineWidth = o;
    ctx.strokeStyle = INK;
    ctx.stroke();
    return;
  }
  const bot = !person || person.bot !== false;
  const f = faceOf(a.id);
  const base = bot ? shade(a.color, 0.4) : '#ffd9b3';
  if (bot) {
    // a little antenna
    ctx.beginPath();
    ctx.moveTo(0, (cy - r) * k);
    ctx.lineTo(0.06 * k, (cy - r - 0.26) * k);
    ctx.lineWidth = o * 0.8;
    ctx.strokeStyle = INK;
    ctx.stroke();
    circle(ctx, 0.06 * k, (cy - r - 0.3) * k, 0.08 * k);
    fillStroke(ctx, f.ant, o * 0.7);
  }
  circle(ctx, 0, cy * k, r * k);
  fillStroke(ctx, base, o);
  face(ctx, k, f, expr, cy, r, t);
}

function face(ctx, k, f, expr, cy, r, t) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ex = 0.17 * r * 2.2;
  const ey = (cy - 0.04) * k;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1.8, 0.055 * k);
  if (expr === 'happy') {
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(sx * ex * k, ey + 0.04 * k, 0.07 * k, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }
  } else if (expr === 'sad') {
    for (const sx of [-1, 1]) {
      ellipse(ctx, sx * ex * k, ey + 0.03 * k, 0.05 * k, 0.07 * k);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx * (ex + 0.08) * k, ey - 0.12 * k);
      ctx.lineTo(sx * (ex - 0.07) * k, ey - 0.07 * k);
      ctx.stroke();
    }
  } else {
    const big = f.eye === 1 || expr === 'ohh';
    for (const sx of [-1, 1]) {
      const blink = Math.sin(t * 0.9 + sx) > 0.985;
      ellipse(ctx, sx * ex * k, ey, (big ? 0.08 : 0.055) * k, (blink ? 0.01 : f.eye === 2 ? 0.1 : big ? 0.09 : 0.07) * k);
      if (big) {
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.stroke();
        ellipse(ctx, sx * ex * k + 0.01 * k, ey + 0.01 * k, 0.04 * k, 0.05 * k);
        ctx.fillStyle = INK;
        ctx.fill();
      } else ctx.fill();
    }
    if (expr === 'go') {
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * (ex + 0.1) * k, ey - 0.15 * k);
        ctx.lineTo(sx * (ex - 0.08) * k, ey - 0.09 * k);
        ctx.stroke();
      }
    }
  }
  const my = (cy + 0.2) * k;
  ctx.fillStyle = INK;
  if (expr === 'ohh') {
    ellipse(ctx, 0, my + 0.02 * k, 0.07 * k, 0.09 * k);
    ctx.fill();
  } else if (expr === 'sad') {
    ctx.beginPath();
    ctx.arc(0, my + 0.1 * k, 0.1 * k, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else if (expr === 'happy' || expr === 'go' || f.mouth === 1) {
    ctx.beginPath();
    ctx.arc(0, my - 0.06 * k, 0.12 * k, 0.1, Math.PI - 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff6b81';
    ellipse(ctx, 0, my + 0.04 * k, 0.05 * k, 0.03 * k);
    ctx.fill();
  } else if (f.mouth === 2) {
    ctx.beginPath();
    ctx.arc(-0.05 * k, my, 0.05 * k, 0.1, Math.PI - 0.1);
    ctx.arc(0.05 * k, my, 0.05 * k, 0.1, Math.PI - 0.1);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, my - 0.04 * k, 0.1 * k, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
  ctx.restore();
}

function kickAt(S, a) {
  return Math.pow(1 - ((S.beat + vis(a).phase * 0.4) % 1), 3);
}

/** Everything about one character: ring, shadow, body, head, then its tag, check, bubble and arrow. */
export function drawActor(ctx, S, a) {
  const { cam } = S;
  const F = S.world.field;
  const person = a.person || S.people.get(a.id) || null;
  const v = vis(a);
  const k = cam.s * ACTOR;
  const gx = cam.ox + a.x * cam.s;
  const gy = cam.oy + a.y * cam.s;
  const speed = Math.hypot(a.vx, a.vy);
  const seatedHere = a.chair >= 0 || a.sitFlag || v.forceSeat;
  const isMe = a.id === S.meId;
  const outNow = F.ph === 'out' && F.out === a.id;
  const ghost = a.ghost && !outNow;
  const dancing = (F.music === 'play' || F.music === 'party') && !seatedHere;

  // a light ring under you, always
  if (isMe && !ghost) {
    ellipse(ctx, gx, gy + 0.02 * k, 0.68 * k, 0.28 * k);
    ctx.lineWidth = Math.max(2, 0.07 * k);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(gx, gy);
  if (ghost) ctx.globalAlpha = 0.45;
  // a solid shadow, offset
  if (!ghost) {
    ellipse(ctx, 0.06 * k, 0.04 * k, 0.5 * k, 0.2 * k);
    ctx.fillStyle = SHADOW;
    ctx.fill();
  }

  // the hop: dancing to the beat, steps when running, a happy bounce when seated, floating as a ghost
  let hop = 0;
  if (ghost) hop = 0.3 + 0.08 * Math.sin(S.t * 3 + v.phase * 6);
  else if (seatedHere) hop = 0.2 + (a.sat || a.sitFlag || v.forceSeat ? Math.abs(Math.sin(S.t * 9 + v.phase * 6)) * 0.07 : 0);
  else if (speed > 0.6) hop = Math.abs(Math.sin(v.run * Math.PI)) * 0.07;
  else if (dancing) hop = 0.04 + 0.16 * kickAt(S, a);
  if (a.bumpT > 0) hop += 0.06;
  if (v.hopExtra) hop += v.hopExtra;
  ctx.translate(0, -hop * k);
  let lean = v.tilt + (v.leanExtra || 0);
  if (a.wob > 0) lean += Math.sin(S.t * 28) * 0.28 * Math.min(1, a.wob * 2);
  if (dancing && speed < 0.6) lean += Math.sin((S.beat + v.phase) * Math.PI) * 0.1;
  if (a.bumpT > 0) {
    ctx.translate(a.fx * 0.18 * k, a.fy * 0.08 * k);
    lean += a.fx * 0.2;
  }
  ctx.rotate(lean);
  const sy = seatedHere ? v.sy * 0.92 : v.sy;
  ctx.scale(1 + (1 - sy) * 0.8, sy);

  let expr = 'normal';
  if (seatedHere || (S.world.field.ph === 'over' && F.winner === a.id)) expr = 'happy';
  else if (outNow) expr = 'sad';
  else if (v.hurt < 0.5) expr = 'ohh';
  else if (F.ph === 'race' && speed > 2) expr = 'go';
  else if (dancing && speed < 1) expr = 'happy';

  const color = a.color;
  const o = Math.max(2.4, 0.08 * k);
  // feet
  if (!seatedHere) {
    const step = speed > 0.6 ? Math.sin(v.run * Math.PI * 2) * 0.1 : 0;
    for (const sx of [-1, 1]) {
      ellipse(ctx, sx * 0.19 * k, (-0.06 + (sx > 0 ? step : -step)) * k, 0.15 * k, 0.1 * k);
      fillStroke(ctx, shade(color, -0.35), o * 0.9);
    }
  }
  // arms
  const swing = speed > 0.6 ? Math.sin(v.run * Math.PI * 2) * 0.12 : 0;
  const up = seatedHere || (ghost && Math.sin(S.t * 5 + v.phase * 6) > 0) || (dancing && speed < 0.6 && kickAt(S, a) > 0.45) || (S.world.field.ph === 'over' && F.winner === a.id);
  for (const sx of [-1, 1]) {
    const ay = up ? -0.78 : -0.34 + (sx > 0 ? swing : -swing);
    ellipse(ctx, sx * 0.47 * k, ay * k, 0.13 * k, 0.13 * k);
    fillStroke(ctx, shade(color, 0.12), o * 0.9);
  }
  // body
  roundRect(ctx, -0.4 * k, -0.62 * k, 0.8 * k, 0.6 * k, 0.26 * k);
  fillStroke(ctx, color, o);
  roundRect(ctx, -0.26 * k, -0.5 * k, 0.52 * k, 0.28 * k, 0.12 * k);
  ctx.fillStyle = shade(color, 0.3);
  ctx.globalAlpha *= 0.65;
  ctx.fill();
  ctx.globalAlpha = ghost ? 0.45 : 1;
  // head
  drawHead(ctx, k, person, a, expr, -0.98, 0.44, S.t);
  if (outNow) {
    // a tear
    ellipse(ctx, 0.32 * k, -0.78 * k + Math.abs(Math.sin(S.t * 5)) * 0.1 * k, 0.05 * k, 0.08 * k);
    ctx.fillStyle = '#6ad1ff';
    ctx.fill();
  }
  ctx.restore();

  // the hip-check's swoosh
  if (a.bumpT > 0) {
    const t = a.bumpT / BUMP_TIME;
    const ang = Math.atan2(a.fy, a.fx);
    ctx.save();
    ctx.translate(gx, gy - 0.4 * k);
    ctx.rotate(ang);
    ctx.globalAlpha = Math.min(1, t * 1.6);
    ctx.beginPath();
    ctx.arc(0, 0, (0.78 + (1 - t) * 0.35) * k, -0.95, 0.95);
    ctx.lineWidth = Math.max(3, 0.16 * k);
    ctx.strokeStyle = '#fff';
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
  }

  // over the head: the READY check, the seat's check mark, a speech bubble, the YOU arrow
  let top = gy - (1.62 + hop) * k;
  if (a.ready && S.lobby) {
    const pp = pop(S.t - (v.readyAt ?? S.t) + 0.001, 0.4);
    ctx.save();
    ctx.translate(gx, top - 0.1 * k);
    ctx.scale(pp, pp);
    const fs = Math.max(11, cam.s * 0.5);
    ctx.font = font(fs);
    const tw = ctx.measureText('READY').width;
    const total = tw + fs * 1.9;
    const x0 = -total / 2;
    roundRect(ctx, x0, -fs * 0.75, total, fs * 1.5, fs * 0.75);
    fillStroke(ctx, '#2ed573', Math.max(2.5, fs * 0.16));
    checkBadge(ctx, x0 + fs * 0.85, 0, fs * 0.55, '#1c9a4f');
    label(ctx, 'READY', x0 + fs * 1.55 + tw / 2, 0, fs, { align: 'center' });
    ctx.restore();
    top -= 0.5 * k;
  } else if (a.sat && !seatedForever(F, a)) {
    const pp = pop(v.satT, 0.35);
    checkBadge(ctx, gx, top - 0.05 * k, 0.26 * k * pp);
    top -= 0.2 * k;
  }
  if (a.bubble) {
    const pp = pop(v.bubbleAge, 0.3);
    const fs = Math.max(12, k * 0.5);
    ctx.save();
    ctx.translate(gx, top - 0.18 * k);
    ctx.scale(pp, pp);
    ctx.font = font(fs);
    const tw = ctx.measureText(a.bubble).width;
    const bw = tw + fs * 0.9;
    const bh = fs * 1.35;
    roundRect(ctx, -bw / 2, -bh, bw, bh, bh * 0.4);
    const danger = a.bubble === 'OUT!';
    fillStroke(ctx, danger ? '#ff4757' : '#fff', Math.max(2.4, fs * 0.15));
    ctx.beginPath();
    ctx.moveTo(-fs * 0.2, -1);
    ctx.lineTo(fs * 0.2, -1);
    ctx.lineTo(0, fs * 0.35);
    ctx.closePath();
    fillStroke(ctx, danger ? '#ff4757' : '#fff', Math.max(2.4, fs * 0.15));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = danger ? '#fff' : INK;
    ctx.fillText(a.bubble, 0, -bh * 0.5);
    ctx.restore();
    top -= bh + 0.1 * k;
  }
  if (isMe && !ghost && S.youT < 3.2) {
    const fade = clamp((3.2 - S.youT) / 0.5, 0, 1);
    const bounce = Math.abs(Math.sin(S.t * 7)) * 0.22 * k;
    const ay = top - 0.08 * k - bounce;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.beginPath();
    ctx.moveTo(gx, ay);
    ctx.lineTo(gx - 0.3 * k, ay - 0.36 * k);
    ctx.lineTo(gx - 0.12 * k, ay - 0.36 * k);
    ctx.lineTo(gx - 0.12 * k, ay - 0.66 * k);
    ctx.lineTo(gx + 0.12 * k, ay - 0.66 * k);
    ctx.lineTo(gx + 0.12 * k, ay - 0.36 * k);
    ctx.lineTo(gx + 0.3 * k, ay - 0.36 * k);
    ctx.closePath();
    fillStroke(ctx, '#ffd23f', Math.max(2.4, 0.07 * k));
    label(ctx, 'YOU', gx, ay - 0.95 * k, Math.max(13, k * 0.55), { fill: '#ffd23f' });
    ctx.restore();
  }
}

// A seat that holds the winner of the game isn't a "just sat" check.
function seatedForever(F, a) {
  return F.ph === 'over' && F.winner === a.id;
}

/** The little tag under a character. */
export function drawName(ctx, S, a) {
  if (a.ghost && !(S.world.field.ph === 'out' && S.world.field.out === a.id)) return;
  const person = a.person || S.people.get(a.id);
  const name = (person && person.name) || a.name;
  if (!name) return;
  const { cam } = S;
  const fs = clamp(cam.s * 0.4, 10, 20);
  const x = cam.ox + a.x * cam.s;
  const y = cam.oy + a.y * cam.s + 0.42 * cam.s * ACTOR;
  const t = fitName(ctx, name, fs, cam.s * 3);
  ctx.save();
  ctx.font = font(fs);
  const w = ctx.measureText(t).width + fs * 0.9;
  roundRect(ctx, x - w / 2, y - fs * 0.62, w, fs * 1.25, fs * 0.5);
  ctx.fillStyle = a.id === S.meId ? 'rgba(255,210,63,0.95)' : 'rgba(45,22,80,0.78)';
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = a.id === S.meId ? INK : '#fff';
  ctx.fillText(t, x, y + fs * 0.02);
  ctx.restore();
}

/** A round avatar (or generated face) for the scoreboard, the podium and the HUD. */
export function drawFace(ctx, S, id, x, y, r, expr = 'normal') {
  const person = S.people.get(id);
  const a = { id, color: (person && person.color) || '#ff4d4d' };
  const k = r / 0.44;
  ctx.save();
  ctx.translate(x, y);
  drawHead(ctx, k, person || { bot: true }, a, expr, 0, 0.44, S.t);
  ctx.restore();
}

// ---------------------------------------------------------------- the whole room

export function drawArena(ctx, S) {
  const { w, h, cam } = S;
  const F = S.world.field;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const [sx, sy] = S.fx.shakeOffset(Math.max(4, cam.s * 0.3));
  ctx.save();
  ctx.translate(sx, sy);
  if (S.floor) ctx.drawImage(S.floor, 0, 0, w, h);
  drawLights(ctx, S);
  drawSpeaker(ctx, S);
  drawCake(ctx, S);
  drawBalloons(ctx, S);
  // chairs on the floor, then the characters (ghosts first, then by depth), then chairs still in the air
  for (let i = 0; i < F.chairs.length; i++) drawChair(ctx, S, i, F.chairs[i], false);
  if (F.ph === 'over') drawGolden(ctx, S);
  const list = S.drawList;
  list.length = 0;
  for (const a of S.world.list) list.push(a);
  list.sort((p, q) => (p.ghost === q.ghost ? p.y - q.y : p.ghost ? -1 : 1));
  for (const a of list) drawActor(ctx, S, a);
  if (S.names !== false) for (const a of list) drawName(ctx, S, a);
  for (let i = 0; i < F.chairs.length; i++) drawChair(ctx, S, i, F.chairs[i], true);
  S.fx.draw(ctx, cam);
  ctx.restore();
  if (S.dim > 0.01) {
    ctx.fillStyle = `rgba(20,5,50,${S.dim * 0.35})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (S.flash > 0.01 && !S.reduced) {
    ctx.fillStyle = `rgba(255,255,255,${S.flash * 0.5})`;
    ctx.fillRect(0, 0, w, h);
  }
}

