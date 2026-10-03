// The game's own screens, built inside the tunnel: the hub puts the ships on the rim and the mode at the far end,
// the draft brings the mods up three lanes of the next zone's web, the results hang the score in the middle of the
// tunnel the run ended in. Each screen returns this frame's buttons; the platform's Ready / Start strip sits under
// the lobby screens (their bottom 96 px stay clear).
import { SHIPS, MODS, WORLDS, OVERCLOCK, LEVELS_PER_WORLD } from '../sim/data.js';
import { MODE_NAMES, TEMPOS, draftOptions, zoneFor, zoneLabel, dailyFor, dayOf } from '../sim/run.js';
import { SHIP_SHAPES } from '../render/shapes.js';
import { TINTS, TRAILS, RIMS, TAPES, shipUnlocked, unlockLabel, needLabel, met, ocAllowed } from '../sim/profile.js';
import { MOD_ICONS, iconPath } from './icons.js';
import { DEATH_NAMES } from '../sim/world.js';
import { strokeable } from '../render/vector.js';
import { laneOf } from '../sim/web.js';

const WHITE = '#ffffff';
const CAUSE = {
  FLIPPER: 'CAUGHT BY A FLIPPER',
  SHOT: 'SHOT DOWN',
  PULSAR: 'PULSAR LANE',
  MINE: 'MINE BLAST',
  SPIKE: 'HIT A SPIKE',
  FUSEBALL: 'FUSEBALL',
  GHOST: 'GHOST ON THE BEAT',
  WEAVER: 'CAUGHT BY A WEAVER',
  SIREN: 'CAUGHT BY THE CHOIR',
  BOMBER: 'CAUGHT BY A BOMBER',
  BOSS: 'BOSS BLAST',
  TIDE: 'THE TIDE',
};
// Where each ship sits on the rim, left to right along the bottom: the first ship in the middle.
const SHIP_SLOTS = [0, 1, -1, 2, -2, -3];
export const RIM_ORDER = [5, 4, 2, 0, 1, 3];

/** Draws a ship's outline at a point, prongs up. */
export function shipIcon(vec, type, cx, cy, size) {
  const list = SHIP_SHAPES[type] || SHIP_SHAPES[0];
  for (const st of list) {
    for (let i = 0; i < st.length; i += 2) {
      const x = cx + st[i] * size;
      const y = cy - (st[i + 1] - 0.35) * size;
      if (i === 0) vec.move(x, y);
      else vec.to(x, y);
    }
  }
}

export class Menus {
  constructor(app) {
    this.app = app;
    this.look = false; // the cosmetics panel is open
    this.focus = 1; // the draft option the keys point at
    this.flash = null; // a locked ship's requirement, shown for a moment
  }

  /** The tunnel's centre, its rim radius and a point at (lane, depth). */
  geo() {
    const v = this.app.view;
    return { v, cx: v.vx(), cy: v.vy(), R: v.S, Ry: v.Sy, web: v.web };
  }

  // ---------------------------------------------------------------- title

  title(vec, W, H, t, hue) {
    const app = this.app;
    const size = Math.min(W / 8.5, H / 7, 92);
    const y = H * 0.3;
    // A pool of dark behind the words, so the lanes running through them never cut a letter.
    const c = vec.ctx;
    c.globalCompositeOperation = 'source-over';
    for (const [gy, gr, ga] of [[y, Math.max(size * 4.2, W * 0.34), 0.62], [H * 0.66, Math.max(150, W * 0.24), 0.55]]) {
      const g = c.createRadialGradient(W / 2, gy, 0, W / 2, gy, gr);
      g.addColorStop(0, `rgba(2,4,3,${ga})`);
      g.addColorStop(0.6, `rgba(2,4,3,${ga * 0.6})`);
      g.addColorStop(1, 'rgba(2,4,3,0)');
      c.fillStyle = g;
      c.fillRect(W / 2 - gr, gy - gr, gr * 2, gr * 2);
    }
    c.globalCompositeOperation = 'lighter';
    // The logo: an outline in the world's colour with a thin white-hot line inside it, like a tube drawn twice.
    vec.text('RIMSHOT', W / 2, y - size / 2, size, hue, 0.5, 0.95, 0.75);
    vec.text('RIMSHOT', W / 2 + 1.5, y - size / 2 + 1.5, size, WHITE, 0.5, 0.35 + (app.calm ? 0 : 0.12 * Math.sin(t * 2.4)), 0.22);
    if (app.profile.best > 0) vec.text(`BEST ${app.profile.best}`, W / 2, y + size * 0.72, Math.max(11, size * 0.15), hue, 0.5, 0.8);
    const bw = Math.min(300, W * 0.7);
    return [{ id: 'play', x: W / 2 - bw / 2, y: H * 0.64, w: bw, h: 84, label: 'PLAY', key: 'ENTER', big: true }];
  }

  // ---------------------------------------------------------------- hub: ships on the rim, the mode at the far end

  hub(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const prof = app.profile;
    const host = s.isHost;
    const hub = s.hub;
    const buttons = [];
    if (this.look) return this.lookPanel(vec, W, H, t, hue);
    if (app.short) return this.hubShort(vec, W, H, t, hue);
    this.playersRow(vec, 12, 62, W - 24, hue, buttons, true);
    this.corner(buttons, W);
    const { v, cx, cy, R, Ry, web } = this.geo();
    if (!web) return buttons;
    const daily = hub.mode === 'daily' ? dailyFor(dayOf(app.now())) : null;
    // The six ships along the bottom of the rim.
    const f = {};
    const chosen = daily ? daily.ship : s.myShip;
    SHIP_SLOTS.forEach((off, i) => {
      const lane = laneOf(web, web.start + off);
      v.frame(lane, 0, f);
      const open = shipUnlocked(prof, i);
      const on = chosen === i;
      // Lift the ship off the rim a little so it reads as a choice, not a player.
      const lift = on ? 0.35 : 0.18;
      vec.begin();
      v.strokes(SHIP_SHAPES[i], { ...f, cx: f.cx + f.dx * lift, cy: f.cy + f.dy * lift }, 0.82, 0.82);
      vec.glow(on ? WHITE : hue, on ? 1.8 : 1.2, open ? (on ? 1.15 : 0.6) : 0.18);
      if (on) {
        // Its lane lit, and a few notes going down it.
        vec.begin();
        for (const j of [lane, lane + 1]) {
          v.B(j, 0, tmp1);
          v.B(j, 1, tmp2);
          vec.line(tmp1[0], tmp1[1], tmp2[0], tmp2[1]);
        }
        const k = (t * 0.9) % 1;
        for (let b = 0; b < 3; b++) {
          const z = (k + b / 3) % 1;
          v.P(lane, z, tmp1);
          v.P(lane, Math.max(0, z - 0.05), tmp2);
          vec.line(tmp1[0], tmp1[1], tmp2[0], tmp2[1]);
        }
        vec.glow(WHITE, 1.1, 0.55);
      }
      const r = Math.max(24, f.len * 0.95);
      buttons.push({ id: `ship:${i}`, x: f.cx - r, y: f.cy - r, w: r * 2, h: r * 2, frame: false, on, off: Boolean(daily), aria: open ? SHIPS[i].name : `${SHIPS[i].name}, locked: ${unlockLabel(i)}` });
    });
    // The chosen ship's name over the arc (or what a locked one asks for).
    const nameY = cy + Ry * 0.4;
    const nsz = Math.max(14, Math.min(R * 0.11, 22));
    const tsz = Math.max(10.5, nsz * 0.55);
    if (this.flash && performance.now() - this.flash.at < 1800) {
      vec.text(SHIPS[this.flash.i].name, cx, nameY, nsz, hue, 0.5, 0.6);
      vec.text(unlockLabel(this.flash.i), cx, nameY + nsz + 8, tsz, WHITE, 0.5, 0.95);
    } else {
      vec.text(SHIPS[chosen].name, cx, nameY, nsz, WHITE, 0.5, 1);
      vec.text(SHIPS[chosen].tag, cx, nameY + nsz + 8, tsz, hue, 0.5, 0.85);
    }
    // The mode at the far end of the tunnel.
    const msz = Math.max(24, Math.min(R * 0.17, 38));
    const my = cy - Ry * 0.38;
    vec.text(MODE_NAMES[hub.mode], cx, my, msz, WHITE, 0.5, 1, 1.1);
    if (host) this.arrows(buttons, 'mode', cx, my + msz / 2, Math.max(vec.measure(MODE_NAMES[hub.mode], msz) / 2 + 30, R * 0.42), true, true);
    // What the mode plays with: Overclock, or the practice zone, or today's best.
    const rsz = Math.max(13, Math.min(R * 0.085, 17));
    this.modeRows(vec, buttons, cx, cy - Ry * 0.1, rsz, R * 0.3, hue);
    if (hub.mode === 'run' || hub.mode === 'descent') this.dial(vec, cx, cy, R, Ry, Math.min(8, hub.oc), hue);
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 80, w: 220, h: 56, label: 'START', key: 'ENTER' });
    return buttons;
  }

  /** What the mode plays with: Overclock, the practice zone, or today's best. Returns the y below the last row. */
  modeRows(vec, buttons, cx, y, rsz, minHalf, hue, gap = 8) {
    const app = this.app;
    const s = app.session;
    const prof = app.profile;
    const host = s.isHost;
    const hub = s.hub;
    const row = (id, label, sub, canDown, canUp) => {
      vec.text(label, cx, y, rsz, hue, 0.5, 0.95);
      if (sub) vec.text(sub, cx, y + rsz + 6, Math.max(10, rsz * 0.6), WHITE, 0.5, 0.75);
      if (host) this.arrows(buttons, id, cx, y + rsz / 2, Math.max(vec.measure(label, rsz) / 2 + 26, minHalf), canDown, canUp);
      y += rsz + (sub ? 30 : 16) + gap;
    };
    if (hub.mode === 'run' || hub.mode === 'descent') {
      const max = host ? ocAllowed(prof) : 8;
      const oc = Math.min(8, hub.oc);
      row('oc', oc ? `OVERCLOCK ${oc}` : 'OVERCLOCK OFF', oc ? OVERCLOCK[oc].rule : '', oc > 0, oc < max);
    } else if (hub.mode === 'practice') {
      row('pw', WORLDS[hub.pw].name, '', hub.pw > 0, hub.pw < (prof.deepest >= 8 ? 7 : 5));
      row('pl', hub.pl >= 4 ? 'BOSS' : `ZONE ${hub.pl}`, '', hub.pl > 1, hub.pl < LEVELS_PER_WORLD);
      row('pt', `${Math.round(TEMPOS[hub.pt] * 100)}%`, '', hub.pt > 0, hub.pt < TEMPOS.length - 1);
    } else if (hub.mode === 'daily') {
      const best = prof.daily.day === dayOf(app.now()) ? prof.daily.best : 0;
      if (best) vec.text(`TODAY ${best}`, cx, y, rsz, hue, 0.5, 0.9);
    }
    return y;
  }

  /** The hub on a short screen (a phone held sideways): one column over the dimmed tunnel, the ships in a row. */
  hubShort(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const prof = app.profile;
    const host = s.isHost;
    const hub = s.hub;
    const buttons = [];
    this.playersRow(vec, 12, 46, W - 190, hue, buttons, true);
    this.corner(buttons, W);
    const cx = W / 2;
    const daily = hub.mode === 'daily' ? dailyFor(dayOf(app.now())) : null;
    const chosen = daily ? daily.ship : s.myShip;
    let y = 92;
    const msz = 26;
    vec.text(MODE_NAMES[hub.mode], cx, y, msz, WHITE, 0.5, 1, 1.1);
    if (host) this.arrows(buttons, 'mode', cx, y + msz / 2, Math.max(vec.measure(MODE_NAMES[hub.mode], msz) / 2 + 34, 90), true, true);
    y += msz + 16;
    y = this.modeRows(vec, buttons, cx, y, 15, 90, hue, 2);
    // The six ships in a row, the chosen one lit.
    const sy = Math.max(y + 6, 178);
    const size = 46;
    this.shipRow(vec, buttons, cx, sy, chosen, hue, Boolean(daily));
    const ny = sy + size + 14;
    if (this.flash && performance.now() - this.flash.at < 1800) {
      vec.text(`${SHIPS[this.flash.i].name}  ${unlockLabel(this.flash.i)}`, cx, ny, 13, WHITE, 0.5, 0.95);
    } else {
      vec.text(`${SHIPS[chosen].name}  ${SHIPS[chosen].tag}`, cx, ny, 13, WHITE, 0.5, 1);
    }
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 70, w: 220, h: 50, label: 'START', key: 'ENTER' });
    void host;
    return buttons;
  }

  /** The six ships in a row (a short screen's picker): the chosen one lit, the locked ones dim. */
  shipRow(vec, buttons, cx, sy, chosen, hue, off = false) {
    const prof = this.app.profile;
    const size = 46;
    const gap = 8;
    const total = RIM_ORDER.length * size + (RIM_ORDER.length - 1) * gap;
    let x = cx - total / 2;
    RIM_ORDER.forEach((i) => {
      const open = shipUnlocked(prof, i);
      const on = chosen === i;
      vec.begin();
      shipIcon(vec, i, x + size / 2, sy + size / 2 + 5, 17);
      vec.glow(on ? WHITE : hue, on ? 1.8 : 1.3, open ? (on ? 1.15 : 0.8) : 0.2);
      if (on) {
        vec.begin();
        vec.move(x + 6, sy + size + 2);
        vec.to(x + size - 6, sy + size + 2);
        vec.glow(WHITE, 1.4, 0.9);
      }
      buttons.push({ id: `ship:${i}`, x, y: sy, w: size, h: size, frame: false, on, off, aria: open ? SHIPS[i].name : `${SHIPS[i].name}, locked: ${unlockLabel(i)}` });
      x += size + gap;
    });
  }

  /** The draft on a short screen: three cards side by side under a one-line header. */
  draftShort(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const run = s.run;
    const buttons = [];
    this.playersRow(vec, 12, 46, W - 190, hue, buttons, true);
    this.corner(buttons, W);
    const cx = W / 2;
    const me = s.room.me.id;
    const mine = run.players[me];
    const done = zoneFor(run, run.idx - 1);
    const next = zoneFor(run, run.idx);
    vec.text(`${zoneLabel(done)} CLEAR`, cx, 90, 20, WHITE, 0.5, 1, 1.1);
    vec.text(`${next.level >= 4 ? 'NEXT: BOSS' : `NEXT: ${zoneLabel(next)}`}    ${run.score}`, cx, 118, 12, hue, 0.5, 0.95);
    vec.begin();
    for (let i = 0; i < Math.min(8, run.lives); i++) {
      const x = cx - ((Math.min(8, run.lives) - 1) * 14) / 2 + i * 14;
      vec.move(x - 5, 142);
      vec.to(x + 5, 142);
      vec.to(x, 150);
      vec.to(x - 5, 142);
    }
    vec.glow(WHITE, 1, 0.85);
    if (!mine) {
      vec.text('PICK A SHIP', cx, 170, 14, WHITE, 0.5, 0.95);
      this.shipRow(vec, buttons, cx, 196, s.myShip, hue);
      return buttons;
    }
    const key = `${run.rid}.${run.idx}`;
    const options = draftOptions(run, me, run.idx - 1, mine.mods, run.roster.length > 1);
    const picked = s.pickedKey === key ? s.pickedMod : null;
    if (this.focus >= options.length) this.focus = Math.max(0, options.length - 1);
    const gap = 10;
    const cw = Math.min(250, (W - 28 - gap * (options.length - 1)) / Math.max(1, options.length));
    const total = options.length * cw + (options.length - 1) * gap;
    let x = cx - total / 2;
    const y = 166;
    options.forEach((k, i) => {
      const def = MODS.find((m) => m.key === k);
      const on = picked === k;
      const lit = on || (!picked && this.focus === i);
      const have = mine.mods[k] || 0;
      const name = have ? `${def.name} ${'I'.repeat(have + 1)}` : def.name;
      const dim = picked && !on;
      buttons.push({
        id: `mod:${k}`,
        x,
        y,
        w: cw,
        h: 120,
        on: lit,
        aria: `${def.name}: ${def.tag}`,
        draw: (vc, b, hover) => {
          vc.begin();
          iconPath(vc, MOD_ICONS[k] || [], b.x + b.w / 2 - 17, b.y + 12, 34);
          vc.glow(on || hover ? WHITE : hue, 1.8, dim ? 0.35 : 1);
          vc.text(name, b.x + b.w / 2, b.y + 54, 13, on || hover ? WHITE : hue, 0.5, dim ? 0.4 : 1);
          vc.lines(def.tag, 10.5, b.w - 16)
            .slice(0, 2)
            .forEach((ln, li) => vc.text(ln, b.x + b.w / 2, b.y + 78 + li * 14, 10.5, WHITE, 0.5, dim ? 0.3 : 0.85));
        },
      });
      x += cw + gap;
    });
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 70, w: 220, h: 50, label: 'GO', key: 'ENTER' });
    return buttons;
  }

  /** What the score was made of: the run's biggest payouts, one line each. Returns the y below them. */
  moments(vec, run, cx, y, size, hue, step = 20) {
    for (const [value, label, zone] of run.top || []) {
      vec.text(`${label}  ${value}  ${zone}`, cx, y, size, hue, 0.5, 0.8);
      y += step;
    }
    return y;
  }

  /** The results on a short screen: one column. */
  resultsShort(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const run = s.run;
    const buttons = [];
    const cx = W / 2;
    const r = run.result || { cleared: false, cause: 0, zone: '', depth: run.idx };
    let title = r.cleared ? 'RUN CLEAR' : 'GAME OVER';
    if (run.mode === 'descent') title = `DEPTH ${r.depth}`;
    if (run.mode === 'practice') title = r.cleared ? 'ZONE CLEAR' : 'PRACTICE';
    vec.text(title, cx, 60, 30, r.cleared ? WHITE : hue, 0.5, 1, 1.2);
    const cause = DEATH_NAMES[r.cause];
    if (!r.cleared && (cause || r.ended)) vec.text(`${r.ended ? 'ENDED' : CAUSE[cause] || cause} · ${r.zone}`, cx, 102, 12, WHITE, 0.5, 0.9);
    vec.text(String(run.score), cx, 128, 36, WHITE, 0.5, 1, 1.1);
    const best = run.mode === 'descent' ? app.profile.bestDescent : app.profile.best;
    let y = 176;
    if (app.newBest) vec.text('NEW BEST', cx, y, 13, hue, 0.5, app.calm ? 0.95 : 0.7 + 0.3 * Math.abs(Math.sin(t * 2.5)));
    else if (best) vec.text(`BEST ${best}`, cx, y, 12, hue, 0.5, 0.8);
    y += 22;
    // What fits above the platform's strip, most telling first: the biggest payouts, then the tally, then the crew.
    const room = () => H - 96 - y;
    const top = (run.top || []).slice(0, Math.max(0, Math.min(3, Math.floor(room() / 17) - 2)));
    y = this.moments(vec, { top }, cx, y, 11, hue, 17);
    const mine = run.players[s.room.me.id];
    if (mine && room() >= 18) {
      vec.text(`KILLS ${mine.kills}   CHORDS ${mine.chords}   BOSSES ${run.stats.bosses}`, cx, y, 11, hue, 0.5, 0.85);
      y += 20;
    }
    const list = Object.entries(run.players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((p, q) => q.score - p.score)
      .slice(0, 4);
    if (list.length > 1) {
      const rowW = 300;
      for (const p of list.slice(0, Math.max(0, Math.min(2, Math.floor(room() / 22))))) {
        const x = cx - rowW / 2;
        vec.begin();
        shipIcon(vec, p.ship, x + 10, y + 7, 8);
        vec.glow(p.id === s.room.me.id ? WHITE : hue, 1, 0.8);
        app.nameText(p.n || 'PLAYER', x + 26, y, rowW * 0.55, false);
        vec.text(`${p.score}`, x + rowW, y + 1, 11, WHITE, 1, 0.9);
        y += 22;
      }
    }
    for (const u of (app.unlocked || []).slice(0, 2)) {
      if (room() < 16) break;
      vec.text(`NEW ${u}`, cx, y, 12, WHITE, 0.5, 0.95);
      y += 18;
    }
    if (s.isHost) buttons.push({ id: 'tohub', x: W - 12 - 96, y: 8, w: 96, h: 44, label: 'SHIPS', small: true });
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 70, w: 220, h: 50, label: 'AGAIN', key: 'ENTER' });
    return buttons;
  }

  /** Overclock as eight ticks round the far ring. */
  dial(vec, cx, cy, R, Ry, oc, hue) {
    if (!oc) return;
    const r = R * 0.27;
    vec.begin();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + ((i - 3.5) * Math.PI) / 14;
      const a2 = a + Math.PI / 20;
      if (i >= oc) continue;
      vec.move(cx + Math.cos(a) * r, cy - Ry * 0.02 + Math.sin(a) * r);
      vec.to(cx + Math.cos(a2) * r, cy - Ry * 0.02 + Math.sin(a2) * r);
    }
    vec.glow(oc >= 6 ? WHITE : hue, 2.2, 0.9);
  }

  /** ◀ and ▶ either side of a value: real 44 px buttons. */
  arrows(buttons, id, cx, cy, half, canDown, canUp) {
    const s = 44;
    buttons.push({ id: `${id}:-`, x: cx - half - s / 2, y: cy - s / 2, w: s, h: s, label: '◀', frame: false, off: !canDown, aria: `${id} back` });
    buttons.push({ id: `${id}:+`, x: cx + half - s / 2, y: cy - s / 2, w: s, h: s, label: '▶', frame: false, off: !canUp, aria: `${id} next` });
  }

  /** LOOK and CALM in the top right (the platform's buttons own the top left). */
  corner(buttons, W) {
    const app = this.app;
    buttons.push({ id: 'look', x: W - 12 - 132, y: 8, w: 64, h: 44, label: 'LOOK', small: true });
    buttons.push({ id: 'calm', x: W - 12 - 64, y: 8, w: 64, h: 44, label: 'CALM', small: true, on: app.calmSetting, aria: app.calmSetting ? 'Calm on' : 'Calm off' });
  }

  /** The players in the room, with their ships and ready marks; empty seats invite. */
  playersRow(vec, x, y, w, hue, buttons, lobby) {
    const app = this.app;
    const room = app.session.room;
    const list = room ? [...room.players.values()].slice(0, 4) : [];
    // Seats: everyone here, and one empty seat to invite into (the others stay out of the way).
    const n = Math.max(1, Math.min(4, list.length + (lobby && app.platformPresent && list.length < 4 ? 1 : 0)));
    const gap = 8;
    const cw = Math.min(260, (w - gap * (n - 1)) / n);
    x += (w - (cw * n + gap * (n - 1))) / 2;
    const h = 40;
    for (let i = 0; i < n; i++) {
      const px = x + i * (cw + gap);
      const p = list[i];
      if (!p) {
        if (lobby && app.platformPresent) buttons.push({ id: `invite:${i}`, x: px, y, w: cw, h, label: 'INVITE', small: true });
        continue;
      }
      const ship = Number.isInteger(p.presence?.sh) ? Math.max(0, Math.min(SHIPS.length - 1, p.presence.sh)) : 0;
      vec.begin();
      shipIcon(vec, ship, px + 14, y + h / 2, 10);
      vec.glow(p.id === room.me.id ? WHITE : hue, 1.1, p.connected === false ? 0.3 : 0.85);
      const end = app.nameText(p.name || 'PLAYER', px + 30, y + h / 2 - 7, cw - 48, p.id === room.host);
      const ready = p.ready || p.id === room.host;
      if (ready && app.session.match.phase === 'lobby') {
        // The ready mark follows the name.
        const cx = Math.min(px + cw - 16, end + 8);
        vec.begin();
        vec.move(cx, y + h / 2 + 2);
        vec.to(cx + 5, y + h / 2 + 7);
        vec.to(cx + 13, y + h / 2 - 3);
        vec.glow(WHITE, 1.2, 0.9);
      }
    }
    return h;
  }

  lookPanel(vec, W, H, t, hue) {
    const app = this.app;
    const p = app.profile;
    const buttons = [];
    let y = Math.max(70, H * 0.16);
    vec.text('LOOK', W / 2, y, 22, WHITE, 0.5, 0.95);
    y += 44;
    const rows = [
      ['tint', 'SHIP', TINTS],
      ['trail', 'TRAIL', TRAILS],
      ['rim', 'RIM', RIMS],
      ['tape', 'FALL', TAPES],
    ];
    const w = Math.min(440, W - 32);
    const x = W / 2 - w / 2;
    for (const [key, label, list] of rows) {
      const item = list[p[key]];
      vec.text(label, x, y + 15, 11, hue, 0, 0.75);
      const ix = x + 78;
      const iw = w - 78;
      buttons.push({ id: `${key}:-`, x: ix, y, w: 44, h: 44, label: '◀', frame: false, aria: `${label} back` });
      buttons.push({ id: `${key}:+`, x: ix + iw - 44, y, w: 44, h: 44, label: '▶', frame: false, aria: `${label} next` });
      vec.text(item.name, ix + iw / 2, y + 9, 15, key === 'tint' ? item.hex : WHITE, 0.5, 0.95);
      const next = list.find((x2, i) => i > 0 && !met(p, x2.need));
      if (next) vec.text(needLabel(next.need), ix + iw / 2, y + 31, 8, hue, 0.5, 0.55);
      y += 62;
    }
    buttons.push({ id: 'look:done', x: W / 2 - 90, y: y + 10, w: 180, h: 50, label: 'DONE', key: 'ESC' });
    return buttons;
  }

  // ---------------------------------------------------------------- draft: three mods climbing three lanes

  draft(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const run = s.run;
    const buttons = [];
    if (!run) return buttons;
    if (app.short) return this.draftShort(vec, W, H, t, hue);
    this.playersRow(vec, 12, 62, W - 24, hue, buttons, true);
    this.corner(buttons, W);
    const { v, cx, cy, R, Ry, web } = this.geo();
    if (!web) return buttons;
    const me = s.room.me.id;
    const mine = run.players[me];
    const done = zoneFor(run, run.idx - 1);
    const next = zoneFor(run, run.idx);
    const compact = W < 600;
    const tsz = Math.max(20, Math.min(R * 0.14, 32));
    const top = cy - Ry * (compact ? 0.78 : 0.6);
    vec.text(`${zoneLabel(done)} CLEAR`, cx, top, tsz, WHITE, 0.5, 1, 1.1);
    vec.text(next.level >= 4 ? 'NEXT: BOSS' : `NEXT: ${zoneLabel(next)}`, cx, top + tsz + 12, Math.max(12, Math.min(R * 0.065, 14)), hue, 0.5, 0.95);
    const sy = top + tsz + 40;
    vec.text(`${run.score}`, cx, sy, Math.max(14, Math.min(R * 0.085, 18)), WHITE, 0.5, 0.9);
    // The team's ships left, as small marks.
    vec.begin();
    for (let i = 0; i < Math.min(8, run.lives); i++) {
      const x = cx - ((Math.min(8, run.lives) - 1) * 14) / 2 + i * 14;
      const y = sy + 28;
      vec.move(x - 5, y);
      vec.to(x + 5, y);
      vec.to(x, y + 8);
      vec.to(x - 5, y);
    }
    vec.glow(WHITE, 1, 0.85);
    if (!mine) {
      // Someone new joins with a ship; their mods start at the next draft.
      this.shipsOnRim(vec, buttons, t, hue);
      vec.text('PICK A SHIP', cx, cy + Ry * 0.3, Math.max(13, Math.min(R * 0.08, 16)), WHITE, 0.5, 0.95);
      return buttons;
    }
    const key = `${run.rid}.${run.idx}`;
    const options = draftOptions(run, me, run.idx - 1, mine.mods, run.roster.length > 1);
    const picked = s.pickedKey === key ? s.pickedMod : null;
    if (this.focus >= options.length) this.focus = Math.max(0, options.length - 1);
    const f = {};
    if (compact) {
      // A phone: three rows, one under the other, each a whole button (the lanes are too narrow to carry the words).
      const rowW = Math.min(W - 28, 440);
      const rowH = 76;
      const gap = 10;
      const total = options.length * rowH + (options.length - 1) * gap;
      let y = Math.min(H - 108 - total, cy + Ry * 0.06);
      options.forEach((k, i) => {
        const def = MODS.find((m) => m.key === k);
        const on = picked === k;
        const lit = on || (!picked && this.focus === i);
        const have = mine.mods[k] || 0;
        const name = have ? `${def.name} ${'I'.repeat(have + 1)}` : def.name;
        const dim = picked && !on;
        buttons.push({
          id: `mod:${k}`,
          x: cx - rowW / 2,
          y,
          w: rowW,
          h: rowH,
          on: lit,
          aria: `${def.name}: ${def.tag}`,
          draw: (vc, b, hover, kk) => {
            vc.begin();
            iconPath(vc, MOD_ICONS[k] || [], b.x + 14, b.y + 15, 46);
            vc.glow(on || hover ? WHITE : hue, 1.8, dim ? 0.35 : 1);
            vc.text(name, b.x + 76, b.y + 17, 15, on || hover ? WHITE : hue, 0, dim ? 0.4 : 1);
            const lines = vc.lines(def.tag, 11, b.w - 76 - 12);
            lines.slice(0, 2).forEach((ln, li) => vc.text(ln, b.x + 76, b.y + 42 + li * 15, 11, WHITE, 0, dim ? 0.3 : 0.85));
          },
        });
        y += rowH + gap;
      });
    } else {
      // Three lanes around the bottom, the mods half-way up them.
      const spread = options.length >= 3 ? [-3, 0, 3] : [-2, 2];
      options.forEach((k, i) => {
        const def = MODS.find((m) => m.key === k);
        const lane = laneOf(web, web.start + spread[i]);
        const on = picked === k;
        const lit = on || (!picked && this.focus === i);
        v.frame(lane, 0.24, f);
        const size = Math.max(30, Math.min(70, f.len * 1.8));
        // The lane, lit.
        vec.begin();
        for (const j of [lane, lane + 1]) {
          v.B(j, 0, tmp1);
          v.B(j, 1, tmp2);
          vec.line(tmp1[0], tmp1[1], tmp2[0], tmp2[1]);
        }
        vec.glow(lit ? WHITE : hue, 1, lit ? 0.6 : 0.25);
        vec.begin();
        iconPath(vec, MOD_ICONS[k] || [], f.cx - size / 2, f.cy - size / 2, size);
        vec.glow(on ? WHITE : hue, 1.8, picked && !on ? 0.35 : 1);
        const have = mine.mods[k] || 0;
        const name = have ? `${def.name} ${'I'.repeat(have + 1)}` : def.name;
        const nsz = Math.min(16, Math.max(12, R * 0.05));
        const ty = f.cy + size / 2 + 8;
        const dim = picked && !on;
        vec.text(name, f.cx, ty, nsz, on ? WHITE : hue, 0.5, dim ? 0.4 : 1);
        const tagW = Math.max(110, f.len * 5.2);
        vec.lines(def.tag, 11, tagW).forEach((ln, li) => vec.text(ln, f.cx, ty + nsz + 8 + li * 15, 11, WHITE, 0.5, dim ? 0.3 : 0.85));
        const hw = Math.max(size, vec.measure(name, nsz), tagW * 0.8) / 2 + 10;
        buttons.push({ id: `mod:${k}`, x: f.cx - hw, y: f.cy - size / 2 - 8, w: hw * 2, h: size + nsz + 70, frame: false, on, aria: `${def.name}: ${def.tag}` });
      });
    }
    // What this ship carries: a row of small icons.
    const owned = Object.entries(mine.mods);
    if (owned.length) {
      const sz = 18;
      const gap = 10;
      const total = owned.length * (sz + gap) - gap;
      let x = cx - Math.min(total, W - 40) / 2;
      const y = Math.min(H - 128, cy + Ry + 14);
      for (const [k, c] of owned.slice(0, Math.floor((W - 40) / (sz + gap)))) {
        vec.begin();
        iconPath(vec, MOD_ICONS[k] || [], x, y, sz);
        vec.glow(hue, 1, 0.7);
        if (c > 1) vec.text('I'.repeat(c), x + sz / 2, y + sz + 4, 7, WHITE, 0.5, 0.7);
        x += sz + gap;
      }
    }
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 80, w: 220, h: 56, label: 'GO', key: 'ENTER' });
    return buttons;
  }

  /** The ship picker on the rim (a newcomer's draft). */
  shipsOnRim(vec, buttons, t, hue) {
    const app = this.app;
    const s = app.session;
    const { v, web } = this.geo();
    const f = {};
    SHIP_SLOTS.forEach((off, i) => {
      const lane = laneOf(web, web.start + off);
      v.frame(lane, 0, f);
      const open = shipUnlocked(app.profile, i);
      const on = s.myShip === i;
      vec.begin();
      v.strokes(SHIP_SHAPES[i], { ...f, cx: f.cx + f.dx * 0.25, cy: f.cy + f.dy * 0.25 }, 0.82, 0.82);
      vec.glow(on ? WHITE : hue, on ? 1.8 : 1.2, open ? (on ? 1.1 : 0.6) : 0.18);
      const r = Math.max(24, f.len * 0.95);
      buttons.push({ id: `ship:${i}`, x: f.cx - r, y: f.cy - r, w: r * 2, h: r * 2, frame: false, on, aria: SHIPS[i].name });
    });
  }

  /** Keys on the draft: left and right choose, Space or Enter takes it. */
  draftKey(dir) {
    const s = this.app.session;
    const run = s.run;
    if (!run || !run.players[s.room.me.id]) return;
    const options = draftOptions(run, s.room.me.id, run.idx - 1, run.players[s.room.me.id].mods, run.roster.length > 1);
    if (!options.length) return;
    if (dir) this.focus = (this.focus + dir + options.length) % options.length;
    else this.app.press(`mod:${options[this.focus]}`);
  }

  // ---------------------------------------------------------------- results: the score in the tunnel it ended in

  results(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const run = s.run;
    const buttons = [];
    if (!run) return buttons;
    if (app.short) return this.resultsShort(vec, W, H, t, hue);
    const { cx, cy, R, Ry } = this.geo();
    const r = run.result || { cleared: false, cause: 0, zone: '', depth: run.idx };
    let title = r.cleared ? 'RUN CLEAR' : 'GAME OVER';
    if (run.mode === 'descent') title = `DEPTH ${r.depth}`;
    if (run.mode === 'practice') title = r.cleared ? 'ZONE CLEAR' : 'PRACTICE';
    const big = Math.max(26, Math.min(R * 0.2, 46, W / 9));
    let y = cy - Ry * 0.66;
    vec.text(title, cx, y, big, r.cleared ? WHITE : hue, 0.5, 1, 1.2);
    y += big + 14;
    const cause = DEATH_NAMES[r.cause];
    if (!r.cleared && (cause || r.ended)) vec.text(`${r.ended ? 'ENDED' : CAUSE[cause] || cause} · ${r.zone}`, cx, y, Math.max(11, Math.min(13, R * 0.06)), WHITE, 0.5, 0.9);
    const ssz = Math.min(R * 0.17, 40);
    y = Math.max(y + 8, cy - ssz / 2 - Ry * 0.08);
    vec.text(String(run.score), cx, y, ssz, WHITE, 0.5, 1, 1.1);
    y += ssz + 12;
    const best = run.mode === 'descent' ? app.profile.bestDescent : app.profile.best;
    if (app.newBest) vec.text('NEW BEST', cx, y, Math.max(12, Math.min(14, R * 0.07)), hue, 0.5, app.calm ? 0.95 : 0.7 + 0.3 * Math.abs(Math.sin(t * 2.5)));
    else if (best) vec.text(`BEST ${best}`, cx, y, Math.max(11, Math.min(12, R * 0.06)), hue, 0.5, 0.8);
    y += 26;
    // The rest flows downward and stops above the platform's strip: the biggest payouts, the tally, the crew, the unlocks.
    const room = () => H - 100 - y;
    y = this.moments(vec, { top: (run.top || []).slice(0, Math.max(0, Math.min(3, Math.floor(room() / 20) - 1))) }, cx, y, 11, hue, 19);
    const mine = run.players[s.room.me.id];
    if (mine && room() >= 20) {
      vec.text(`KILLS ${mine.kills}   CHORDS ${mine.chords}   BOSSES ${run.stats.bosses}`, cx, y, Math.max(10.5, Math.min(12, R * 0.05)), hue, 0.5, 0.85);
      y += 24;
    }
    const list = Object.entries(run.players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((p, q) => q.score - p.score)
      .slice(0, 4);
    const rowW = Math.min(360, R * 1.5);
    if (list.length > 1) {
      for (const p of list.slice(0, Math.max(0, Math.min(4, Math.floor(room() / 24))))) {
        const x = cx - rowW / 2;
        vec.begin();
        shipIcon(vec, p.ship, x + 10, y + 7, 8);
        vec.glow(p.id === s.room.me.id ? WHITE : hue, 1, 0.8);
        app.nameText(p.n || 'PLAYER', x + 26, y, rowW * 0.55, false);
        vec.text(`${p.score}`, x + rowW, y + 1, 11, WHITE, 1, 0.9);
        y += 24;
      }
    }
    for (const u of (app.unlocked || []).slice(0, 3)) {
      if (room() < 18) break;
      vec.text(`NEW ${u}`, cx, y, 12, WHITE, 0.5, 0.95);
      y += 20;
    }
    if (s.isHost) buttons.push({ id: 'tohub', x: W - 12 - 96, y: 8, w: 96, h: 44, label: 'SHIPS', small: true });
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 80, w: 220, h: 56, label: 'AGAIN', key: 'ENTER' });
    return buttons;
  }

  // ---------------------------------------------------------------- pause and closed

  pause(vec, W, H, t, hue) {
    vec.text('PAUSED', W / 2, H * 0.32, Math.min(40, W / 9), WHITE, 0.5, 1);
    const bw = Math.min(240, W * 0.7);
    return [
      { id: 'resume', x: W / 2 - bw / 2, y: H * 0.48, w: bw, h: 56, label: 'RESUME', key: 'ESC' },
      { id: 'quit', x: W / 2 - bw / 2, y: H * 0.48 + 68, w: bw, h: 48, label: 'END RUN' },
    ];
  }

  closed(vec, W, H, t, hue, reason) {
    const msg = { kicked: 'YOU WERE REMOVED', replaced: 'PLAYING IN ANOTHER TAB', disconnected: 'CONNECTION LOST', moved: 'MOVED', left: 'LEFT' }[reason] || 'CONNECTION LOST';
    const label = { kicked: 'PLAY', replaced: 'PLAY HERE', disconnected: 'REJOIN' }[reason] || 'REJOIN';
    vec.text(msg, W / 2, H * 0.36, Math.min(26, W / 16), WHITE, 0.5, 0.95);
    const bw = Math.min(240, W * 0.7);
    return [{ id: 'rejoin', x: W / 2 - bw / 2, y: H * 0.5, w: bw, h: 56, label, key: 'ENTER' }];
  }

  connecting(vec, W, H, t, hue) {
    const dots = '.'.repeat(1 + (Math.floor(t * 3) % 3));
    vec.text(`TUNING${dots}`, W / 2, H * 0.45, 16, hue, 0.5, 0.8);
    return [];
  }
}

const tmp1 = [0, 0];
const tmp2 = [0, 0];

export { CAUSE, strokeable };
