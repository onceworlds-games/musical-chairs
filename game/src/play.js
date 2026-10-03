// A zone being played (or watched): the song clock, the fixed steps, the local ship's controls, and what every event
// sounds and looks like. The host's page also publishes what happened; a mirror's page sends its own moments up.
import { PHASE, DEATH_NAMES } from './sim/world.js';
import { E, ENEMIES, WORLDS, STEPS_PER_BEAT, STEPS_PER_BAR, TICKS_PER_BAR, COUNTIN_BARS } from './sim/data.js';
import { zoneLabel } from './sim/run.js';
import { laneOf } from './sim/web.js';

const WHITE = '#ffffff';
const HINTS = {
  move: { keys: '← → MOVE', mouse: 'POINT TO MOVE', touch: 'SLIDE TO TURN', pad: 'STICK TO MOVE' },
  fire: { keys: 'HOLD SPACE TO FIRE', mouse: 'HOLD CLICK TO FIRE', touch: '', pad: 'HOLD A TO FIRE' },
  spike: { all: 'SHOOT THE SPIKES' },
  hop: { keys: 'SHIFT TO HOP', mouse: 'RIGHT CLICK TO HOP', touch: 'TAP HOP', pad: 'B TO HOP' },
  zap: { keys: '↓ TO ZAP', mouse: 'WHEEL DOWN TO ZAP', touch: 'TAP ZAP', pad: 'X TO ZAP' },
  dodge: { all: 'DODGE THE SPIKES' },
};
const BOSS_BADGE = { hydra: 'hydra-down', conductor: 'conductor-down', maestro: 'maestro-down' };

export class Play {
  constructor(app) {
    this.app = app;
    this.world = null;
    this.song = 0;
    this.lastRoom = 0;
    this.doneAt = 0;
    this.pulse = 0;
    this.shake = [0, 0];
    this.shakeAmt = 0;
    this.flash = 0;
    this.lastBeat = -1;
    this.ghostBolts = [];
    this.tetherMine = 0;
  }

  begin(w, zone, run) {
    const app = this.app;
    this.world = w;
    this.zone = zone;
    this.run = run;
    this.doneAt = 0;
    this.song = app.session.songTime();
    this.lastBeat = -1;
    this.tetherMine = 0;
    const def = WORLDS[zone.world] || WORLDS[0];
    this.hue = def.hue;
    app.view.setWeb(w.web, def.hue);
    app.music.setWorld(def);
    app.engine.resync();
    app.fx.clear();
    app.hud.clear();
    w.zone.hints = app.wantHints();
    // The count-in's words, on the beat.
    this.saidReady = false;
    this.saidZone = false;
    this.ghostBolts.length = 0;
  }

  end() {
    this.world = null;
  }

  /** The song's clock: the room's match time, smoothed so a clock correction never jerks the picture. */
  clock(dt, paused) {
    const s = this.app.session;
    const room = s.songTime();
    if (paused || s.match.paused) {
      this.song = room;
      return;
    }
    this.song += dt;
    const err = room - this.song;
    if (Math.abs(err) > 0.25) this.song = room;
    else this.song += err * 0.12;
  }

  frame(dt, paused) {
    const app = this.app;
    const s = app.session;
    const w = this.world;
    if (!w) return;
    this.clock(dt, paused);
    const me = s.meIdx >= 0 ? w.ships[s.meIdx] : null;
    // Controls (or, under ?test=bot, an autopilot flying the same inputs).
    if (me && !paused && app.autopilot) {
      app.autopilot.wait = Math.min(app.autopilot.wait, 2);
      app.autopilot.drive(w, me);
    } else if (me && !paused) {
      const intent = app.input.read(me, w.web);
      if (intent.target !== null) me.in.target = intent.target;
      else if (me.in.target === null) me.in.target = Math.round(me.u);
      me.in.fire = intent.fire && me.state === 'live';
      if (intent.hop) me.in.hop = true;
      if (intent.zap) me.in.zap = true;
    }
    s.steerPuppets();
    // Steps, from where the world is to where the song is (a hidden tab catches up a few seconds at most).
    const target = Math.floor(this.song / w.dt);
    let n = 0;
    if (!paused) {
      if (target - w.step > 600) w.step = target - 600;
      while (w.step < target && n++ < 600) {
        w.update();
        if (w.ev.length > 400) this.events(w);
      }
    }
    this.events(w);
    if (w.auth) {
      s.publishSnapshot();
      this.hostEnd(w);
    } else s.sendBatch();
    // Sound follows the song.
    const layer = this.layer(w);
    app.music.setLayer(layer, w.boss && !w.boss.down ? 1 : 0);
    app.engine.sync(Math.max(0, this.song), w.bpm, paused || s.match.paused);
    // Beat pulse for the web and the HUD.
    const beat = Math.floor(this.song / (60 / w.bpm));
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      this.pulse = 1;
    }
    this.pulse = Math.max(0, this.pulse - dt * (w.bpm / 60) * 1.6);
    if (this.shakeAmt > 0) {
      this.shakeAmt = Math.max(0, this.shakeAmt - dt * 30);
      const a = Math.random() * Math.PI * 2;
      this.shake[0] = Math.cos(a) * this.shakeAmt;
      this.shake[1] = Math.sin(a) * this.shakeAmt;
    } else this.shake[0] = this.shake[1] = 0;
    this.countIn(w);
    this.updateGhostBolts(w, dt);
  }

  /** How much of the band plays now. */
  layer(w) {
    if (w.phase === PHASE.COUNTIN) return 1;
    if (w.phase === PHASE.OVER) return 0;
    if (w.overdrive) return 4;
    const crowd = w.enemies.length;
    if (w.mult >= 4 || crowd >= 14 || (w.boss && !w.boss.down)) return 3;
    return 2;
  }

  countIn(w) {
    const hud = this.app.hud;
    const beat = Math.floor(w.step / STEPS_PER_BEAT);
    if (w.phase !== PHASE.COUNTIN) return;
    if (!this.saidReady && beat >= 0) {
      this.saidReady = true;
      hud.say('READY', { life: 1.6, priority: 1 });
    }
    if (!this.saidZone && beat >= 4) {
      this.saidZone = true;
      const z = this.zone;
      const name = z.level >= 4 ? WORLDS[z.world].name : `ZONE ${zoneLabel(z)}`;
      hud.say(name, { life: 2, priority: 1, color: this.hue });
      if (z.level === 1 || z.level >= 4) hud.say(z.level >= 4 ? 'BOSS' : WORLDS[z.world].name, { kind: 'small', life: 2, color: WHITE });
    }
  }

  /** The host decides when the zone is over in the room (a moment after the world says so). */
  hostEnd(w) {
    if (w.phase !== PHASE.DONE && w.phase !== PHASE.OVER) return;
    const now = performance.now();
    if (!this.doneAt) this.doneAt = now;
    const wait = w.phase === PHASE.DONE ? 1400 : 2400;
    if (now - this.doneAt > wait && !this.ended) {
      this.ended = true;
      this.app.session.finishZone();
    }
  }

  // ---------------------------------------------------------------- events

  events(w) {
    const evs = w.drain();
    if (!evs.length) return;
    for (const ev of evs) this.event(ev, w);
  }

  /** Screen point of a lane and depth (for effects). */
  at(lane, z) {
    return this.app.view.P(lane, z, [0, 0]);
  }

  event(ev, w) {
    const app = this.app;
    const s = app.session;
    const music = app.music;
    const fx = app.fx;
    const hud = app.hud;
    const mine = (idx) => idx === s.meIdx;
    const calm = app.calm;
    const n = w.n;
    const closed = w.web.closed;
    const share = w.auth ? (...a) => s.shareEvent(...a) : () => {};
    switch (ev.k) {
      case 'fire':
        if (mine(ev.id)) music.shot(ev.lane, n, closed, ev.id, ev.a === 1, true);
        break;
      case 'kill': {
        const p = this.at(ev.lane, ev.z);
        const type = ev.a;
        const shape = app.shapePoints(type, ev.lane, ev.z);
        fx.shatter(shape, this.hue, 110, 0.5);
        fx.sparks(p[0], p[1], WHITE, 6, 140, 4);
        if (type !== E.SHOT) music.kill(type, ev.lane, n, closed, type === E.TANKER || type === E.BOMBER);
        if (ev.c > 0) fx.pop(p[0], p[1] - 10, ev.c, this.hue, 9, 0.7);
        if (type === E.PART) this.shakeAmt = Math.max(this.shakeAmt, calm ? 0 : 3);
        share('k', ev.id, Math.round(ev.lane), Math.round(ev.z * 100), type, ev.b);
        break;
      }
      case 'hit':
        if (mine(ev.a) || w.auth) music.hit();
        break;
      case 'bosshit':
        if (Math.random() < 0.4) music.bossHit();
        break;
      case 'clink':
        if (Math.random() < 0.35) music.clink();
        break;
      case 'shatter': {
        const p = this.at(ev.lane, ev.z);
        fx.sparks(p[0], p[1], WHITE, 10, 160, 6);
        music.clink();
        break;
      }
      case 'chord':
        hud.say(ev.a >= 4 ? `${ev.a}-CHORD` : 'CHORD', { life: 1.1, priority: 2, color: WHITE });
        music.chordBurst(ev.a);
        fx.ring(...this.at(ev.lane, ev.z), 6, 60, 0.4, WHITE, 3);
        if (ev.a >= 5 || ev.b >= 3) app.award('chord-master');
        share('c', ev.a, ev.b);
        break;
      case 'perfect':
        hud.say('PERFECT BAR', { kind: 'small', life: 1.2, color: this.hue });
        music.perfect();
        app.award('perfect-bar');
        share('p');
        break;
      case 'mult':
        hud.multPop = 1;
        break;
      case 'overdrive':
        hud.say('OVERDRIVE', { life: 1.4, priority: 3, color: WHITE });
        music.overdrive(true);
        app.award('overdrive');
        share('o');
        break;
      case 'down': {
        const p = this.at(ev.lane, 0);
        fx.shatter(app.shipPoints(w.ships[ev.id]?.type || 0, ev.lane), WHITE, 160, 0.9);
        fx.ring(p[0], p[1], 4, 90, 0.6, WHITE, 18);
        if (mine(ev.id)) {
          music.down();
          app.tapeDeath();
          this.shakeAmt = calm ? 0 : 9;
          hud.say(DEATH_NAMES[ev.a] ? 'DOWN' : 'DOWN', { life: 1.5, priority: 4, color: WHITE });
          if (!w.auth) s.pendingDown = ev.a || 1;
        }
        share('d', ev.id, ev.lane, ev.a);
        break;
      }
      case 'shieldbreak':
        fx.ring(...this.at(ev.lane, 0), 4, 50, 0.4, WHITE, 12);
        music.clink();
        if (mine(ev.id)) hud.say('SHIELD', { kind: 'small', life: 0.9 });
        break;
      case 'shield':
        if (mine(ev.id)) music.pickup(3);
        break;
      case 'respawn':
        if (mine(ev.id)) {
          music.respawn();
          fx.ring(...this.at(ev.lane, 0), 50, 4, 0.5, WHITE, 16);
        }
        break;
      case 'revive':
        hud.say('REVIVED', { kind: 'small', life: 1.1, color: WHITE });
        music.respawn();
        share('r', ev.id, ev.lane);
        break;
      case 'life':
        hud.say('+1 SHIP', { kind: 'small', life: 1.3, color: WHITE });
        music.life();
        share('l');
        break;
      case 'zap': {
        const p = this.at(ev.lane, 0);
        fx.ring(p[0], p[1], 10, Math.max(app.W, app.H) * 0.7, 0.7, WHITE, 32);
        if (!calm) this.flash = 0.35;
        music.zap();
        this.shakeAmt = calm ? 0 : 5;
        share('z', ev.id, ev.lane);
        break;
      }
      case 'zapask':
        if (mine(ev.id) && !w.auth) {
          s.pendingZap = true;
          const p = this.at(ev.lane, 0);
          fx.ring(p[0], p[1], 10, Math.max(app.W, app.H) * 0.7, 0.7, WHITE, 32);
          music.zap();
          w.ships[ev.id].zaps = Math.max(0, w.ships[ev.id].zaps - 1);
        }
        break;
      case 'hop':
        if (mine(ev.id)) {
          music.hop(ev.b === 1);
          const p = this.at(ev.lane, 0);
          fx.ring(p[0], p[1], 2, 26, 0.25, ev.b === 1 ? WHITE : this.hue, 10);
          if (!w.auth) s.pendingHops.push([laneOf(w.web, ev.a), laneOf(w.web, ev.lane), ev.b]);
          if (ev.b === 1) hud.multPop = 0.6;
        }
        break;
      case 'charge':
        music.charge(ev.lane, n, closed);
        break;
      case 'pulse':
        music.pulse();
        if (!calm) this.shakeAmt = Math.max(this.shakeAmt, 1.5);
        break;
      case 'count':
        music.count(ev.a);
        break;
      case 'boom': {
        const p = this.at(ev.lane, 0);
        fx.ring(p[0], p[1], 4, 70, 0.5, WHITE, 14);
        fx.sparks(p[0], p[1], this.hue, 14, 200, 6);
        music.boom();
        this.shakeAmt = calm ? 0 : 4;
        break;
      }
      case 'eshot':
        music.eshot();
        break;
      case 'rim':
        music.rim();
        break;
      case 'spike':
        music.spike();
        break;
      case 'pickup': {
        const label = ev.a === 1 ? 'ZAP' : ev.a === 2 ? '+1 SHIP' : 'TEMPO';
        if (mine(ev.id) || w.auth) hud.say(label, { kind: 'small', life: 0.9, color: this.hue });
        music.pickup(ev.a);
        share('u', ev.id, ev.a);
        break;
      }
      case 'recharge':
        if (mine(ev.id)) hud.say('ZAP READY', { kind: 'small', life: 0.9 });
        break;
      case 'arc': {
        const to = this.at(Math.floor(ev.a / 1000), (ev.a % 1000) / 999);
        const from = this.at(ev.lane, ev.z);
        fx.shatter([from[0], from[1], (from[0] + to[0]) / 2 + 6, (from[1] + to[1]) / 2 - 6, to[0], to[1]], WHITE, 10, 0.18);
        break;
      }
      case 'tether':
        if (mine(ev.id) || mine(ev.b)) {
          this.tetherMine++;
          if (app.profile.tether + this.tetherMine >= 50) app.award('tethered');
        }
        break;
      case 'choir':
        hud.say('CHOIR', { kind: 'small', life: 1.1, color: WHITE });
        music.chordBurst(4);
        break;
      case 'reform':
        music.charge(ev.lane, n, closed);
        break;
      case 'boss':
        break;
      case 'bossin':
        hud.say(WORLDS[this.zone.world].boss.toUpperCase(), { life: 1.6, priority: 3, color: WHITE });
        music.bossIn();
        break;
      case 'bossphase':
        music.bossIn();
        this.shakeAmt = calm ? 0 : 4;
        break;
      case 'baton':
      case 'tide':
        music.tele();
        break;
      case 'bossdown': {
        const p = this.at(ev.lane, ev.z);
        fx.ring(p[0], p[1], 10, Math.max(app.W, app.H), 1.2, WHITE, 40);
        fx.sparks(p[0], p[1], this.hue, 40, 320, 10);
        hud.say(`${WORLDS[this.zone.world].boss.toUpperCase()} DOWN`, { life: 2.2, priority: 5, color: WHITE });
        music.bossDown();
        this.shakeAmt = calm ? 0 : 12;
        const badge = BOSS_BADGE[WORLDS[this.zone.world].boss];
        if (badge && this.zone.mode !== 'practice') app.award(badge);
        share('b');
        break;
      }
      case 'phase':
        if (ev.a === PHASE.WARP) {
          hud.say('WARP', { kind: 'small', life: 1.2, color: this.hue });
          music.warp();
        }
        if (ev.a === PHASE.DONE) {
          hud.say('CLEAR', { life: 1.6, priority: 4, color: WHITE });
          music.clear();
          if (this.zone.idx === 0 && this.zone.mode !== 'practice' && s.meIdx >= 0) app.award('first-zone');
        }
        if (ev.a === PHASE.OVER) hud.say('GAME OVER', { life: 3, priority: 6, color: WHITE });
        break;
      case 'flawless':
        hud.say('FLAWLESS', { kind: 'small', life: 1.8, color: WHITE });
        if (s.meIdx >= 0) app.award('flawless');
        share('f');
        break;
      case 'hint':
        if (ev.a) app.hint(ev.a, HINTS[ev.a]);
        break;
      case 'scatter': {
        const p = this.at(ev.lane, ev.z);
        fx.sparks(p[0], p[1], this.hue, 3, 60, 3);
        break;
      }
      case 'downbeat':
      case 'spark': {
        const p = this.at(ev.lane, ev.z || 0);
        fx.ring(p[0], p[1], 2, 30, 0.3, WHITE, 8);
        break;
      }
      default:
        break;
    }
  }

  /** Something the host's page saw that this page did not (others' kills, team moments). Checked: it came from a page. */
  remote(ev, w) {
    const app = this.app;
    const s = app.session;
    const kind = typeof ev[1] === 'string' ? ev[1] : '';
    const num = (x, lo, hi) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo);
    const a = num(ev[2], -1, 1e9);
    const lane = num(ev[3], 0, w.n - 1);
    const c = num(ev[4], 0, 100000);
    const d = num(ev[5], 0, 20);
    const by = num(ev[6], -1, 8);
    switch (kind) {
      case 'k': {
        if (by === s.meIdx || w.predicted.has(a)) return; // our own, already shown
        const z = Math.min(1, c / 100);
        const p = this.at(lane, z);
        app.fx.shatter(app.shapePoints(d, lane, z), this.hue, 100, 0.45);
        app.fx.sparks(p[0], p[1], WHITE, 4, 120, 3);
        if (d !== E.SHOT) app.music.kill(d, lane, w.n, w.web.closed, false);
        break;
      }
      case 'c':
        this.event({ k: 'chord', a: num(ev[2], 0, 24), b: num(ev[3], 0, 4), lane: 0, z: 0.5 }, w);
        break;
      case 'p':
        this.event({ k: 'perfect' }, w);
        break;
      case 'o':
        this.event({ k: 'overdrive' }, w);
        break;
      case 'd':
        if (a !== s.meIdx && a >= 0 && a < w.ships.length) this.event({ k: 'down', id: a, lane, a: Math.round(num(ev[4], 0, 20)) }, w);
        break;
      case 'r':
        this.event({ k: 'revive', id: a, lane }, w);
        break;
      case 'l':
        this.event({ k: 'life' }, w);
        break;
      case 'b':
        this.event({ k: 'bossdown', lane: w.web.start, z: 0.8 }, w);
        break;
      case 'f':
        this.event({ k: 'flawless' }, w);
        break;
      case 'u':
        if (a === s.meIdx) this.event({ k: 'pickup', id: a, a: Math.round(num(ev[3], 1, 3)), lane: 0 }, w);
        break;
      case 'z':
        if (a !== s.meIdx) this.event({ k: 'zap', id: a, lane }, w);
        break;
    }
  }

  /** Other players' bolts, for show: a stream down their lane while their presence says they fire. */
  updateGhostBolts(w, dt) {
    const list = this.ghostBolts;
    for (const g of list) g.z += dt * 1.6;
    while (list.length && list[0].z > 1) list.shift();
    if (list.length > 120) list.splice(0, list.length - 120);
    const t16 = 60 / w.bpm / 4;
    for (const ship of w.ships) {
      if (ship.kind !== 'puppet' || ship.state !== 'live' || !ship.in.fire || ship.gone) continue;
      ship.ghostT = (ship.ghostT || 0) + dt;
      const every = t16 * ship.def.rate;
      if (ship.ghostT >= every) {
        ship.ghostT %= every;
        list.push({ lane: laneOf(w.web, ship.u), z: 0 });
        if (this.app.session.meIdx >= 0) this.app.music.shot(laneOf(w.web, ship.u), w.n, w.web.closed, ship.idx, false, false);
      }
    }
  }
}
