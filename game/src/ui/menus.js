// The game's own screens, drawn in the stroke font: the title, the hub (ships, mode, Overclock, look), the draft
// between zones, the results, the pause card and the room-closed card. Each screen returns the buttons it shows this
// frame; the platform's Ready / Start strip sits under the lobby screens (their bottom 96 px stay clear).
import { SHIPS, MODS, WORLDS, OVERCLOCK, LEVELS_PER_WORLD } from '../sim/data.js';
import { MODE_NAMES, TEMPOS, draftOptions, zoneFor, zoneLabel, dailyFor, dayOf } from '../sim/run.js';
import { SHIP_SHAPES } from '../render/shapes.js';
import { TINTS, TRAILS, RIMS, TAPES, shipUnlocked, unlockLabel, needLabel, met, ocAllowed } from '../sim/profile.js';
import { MOD_ICONS, iconPath } from './icons.js';
import { DEATH_NAMES } from '../sim/world.js';
import { strokeable } from '../render/vector.js';

const WHITE = '#ffffff';
const MODE_TAG = { run: 'SIX WORLDS', descent: 'NO BOTTOM', daily: 'TODAY ONLY', practice: 'ONE ZONE' };
const ADVICE = {
  FLIPPER: 'KEEP FIRING AS THEY LAND',
  SHOT: 'SHOOT THE SHOTS DOWN',
  PULSAR: 'LEAVE ON THE BUILD-UP',
  MINE: 'SHOOT MINES BEFORE ZERO',
  SPIKE: 'CLEAR SPIKES BEFORE THE WARP',
  FUSEBALL: 'HIT THEM MID-LANE',
  GHOST: 'THEY BITE ON THE BEAT',
  WEAVER: 'MEET THEM AT A LANE',
  SIREN: 'KILL THE CHOIR TOGETHER',
  BOMBER: 'DOWN BOMBERS EARLY',
  BOSS: 'WATCH THE LIT LANES',
  TIDE: 'STAY IN THE DRY HALF',
};
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
  }

  /** Space for lobby screens: below the platform's buttons, above its Ready strip. */
  area(W, H, lobby = true) {
    const top = 62;
    const bottom = lobby ? 100 : 24;
    return { x: Math.max(12, W * 0.04), y: top, w: W - 2 * Math.max(12, W * 0.04), h: Math.max(200, H - top - bottom) };
  }

  // ---------------------------------------------------------------- title

  title(vec, W, H, t, hue) {
    const app = this.app;
    const size = Math.min(W / 8.5, H / 7, 92);
    const y = H * 0.3;
    // The logo: a heavy stroke with a slow shimmer along it.
    // The logo: an outline in the world's colour with a thin white-hot line inside it, like a tube drawn twice.
    vec.text('RIMSHOT', W / 2, y - size / 2, size, hue, 0.5, 0.95, 0.75);
    vec.text('RIMSHOT', W / 2 + 1.5, y - size / 2 + 1.5, size, WHITE, 0.5, 0.35 + (app.calm ? 0 : 0.12 * Math.sin(t * 2.4)), 0.22);
    const best = app.profile.best;
    if (best > 0) vec.text(`BEST ${best}`, W / 2, y + size * 0.75, Math.max(10, size * 0.16), hue, 0.5, 0.7);
    const bw = Math.min(260, W * 0.6);
    const bh = 66;
    const buttons = [{ id: 'play', x: W / 2 - bw / 2, y: H * 0.62, w: bw, h: bh, label: 'PLAY', key: 'ENTER', big: true }];
    if (app.joinedRunning) vec.text('FRIENDS ARE PLAYING', W / 2, H * 0.62 + bh + 18, 11, WHITE, 0.5, 0.6);
    return buttons;
  }

  // ---------------------------------------------------------------- hub

  hub(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const prof = app.profile;
    const host = s.isHost;
    const hub = s.hub;
    const a = this.area(W, H);
    const wide = W >= H * 1.1 && W >= 720;
    const buttons = [];
    if (this.look) return this.lookPanel(vec, W, H, t, hue, a);
    // Players across the top.
    const players = this.playersRow(vec, a.x, a.y, a.w, hue, buttons, true);
    let y = a.y + players + 10;
    const colW = wide ? a.w * 0.52 : a.w;
    const rightX = wide ? a.x + a.w * 0.56 : a.x;
    // Ships.
    vec.text('SHIP', a.x, y, 11, hue, 0, 0.7);
    y += 18;
    const cols = 3;
    const gap = 8;
    const cw = (colW - gap * (cols - 1)) / cols;
    const ch = Math.max(56, Math.min(wide ? 118 : 86, cw * 0.82));
    const daily = hub.mode === 'daily' ? dailyFor(dayOf(app.now())) : null;
    for (let i = 0; i < SHIPS.length; i++) {
      const cx = a.x + (i % cols) * (cw + gap);
      const cy = y + Math.floor(i / cols) * (ch + gap);
      const open = shipUnlocked(prof, i);
      const chosen = daily ? daily.ship === i : s.myShip === i;
      buttons.push({
        id: `ship:${i}`,
        x: cx,
        y: cy,
        w: cw,
        h: ch,
        on: chosen,
        off: !open || Boolean(daily),
        aria: open ? SHIPS[i].name : `${SHIPS[i].name} locked`,
        draw: (v, b, lit, k) => {
          v.begin();
          shipIcon(v, i, b.x + b.w / 2, b.y + b.h * 0.42, Math.min(b.w, b.h) * 0.24);
          v.glow(chosen ? WHITE : hue, 1.4, open ? (chosen ? 1 : 0.75) : 0.25);
          const nameSize = Math.min(13, b.w / 9);
          v.text(SHIPS[i].name, b.x + b.w / 2, b.y + b.h - 30, nameSize, chosen ? WHITE : hue, 0.5, open ? 0.95 : 0.4);
          const tag = open ? SHIPS[i].tag : unlockLabel(i);
          v.text(tag, b.x + b.w / 2, b.y + b.h - 13, Math.min(9, (b.w - 10) / Math.max(8, tag.length * 0.95)), WHITE, 0.5, open ? 0.6 : 0.7);
        },
      });
    }
    y += 2 * (ch + gap) + 8;
    // Mode, Overclock, practice, look: on the right in a wide window, under the ships otherwise.
    let ry = wide ? a.y + players + 10 : y;
    const rw = wide ? a.w * 0.44 : a.w;
    vec.text('MODE', rightX, ry, 11, hue, 0, 0.7);
    ry += 18;
    const modes = ['run', 'descent', 'daily', 'practice'];
    const mw = (rw - gap) / 2;
    const mh = 44;
    if (host) {
      modes.forEach((m, i) => {
        buttons.push({
          id: `mode:${m}`,
          x: rightX + (i % 2) * (mw + gap),
          y: ry + Math.floor(i / 2) * (mh + gap),
          w: mw,
          h: mh,
          on: hub.mode === m,
          label: MODE_NAMES[m],
        });
      });
      ry += 2 * (mh + gap) + 2;
    } else {
      vec.text(MODE_NAMES[hub.mode], rightX, ry + 4, 16, WHITE, 0, 0.9);
      ry += 30;
    }
    vec.text(MODE_TAG[hub.mode], rightX, ry, 9, WHITE, 0, 0.5);
    ry += 18;
    if (hub.mode === 'run' || hub.mode === 'descent') {
      const max = host ? ocAllowed(prof) : 8;
      const oc = Math.min(hub.oc, Math.max(max, hub.oc));
      ry = this.stepper(vec, buttons, 'oc', rightX, ry, rw, `OVERCLOCK ${oc}`, OVERCLOCK[oc].rule || 'OFF', host, oc > 0, host && oc < max, hue);
    }
    if (hub.mode === 'practice') {
      ry = this.stepper(vec, buttons, 'pw', rightX, ry, rw, WORLDS[hub.pw].name, '', host, hub.pw > 0, host && hub.pw < 5 + (prof.deepest >= 8 ? 2 : 0), hue);
      ry = this.stepper(vec, buttons, 'pl', rightX, ry, rw, hub.pl >= 4 ? 'BOSS' : `ZONE ${hub.pl}`, '', host, hub.pl > 1, host && hub.pl < LEVELS_PER_WORLD, hue);
      ry = this.stepper(vec, buttons, 'pt', rightX, ry, rw, `TEMPO ${Math.round(TEMPOS[hub.pt] * 100)}%`, '', host, hub.pt > 0, host && hub.pt < TEMPOS.length - 1, hue);
    }
    if (hub.mode === 'daily') {
      const best = prof.daily.day === dayOf(app.now()) ? prof.daily.best : 0;
      vec.text(best ? `TODAY ${best}` : 'NOT PLAYED TODAY', rightX, ry, 10, WHITE, 0, 0.6);
      ry += 22;
    }
    // Look and Calm.
    const lw = (rw - gap) / 2;
    buttons.push({ id: 'look', x: rightX, y: ry, w: lw, h: 44, label: 'LOOK' });
    buttons.push({ id: 'calm', x: rightX + lw + gap, y: ry, w: lw, h: 44, label: app.calmSetting ? 'CALM ON' : 'CALM OFF', on: app.calmSetting });
    ry += 52;
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 84, w: 220, h: 56, label: 'START', key: 'ENTER' });
    return buttons;
  }

  /** ◀ value ▶ with a line under it. Returns the next y. */
  stepper(vec, buttons, id, x, y, w, label, sub, can, canDown, canUp, hue) {
    const bw = 44;
    if (can) {
      buttons.push({ id: `${id}:-`, x, y, w: bw, h: 44, label: '◀', off: !canDown, aria: `${label} down` });
      buttons.push({ id: `${id}:+`, x: x + w - bw, y, w: bw, h: 44, label: '▶', off: !canUp, aria: `${label} up` });
    }
    vec.text(label, x + w / 2, y + 12, Math.min(15, (w - 2 * bw) / Math.max(6, label.length * 0.9)), WHITE, 0.5, 0.95);
    if (sub) vec.text(sub, x + w / 2, y + 32, 8, hue, 0.5, 0.65);
    return y + 52;
  }

  /** The players in the room, with their ships and ready marks; empty seats invite. Returns its height. */
  playersRow(vec, x, y, w, hue, buttons, lobby) {
    const app = this.app;
    const room = app.session.room;
    const list = room ? [...room.players.values()].slice(0, 4) : [];
    const n = 4;
    const gap = 8;
    const cw = (w - gap * (n - 1)) / n;
    const h = 40;
    for (let i = 0; i < n; i++) {
      const px = x + i * (cw + gap);
      const p = list[i];
      if (!p) {
        if (lobby && app.platformPresent) buttons.push({ id: `invite:${i}`, x: px, y, w: cw, h, label: 'INVITE', small: true });
        else {
          vec.begin();
          vec.move(px, y + h);
          vec.to(px + cw, y + h);
          vec.thin(hue, 1, 0.2);
        }
        continue;
      }
      const ship = Number.isInteger(p.presence?.sh) ? Math.max(0, Math.min(SHIPS.length - 1, p.presence.sh)) : 0;
      vec.begin();
      shipIcon(vec, ship, px + 16, y + h / 2, 11);
      vec.glow(p.id === room.me.id ? WHITE : hue, 1.1, p.connected === false ? 0.3 : 0.85);
      app.nameText(p.name || 'PLAYER', px + 32, y + h / 2 - 7, cw - 40, p.id === room.host);
      const ready = p.ready || p.id === room.host;
      if (ready && app.session.match.phase === 'lobby') {
        vec.begin();
        vec.move(px + cw - 16, y + h / 2 + 8);
        vec.to(px + cw - 11, y + h / 2 + 13);
        vec.to(px + cw - 3, y + h / 2 + 3);
        vec.glow(WHITE, 1.2, 0.9);
      }
      if (p.presence?.dp === 1 && app.session.lobbyScreen() === 'draft') vec.text('PICKED', px + 32, y + h / 2 + 7, 7, hue, 0, 0.7);
    }
    return h;
  }

  lookPanel(vec, W, H, t, hue, a) {
    const app = this.app;
    const p = app.profile;
    const buttons = [];
    let y = a.y + 6;
    vec.text('LOOK', W / 2, y, 18, WHITE, 0.5, 0.95);
    y += 36;
    const rows = [
      ['tint', 'SHIP', TINTS],
      ['trail', 'TRAIL', TRAILS],
      ['rim', 'RIM', RIMS],
      ['tape', 'FALL', TAPES],
    ];
    const w = Math.min(420, a.w);
    const x = W / 2 - w / 2;
    for (const [key, label, list] of rows) {
      const cur = p[key];
      const item = list[cur];
      vec.text(label, x, y + 14, 10, hue, 0, 0.7);
      const ix = x + 70;
      const iw = w - 70;
      buttons.push({ id: `${key}:-`, x: ix, y, w: 44, h: 44, label: '◀', aria: `${label} previous` });
      buttons.push({ id: `${key}:+`, x: ix + iw - 44, y, w: 44, h: 44, label: '▶', aria: `${label} next` });
      const col = key === 'tint' ? item.hex : WHITE;
      vec.text(item.name, ix + iw / 2, y + 10, 13, col, 0.5, 0.95);
      // What the next locked one needs.
      const next = list.find((x2, i) => i > 0 && !met(p, x2.need));
      if (next) vec.text(`NEXT: ${needLabel(next.need)}`, ix + iw / 2, y + 30, 7, WHITE, 0.5, 0.45);
      y += 58;
    }
    buttons.push({ id: 'look:done', x: W / 2 - 90, y: y + 6, w: 180, h: 50, label: 'DONE', key: 'ESC' });
    return buttons;
  }

  // ---------------------------------------------------------------- draft

  draft(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const run = s.run;
    const buttons = [];
    if (!run) return buttons;
    const a = this.area(W, H);
    const me = s.room.me.id;
    const mine = run.players[me];
    const playersH = this.playersRow(vec, a.x, a.y, a.w, hue, buttons, true);
    let y = a.y + playersH + 14;
    const done = zoneFor(run, run.idx - 1);
    const next = zoneFor(run, run.idx);
    vec.text(`${zoneLabel(done)} CLEAR`, W / 2, y, Math.min(26, W / 14), WHITE, 0.5, 1);
    y += Math.min(26, W / 14) + 12;
    const nextName = next.level >= 4 ? `NEXT: ${WORLDS[next.world].name} BOSS` : `NEXT: ZONE ${zoneLabel(next)}`;
    vec.text(nextName, W / 2, y, 11, hue, 0.5, 0.85);
    y += 22;
    vec.text(`SHIPS ${run.lives}   SCORE ${run.score}`, W / 2, y, 10, WHITE, 0.5, 0.6);
    y += 26;
    if (!mine) {
      // Someone new: a ship first (mods come from the next draft).
      vec.text('PICK A SHIP', W / 2, y, 14, WHITE, 0.5, 0.9);
      y += 26;
      const cols = Math.min(6, Math.floor(a.w / 96));
      const cw = Math.min(110, (a.w - 8 * (cols - 1)) / cols);
      const x0 = W / 2 - (cols * cw + 8 * (cols - 1)) / 2;
      for (let i = 0; i < SHIPS.length; i++) {
        const open = shipUnlocked(app.profile, i);
        const bx = x0 + (i % cols) * (cw + 8);
        const by = y + Math.floor(i / cols) * (cw * 0.8 + 8);
        buttons.push({
          id: `ship:${i}`,
          x: bx,
          y: by,
          w: cw,
          h: cw * 0.8,
          on: s.myShip === i,
          off: !open,
          aria: SHIPS[i].name,
          draw: (v, b) => {
            v.begin();
            shipIcon(v, i, b.x + b.w / 2, b.y + b.h * 0.42, b.h * 0.26);
            v.glow(s.myShip === i ? WHITE : hue, 1.3, open ? 0.85 : 0.25);
            v.text(SHIPS[i].name, b.x + b.w / 2, b.y + b.h - 16, 9, WHITE, 0.5, open ? 0.8 : 0.3);
          },
        });
      }
      return buttons;
    }
    const key = `${run.rid}.${run.idx}`;
    const options = draftOptions(run, me, run.idx - 1, mine.mods, run.roster.length > 1);
    const picked = s.pickedKey === key ? s.pickedMod : null;
    vec.text(options.length ? 'PICK ONE' : 'NOTHING LEFT TO LEARN', W / 2, y, 12, WHITE, 0.5, 0.85);
    y += 24;
    const wide = W >= 640;
    const n = Math.max(1, options.length);
    const gap = 10;
    const cw = wide ? Math.min(230, (a.w - gap * (n - 1)) / n) : Math.min(a.w, 420);
    const chh = wide ? Math.min(200, a.y + a.h - y - 60) : Math.min(92, (a.y + a.h - y - 50 - gap * (n - 1)) / n);
    const x0 = wide ? W / 2 - (n * cw + gap * (n - 1)) / 2 : W / 2 - cw / 2;
    options.forEach((k, i) => {
      const def = MODS.find((m) => m.key === k);
      const have = mine.mods[k] || 0;
      const bx = wide ? x0 + i * (cw + gap) : x0;
      const by = wide ? y : y + i * (chh + gap);
      buttons.push({
        id: `mod:${k}`,
        x: bx,
        y: by,
        w: cw,
        h: chh,
        on: picked === k,
        aria: `${def.name}: ${def.tag}`,
        draw: (v, b, lit) => {
          const on = picked === k;
          const col = on || lit ? WHITE : hue;
          const icon = Math.min(b.h * (wide ? 0.32 : 0.5), 56);
          v.begin();
          if (wide) iconPath(v, MOD_ICONS[k] || [], b.x + b.w / 2 - icon / 2, b.y + 18, icon);
          else iconPath(v, MOD_ICONS[k] || [], b.x + 14, b.y + b.h / 2 - icon / 2, icon);
          v.glow(col, 1.3, 0.95);
          const tx = wide ? b.x + b.w / 2 : b.x + icon + 28;
          const al = wide ? 0.5 : 0;
          const ty = wide ? b.y + icon + 34 : b.y + b.h / 2 - 16;
          const name = have ? `${def.name} ${'I'.repeat(have + 1)}` : def.name;
          v.text(name, tx, ty, Math.min(16, (b.w - (wide ? 16 : icon + 40)) / Math.max(5, name.length * 0.95)), col, al, 1);
          v.text(def.tag, tx, ty + 24, Math.min(10, (b.w - (wide ? 16 : icon + 40)) / Math.max(8, def.tag.length * 0.92)), WHITE, al, 0.7);
        },
      });
    });
    // What you carry.
    const carry = Object.entries(mine.mods)
      .map(([k, c]) => `${MODS.find((m) => m.key === k)?.name || k}${c > 1 ? ` ${'I'.repeat(c)}` : ''}`)
      .join(' · ');
    if (carry) this.wrapText(vec, carry, W / 2, a.y + a.h - 18, a.w, 8, hue, 0.55);
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 84, w: 220, h: 56, label: 'GO', key: 'ENTER' });
    return buttons;
  }

  wrapText(vec, text, cx, y, w, size, col, bright) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (vec.measure(next, size) > w && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    lines.slice(-3).forEach((l, i, arr) => vec.text(l, cx, y - (arr.length - 1 - i) * (size + 6), size, col, 0.5, bright));
  }

  // ---------------------------------------------------------------- results

  results(vec, W, H, t, hue) {
    const app = this.app;
    const s = app.session;
    const run = s.run;
    const buttons = [];
    if (!run) return buttons;
    const a = this.area(W, H);
    let y = a.y + 8;
    const r = run.result || { cleared: false, cause: 0, zone: '', depth: run.idx };
    const big = Math.min(46, W / 9);
    let title = r.cleared ? 'RUN CLEAR' : 'GAME OVER';
    if (run.mode === 'descent') title = `DEPTH ${r.depth}`;
    if (run.mode === 'practice') title = r.cleared ? 'ZONE CLEAR' : 'PRACTICE OVER';
    vec.text(title, W / 2, y, big, r.cleared ? WHITE : hue, 0.5, 1, 1.3);
    y += big + 16;
    const cause = DEATH_NAMES[r.cause];
    if (!r.cleared && (cause || r.ended)) {
      vec.text(`${r.ended ? 'ENDED' : CAUSE[cause] || cause} · ZONE ${r.zone}`, W / 2, y, 11, WHITE, 0.5, 0.8);
      if (!r.ended && ADVICE[cause]) vec.text(ADVICE[cause], W / 2, y + 18, 9, hue, 0.5, 0.7);
    }
    y += 40;
    vec.text(String(run.score), W / 2, y, Math.min(34, W / 12), hue, 0.5, 1);
    y += Math.min(34, W / 12) + 10;
    const best = run.mode === 'descent' ? app.profile.bestDescent : app.profile.best;
    if (app.newBest) vec.text('NEW BEST', W / 2, y, 12, WHITE, 0.5, app.calm ? 0.9 : 0.6 + 0.4 * Math.abs(Math.sin(t * 2.5)));
    else if (best) vec.text(`BEST ${best}`, W / 2, y, 10, WHITE, 0.5, 0.55);
    y += 30;
    // The team, best first.
    const list = Object.entries(run.players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((p, q) => q.score - p.score)
      .slice(0, 4);
    for (const p of list) {
      const rowW = Math.min(420, a.w);
      const x = W / 2 - rowW / 2;
      vec.begin();
      shipIcon(vec, p.ship, x + 12, y + 8, 9);
      vec.glow(p.id === s.room.me.id ? WHITE : hue, 1, 0.8);
      app.nameText(p.n || 'PLAYER', x + 28, y + 1, rowW * 0.42, false);
      vec.text(`${p.score}`, x + rowW, y + 2, 11, WHITE, 1, 0.85);
      vec.text(`${p.kills} KILLS · ${p.chords} CHORDS`, x + rowW * 0.62, y + 3, 7, hue, 1, 0.55);
      y += 26;
    }
    y += 8;
    for (const u of (app.unlocked || []).slice(0, 4)) {
      vec.text(`NEW ${u}`, W / 2, y, 10, WHITE, 0.5, 0.9);
      y += 20;
    }
    const bw = 170;
    if (s.isHost) buttons.push({ id: 'tohub', x: W / 2 - bw / 2, y: Math.min(H - 160, Math.max(y + 10, a.y + a.h - 50)), w: bw, h: 48, label: 'SHIPS' });
    if (!app.platformPresent) buttons.push({ id: 'start', x: W / 2 - 110, y: H - 84, w: 220, h: 56, label: 'AGAIN', key: 'ENTER' });
    return buttons;
  }

  // ---------------------------------------------------------------- pause and closed

  pause(vec, W, H, t, hue) {
    vec.text('PAUSED', W / 2, H * 0.32, Math.min(40, W / 9), WHITE, 0.5, 1);
    const bw = Math.min(240, W * 0.7);
    return [
      { id: 'resume', x: W / 2 - bw / 2, y: H * 0.48, w: bw, h: 56, label: 'RESUME', key: 'ESC' },
      { id: 'quit', x: W / 2 - bw / 2, y: H * 0.48 + 68, w: bw, h: 48, label: 'END RUN', small: false },
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

export { CAUSE, strokeable };
