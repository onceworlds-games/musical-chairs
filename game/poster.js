// Store art, drawn by the game itself with its real renderer: open the page with ?poster=cover (1280x720), action, win,
// icon (512x512) or badge-<id> (256x256). No room, no SDK: one fixed frame (a fixed seed, characters mid-action,
// particles frozen), then document.body.dataset.ready = '1'. The main session captures them.

import { W, GOLD, CHAIR_COLORS, colorOf, rng } from './rules.js';
import { World } from './world.js';
import { Fx } from './fx.js';
import { fitCamera, buildFloor, drawArena, drawActor, chairSprite, updateVis } from './draw.js';
import { drawLogo, crown, bolt } from './ui.js';
import { INK, SHADOW, label, circle, ellipse, fillStroke, starPath, noteShape } from './gfx.js';

const SIZES = { cover: [1280, 720], action: [1280, 720], win: [1280, 720], icon: [512, 512] };

function scene(w, h, cam) {
  const fx = new Fx();
  fx.setQuality('high', false);
  return {
    w, h, pr: 1, u: 1, cam, t: 3.1, now: 3.1, beat: 4.25, titleT: 9, lobby: false, meId: null, youT: 99, dim: 0, flash: 0, reduced: false, goldAge: 1,
    floor: null, fx, world: new World(), people: new Map(), drawList: [], names: false, ui: null, g: null, me: null,
  };
}

function cast(S, id, i, x, y, o = {}) {
  const a = S.world.add(id, 'bot', x, y);
  const color = o.color || colorOf(i);
  a.color = color;
  S.people.set(id, { id, name: '', color, bot: true, img: null });
  updateVis(a, 0, S);
  const dx = o.toX !== undefined ? o.toX - x : 0;
  const dy = o.toY !== undefined ? o.toY - y : 0;
  const d = Math.hypot(dx, dy);
  if (d > 0.01) {
    const sp = o.speed ?? 5.2;
    a.vx = (dx / d) * sp;
    a.vy = (dy / d) * sp;
    a.fx = dx / d;
    a.fy = dy / d;
  }
  a.v.run = o.run ?? i * 0.37;
  a.v.hopExtra = o.hop || 0;
  a.v.leanExtra = o.lean || 0;
  a.v.sy = o.sy ?? 1;
  a.v.hurt = 9;
  if (o.bump) a.bumpT = o.bump;
  return a;
}

function field(S, o) {
  const F = S.world.field;
  F.mode = 'match';
  F.ph = o.ph || 'race';
  F.now = o.now ?? 480;
  F.stopAt = 0;
  F.dropAt = 350;
  F.chairs = o.chairs || [];
  F.seats = F.chairs.map(() => null);
  F.music = o.music || 'stop';
  F.winner = o.winner || null;
  F.rid = 'poster';
  for (const a of S.world.list) F.alive.add(a.id);
  return F;
}

function frame(ctx, S) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  S.floor = buildFloor(S);
  drawArena(ctx, S);
}

// ---------------------------------------------------------------- the pictures

function cover(ctx, S) {
  const chairs = [[3.6, 5.2], [6.4, 8.9], [8.8, 4.6], [11.6, 7.4], [14.0, 4.4], [16.0, 8.6], [10.0, 10.3]];
  const runs = [
    [2.2, 3.4, 0], [4.4, 10.4, 1], [6.9, 6.5, 2], [9.4, 8.7, 3], [12.6, 3.7, 4], [17.7, 6.3, 5], [8.0, 9.7, 6],
  ];
  runs.forEach(([x, y, c], i) => cast(S, `p${i}`, i, x, y, { toX: chairs[c][0], toY: chairs[c][1] }));
  // the eighth leaps for the chair everyone is heading to
  cast(S, 'p7', 7, 13.6, 9.3, { toX: 11.6, toY: 7.4, hop: 0.95, lean: -0.3, speed: 5.5, sy: 1.1 });
  field(S, { chairs, now: 480 });
  for (const c of chairs) S.fx.puff(c[0], c[1] + 0.3, 6, 0.3);
  S.fx.confetti(10, 8, 24, 1.6, 0.8);
  S.fx.update(0.25);
  frame(ctx, S);
  drawLogo(ctx, S, 118, [92, 206]);
}

function action(ctx, S) {
  const chair = [10, 6.5];
  cast(S, 'a', 1, 8.8, 6.9, { toX: chair[0], toY: chair[1], hop: 0.45, lean: 0.5, speed: 5.5, sy: 0.95 });
  cast(S, 'b', 8, 11.2, 6.1, { toX: chair[0], toY: chair[1], hop: 0.3, lean: -0.5, speed: 5.5 });
  cast(S, 'c', 6, 14.6, 4.2, { toX: 12, toY: 6, speed: 5 });
  const a = S.world.get('a');
  a.bumpT = 0.12;
  a.fx = 1;
  a.fy = -0.1;
  field(S, { chairs: [chair], now: 520 });
  S.fx.sparks(10, 6, 12);
  S.fx.spawn('star', 10, 5.2, { life: 5, size: 0.4, color: '#fff6a0', rot: 0.3 });
  S.fx.puff(10, 6.8, 7, 0.3);
  S.fx.update(0.1);
  frame(ctx, S);
}

function win(ctx, S) {
  const ring = 7;
  for (let i = 0; i < ring; i++) {
    const ang = Math.PI * 0.12 + (i / (ring - 1)) * Math.PI * 0.76;
    const x = GOLD.x + Math.cos(ang + Math.PI) * 5.6;
    const y = GOLD.y + 2.2 + Math.sin(ang) * 2.4 - (i % 2) * 0.6;
    cast(S, `p${i + 1}`, i + 1, Math.min(18.5, Math.max(1.5, x)), Math.min(11, Math.max(3, y)), { run: i * 0.5 });
  }
  cast(S, 'p0', 0, GOLD.x, GOLD.y, {});
  S.world.get('p0').v.forceSeat = true;
  field(S, { ph: 'over', now: 2400, music: 'party', winner: 'p0' });
  S.beat = 4.0;
  for (let i = 0; i < 9; i++) S.fx.rain(W, 14);
  S.fx.confetti(GOLD.x, GOLD.y - 1.6, 36, 1.8, 1.1);
  S.fx.update(1.3);
  frame(ctx, S);
  // a gold "1" over the golden chair
  const { cam } = S;
  const x = cam.ox + GOLD.x * cam.s;
  const y = cam.oy + (GOLD.y - 3.0) * cam.s;
  const r = cam.s * 0.75;
  starPath(ctx, x, y, r * 1.35, 12, 0.72);
  fillStroke(ctx, '#fff6a0', 5);
  circle(ctx, x, y, r);
  fillStroke(ctx, '#ffd23f', 7);
  label(ctx, '1', x, y + r * 0.04, r * 1.4, { fill: '#fff', lw: r * 0.22 });
}

function icon(ctx, S) {
  const g = ctx.createRadialGradient(256, 250, 30, 256, 256, 330);
  g.addColorStop(0, '#ffe9a8');
  g.addColorStop(0.55, '#ffb35c');
  g.addColorStop(1, '#ff6b81');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  // rays behind the chair
  ctx.save();
  ctx.translate(256, 300);
  for (let i = 0; i < 14; i++) {
    ctx.rotate((Math.PI * 2) / 14);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-26, -330);
    ctx.lineTo(26, -330);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fill();
  }
  ctx.restore();
  ellipse(ctx, 272, 428, 135, 34);
  ctx.fillStyle = SHADOW;
  ctx.fill();
  ctx.save();
  ctx.translate(256, 335);
  chairSprite(ctx, 210, CHAIR_COLORS[0]);
  ctx.restore();
  // the character sits on it: the camera is set so its feet land on the seat
  S.cam = { s: 128, ox: 256 - 5 * 128, oy: 338 - 5 * 128 };
  const hero = cast(S, 'hero', 5, 5, 5, {});
  hero.v.forceSeat = true;
  hero.sat = true;
  const F = field(S, { chairs: [], ph: 'over', music: 'party', winner: null });
  F.now = 0;
  S.beat = 4.3;
  drawActor(ctx, S, hero);
  noteShape(ctx, 98, 190, 40, '#2f9bff');
  noteShape(ctx, 420, 150, 46, '#ff4fa3');
  noteShape(ctx, 78, 330, 32, '#7bed4f');
  noteShape(ctx, 438, 310, 34, '#ffd23f');
  for (const [x, y, s] of [[150, 100, 15], [380, 90, 18], [60, 250, 12], [455, 230, 13]]) {
    starPath(ctx, x, y, s, 4, 0.35);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }
}

function badge(ctx, id) {
  const bg = { 'first-win': '#7a5cff', 'quick-sit': '#2e86ff', 'chair-thief': '#d63c4a', 'party-guest': '#00a896' }[id] || '#7a5cff';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, 256, 256);
  circle(ctx, 128, 128, 118);
  fillStroke(ctx, bg, 9);
  circle(ctx, 128, 128, 98);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, 112, Math.PI * 1.05, Math.PI * 1.55);
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(128, 132);
  if (id === 'quick-sit') {
    bolt(ctx, 0, 0, 78);
  } else if (id === 'chair-thief') {
    // a sneaky mask
    ctx.beginPath();
    ctx.moveTo(-88, -20);
    ctx.quadraticCurveTo(-45, -58, 0, -36);
    ctx.quadraticCurveTo(45, -58, 88, -20);
    ctx.quadraticCurveTo(78, 38, 36, 40);
    ctx.quadraticCurveTo(10, 32, 0, 16);
    ctx.quadraticCurveTo(-10, 32, -36, 40);
    ctx.quadraticCurveTo(-78, 38, -88, -20);
    ctx.closePath();
    fillStroke(ctx, '#2d1650', 6, '#ffffff');
    for (const sx of [-1, 1]) {
      ctx.save();
      ctx.translate(sx * 38, -2);
      ctx.rotate(sx * 0.35);
      ellipse(ctx, 0, 0, 24, 11);
      ctx.fillStyle = '#fff6a0';
      ctx.fill();
      circle(ctx, sx * 4, 0, 5);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.restore();
    }
  } else if (id === 'party-guest') {
    // a balloon
    ctx.beginPath();
    ctx.moveTo(0, 62);
    ctx.quadraticCurveTo(14, 82, -4, 96);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ellipse(ctx, 0, -8, 56, 70);
    fillStroke(ctx, '#ff4757', 8);
    ellipse(ctx, -20, -34, 12, 20, -0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 60);
    ctx.lineTo(-10, 74);
    ctx.lineTo(10, 74);
    ctx.closePath();
    fillStroke(ctx, '#ff4757', 5);
    for (const [x, y, c] of [[-84, -50, '#ffd23f'], [86, -40, '#7bed4f'], [76, 40, '#ffd23f'], [-80, 44, '#ff9fd8']]) {
      starPath(ctx, x, y, 11, 4, 0.4);
      ctx.fillStyle = c;
      ctx.fill();
    }
  } else crown(ctx, 0, -2, 78);
  ctx.restore();
}

export async function runPoster(name, canvas) {
  Math.random = rng(20261004); // the same frame every time
  const badgeId = name.startsWith('badge-') ? name.slice(6) : null;
  const [w, h] = badgeId ? [256, 256] : SIZES[name] || SIZES.cover;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  try {
    if (document.fonts) {
      if (document.fonts.load) await document.fonts.load('800 40px "Baloo 2"');
      await document.fonts.ready;
    }
  } catch (err) {
    /* the fallback font will do */
  }
  const ctx = canvas.getContext('2d');
  const S = scene(w, h, name === 'action' ? { s: 150, ox: w / 2 - 10 * 150, oy: h / 2 - 6.4 * 150 } : fitCamera(w, h));
  if (badgeId) badge(ctx, badgeId);
  else if (name === 'action') action(ctx, S);
  else if (name === 'win') win(ctx, S);
  else if (name === 'icon') icon(ctx, S);
  else cover(ctx, S);
  document.body.dataset.ready = '1';
}
