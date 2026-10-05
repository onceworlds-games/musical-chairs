// Everything drawn over the room: the title, the lobby's settings, the HUD, the countdown, banners, the scoreboard between
// games and the podium. Big words, icons over text, thick outlines. `S` is the scene described in draw.js, plus:
//   u (a size unit that grows with the screen), ui (buttons), names(id), info(id).

import { COLORS, awardsOf } from './rules.js';
import { INK, SHADOW, clamp, ease, pop, label, font, roundRect, circle, fillStroke, starPath, fitName, chairIcon, shade } from './gfx.js';
import { drawFace } from './draw.js';

/** Buttons are registered while drawing and hit-tested by the pointer. */
export function createUI() {
  const ui = { list: [], pressed: null };
  ui.reset = () => {
    ui.list.length = 0;
  };
  ui.add = (id, x, y, w, h, enabled = true) => {
    ui.list.push({ id, x, y, w, h, enabled });
  };
  ui.hit = (px, py) => {
    for (let i = ui.list.length - 1; i >= 0; i--) {
      const b = ui.list[i];
      if (b.enabled && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
    }
    return null;
  };
  return ui;
}

function button(ctx, S, id, text, cx, cy, w, h, o = {}) {
  const enabled = o.enabled !== false;
  const pressed = S.ui.pressed === id;
  const sc = (o.pulse ? 1 + Math.sin(S.t * 4.5) * 0.04 : 1) * (pressed ? 0.95 : 1);
  S.ui.add(id, cx - w / 2, cy - h / 2, w, h, enabled);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sc, sc);
  if (!enabled) ctx.globalAlpha = 0.8;
  const r = h * 0.3;
  const lw = Math.max(3, h * 0.07);
  roundRect(ctx, -w / 2, -h / 2 + h * 0.1, w, h, r);
  ctx.fillStyle = shade(o.fill || '#2ed573', -0.35);
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
  roundRect(ctx, -w / 2, -h / 2, w, h, r);
  fillStroke(ctx, o.fill || '#2ed573', lw);
  roundRect(ctx, -w / 2 + h * 0.08, -h / 2 + h * 0.07, w - h * 0.16, h * 0.28, h * 0.14);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fill();
  if (o.icon === 'play') {
    const ts = h * 0.3;
    ctx.beginPath();
    ctx.moveTo(-w * 0.2 - ts * 0.6, -ts);
    ctx.lineTo(-w * 0.2 - ts * 0.6, ts);
    ctx.lineTo(-w * 0.2 + ts, 0);
    ctx.closePath();
    fillStroke(ctx, '#fff', lw * 0.8);
    label(ctx, text, w * 0.1, 0, h * 0.5);
  } else label(ctx, text, 0, 0, h * 0.5);
  ctx.restore();
}

// ---------------------------------------------------------------- the title

/** The chunky name, two lines, each letter bouncing: `ys` are the heights of the lines, `size` the letter size. */
export function drawLogo(ctx, S, size, ys) {
  const { w, t } = S;
  const lines = [['MUSICAL', -0.045], ['CHAIRS', 0.035]];
  lines.forEach(([text, rot], li) => {
    ctx.save();
    ctx.translate(w / 2, ys[li]);
    ctx.rotate(rot);
    ctx.font = font(size);
    const widths = [...text].map((c) => ctx.measureText(c).width);
    const total = widths.reduce((sum, v) => sum + v, 0);
    let x = -total / 2;
    [...text].forEach((c, i) => {
      const age = S.titleT - i * 0.06 - li * 0.25;
      const pp = pop(age, 0.5);
      const bob = Math.sin(t * 4 + i * 0.7 + li) * size * 0.04;
      label(ctx, c, x + widths[i] / 2, bob, size, { fill: COLORS[(i * 3 + li * 5 + 1) % COLORS.length], lw: size * 0.2, drop: size * 0.06, scale: Math.max(0.001, pp), rotate: Math.sin(t * 3 + i) * 0.04 });
      x += widths[i];
    });
    ctx.restore();
  });
}

export function drawTitle(ctx, S) {
  const { w, h, u } = S;
  ctx.fillStyle = 'rgba(30,8,70,0.28)';
  ctx.fillRect(0, 0, w, h);
  const size = Math.min(w * 0.17, h * 0.27);
  const y1 = h * 0.2 + size * 0.1;
  const y2 = h * 0.46 + size * 0.1;
  drawLogo(ctx, S, size, [y1, y2]);
  // a chair either side of the name says what it is
  const off = Math.min(size * 2.35, w / 2 - size * 0.5);
  chairIcon(ctx, w / 2 - off, y2, size * 0.8, '#ff4757');
  chairIcon(ctx, w / 2 + off, y2, size * 0.8, '#2f9bff');
  const bw = clamp(w * 0.3, 190 * u, 360 * u);
  const bh = clamp(h * 0.2, 62 * u, 100 * u);
  button(ctx, S, 'play', 'PLAY', w / 2, h * 0.78, bw, bh, { icon: 'play', pulse: true });
}

// ---------------------------------------------------------------- lobby: the settings

export function drawLobbyTop(ctx, S, host, games) {
  const { w, u } = S;
  const chip = Math.max(46, 54 * u);
  const gap = 10 * u;
  const total = 3 * chip + 2 * gap;
  const y = 84 * u;
  label(ctx, 'GAMES', w / 2, y - chip * 0.78, 24 * u);
  for (let i = 0; i < 3; i++) {
    const v = i + 1;
    const cx = w / 2 - total / 2 + chip / 2 + i * (chip + gap);
    const on = games === v;
    button(ctx, S, `games${v}`, String(v), cx, y, chip, chip * 0.92, { fill: on ? '#ffd23f' : '#6a4fd0', enabled: host, pulse: false });
    if (on) {
      ctx.save();
      starPath(ctx, cx + chip * 0.38, y - chip * 0.42, chip * 0.17, 5);
      fillStroke(ctx, '#fff', 2);
      ctx.restore();
    }
  }
  label(ctx, 'Music stops? Grab a chair!', w / 2, y + chip * 0.92, 22 * u);
}

// ---------------------------------------------------------------- HUD

/** Top centre: who is still in. Top right: your points, or "OUT". */
export function drawHud(ctx, S, g, meId) {
  const { w, u } = S;
  const roster = g.roster;
  const alive = new Set(g.alive);
  const r = clamp(S.cam.s * 0.42, 9, 17);
  const gap = r * 0.55;
  const total = roster.length * (r * 2 + gap) - gap;
  const x0 = w / 2 - total / 2;
  const y = 10 + r + 4;
  roundRect(ctx, x0 - r * 0.9, y - r - 5, total + r * 1.8, r * 2 + 10, r + 5);
  ctx.fillStyle = 'rgba(45,22,80,0.78)';
  ctx.fill();
  roster.forEach((e, i) => {
    const cx = x0 + r + i * (r * 2 + gap);
    const p = S.people.get(e.id);
    const out = !alive.has(e.id) && g.ph !== 'over' && g.ph !== 'between' && g.ph !== 'final';
    circle(ctx, cx, y, r);
    fillStroke(ctx, out ? '#8a80a8' : (p && p.color) || '#fff', Math.max(2, r * 0.2), e.id === meId ? '#ffd23f' : INK);
    if (out) {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, y - r * 0.5);
      ctx.lineTo(cx + r * 0.5, y + r * 0.5);
      ctx.moveTo(cx + r * 0.5, y - r * 0.5);
      ctx.lineTo(cx - r * 0.5, y + r * 0.5);
      ctx.lineWidth = Math.max(2, r * 0.25);
      ctx.strokeStyle = '#fff';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
  });
  if (g.ph === 'music' || g.ph === 'race' || g.ph === 'out') label(ctx, `ROUND ${g.step}`, w / 2, y + r + 17 * u, Math.max(16, 16 * u), { lw: 4 });
  // you
  const me = meId && roster.some((e) => e.id === meId);
  if (me) {
    const out = !alive.has(meId) && (g.ph === 'music' || g.ph === 'race' || g.ph === 'out');
    const pts = g.scores[meId] ?? 0;
    const pw = 96 * u;
    const ph = 38 * u;
    const px = w - pw - 12;
    const py = 10;
    roundRect(ctx, px, py, pw, ph, ph / 2);
    fillStroke(ctx, out ? '#ff4757' : 'rgba(45,22,80,0.85)', Math.max(2.5, ph * 0.08), out ? INK : '#ffd23f');
    if (out) label(ctx, 'OUT', px + pw / 2, py + ph / 2, ph * 0.56);
    else {
      starPath(ctx, px + ph * 0.52, py + ph * 0.52, ph * 0.3, 5);
      fillStroke(ctx, '#ffd23f', 2);
      label(ctx, String(pts), px + pw * 0.62, py + ph / 2, ph * 0.62);
    }
  }
}

export function drawWatching(ctx, S) {
  const { w, u } = S;
  const pw = 128 * u;
  const ph = 34 * u;
  const px = w - pw - 12;
  roundRect(ctx, px, 10, pw, ph, ph / 2);
  fillStroke(ctx, 'rgba(45,22,80,0.85)', 2.5, '#fff');
  // an eye
  ctx.save();
  ctx.translate(px + ph * 0.6, 10 + ph / 2);
  ctx.beginPath();
  ctx.ellipse(0, 0, ph * 0.3, ph * 0.2, 0, 0, Math.PI * 2);
  fillStroke(ctx, '#fff', 2);
  circle(ctx, 0, 0, ph * 0.11);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
  label(ctx, 'WATCHING', px + pw * 0.6, 10 + ph / 2, ph * 0.46, { lw: 4 });
}

// ---------------------------------------------------------------- big moments

export function drawCountdown(ctx, S, text, age) {
  const { w, h } = S;
  const size = Math.min(w, h) * (text === 'GO!' ? 0.46 : 0.62);
  const pp = ease.outBack(clamp(age / 0.35, 0, 1));
  const fill = text === '3' ? '#ff6b6b' : text === '2' ? '#ffd23f' : text === '1' ? '#7bed4f' : '#2ed573';
  ctx.fillStyle = 'rgba(20,5,50,0.2)';
  ctx.fillRect(0, 0, w, h);
  if (text === 'GO!') {
    ctx.save();
    ctx.translate(w / 2, h * 0.5);
    ctx.rotate(S.t * 0.5);
    starPath(ctx, 0, 0, size * (0.5 + age * 0.4), 12, 0.6);
    ctx.globalAlpha = Math.max(0, 0.55 - age * 0.5);
    ctx.fillStyle = '#fff6a0';
    ctx.fill();
    ctx.restore();
  }
  label(ctx, text, w / 2, h * 0.5, size, { fill, scale: Math.max(0.01, 0.4 + 0.6 * pp), lw: size * 0.16, drop: size * 0.05, alpha: clamp(1.5 - age * 0.6, 0, 1) });
}

export function drawBanner(ctx, S, b) {
  const age = S.now - b.t0;
  if (age < 0 || age > b.dur) return;
  const { w, h } = S;
  const size = clamp(Math.min(w * 0.115, h * 0.2), 34, 150) * (b.big ? 1.15 : 1);
  const pp = ease.outBack(clamp(age / 0.28, 0, 1));
  const fade = clamp((b.dur - age) / 0.25, 0, 1);
  label(ctx, b.text, w / 2, h * (b.y ?? 0.25), size, { fill: b.color || '#fff', scale: Math.max(0.01, 0.5 + 0.5 * pp), alpha: fade, lw: size * 0.2, drop: size * 0.05, rotate: Math.sin(age * 9) * 0.02 * (1 - clamp(age / 0.4, 0, 1)) });
}

// ---------------------------------------------------------------- between games: the scoreboard

export function drawBetween(ctx, S, g, age) {
  const { w, h, u } = S;
  const n = g.rank.length;
  const cols = n > 5 ? 2 : 1;
  const per = Math.ceil(n / cols);
  const pw = Math.min(w * 0.94, cols === 2 ? 700 * u : 420 * u);
  const head = 62 * u;
  const rowH = Math.min(46 * u, (h * 0.8 - head - 24 * u) / per);
  const ph = head + per * rowH + 22 * u;
  const px = (w - pw) / 2;
  const py = Math.max(8, (h - ph) / 2 - 8 * u);
  const slide = ease.outCubic(clamp(age / 0.45, 0, 1));
  ctx.fillStyle = `rgba(20,5,50,${0.45 * slide})`;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(0, (1 - slide) * h * 0.4);
  roundRect(ctx, px, py, pw, ph, 22 * u);
  fillStroke(ctx, 'rgba(45,22,80,0.95)', Math.max(3, 4 * u), '#fff');
  label(ctx, `GAME ${g.game} DONE`, w / 2, py + head * 0.5, 32 * u, { fill: '#ffd23f' });
  const colW = (pw - 28 * u) / cols;
  const grow = ease.outCubic(clamp((age - 0.7) / 1.3, 0, 1));
  g.rank.forEach((id, i) => {
    const col = Math.floor(i / per);
    const row = i % per;
    const cx = px + 14 * u + col * colW;
    const cy = py + head + row * rowH + rowH / 2;
    const me = id === S.meId;
    roundRect(ctx, cx + 2, cy - rowH * 0.46, colW - 8 * u, rowH * 0.92, rowH * 0.3);
    ctx.fillStyle = me ? 'rgba(255,210,63,0.28)' : 'rgba(255,255,255,0.1)';
    ctx.fill();
    if (me) {
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#ffd23f';
      ctx.stroke();
    }
    label(ctx, String(i + 1), cx + rowH * 0.45, cy, rowH * 0.55, { lw: 4 });
    drawFace(ctx, S, id, cx + rowH * 1.25, cy, rowH * 0.36, i === 0 ? 'happy' : 'normal');
    const gp = g.gp[id] ?? 0;
    const total = g.scores[id] ?? 0;
    const shown = Math.round(total - gp + gp * grow);
    const nameSize = rowH * 0.48;
    ctx.font = font(nameSize);
    const nm = fitName(ctx, S.names(id), nameSize, colW - rowH * 3.9 - 40 * u);
    label(ctx, nm, cx + rowH * 1.85, cy, nameSize, { align: 'left', lw: 4 });
    label(ctx, String(shown), cx + colW - 14 * u, cy, rowH * 0.62, { align: 'right', fill: '#ffd23f', lw: 4 });
    // the points fly in
    if (gp > 0 && age > 0.55 && age < 2.3) {
      const t = clamp((age - 0.55 - (i % 5) * 0.05) / 0.9, 0, 1);
      const fx = cx + rowH * 1.25 + (cx + colW - 70 * u - (cx + rowH * 1.25)) * ease.inOutCubic(t);
      label(ctx, `+${gp}`, fx, cy - rowH * 0.5 * Math.sin(t * Math.PI), rowH * 0.5, { fill: '#7bed4f', alpha: t >= 1 ? 0 : 1, lw: 4 });
    }
  });
  ctx.restore();
}

// ---------------------------------------------------------------- the podium

export function crown(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.5);
  ctx.lineTo(x - s, y - s * 0.3);
  ctx.lineTo(x - s * 0.5, y + s * 0.1);
  ctx.lineTo(x, y - s * 0.6);
  ctx.lineTo(x + s * 0.5, y + s * 0.1);
  ctx.lineTo(x + s, y - s * 0.3);
  ctx.lineTo(x + s, y + s * 0.5);
  ctx.closePath();
  fillStroke(ctx, '#ffd23f', Math.max(2, s * 0.14));
  circle(ctx, x, y + s * 0.12, s * 0.12);
  fillStroke(ctx, '#ff4757', Math.max(1.5, s * 0.08));
}

export function bolt(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x + s * 0.2, y - s);
  ctx.lineTo(x - s * 0.55, y + s * 0.15);
  ctx.lineTo(x - s * 0.05, y + s * 0.15);
  ctx.lineTo(x - s * 0.25, y + s);
  ctx.lineTo(x + s * 0.55, y - s * 0.2);
  ctx.lineTo(x + s * 0.05, y - s * 0.2);
  ctx.closePath();
  fillStroke(ctx, '#ffd23f', Math.max(1.5, s * 0.14));
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

/** 1st, 2nd, 3rd on blocks with their faces, the fun awards, and "You: 4th" if you're lower. `age` is seconds since it appeared. */
export function drawPodium(ctx, S, g, age) {
  const { w, h, u } = S;
  const rank = g.rank;
  if (rank.length === 0) return;
  const baseY = h - 100 * u;
  const bw = clamp(w * 0.17, 96 * u, 190 * u);
  const gap = 8 * u;
  const slots = [
    { i: 1, x: w / 2 - bw - gap, hgt: h * 0.2, col: '#c9d1e0', delay: 0.35 },
    { i: 0, x: w / 2, hgt: h * 0.27, col: '#ffd23f', delay: 0.6 },
    { i: 2, x: w / 2 + bw + gap, hgt: h * 0.15, col: '#e3955c', delay: 0.1 },
  ];
  ctx.fillStyle = 'rgba(20,5,50,0.5)';
  ctx.fillRect(0, 0, w, h);
  const myRank = rank.indexOf(S.meId);
  const y = 0.085 * h;
  if (myRank >= 3) {
    // "You: 4th", beside the podium
    const pw = 150 * u;
    const ph = 38 * u;
    const px = Math.max(pw / 2 + 10 * u, w / 2 - bw * 1.5 - gap - pw / 2 - 14 * u);
    const py = baseY - 26 * u;
    roundRect(ctx, px - pw / 2, py - ph / 2, pw, ph, ph / 2);
    fillStroke(ctx, 'rgba(45,22,80,0.9)', 3, '#ffd23f');
    drawFace(ctx, S, S.meId, px - pw / 2 + ph * 0.55, py, ph * 0.38, 'normal');
    label(ctx, `You: ${ORD[myRank] ?? `${myRank + 1}th`}`, px + ph * 0.3, py, ph * 0.56, { fill: '#ffd23f' });
  }
  const aw = awardsOf(g);
  const awards = [];
  if (aw.speedy) awards.push({ title: 'SPEEDY SEAT', id: aw.speedy.id, icon: 'bolt' });
  if (aw.bumper) awards.push({ title: 'BUMPER', id: aw.bumper.id, icon: 'bump' });
  if (awards.length) {
    const pw = Math.min(w * 0.4, 250 * u);
    const ph = 44 * u;
    awards.forEach((a, k) => {
      const ax = w / 2 + (k - (awards.length - 1) / 2) * (pw + 12 * u);
      const pp = pop(age - 1.2 - k * 0.25, 0.4);
      ctx.save();
      ctx.translate(ax, y);
      ctx.scale(Math.max(0.01, pp), Math.max(0.01, pp));
      roundRect(ctx, -pw / 2, -ph / 2, pw, ph, ph / 2);
      fillStroke(ctx, 'rgba(45,22,80,0.92)', 3, '#7bed4f');
      if (a.icon === 'bolt') bolt(ctx, -pw / 2 + ph * 0.55, 0, ph * 0.3);
      else {
        // an impact star: a bump
        starPath(ctx, -pw / 2 + ph * 0.55, 0, ph * 0.34, 8, 0.55, -Math.PI / 2);
        fillStroke(ctx, '#ff7f32', 2.5);
        circle(ctx, -pw / 2 + ph * 0.55, 0, ph * 0.1);
        fillStroke(ctx, '#fff6a0', 0);
      }
      label(ctx, a.title, -pw / 2 + ph * 0.95, -ph * 0.16, ph * 0.34, { align: 'left', fill: '#7bed4f', lw: 4 });
      ctx.font = font(ph * 0.34);
      label(ctx, fitName(ctx, S.names(a.id), ph * 0.34, pw - ph * 2.1), -pw / 2 + ph * 0.95, ph * 0.2, ph * 0.34, { align: 'left', lw: 4 });
      drawFace(ctx, S, a.id, pw / 2 - ph * 0.55, 0, ph * 0.36, 'happy');
      ctx.restore();
    });
  }
  for (const sl of slots) {
    const id = rank[sl.i];
    if (!id) continue;
    const grow = ease.outBack(clamp((age - sl.delay) / 0.55, 0, 1));
    const bh = sl.hgt * grow;
    const bx = sl.x - bw / 2;
    const by = baseY - bh;
    roundRect(ctx, bx + 5, by + 5, bw, bh + 4, 14 * u);
    ctx.fillStyle = SHADOW;
    ctx.fill();
    roundRect(ctx, bx, by, bw, bh + 4, 14 * u);
    fillStroke(ctx, sl.col, Math.max(3, 4 * u));
    if (bh > 20) {
      label(ctx, String(sl.i + 1), sl.x, by + sl.hgt * 0.34 * grow, sl.hgt * 0.5, { fill: '#fff', lw: sl.hgt * 0.1 });
      label(ctx, String(g.scores[id] ?? 0), sl.x, by + sl.hgt * 0.78 * grow, sl.hgt * 0.26, { fill: INK, stroke: '#fff', lw: sl.hgt * 0.06 });
    }
    const hp = pop(age - sl.delay - 0.35, 0.4);
    const r = Math.min(bw * 0.3, h * 0.07);
    const fy = by - r - 4 * u - (1 - hp) * 20;
    ctx.save();
    ctx.globalAlpha = clamp(hp * 2, 0, 1);
    const bounce = sl.i === 0 ? Math.abs(Math.sin(S.t * 6)) * 6 * u : 0;
    drawFace(ctx, S, id, sl.x, fy - bounce, r * Math.max(0.4, hp), sl.i === 0 ? 'happy' : 'normal');
    if (id === S.meId) {
      circle(ctx, sl.x, fy - bounce, r * 1.12);
      ctx.lineWidth = Math.max(3, 4 * u);
      ctx.strokeStyle = '#ffd23f';
      ctx.stroke();
    }
    if (sl.i === 0) crown(ctx, sl.x, fy - bounce - r - 12 * u, 13 * u * Math.max(0.3, hp));
    ctx.font = font(clamp(h * 0.04, 13, 28));
    const nm = fitName(ctx, S.names(id), clamp(h * 0.04, 13, 28), bw * 1.1);
    label(ctx, nm, sl.x, fy - bounce - r - (sl.i === 0 ? 38 : 16) * u, clamp(h * 0.04, 13, 28), { lw: 4 });
    ctx.restore();
  }
}

// ---------------------------------------------------------------- a stand-in start for a page opened outside the platform

export function drawStart(ctx, S) {
  button(ctx, S, 'start', 'START', S.w / 2, S.h - 56 * S.u, 220 * S.u, 66 * S.u, { pulse: true });
}

