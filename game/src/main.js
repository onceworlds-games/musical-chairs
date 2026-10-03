// Rimshot: boot, the frame loop and the screens. The room is joined as the page loads (before anything heavy), the
// title's one button starts the sound, and from then on what the screen shows is derived from the room every frame.
import { platform } from './platform.js';
import { Vector, strokeable } from './render/vector.js';
import { View } from './render/view.js';
import { Fx } from './render/fx.js';
import { Hud } from './render/hud.js';
import { SHAPE, SHIP_SHAPES } from './render/shapes.js';
import { Buttons } from './ui/buttons.js';
import { Menus } from './ui/menus.js';
import { Input } from './input.js';
import { Engine } from './audio/engine.js';
import { Music } from './audio/music.js';
import { Session } from './net/session.js';
import { Play } from './play.js';
import { World, PHASE } from './sim/world.js';
import { Bot } from './sim/bot.js';
import { WORLDS, E, STEPS_PER_BAR } from './sim/data.js';
import { parseProfile, recordRun, SAVE_KEY, TINTS, TRAILS, RIMS, TAPES, met, shipUnlocked, ocAllowed } from './sim/profile.js';
import { zoneFor, TEMPOS } from './sim/run.js';
import { runPoster } from './poster.js';
import { RIM_ORDER } from './ui/menus.js';

const params = new URLSearchParams(location.search);
const WHITE = '#ffffff';

class App {
  constructor() {
    this.canvas = document.getElementById('screen');
    this.vec = new Vector(this.canvas);
    this.fx = new Fx();
    this.view = new View(this.vec, this.fx);
    this.hud = new Hud(this.vec);
    this.engine = new Engine();
    this.music = new Music(this.engine);
    this.input = new Input(this.canvas, this.view);
    this.input.platformTouch = () => platform.touch;
    this.buttons = new Buttons(document.getElementById('hits'), (id, b) => this.press(id, b));
    this.menus = new Menus(this);
    this.session = new Session(this);
    this.play = new Play(this);
    this.profile = parseProfile(null);
    this.started = false;
    this.paused = false;
    this.menuOpen = false; // the platform's menu
    this.awarded = new Set();
    this.tally = { rid: '', perfect: 0, od: 0 }; // this run's Perfect Bars and Overdrives, for the profile
    this.unlocked = [];
    this.newBest = false;
    this.saveAt = 0;
    this.dirty = false;
    this.last = performance.now();
    this.t = 0;
    this.W = 1;
    this.H = 1;
    this.screen = 'connecting';
    this.attract = null;
    this.attractBot = null;
    this.controlsShown = null;
    this.ctx2d = this.vec.ctx;
  }

  // ---------------------------------------------------------------- settings

  get calmSetting() {
    return this.profile.calm;
  }
  get calm() {
    return this.profile.calm || platform.reducedMotion;
  }
  get platformPresent() {
    return platform.present;
  }
  get myTint() {
    return TINTS[this.profile.tint]?.hex || WHITE;
  }
  now() {
    return platform.now();
  }

  // ---------------------------------------------------------------- boot

  async boot() {
    this.resize();
    addEventListener('resize', () => this.resize());
    try {
      visualViewport?.addEventListener('resize', () => this.resize());
    } catch {}
    platform.onSettings(() => {
      this.applyQuality();
      this.resize();
    });
    platform.on('pause', () => {
      this.menuOpen = true;
      this.engine.setDuck(true);
      if (this.screen === 'play' && this.session.solo) this.setPaused(true);
    });
    platform.on('resume', () => {
      this.menuOpen = false;
      if (!this.paused) this.engine.setDuck(false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.screen === 'play' && this.session.solo) this.setPaused(true);
        this.flush();
      } else this.engine.wake();
    });
    addEventListener('pagehide', () => this.flush());
    // Join first, so a reload or an invite lands in its seat at once; the save loads meanwhile.
    const joining = this.session.connect();
    const saved = await platform.save.get(SAVE_KEY);
    this.profile = parseProfile(saved);
    this.session.myShip = this.profile.ship;
    this.session.myTint = this.profile.tint;
    this.session.myTrail = this.profile.trail;
    this.input.autofire = this.profile.autofire;
    this.applyQuality();
    await joining;
    // The test hook: ?test (standalone) or a 'rimshot:test' event (inside the platform's frame) hands a script the app,
    // and 'bot' puts an autopilot on the controls. Nothing is exposed until asked for.
    const hook = (mode) => {
      window.__rimshot = this;
      if (mode === 'bot') this.autopilot = new Bot('expert', 99);
    };
    if (params.has('test')) hook(params.get('test'));
    addEventListener('rimshot:test', (e) => hook(e?.detail));
    requestAnimationFrame((t) => this.frame(t));
  }

  applyQuality() {
    const q = platform.quality;
    this.vec.quality = q === 'low' ? 'low' : q === 'medium' ? 'medium' : 'high';
    this.fx.scale = (q === 'low' ? 0.45 : q === 'medium' ? 0.75 : 1) * (this.calm ? 0.6 : 1);
  }

  resize() {
    const vv = typeof visualViewport !== 'undefined' && visualViewport ? visualViewport : null;
    const W = Math.max(1, Math.round(vv?.width || innerWidth || 1));
    const H = Math.max(1, Math.round(vv?.height || innerHeight || 1));
    this.W = W;
    this.H = H;
    const pr = platform.pixelRatio(2);
    this.vec.resize(W, H, pr);
    this.layoutView();
  }

  /** A phone held sideways: the screen is wider than it is tall and has under 520 px of height. */
  get short() {
    return this.H < 520 && this.W > this.H;
  }

  layoutView() {
    const touch = platform.touch || this.input.usedTouch;
    const short = this.short;
    if (this.screen === 'title' || this.screen === 'connecting' || this.screen === 'closed' || this.screen === 'wait') this.view.layout(this.W, this.H, 16, 16);
    // The lobby keeps the players' row above the tunnel and the platform's Ready strip below it (on a short screen the
    // tunnel is a backdrop and the words go in a column over it).
    else if (this.screen === 'lobby') short ? this.view.layout(this.W, this.H, 20, 20) : this.view.layout(this.W, this.H, 112, 112);
    else if (short) this.view.layout(this.W, this.H, 34, 52);
    else this.view.layout(this.W, this.H, this.W < 520 ? 92 : 64, touch ? 96 : 52);
  }

  // ---------------------------------------------------------------- saves

  saveSoon() {
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    this.saveAt = performance.now();
    platform.save.set(SAVE_KEY, this.profile);
  }

  award(id) {
    if (this.awarded.has(id)) return;
    this.awarded.add(id);
    platform.award(id);
  }

  wantHints() {
    const h = this.profile.hints;
    return ['move', 'fire', 'hop', 'zap', 'spike'].some((k) => (h[k] || 0) < 3);
  }

  hint(kind, texts) {
    if (!texts) return;
    const h = this.profile.hints;
    if ((h[kind] || 0) >= 3) return;
    const device = platform.touch || this.input.lastDevice === 'touch' ? 'touch' : this.input.lastDevice === 'pad' ? 'pad' : this.input.lastDevice === 'mouse' ? 'mouse' : 'keys';
    const text = texts.all || texts[device];
    if (!text) return;
    h[kind] = (h[kind] || 0) + 1;
    this.hud.showHint(text);
    this.saveSoon();
  }

  // ---------------------------------------------------------------- the frame

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;
    try {
      this.step(dt);
    } catch (err) {
      // One bad frame must not stop the game: say so once, and keep going.
      if (!this.reported) {
        this.reported = true;
        console.error(err);
      }
    }
    if (this.dirty && performance.now() - this.saveAt > 4000) this.flush();
  }

  step(dt) {
    const s = this.session;
    // The window moved to a screen with another pixel density (no resize event says so).
    const pr = platform.pixelRatio(2);
    if (Math.abs(pr - this.vec.pr) > 0.01) this.resize();
    s.screen = this.screenCode();
    s.update();
    const prev = this.screen;
    this.screen = this.decide();
    if (prev !== this.screen) this.enterScreen(prev, this.screen);
    this.fx.update(dt);
    this.hud.update(dt);
    const vec = this.vec;
    vec.calm = this.calm;
    const playing = this.screen === 'play' || this.screen === 'watch';
    vec.frame(dt, playing ? 1 : 0.8);
    let buttons = [];
    if (playing) {
      this.drawPlay(dt);
      if (this.paused) {
        this.dim(0.55);
        buttons = this.menus.pause(vec, this.W, this.H, this.t, this.play.hue);
        if (this.input.take('pause')) this.setPaused(false);
      } else if (this.input.take('pause') && s.solo && this.screen === 'play') this.setPaused(true);
      this.input.take('confirm');
    } else {
      this.drawBackdrop(dt);
      buttons = this.drawMenu();
    }
    this.buttons.set(buttons);
    this.soundHint(dt);
    this.buttons.draw(vec, this.hue(), this.t, this.calm, platform.touch || this.input.usedTouch);
    if (this.play.flash > 0) {
      // A zap: one soft glow round the ship that fades over a fifth of a second. Never a wash of the whole screen
      // (a flash may not cover a third of it) and never twice in a row.
      const c = vec.ctx;
      const r = Math.min(this.W, this.H) * 0.3;
      const [gx, gy] = this.play.flashAt;
      const k = Math.min(1, this.play.flash / 0.35);
      const g = c.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.2)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = k;
      c.fillStyle = g;
      c.fillRect(gx - r, gy - r, r * 2, r * 2);
      c.globalAlpha = 1;
      this.play.flash = Math.max(0, this.play.flash - dt * 1.8);
    }
    if (!this.started && this.screen !== 'title' && this.screen !== 'closed' && this.screen !== 'connecting' && this.input.take('confirm')) this.press('play');
  }

  /**
   * The sound can be parked after it started (iOS does it for a call, Siri or the lock screen): say so, once it has
   * been so for a moment, and the next touch or key brings it back (Engine.listen). Silent games lose players.
   */
  soundHint(dt) {
    const e = this.engine;
    const stuck = this.started && e.ok && e.ctx && e.ctx.state !== 'running' && !document.hidden;
    this.soundOff = stuck ? (this.soundOff || 0) + dt : 0;
    if (this.soundOff > 1.2 && !this.paused) {
      const v = this.vec;
      v.text('TAP FOR SOUND', this.W / 2, this.short ? 14 : this.screen === 'play' ? Math.max(44, this.H * 0.1 + 26) : this.H - 130, this.W < 440 ? 12 : 14, '#ffffff', 0.5, 0.8 + (this.calm ? 0 : 0.2 * Math.sin(this.t * 4)));
    }
  }

  screenCode() {
    return { title: 't', lobby: this.session.lobbyScreen()[0], play: 'p', watch: 'w', closed: 'c', connecting: 'c', wait: 'p' }[this.screen] || 't';
  }

  /** What the screen is, from the room. */
  decide() {
    const s = this.session;
    if (s.closed) return 'closed';
    if (!s.room) return 'connecting';
    if (!this.started) return 'title';
    if (s.match.phase === 'playing') {
      if (s.world) return s.meIdx >= 0 ? 'play' : 'watch';
      return 'wait';
    }
    return 'lobby';
  }

  enterScreen(prev, next) {
    const s = this.session;
    const playing = next === 'play';
    this.input.enabled = playing;
    if (playing !== (this.controlsShown === 'play')) {
      this.controlsShown = playing ? 'play' : null;
      platform.setControls(
        playing
          ? {
              buttons: [
                { id: 'hop', label: 'Hop', key: 'ArrowUp' },
                { id: 'zap', label: 'Zap', key: 'ArrowDown' },
              ],
            }
          : null,
      );
      this.layoutView();
    }
    if (next !== 'play' && next !== 'watch') {
      this.setPaused(false, true);
      this.engine.setDuck(this.menuOpen);
    }
    // The platform's Ready strip belongs to the lobby screens, not the title.
    try {
      if (next === 'title') s.room?.hideLobby?.(true);
      else if (prev === 'title') s.room?.hideLobby?.(false);
    } catch {}
    this.layoutView();
    // Keys pressed on the last screen do nothing on this one.
    for (const k of ['left', 'right', 'fire', 'confirm', 'pause', 'hop', 'zap']) this.input.edges[k] = false;
    if (next === 'lobby') {
      this.menus.look = false;
      this.recordResults();
      this.progress();
    }
    void prev;
    void s;
  }

  setPaused(on, silent = false) {
    if (this.paused === on) return;
    this.paused = on;
    this.engine.setDuck(on || this.menuOpen);
    if (!silent && this.session.solo && this.screen === 'play') this.session.pause(on);
    if (on) this.input.releaseAll();
  }

  hue() {
    if ((this.screen === 'play' || this.screen === 'watch') && this.play.hue) return this.play.hue;
    return WORLDS[this.attractWorld ?? 0]?.hue || WORLDS[0].hue;
  }

  // ---------------------------------------------------------------- the zone

  onZoneStart(w, zone, run) {
    if (this.tally.rid !== run.rid) this.tally = { rid: run.rid, perfect: 0, od: 0 };
    this.play.begin(w, zone, run);
    this.play.ended = false;
    this.layoutView();
  }

  onZoneEnd() {
    this.play.end();
  }

  onRemoteEvent(ev, w) {
    this.play.remote(ev, w);
  }

  onMatchStart() {
    this.unlocked = [];
    this.newBest = false;
  }

  onMatchEnd() {}

  drawPlay(dt) {
    const s = this.session;
    const w = s.world;
    if (!w) return;
    this.play.frame(dt, this.paused);
    const alpha = Math.max(0, Math.min(1, (this.play.song - w.step * w.dt) / w.dt + 1));
    const tints = w.ships.map((ship) => {
      if (ship.idx === s.meIdx) return this.myTint;
      const p = s.room?.players?.get?.(ship.id)?.presence;
      return TINTS[Number.isInteger(p?.ti) ? p.ti : 0]?.hex || WHITE;
    });
    for (const ship of w.ships) ship.tint = tints[ship.idx];
    this.view.draw({
      w,
      alpha: Math.min(1, alpha),
      t: this.play.song,
      me: s.meIdx,
      tints,
      calm: this.calm,
      pulse: this.play.pulse,
      od: w.overdrive,
      shake: this.play.shake,
      ghostBolts: this.play.ghostBolts,
      rim: RIMS[this.profile.rim]?.key || 'plain',
      trails: w.ships.map((ship) => {
        if (ship.idx === s.meIdx) return TRAILS[this.profile.trail]?.key || 'none';
        const p = s.room?.players?.get?.(ship.id)?.presence;
        return TRAILS[Number.isInteger(p?.tr) ? p.tr : 0]?.key || 'none';
      }),
    });
    this.drawNames(w);
    this.fx.draw(this.vec);
    const me = s.meIdx >= 0 ? w.ships[s.meIdx] : null;
    this.hud.draw({
      W: this.W,
      H: this.H,
      hue: this.play.hue,
      score: Math.round(w.score),
      mult: w.mult,
      lives: w.lives,
      zaps: me ? me.zaps : 0,
      res: w.res,
      od: w.overdrive ? Math.max(0, (w.odUntil - w.step) / (10 / w.dt)) : 0,
      zone: this.play.zone ? `ZONE ${this.zoneText()}` : '',
      boss: w.boss && w.boss.active && !w.boss.down ? { name: w.boss.name, hp: w.boss.hp, max: w.boss.maxHp } : null,
      beat: (this.play.song / (60 / w.bpm)) % 1,
      calm: this.calm,
      touch: platform.touch || this.input.usedTouch,
      watching: this.screen === 'watch',
      practice: this.play.zone?.practice,
      short: this.short,
    });
  }

  zoneText() {
    const z = this.play.zone;
    if (!z) return '';
    const w = z.mode === 'descent' ? Math.floor(z.idx / 4) + 1 : (z.mode === 'daily' ? Math.floor(z.idx / 4) : z.world) + 1;
    return z.level >= 4 ? `${w}-BOSS` : `${w}-${z.level}`;
  }

  /** Other players' names by their ships (the UI face, never the stroke font: names can hold anything). */
  drawNames(w) {
    const s = this.session;
    if (w.ships.length < 2) return;
    const c = this.vec.ctx;
    c.globalCompositeOperation = 'source-over';
    for (const ship of w.ships) {
      if (ship.idx === s.meIdx || ship.gone) continue;
      const p = this.view.P(ship.u, -0.06, [0, 0]);
      const name = s.room?.players?.get?.(ship.id)?.name || '';
      this.nameAt(name, p[0], p[1], 120, ship.tint || WHITE, 0.75);
    }
    c.globalCompositeOperation = 'lighter';
  }

  /** A player's name: stroke font when it can be, the UI face otherwise (any script, emoji). Never HTML. */
  nameText(name, x, y, maxW, host) {
    const clean = String(name || '').slice(0, 24);
    const room = host ? 16 : 0;
    let w;
    if (strokeable(clean) && this.vec.measure(clean, 11) <= maxW - room) {
      w = this.vec.text(clean, x, y + 1, 11, WHITE, 0, 0.9);
    } else {
      const c = this.vec.ctx;
      c.globalCompositeOperation = 'source-over';
      c.font = "600 13px 'Chakra', system-ui, sans-serif";
      c.fillStyle = '#e8fff4';
      c.textBaseline = 'top';
      const text = fit(c, clean, maxW - room);
      c.fillText(text, x, y);
      w = c.measureText(text).width;
      c.globalCompositeOperation = 'lighter';
    }
    if (host) {
      // The host's mark: a small diamond after the name.
      const v = this.vec;
      const cx = x + w + 9;
      const cy = y + 6;
      v.begin();
      v.move(cx, cy - 4);
      v.to(cx + 4, cy);
      v.to(cx, cy + 4);
      v.to(cx - 4, cy);
      v.to(cx, cy - 4);
      v.glow(this.hue(), 1, 0.9);
    }
    return x + w + room;
  }

  nameAt(name, x, y, maxW, col, alpha) {
    const c = this.vec.ctx;
    c.font = "600 11px 'Chakra', system-ui, sans-serif";
    c.fillStyle = col;
    c.globalAlpha = alpha;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(fit(c, String(name).slice(0, 24), maxW), x, y);
    c.textAlign = 'left';
    c.globalAlpha = 1;
  }

  /** Screen-space outline of an enemy at a lane and depth (for its shards). */
  shapePoints(type, lane, z) {
    const f = this.view.frame(lane, z, {});
    const list = SHAPE[type] || SHAPE[E.FLIPPER];
    const out = [];
    for (const st of list) {
      for (let i = 0; i + 3 < st.length; i += 2) out.push(f.cx + st[i] * f.ax + st[i + 1] * f.dx, f.cy + st[i] * f.ay + st[i + 1] * f.dy, f.cx + st[i + 2] * f.ax + st[i + 3] * f.dx, f.cy + st[i + 2] * f.ay + st[i + 3] * f.dy);
    }
    return out;
  }

  shipPoints(type, lane) {
    const f = this.view.frame(lane, 0, {});
    const out = [];
    for (const st of SHIP_SHAPES[type] || SHIP_SHAPES[0]) {
      for (let i = 0; i + 3 < st.length; i += 2) out.push(f.cx + st[i] * f.ax + st[i + 1] * f.dx, f.cy + st[i] * f.ay + st[i + 1] * f.dy, f.cx + st[i + 2] * f.ax + st[i + 3] * f.dx, f.cy + st[i + 2] * f.ay + st[i + 3] * f.dy);
    }
    return out;
  }

  /** The fall sound this player chose. */
  fallSound() {
    return TAPES[this.profile.tape]?.key || 'stop';
  }

  dim(alpha) {
    const c = this.vec.ctx;
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#020403';
    c.globalAlpha = alpha;
    c.fillRect(0, 0, this.W, this.H);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'lighter';
  }

  // ---------------------------------------------------------------- menus and the attract mode behind them

  /** What plays behind the menus: a demo wave on the title, the next zone's web (or the last one's) in the lobby. */
  stageSpec() {
    const s = this.session;
    const run = s.run;
    if (this.screen === 'title' || this.screen === 'connecting' || this.screen === 'closed' || this.screen === 'wait') return { key: 'demo', world: 0, demo: true };
    // The lobby's stage is always a ring of sixteen lanes, in the colour of the world that comes next (or ended).
    if (run && s.match.phase === 'lobby' && run.status === 'draft') {
      const z = zoneFor(run, run.idx);
      return { key: `draft:${run.rid}:${run.idx}`, world: z.world, shape: 'circle' };
    }
    if (run && s.match.phase === 'lobby' && run.status === 'over') {
      const z = zoneFor(run, Math.max(0, run.idx));
      return { key: `over:${run.rid}`, world: z.world, shape: 'circle' };
    }
    return { key: 'hub', world: 0, shape: 'circle' };
  }

  drawBackdrop(dt) {
    const spec = this.stageSpec();
    if (!this.attract || this.stageKey !== spec.key || (spec.demo && this.attract.phase >= PHASE.DONE)) {
      const def = WORLDS[spec.world];
      const shape = spec.shape || def.shapes[Math.floor(Math.random() * def.shapes.length)];
      const zone = { mode: 'run', world: spec.world, level: 1 + Math.floor(Math.random() * 3), shape, bpm: def.bpm, seed: Math.floor(Math.random() * 1e9), oc: 0 };
      this.attract = new World({ zone, players: [{ id: 'bot', ship: Math.floor(Math.random() * 3), mods: { pierce: 1, spread: 1 }, kind: 'bot' }], carry: { lives: 99 } });
      if (!spec.demo) {
        this.attract.spawns = [];
        this.attract.ships[0].gone = true;
      }
      this.attractBot = spec.demo ? new Bot('expert', 7) : null;
      if (spec.demo) {
        // The demo opens mid-wave: things are already climbing on the first frame of the title.
        const w = this.attract;
        const live = () => w.enemies.reduce((n, e) => n + (e.dead ? 0 : 1), 0);
        for (let i = 0; i < 12 * STEPS_PER_BAR && !(w.phase === PHASE.PLAY && live() >= 5); i++) {
          this.attractBot.drive(w, w.ships[0]);
          w.update();
        }
        w.drain();
      }
      this.attractT = this.attract.step * this.attract.dt;
      this.attractWorld = spec.world;
      this.stageKey = spec.key;
      this.view.setWeb(this.attract.web, def.hue, Boolean(def.spin));
      this.music.setWorld(def);
      this.engine.resync();
    }
    const w = this.attract;
    if (this.view.web !== w.web) {
      this.view.setWeb(w.web, WORLDS[this.attractWorld].hue, Boolean(WORLDS[this.attractWorld].spin));
      this.music.setWorld(WORLDS[this.attractWorld]);
      this.engine.resync();
    }
    this.attractT += dt;
    const target = Math.floor(this.attractT / w.dt);
    let n = 0;
    while (w.step < target && n++ < 30) {
      if (this.attractBot) this.attractBot.drive(w, w.ships[0]);
      w.update();
    }
    for (const ev of w.drain()) {
      if (ev.k === 'kill') this.fx.shatter(this.shapePoints(ev.a, ev.lane, ev.z), WORLDS[this.attractWorld].hue, 90, 0.4);
    }
    // The lobby's music: the next world's groove, quietly, on the stage's own clock.
    this.music.setLayer(this.screen === 'title' ? 1 : 0, 0);
    this.engine.sync(this.attractT, w.bpm, false);
    const beat = (this.attractT * w.bpm) / 60;
    this.view.draw({ w, alpha: 1, t: this.attractT, me: -1, tints: [WHITE], calm: this.calm, pulse: this.calm ? 0 : Math.max(0, 1 - (beat % 1) * 2), od: false, shake: null, rim: RIMS[this.profile.rim]?.key || 'plain', trails: [] });
    this.fx.draw(this.vec);
    this.dim(this.screen === 'title' ? 0.12 : this.menus.look ? 0.75 : 0.3);
    // The middle of the tunnel darkens a little so words read over the lanes.
    if (this.screen === 'lobby' && !this.menus.look) {
      const v = this.view;
      const c = this.vec.ctx;
      c.globalCompositeOperation = 'source-over';
      c.save();
      c.translate(v.vx(), v.vy());
      c.scale(v.Sx / v.S, v.Sy / v.S);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, v.S * 0.7);
      g.addColorStop(0, 'rgba(2,4,3,0.82)');
      g.addColorStop(0.75, 'rgba(2,4,3,0.55)');
      g.addColorStop(1, 'rgba(2,4,3,0)');
      c.fillStyle = g;
      c.fillRect(-v.S, -v.S, v.S * 2, v.S * 2);
      c.restore();
      c.globalCompositeOperation = 'lighter';
    }
  }

  drawMenu() {
    const v = this.vec;
    const hue = this.hue();
    const s = this.session;
    switch (this.screen) {
      case 'connecting':
        return this.menus.connecting(v, this.W, this.H, this.t, hue);
      case 'closed':
        return this.menus.closed(v, this.W, this.H, this.t, hue, s.closed);
      case 'title': {
        // The strip comes back by itself when a match starts or ends: keep it off the title.
        if (this.t - (this.hiddenAt || -9) > 1 && s.match.phase === 'lobby') {
          this.hiddenAt = this.t;
          try {
            s.room?.hideLobby?.(true);
          } catch {}
        }
        const b = this.menus.title(v, this.W, this.H, this.t, hue);
        if (this.input.take('confirm') || this.input.take('fire')) this.press('play');
        return b;
      }
      case 'wait':
        v.text('READY', this.W / 2, this.H * 0.45, 20, hue, 0.5, 0.8);
        return [];
      case 'lobby': {
        const screen = s.lobbyScreen();
        if (screen === 'results') this.recordResults(); // once per run (the record may arrive after the lobby)
        if (this.input.take('pause') && this.menus.look) this.menus.look = false;
        if (this.input.take('confirm')) this.press('start');
        const left = this.input.take('left');
        const right = this.input.take('right');
        const fire = this.input.take('fire');
        if (screen === 'draft') {
          if (left || right) this.menus.draftKey(left ? -1 : 1);
          if (fire) this.menus.draftKey(0);
          return this.menus.draft(v, this.W, this.H, this.t, hue);
        }
        if (screen === 'results') return this.menus.results(v, this.W, this.H, this.t, hue);
        if ((left || right) && !this.menus.look) this.cycleShip(left ? -1 : 1);
        return this.menus.hub(v, this.W, this.H, this.t, hue);
      }
    }
    return [];
  }

  press(id) {
    const s = this.session;
    const [kind, arg] = String(id).split(':');
    this.music.tickUi();
    switch (kind) {
      case 'play': {
        if (this.started) return;
        this.started = true;
        this.engine.start();
        // Someone new, alone: straight into their first zone.
        if (this.profile.first && s.solo && s.isHost && s.match.phase === 'lobby' && !s.run) {
          s.setHub({ mode: 'run' });
          setTimeout(() => s.start(), 60);
        }
        return;
      }
      case 'start':
        if (s.isHost) {
          if (!s.start()) this.music.denied();
        } else if (s.match.phase === 'lobby') s.setReady(true);
        return;
      case 'ship': {
        const i = Number(arg);
        if (!shipUnlocked(this.profile, i)) {
          this.menus.flash = { i, at: performance.now() };
          return this.music.denied();
        }
        s.pickShip(i);
        this.profile.ship = i;
        this.saveSoon();
        this.music.pick();
        // Someone new picking their ship in the draft is ready for the next zone.
        const run = s.run;
        if (run && run.status === 'draft' && !run.players[s.room.me.id] && !s.isHost) s.setReady(true);
        return;
      }
      case 'mode':
        s.setHub({ mode: arg });
        return;
      case 'oc':
      case 'pw':
      case 'pl':
      case 'pt': {
        const hub = s.hub;
        const d = arg === '+' ? 1 : -1;
        const max = { oc: ocAllowed(this.profile), pw: this.profile.deepest >= 8 ? 7 : 5, pl: 4, pt: TEMPOS.length - 1 }[kind];
        const min = kind === 'pl' ? 1 : 0;
        s.setHub({ [kind]: Math.max(min, Math.min(max, hub[kind] + d)) });
        return;
      }
      case 'mod':
        if (s.pickMod(arg)) {
          this.music.pick();
          // Alone, the pick is the go: the next zone starts (with friends the host waits for their picks).
          if (s.isHost && s.solo) setTimeout(() => s.start(), 450);
        }
        return;
      case 'invite':
        platform.showInvite();
        return;
      case 'look':
        if (arg === 'done') this.menus.look = false;
        else this.menus.look = true;
        return;
      case 'calm':
        this.profile.calm = !this.profile.calm;
        this.applyQuality();
        this.saveSoon();
        return;
      case 'tint':
      case 'trail':
      case 'rim':
      case 'tape': {
        const list = { tint: TINTS, trail: TRAILS, rim: RIMS, tape: TAPES }[kind];
        let i = this.profile[kind];
        for (let k = 0; k < list.length; k++) {
          i = (i + (arg === '+' ? 1 : -1) + list.length) % list.length;
          if (met(this.profile, list[i].need)) break;
        }
        this.profile[kind] = i;
        if (kind === 'tint') s.myTint = i;
        if (kind === 'trail') s.myTrail = i;
        this.saveSoon();
        return;
      }
      case 'resume':
        this.setPaused(false);
        return;
      case 'quit':
        this.setPaused(false);
        s.quitRun();
        return;
      case 'tohub':
        s.toHub();
        return;
      case 'rejoin':
        this.started = true;
        this.engine.start();
        s.connect();
        return;
    }
  }

  /** Left and right on the hub walk the ships along the rim (skipping locked ones). */
  cycleShip(dir) {
    const s = this.session;
    const order = RIM_ORDER;
    let k = order.indexOf(s.myShip);
    for (let n = 0; n < order.length; n++) {
      k = (k + dir + order.length) % order.length;
      if (shipUnlocked(this.profile, order[k])) break;
    }
    if (order[k] !== s.myShip) this.press(`ship:${order[k]}`);
  }

  // ---------------------------------------------------------------- the run's end, folded into the profile

  progress() {
    const run = this.session.run;
    if (!run || run.mode !== 'run') return;
    const p = this.profile;
    const reached = Math.min(6, Math.floor(run.idx / 4) + 1);
    if (reached > p.reached || run.stats.bosses > p.worldsCleared) {
      p.reached = Math.max(p.reached, reached);
      p.worldsCleared = Math.max(p.worldsCleared, Math.min(6, run.stats.bosses));
      this.saveSoon();
    }
  }

  recordResults() {
    const s = this.session;
    const run = s.run;
    if (!run || run.status !== 'over' || !run.players[s.room.me.id]) return;
    if (this.profile.lastRun === run.rid || !s.shouldRecord(run.rid)) return;
    const tally = this.tally.rid === run.rid ? this.tally : { perfect: 0, od: 0 };
    const me = run.players[s.room.me.id];
    const r = run.result || {};
    const before = run.mode === 'descent' ? this.profile.bestDescent : this.profile.best;
    const { profile, unlocked } = recordRun(this.profile, {
      mode: run.mode,
      score: run.score,
      depth: r.depth ?? run.idx,
      worldsCleared: run.stats.bosses,
      reached: Math.min(6, Math.floor((r.depth ?? run.idx) / 4) + 1),
      cleared: r.cleared,
      oc: run.oc,
      kills: me.kills,
      chords: me.chords,
      perfect: tally.perfect,
      tether: me.tether,
      flawless: run.stats.flawless,
      od: tally.od,
      rid: run.rid,
      day: run.daily?.day,
      mods: Object.keys(me.mods),
    });
    this.profile = profile;
    this.unlocked = unlocked;
    this.newBest = run.mode !== 'practice' && run.score > before && run.score > 0;
    this.saveSoon();
    this.flush();
    if (run.mode === 'run') platform.submit('high-score', run.score);
    if (run.mode === 'descent') {
      platform.submit('descent-score', run.score);
      platform.submit('deepest-level', r.depth ?? run.idx);
      if ((r.depth ?? 0) >= 12) this.award('deep-descent');
    }
    if (run.mode === 'daily') this.award('daily-run');
    if (run.mode === 'run' && r.cleared && run.oc >= 4) this.award('overclock-4');
  }
}

function fit(c, text, maxW) {
  if (c.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && c.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

if (params.has('poster')) runPoster(params.get('poster'));
else new App().boot();
