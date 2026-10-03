// Every way to play, turned into one intent per frame: a target lane, Fire, Hop and Zap.
//   Keys: Left/Right or A/D step a lane (hold to run), Space fires, Shift or Up hops, Down or Ctrl zaps, F auto-fire.
//   Mouse: point at a lane (no pointer lock), hold the left button to fire, right-click hops, wheel down zaps.
//   Touch: drag anywhere to turn the ship round the web like a dial; fire is automatic; Hop and Zap are the
//          platform's buttons (a second finger's tap also hops).
//   Gamepad: stick or d-pad (on a closed web the stick points at a lane), A fire, B hop, X zap, Start pause.
// Keys are cleared whenever the window loses focus, so nothing stays held.

const LEFT = new Set(['ArrowLeft', 'a', 'A']);
const RIGHT = new Set(['ArrowRight', 'd', 'D']);
const FIRE = new Set([' ', 'Spacebar']);
const HOP = new Set(['Shift', 'ArrowUp', 'w', 'W']);
const ZAP = new Set(['ArrowDown', 'Control', 's', 'S']);
const GAME_KEYS = new Set([...LEFT, ...RIGHT, ...FIRE, ...HOP, ...ZAP, 'Tab']);

export class Input {
  constructor(el, view) {
    this.el = el;
    this.view = view;
    this.keys = new Set();
    this.pressedAt = new Map();
    this.kbTarget = null;
    this.kbDir = 0;
    this.kbSince = 0;
    this.mouse = { x: 0, y: 0, moved: -1e9, down: false, inside: false };
    this.touches = new Map(); // id -> { x, y, sx, sy, t }
    this.steer = null; // the steering finger
    this.touchU = null;
    this.edges = { hop: false, zap: false, pause: false, confirm: false, back: false };
    this.autofire = false;
    this.usedTouch = false;
    this.lastDevice = 'keys';
    this.pad = { active: false, prev: new Set(), lane: null, idx: -1 };
    this.padOk = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
    this.enabled = false; // only while a zone is being played
    this.bind();
  }

  bind() {
    const opts = { passive: false };
    addEventListener('keydown', (e) => this.onKey(e, true), opts);
    addEventListener('keyup', (e) => this.onKey(e, false), opts);
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
    const el = this.el;
    el.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    addEventListener('pointermove', (e) => this.onMove(e), { passive: true });
    addEventListener('pointerup', (e) => this.onUp(e), opts);
    addEventListener('pointercancel', (e) => this.onUp(e), opts);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        if (e.deltaY > 8) this.edges.zap = true;
      },
      opts,
    );
    document.addEventListener('mouseleave', () => {
      this.mouse.inside = false;
      this.mouse.down = false;
    });
  }

  releaseAll() {
    this.keys.clear();
    this.kbDir = 0;
    this.mouse.down = false;
    this.touches.clear();
    this.steer = null;
  }

  onKey(e, down) {
    const k = e.key;
    if (this.enabled && GAME_KEYS.has(k) && k !== 'Tab') e.preventDefault();
    if (down) {
      if (e.repeat) return;
      this.lastDevice = 'keys';
      this.keys.add(k);
      this.pressedAt.set(k, performance.now());
      if (HOP.has(k)) this.edges.hop = true;
      if (ZAP.has(k)) this.edges.zap = true;
      if (k === 'p' || k === 'P' || k === 'Escape') this.edges.pause = true;
      if (k === 'Enter') this.edges.confirm = true;
      if ((k === 'f' || k === 'F') && this.enabled) this.autofire = !this.autofire;
      if (LEFT.has(k)) this.stepKey(-1);
      if (RIGHT.has(k)) this.stepKey(1);
    } else {
      this.keys.delete(k);
      if ((LEFT.has(k) && this.kbDir < 0) || (RIGHT.has(k) && this.kbDir > 0)) {
        this.kbDir = this.held(LEFT) ? -1 : this.held(RIGHT) ? 1 : 0;
      }
    }
  }

  held(set) {
    for (const k of set) if (this.keys.has(k)) return true;
    return false;
  }

  /** A tap moves exactly one lane; holding keeps going once the ship gets there. */
  stepKey(dir) {
    const ship = this.ship;
    if (!ship) return;
    const base = this.kbTarget !== null && this.kbDir === dir ? this.kbTarget : Math.round(ship.u);
    this.kbTarget = base + dir;
    this.kbDir = dir;
    this.kbSince = performance.now();
    this.mouse.moved = -1e9; // keys take over from a resting mouse
    this.touchU = null;
  }

  onDown(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      this.usedTouch = true;
      this.lastDevice = 'touch';
      if (!this.enabled) return;
      e.preventDefault();
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (this.steer === null) {
        this.steer = e.pointerId;
        this.touchU = this.ship ? this.ship.u : null;
      }
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }
    this.lastDevice = 'mouse';
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.inside = true;
    if (!this.enabled) return;
    if (e.button === 0) this.mouse.down = true;
    if (e.button === 2) this.edges.hop = true;
    this.mouse.moved = performance.now();
  }

  onMove(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      const t = this.touches.get(e.pointerId);
      if (!t) return;
      const dx = e.clientX - t.x;
      const dy = e.clientY - t.y;
      t.x = e.clientX;
      t.y = e.clientY;
      if (e.pointerId === this.steer && this.enabled) this.dial(t.x, t.y, dx, dy);
      return;
    }
    const moved = Math.abs(e.clientX - this.mouse.x) + Math.abs(e.clientY - this.mouse.y) > 1;
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    this.mouse.inside = true;
    if (moved) {
      this.mouse.moved = performance.now();
      this.lastDevice = 'mouse';
    }
  }

  onUp(e) {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      const t = this.touches.get(e.pointerId);
      this.touches.delete(e.pointerId);
      if (e.pointerId === this.steer) {
        this.steer = null;
        // A finger still down takes over the steering.
        const next = this.touches.keys().next();
        if (!next.done) this.steer = next.value;
      } else if (t && this.enabled && performance.now() - t.t < 260 && Math.hypot(t.x - t.sx, t.y - t.sy) < 18) {
        // A quick tap with another finger: hop.
        this.edges.hop = true;
      }
      return;
    }
    if (e.button === 0) this.mouse.down = false;
  }

  /** Touch steering: the finger's motion around the web's centre turns the ship. */
  dial(x, y, dx, dy) {
    const view = this.view;
    const ship = this.ship;
    if (!ship || !view.web || this.touchU === null) return;
    const perLane = Math.max(18, Math.min(60, view.laneWidth() * 0.85));
    let d;
    if (view.web.closed) {
      const cx = view.cx + view.vp[0] * view.S;
      const cy = view.cy + view.vp[1] * view.S;
      const rx = x - cx;
      const ry = y - cy;
      const r = Math.hypot(rx, ry);
      if (r < view.S * 0.3) d = dx / perLane; // near the middle: plain left and right, as at the bottom of the web
      else d = (dx * ry - dy * rx) / r / perLane;
    } else d = dx / perLane;
    if (Math.abs(d) < 0.02) return;
    this.touchU += d;
    if (!view.web.closed) this.touchU = Math.max(0, Math.min(view.web.n - 1, this.touchU));
    this.mouse.moved = -1e9;
    this.kbTarget = null;
  }

  pollPad() {
    if (!this.padOk) return null;
    let pads;
    try {
      pads = navigator.getGamepads();
    } catch {
      this.padOk = false;
      return null;
    }
    if (!pads) return null;
    let pad = null;
    for (const p of pads) if (p && p.connected) pad = pad || p;
    if (!pad) {
      this.pad.active = false;
      return null;
    }
    const b = (i) => Boolean(pad.buttons?.[i]?.pressed);
    const now = new Set();
    for (let i = 0; i < Math.min(17, pad.buttons?.length || 0); i++) if (b(i)) now.add(i);
    const edge = (i) => now.has(i) && !this.pad.prev.has(i);
    if (edge(1)) this.edges.hop = true;
    if (edge(2)) this.edges.zap = true;
    if (edge(9)) this.edges.pause = true;
    if (edge(0) && !this.enabled) this.edges.confirm = true;
    if (edge(14)) this.stepKey(-1);
    if (edge(15)) this.stepKey(1);
    this.pad.prev = now;
    const ax = Number(pad.axes?.[0]) || 0;
    const ay = Number(pad.axes?.[1]) || 0;
    if (now.size || Math.hypot(ax, ay) > 0.3) {
      this.pad.active = true;
      this.lastDevice = 'pad';
    }
    return { fire: b(0) || b(7), ax, ay, dpad: (b(15) ? 1 : 0) - (b(14) ? 1 : 0) };
  }

  /** The frame's intent for the local ship. ship: the simulation's ship (for where it is now). */
  read(ship, web) {
    this.ship = ship;
    const pad = this.pollPad();
    const out = { target: null, fire: false, hop: false, zap: false };
    if (!ship || !web) return out;
    const now = performance.now();
    // Keys: keep running while held.
    if (this.kbDir && this.held(this.kbDir < 0 ? LEFT : RIGHT) && now - this.kbSince > 110) {
      const d = this.kbTarget - ship.u;
      const wrapD = web.closed ? ((((d % web.n) + web.n * 1.5) % web.n) - web.n / 2) : d;
      if (Math.abs(wrapD) < 0.45) this.kbTarget += this.kbDir;
    }
    if (pad && Math.hypot(pad.ax, pad.ay) > 0.6) {
      if (web.closed) {
        out.target = this.view.laneAtAngle(Math.atan2(pad.ay, pad.ax));
        this.kbTarget = null;
      } else {
        out.target = Math.round(ship.u) + Math.sign(pad.ax);
        this.kbTarget = null;
      }
    } else if (this.steer !== null && this.touchU !== null) {
      out.target = Math.round(this.touchU);
    } else if (this.kbTarget !== null && now - this.mouse.moved > 600) {
      out.target = this.kbTarget;
    } else if (now - this.mouse.moved < 1500 && this.mouse.inside) {
      out.target = this.view.laneAt(this.mouse.x, this.mouse.y);
    } else if (this.kbTarget !== null) out.target = this.kbTarget;
    if (out.target !== null && web.closed) out.target = ((out.target % web.n) + web.n) % web.n;
    if (out.target !== null && !web.closed) out.target = Math.max(0, Math.min(web.n - 1, out.target));
    // Keep the dial's count in step with where the ship really is (a hop, a respawn).
    if (this.steer === null && this.touchU !== null && Math.abs(this.touchU - ship.u) > 0.6) this.touchU = ship.u;
    const touchPlay = this.usedTouch && this.lastDevice === 'touch';
    out.fire = this.held(FIRE) || this.mouse.down || Boolean(pad?.fire) || this.autofire || touchPlay;
    out.hop = this.edges.hop;
    out.zap = this.edges.zap;
    this.edges.hop = false;
    this.edges.zap = false;
    return out;
  }

  /** Menu keys since the last call. */
  take(name) {
    const v = this.edges[name];
    this.edges[name] = false;
    return v;
  }
}
