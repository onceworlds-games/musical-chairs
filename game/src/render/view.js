// The game seen down the barrel: the web, everything on it, and the ships on the rim. Reads the simulation (never
// writes it) and draws with the vector renderer. The camera leans a little toward your ship, spins with the web,
// and dives down the tunnel during the warp.
import { E, STEPS_PER_BEAT, TICKS_PER_BAR } from '../sim/data.js';
import { SHAPE, SHIP_SHAPES, WRECK, fuseStrokes, noteStrokes } from './shapes.js';
import { ghostVisible, S as ST } from '../sim/enemies.js';
import { PHASE } from '../sim/world.js';
import { hazardMethods } from './hazards.js';

const WHITE = '#ffffff';
const tmpA = [0, 0];
const tmpB = [0, 0];
const tmpC = [0, 0];
const fuse = [];

export class View {
  constructor(vec, fx) {
    this.vec = vec;
    this.fx = fx;
    this.web = null;
    this.rim = [];
    this.cx = 0;
    this.cy = 0;
    this.S = 100; // pixels per unit of the web, the shorter way
    this.Sx = 100; // across and down: the web stretches along the longer side of the screen so it fills it
    this.Sy = 100;
    this.maxStretch = 0; // 0: by the screen's shape (a little on a wide window, more on a tall phone)
    this.vp = [0, 0];
    this.camZ = 0;
    this.hue = '#3dffb0';
    this.angle = 0;
    this.lean = [0, 0];
    this.pts = new Float32Array(256);
    this.flat = [];
    this.minSize = 7; // the smallest half-width an enemy is drawn at, in CSS px
  }

  /** A new web: fit it to the screen. spins: the web turns (it needs room for any angle). */
  setWeb(web, hue, spins = false) {
    this.web = web;
    this.hue = hue;
    this.spins = spins;
    this.rim = web.rim.map((p) => p.slice());
    this.lean = [0, 0];
    this.fit();
  }

  /** Screen area for the web: top and bottom keep room for the HUD (and the platform's buttons). */
  layout(w, h, top = 58, bottom = 70) {
    this.W = w;
    this.H = h;
    this.top = top;
    this.bottom = bottom;
    this.fit();
  }

  fit() {
    const web = this.web;
    if (!web || !this.W) return;
    const side = 14;
    const availW = Math.max(40, this.W - side * 2);
    const availH = Math.max(40, this.H - this.top - this.bottom);
    let ux; // the web's unit size across and down, with its margin
    let uy;
    if (web.closed && this.spins) {
      // Room for any spin: the widest point decides.
      let r = 0;
      for (const p of web.rim) r = Math.max(r, Math.hypot(p[0], p[1]));
      ux = uy = 2 * r * 1.04;
    } else if (web.closed) {
      let rx = 0;
      let ry = 0;
      for (const p of web.rim) {
        rx = Math.max(rx, Math.abs(p[0]));
        ry = Math.max(ry, Math.abs(p[1]));
      }
      ux = 2 * rx * 1.05;
      uy = 2 * ry * 1.05;
    } else {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = web.vp[1];
      let y1 = -Infinity;
      for (const p of web.rim) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
      ux = (x1 - x0) * 1.06;
      uy = (y1 - y0) * 1.1;
    }
    const fx = availW / ux;
    const fy = availH / uy;
    // The web keeps its shape on the shorter side and stretches along the longer one, up to a limit: a tall phone gets
    // a taller tunnel, a wide window a wider one, instead of a small circle with black above and below.
    const cap = this.maxStretch || (this.W >= this.H ? (this.W >= this.H * 1.7 ? 1.6 : 1.3) : 1.55);
    this.S = Math.min(fx, fy);
    this.Sx = Math.min(fx, this.S * cap);
    this.Sy = Math.min(fy, this.S * cap);
    if (web.closed) {
      this.cx = this.W / 2;
      this.cy = this.top + availH / 2;
    } else {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = web.vp[1];
      let y1 = -Infinity;
      for (const p of web.rim) {
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
      this.cx = this.W / 2 - ((x0 + x1) / 2) * this.Sx;
      this.cy = this.top + availH / 2 - ((y0 + y1) / 2) * this.Sy;
    }
  }

  /** The vanishing point on screen. */
  vx() {
    return this.cx + this.vp[0] * this.Sx;
  }
  vy() {
    return this.cy + this.vp[1] * this.Sy;
  }

  /** The lane width at the rim, in CSS px (for touch sensitivity and hit areas). */
  laneWidth() {
    const web = this.web;
    if (!web) return 30;
    let sum = 0;
    for (let i = 0; i < web.n; i++) {
      const a = web.rim[i];
      const b = web.rim[web.closed ? (i + 1) % web.n : i + 1];
      sum += Math.hypot((a[0] - b[0]) * this.Sx, (a[1] - b[1]) * this.Sy);
    }
    return sum / web.n;
  }

  // ---------------------------------------------------------------- projection

  /** Depth on screen: during the warp the camera dives, so what is behind it is gone. */
  depth(z) {
    if (this.camZ <= 0) return z;
    return (z - this.camZ) / Math.max(0.02, 1 - this.camZ);
  }

  /** Screen point at continuous lane u (centres are integers) and depth z. */
  P(u, z, out) {
    const web = this.web;
    const n = web.n;
    let a;
    let f;
    if (web.closed) {
      const uu = ((u % n) + n) % n;
      a = Math.floor(uu + 0.5);
      f = uu + 0.5 - a;
      a %= n;
    } else {
      const uu = Math.max(-0.5, Math.min(n - 0.5, u));
      a = Math.floor(uu + 0.5);
      f = uu + 0.5 - a;
      if (a >= n) (a = n - 1), (f = 1);
    }
    const p = this.rim[a];
    const q = this.rim[web.closed ? (a + 1) % n : a + 1];
    const x = p[0] + (q[0] - p[0]) * f;
    const y = p[1] + (q[1] - p[1]) * f;
    const zz = this.depth(z);
    const s = 1 / (1 + web.k * Math.max(-0.2, zz));
    out[0] = this.cx + (this.vp[0] + (x - this.vp[0]) * s) * this.Sx;
    out[1] = this.cy + (this.vp[1] + (y - this.vp[1]) * s) * this.Sy;
    return out;
  }

  /** Screen point on lane boundary j at depth z. */
  B(j, z, out) {
    const web = this.web;
    const p = this.rim[web.closed ? ((j % web.n) + web.n) % web.n : Math.max(0, Math.min(web.n, j))];
    const zz = this.depth(z);
    const s = 1 / (1 + web.k * Math.max(-0.2, zz));
    out[0] = this.cx + (this.vp[0] + (p[0] - this.vp[0]) * s) * this.Sx;
    out[1] = this.cy + (this.vp[1] + (p[1] - this.vp[1]) * s) * this.Sy;
    return out;
  }

  /** The local frame of a lane at (u, z): centre, half-width across, and a depth axis of the same length. */
  frame(u, z, f) {
    this.P(u - 0.5, z, tmpA);
    this.P(u + 0.5, z, tmpB);
    f.cx = (tmpA[0] + tmpB[0]) / 2;
    f.cy = (tmpA[1] + tmpB[1]) / 2;
    f.ax = (tmpB[0] - tmpA[0]) / 2;
    f.ay = (tmpB[1] - tmpA[1]) / 2;
    const len = Math.hypot(f.ax, f.ay) || 1;
    // Keep the depth axis square to the lane (a tidy shape even where the lanes fan out), pointing at the vanishing point.
    let dx = -f.ay;
    let dy = f.ax;
    if (dx * (this.vx() - f.cx) + dy * (this.vy() - f.cy) < 0) (dx = -dx), (dy = -dy);
    const k = len / (Math.hypot(dx, dy) || 1);
    f.dx = dx * k;
    f.dy = dy * k;
    f.len = len;
    // Far away things stay big enough to read.
    if (len < this.minSize) {
      const g = this.minSize / len;
      f.ax *= g;
      f.ay *= g;
      f.dx *= g;
      f.dy *= g;
      f.len = this.minSize;
    }
    return f;
  }

  /** Adds a local-frame stroke list to the current path. sx/sy squash the shape (a flip turns it edge-on). */
  strokes(list, f, sx = 1, sy = 1, rot = 0) {
    const v = this.vec;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    for (const st of list) {
      let px = 0;
      let py = 0;
      for (let i = 0; i < st.length; i += 2) {
        let x = st[i] * sx;
        let y = st[i + 1] * sy;
        if (rot) {
          const xr = x * c - y * s;
          y = x * s + y * c;
          x = xr;
        }
        px = f.cx + x * f.ax + y * f.dx;
        py = f.cy + x * f.ay + y * f.dy;
        if (i === 0) v.move(px, py);
        else v.to(px, py);
      }
      if (st.length === 2) v.to(px + 0.5, py + 0.5);
    }
  }

  /** The lane under a screen point: the nearest lane's centre line. */
  laneAt(x, y) {
    const web = this.web;
    if (!web) return null;
    let best = 0;
    let bestD = Infinity;
    for (let l = 0; l < web.n; l++) {
      this.P(l, 0, tmpA);
      this.P(l, 0.92, tmpB);
      const d = segDist(x, y, tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
      if (d < bestD) (bestD = d), (best = l);
    }
    return best;
  }

  /** The lane in a direction from the web's centre (a gamepad stick on a closed web). */
  laneAtAngle(angle) {
    const web = this.web;
    if (!web) return null;
    const cx = this.vx();
    const cy = this.vy();
    let best = 0;
    let bestD = Infinity;
    for (let l = 0; l < web.n; l++) {
      this.P(l, 0, tmpA);
      let d = Math.abs(Math.atan2(tmpA[1] - cy, tmpA[0] - cx) - angle);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < bestD) (bestD = d), (best = l);
    }
    return best;
  }

  // ---------------------------------------------------------------- the frame

  /**
   * scene: { w (World), alpha, t (song seconds), me (local ship index or -1), tints [hex], names [], calm,
   *          pulse (0..1 beat glow), od, shake: [x, y] }
   */
  draw(scene) {
    const w = scene.w;
    const v = this.vec;
    if (!this.web || !w) return;
    const calm = scene.calm;
    // Spin and sway: closed webs turn, open ones sway; Calm keeps them still.
    const spin = w.def.spin || 0;
    this.angle = calm ? 0 : this.web.closed ? spin * scene.t : spin ? Math.sin(scene.t * 0.5) * 0.08 : 0;
    // A closed web turns about its centre; an open one about its vanishing point.
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const ox = this.web.closed ? 0 : this.web.vp[0];
    const oy = this.web.closed ? 0 : this.web.vp[1];
    for (let i = 0; i < this.web.rim.length; i++) {
      const p = this.web.rim[i];
      const x = p[0] - ox;
      const y = p[1] - oy;
      this.rim[i][0] = ox + x * c - y * s;
      this.rim[i][1] = oy + x * s + y * c;
    }
    // Lean toward the local ship.
    const me = scene.me >= 0 ? w.ships[scene.me] : null;
    let lx = 0;
    let ly = 0;
    if (me && !calm && this.web.closed) {
      this.camZ = 0;
      this.P(me.u, 0, tmpC);
      lx = -((tmpC[0] - this.cx) / this.Sx) * 0.07;
      ly = -((tmpC[1] - this.cy) / this.Sy) * 0.07;
    }
    this.lean[0] += (lx - this.lean[0]) * 0.08;
    this.lean[1] += (ly - this.lean[1]) * 0.08;
    this.vp[0] = this.web.vp[0] + this.lean[0];
    this.vp[1] = this.web.vp[1] + this.lean[1];
    this.camZ = w.phase === PHASE.WARP || w.phase === PHASE.DONE ? w.warpZ() * 0.92 : 0;
    const shakeX = scene.shake ? scene.shake[0] : 0;
    const shakeY = scene.shake ? scene.shake[1] : 0;
    this.cx += shakeX;
    this.cy += shakeY;

    this.drawWeb(scene);
    this.drawHazards(scene);
    this.drawSpikes(scene);
    this.drawEnemies(scene);
    this.drawPickups(scene);
    this.drawBolts(scene);
    this.drawShips(scene);
    this.cx -= shakeX;
    this.cy -= shakeY;
  }

  drawWeb(scene) {
    const w = scene.w;
    const v = this.vec;
    const web = this.web;
    const n = web.n;
    const bounds = web.closed ? n : n + 1;
    const pulse = scene.calm ? 0 : scene.pulse;
    const od = scene.od ? 1 : 0;
    // Lanes, far ring.
    v.begin();
    for (let j = 0; j < bounds; j++) {
      this.B(j, 0, tmpA);
      this.B(j, 1, tmpB);
      v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
    }
    for (let j = 0; j < bounds; j++) {
      this.B(j, 1, tmpA);
      if (j === 0) v.move(tmpA[0], tmpA[1]);
      else v.to(tmpA[0], tmpA[1]);
    }
    if (web.closed) {
      this.B(0, 1, tmpA);
      v.to(tmpA[0], tmpA[1]);
    }
    v.glow(this.hue, 1, 0.34 + 0.08 * pulse + 0.14 * od);
    // Posters ask for a field of faint rings down the tube (depth you can count); play has only the travelling rungs.
    if (scene.rings) {
      v.begin();
      for (const z of scene.rings) {
        if (this.depth(z) < 0.02) continue;
        for (let j = 0; j < bounds; j++) {
          this.B(j, z, tmpA);
          if (j === 0) v.move(tmpA[0], tmpA[1]);
          else v.to(tmpA[0], tmpA[1]);
        }
        if (web.closed) {
          this.B(0, z, tmpA);
          v.to(tmpA[0], tmpA[1]);
        }
      }
      v.glow(this.hue, 0.8, 0.2);
    }
    // Rungs: rings travelling up the tube, one per beat (still and faint in Calm).
    const beatFrac = (w.step % STEPS_PER_BEAT) / STEPS_PER_BEAT + scene.alpha / STEPS_PER_BEAT;
    v.begin();
    const rungs = scene.calm ? [0.4, 0.7] : [1 - beatFrac * 0.5, 0.5 - beatFrac * 0.5];
    for (const z of rungs) {
      if (z <= 0.02 || z >= 0.99 || this.depth(z) < 0) continue;
      for (let j = 0; j < bounds; j++) {
        this.B(j, z, tmpA);
        if (j === 0) v.move(tmpA[0], tmpA[1]);
        else v.to(tmpA[0], tmpA[1]);
      }
      if (web.closed) {
        this.B(0, z, tmpA);
        v.to(tmpA[0], tmpA[1]);
      }
    }
    v.glow(this.hue, 0.8, scene.calm ? 0.12 : 0.1 + 0.12 * (1 - beatFrac));
    // The rim: brightest line on the screen, swelling on the beat.
    v.begin();
    for (let j = 0; j < bounds; j++) {
      this.B(j, 0, tmpA);
      if (j === 0) v.move(tmpA[0], tmpA[1]);
      else v.to(tmpA[0], tmpA[1]);
    }
    if (web.closed) {
      this.B(0, 0, tmpA);
      v.to(tmpA[0], tmpA[1]);
    }
    v.glow(this.hue, 1.5 + od * 0.8, 0.72 + 0.28 * pulse + 0.2 * od);
    this.rimStyle(scene, bounds);
    // A slight colour split on the beat (not in Calm, not on low quality).
    if (!scene.calm && pulse > 0.35 && v.quality === 'high') {
      const off = 1.6 * pulse;
      v.begin();
      for (let j = 0; j < bounds; j++) {
        this.B(j, 0, tmpA);
        if (j === 0) v.move(tmpA[0] + off, tmpA[1]);
        else v.to(tmpA[0] + off, tmpA[1]);
      }
      if (web.closed) {
        this.B(0, 0, tmpA);
        v.to(tmpA[0] + off, tmpA[1]);
      }
      v.thin(WHITE, 1, 0.18 * pulse);
    }
    // Your lane, lit.
    const me = scene.me >= 0 ? w.ships[scene.me] : null;
    if (me && me.state === 'live') {
      const lane = Math.round(this.interpU(me, scene.alpha));
      v.begin();
      for (const j of [lane, lane + 1]) {
        this.B(j, 0, tmpA);
        this.B(j, 1, tmpB);
        v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
      }
      v.glow(me.tint || WHITE, 1, 0.42);
    }
  }

  /** The player's chosen rim: a second line outside it, beads at its corners, or teeth along it. */
  rimStyle(scene, bounds) {
    const style = scene.rim || 'plain';
    if (style === 'plain' || this.camZ > 0) return;
    const v = this.vec;
    const web = this.web;
    v.begin();
    if (style === 'double') {
      for (let j = 0; j < bounds; j++) {
        this.B(j, -0.035, tmpA);
        if (j === 0) v.move(tmpA[0], tmpA[1]);
        else v.to(tmpA[0], tmpA[1]);
      }
      if (web.closed) {
        this.B(0, -0.035, tmpA);
        v.to(tmpA[0], tmpA[1]);
      }
    } else if (style === 'beads') {
      for (let j = 0; j < bounds; j++) {
        this.B(j, 0, tmpA);
        const r = 3;
        v.move(tmpA[0], tmpA[1] - r);
        v.to(tmpA[0] + r, tmpA[1]);
        v.to(tmpA[0], tmpA[1] + r);
        v.to(tmpA[0] - r, tmpA[1]);
        v.to(tmpA[0], tmpA[1] - r);
      }
    } else if (style === 'teeth') {
      for (let l = 0; l < web.n; l++) {
        this.P(l, 0, tmpA);
        this.P(l, -0.05, tmpB);
        v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
      }
    }
    v.glow(this.hue, 1, 0.55);
  }

  interpU(ship, alpha) {
    const d = ship.u - ship.pu;
    if (Math.abs(d) > 2) return ship.u;
    return ship.pu + d * alpha;
  }

  drawSpikes(scene) {
    const w = scene.w;
    const v = this.vec;
    const f = this.flat;
    v.begin();
    let any = false;
    for (let lane = 0; lane < this.web.n; lane++) {
      const h = w.spikes[lane];
      if (h < 0.01) continue;
      const tip = 1 - h;
      if (this.depth(tip) < 0) continue;
      this.P(lane, 1, tmpA);
      this.P(lane, tip, tmpB);
      v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
      this.frame(lane, tip, f);
      this.strokes(TIP, f, 0.35, 0.35);
      any = true;
    }
    if (any) v.glow(this.hue, 1.2, 0.85);
  }

  drawEnemies(scene) {
    const w = scene.w;
    const v = this.vec;
    const f = this.flat;
    const a = scene.alpha;
    const t = scene.t;
    // Three brightness bands (far, mid, near) and a flash band: four strokes for the whole wave.
    for (let band = 0; band < 4; band++) {
      v.begin();
      let any = false;
      for (const e of w.enemies) {
        if (e.dead) continue;
        if (e.type === E.PART) continue;
        const z = e.pz + (e.z - e.pz) * a;
        const flash = e.flash > 0;
        const b = flash ? 3 : z > 0.66 ? 0 : z > 0.3 ? 1 : 2;
        if (b !== band) continue;
        if (this.depth(z) < -0.02) continue;
        let u = e.lane;
        const d = e.lane - e.px;
        if (Math.abs(d) < 2) u = e.px + d * a;
        this.frame(u, z, f);
        if (z < 0.04) {
          // On the rim they sit a little smaller, so neighbours never merge into one shape.
          f.ax *= 0.8;
          f.ay *= 0.8;
          f.dx *= 0.8;
          f.dy *= 0.8;
        }
        this.enemyShape(e, f, t, scene, z);
        any = true;
      }
      if (any) v.glow(band === 3 ? WHITE : this.hue, band === 3 ? 1.6 : 1.3, [0.55, 0.8, 1, 1.2][band]);
      // The core of each enemy is white: a second, thin pass.
      if (any && band < 3) v.thin(WHITE, 0.9, [0.35, 0.55, 0.75][band]);
    }
    // Ghosts between beats: a dashed, dim outline (never a flicker).
    v.begin();
    let ghosts = false;
    for (const e of w.enemies) {
      if (e.dead || e.type !== E.GHOST || ghostVisible(w, e)) continue;
      const z = e.pz + (e.z - e.pz) * a;
      this.frame(e.lane, z, f);
      this.strokes(SHAPE[E.GHOST], f);
      ghosts = true;
    }
    if (ghosts) {
      this.vec.ctx.setLineDash([3, 4]);
      v.thin(this.hue, 1, 0.45);
      this.vec.ctx.setLineDash([]);
    }
    // Choirs: a thin line joins the voices of one choir.
    v.begin();
    let choir = false;
    const groups = new Map();
    for (const e of w.enemies) {
      if (e.dead || e.type !== E.SIREN || !e.group) continue;
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(e);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((p, q) => p.lane - q.lane);
      for (let i = 0; i < list.length; i++) {
        this.P(list[i].lane, list[i].z, tmpA);
        if (i === 0) v.move(tmpA[0], tmpA[1]);
        else v.to(tmpA[0], tmpA[1]);
      }
      choir = true;
    }
    if (choir) v.thin(this.hue, 1, 0.35);
    if (w.boss && !w.boss.down) this.drawBoss(scene);
  }

  enemyShape(e, f, t, scene, z) {
    switch (e.type) {
      case E.FLIPPER: {
        // Mid-flip it turns edge-on, the way a card does.
        let sx = 1;
        if (e.fs >= 0) {
          const p = Math.min(1, (scene.w.step - e.fs + scene.alpha) / e.fl);
          sx = Math.cos(p * Math.PI);
        }
        this.strokes(SHAPE[E.FLIPPER], f, sx, 1);
        break;
      }
      case E.FUSEBALL:
        this.strokes(fuseStrokes(scene.calm ? 0 : t, e.id % 7, fuse), f, 1, 1);
        break;
      case E.PULSAR: {
        const period = scene.w.oc >= 5 ? TICKS_PER_BAR : TICKS_PER_BAR * 2;
        const warn = period - (scene.w.tick % period);
        const amp = warn <= 8 ? 0.6 + 0.6 * (1 - warn / 8) : 0.5;
        this.strokes(SHAPE[E.PULSAR], f, 1, amp);
        break;
      }
      case E.MINE: {
        this.strokes(SHAPE[E.MINE], f, 1, 1);
        if (e.st === ST.ARMED) {
          // Its count: one tick mark per beat left.
          for (let i = 0; i < e.a; i++) {
            const ang = -Math.PI / 2 + (i - (e.a - 1) / 2) * 0.55;
            const x = Math.cos(ang) * 0.75;
            const y = Math.sin(ang) * 0.75;
            this.strokes([[x, y, x * 1.25, y * 1.25]], f);
          }
        }
        break;
      }
      case E.WEAVER:
        this.strokes(SHAPE[E.WEAVER], f, 1, 1, scene.calm ? 0 : Math.sin(t * 4 + e.id) * 0.3);
        break;
      default:
        this.strokes(SHAPE[e.type] || SHAPE[E.FLIPPER], f);
    }
  }

  drawPickups(scene) {
    const w = scene.w;
    if (!w.pickups.length) return;
    const v = this.vec;
    const f = this.flat;
    v.begin();
    for (const p of w.pickups) {
      if (p.dead) continue;
      const z = p.pz + (p.z - p.pz) * scene.alpha;
      this.frame(p.lane, z, f);
      this.strokes(noteStrokes(p.kind), f, 0.9, 0.9, scene.calm ? 0 : Math.sin(scene.t * 3) * 0.2);
    }
    v.glow(WHITE, 1.3, 1);
  }

  drawBolts(scene) {
    const w = scene.w;
    const v = this.vec;
    const tints = scene.tints;
    // One stroke per owner (their tint), and the core in white.
    for (let owner = -1; owner < w.ships.length; owner++) {
      v.begin();
      let any = false;
      for (const b of w.bolts) {
        if (b.dead || (owner >= 0 && b.owner !== owner) || (owner < 0 && b.owner < w.ships.length)) continue;
        const z = b.pz + (b.z - b.pz) * scene.alpha;
        if (this.depth(z) < 0) continue;
        const tail = b.dir > 0 ? Math.max(0, z - 0.06) : Math.min(1, z + 0.06);
        this.P(b.lane, z, tmpA);
        this.P(b.lane, tail, tmpB);
        v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
        any = true;
      }
      if (any) v.glow((owner >= 0 && tints[owner]) || WHITE, scene.od ? 2 : 1.6, 1);
    }
    // Other players' bolts are only for show (each page judges its own).
    if (scene.ghostBolts && scene.ghostBolts.length) {
      v.begin();
      for (const g of scene.ghostBolts) {
        this.P(g.lane, g.z, tmpA);
        this.P(g.lane, Math.max(0, g.z - 0.06), tmpB);
        v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
      }
      v.glow(WHITE, 1.2, 0.6);
    }
  }

  /** A ship's trail along the rim (a cosmetic): dots, dashes or a ribbon where it has just been. */
  drawTrail(ship, u, scene) {
    const kind = scene.trails?.[ship.idx];
    const hist = ship.trail || (ship.trail = []);
    hist.push(u);
    if (hist.length > 14) hist.shift();
    if (!kind || kind === 'none' || ship.state !== 'live' || this.camZ > 0) return;
    const v = this.vec;
    const n = this.web.n;
    v.begin();
    let any = false;
    for (let i = 0; i < hist.length - 1; i++) {
      const a = hist[i];
      const b = hist[i + 1];
      if (Math.abs(a - b) > n / 2 || Math.abs(a - u) < 0.3) continue;
      any = true;
      if (kind === 'dots') {
        this.P(a, 0.012, tmpA);
        v.move(tmpA[0], tmpA[1]);
        v.to(tmpA[0] + 0.6, tmpA[1] + 0.6);
      } else if (kind === 'dash') {
        if (i % 2) continue;
        this.P(a, 0.012, tmpA);
        this.P(b, 0.012, tmpB);
        v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
      } else {
        this.P(a, 0.012 + 0.004 * (hist.length - i), tmpA);
        this.P(b, 0.012 + 0.004 * (hist.length - i - 1), tmpB);
        v.line(tmpA[0], tmpA[1], tmpB[0], tmpB[1]);
      }
    }
    if (any) v.glow(scene.tints[ship.idx] || WHITE, kind === 'dots' ? 2.4 : 1.4, 0.7);
  }

  drawShips(scene) {
    const w = scene.w;
    const v = this.vec;
    const f = this.flat;
    const t = scene.t;
    for (const ship of w.ships) if (!ship.gone) this.drawTrail(ship, this.interpU(ship, scene.alpha), scene);
    const live = [];
    for (const ship of w.ships) {
      if (ship.gone) continue;
      const u = this.interpU(ship, scene.alpha);
      if (ship.state === 'live') live.push([ship, u]);
    }
    // Tethers between neighbours: a crackling line along the rim.
    if (live.length > 1) {
      v.begin();
      let any = false;
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const [a, ua] = live[i];
          const [b, ub] = live[j];
          let d = ub - ua;
          if (this.web.closed) {
            const n = this.web.n;
            d = ((d % n) + n) % n;
            if (d > n / 2) d -= n;
          }
          const reach = 3 + Math.max(a.mods.unison || 0, b.mods.unison || 0);
          if (Math.abs(d) > reach || Math.abs(d) < 0.5) continue;
          const steps = Math.max(4, Math.round(Math.abs(d) * 4));
          for (let k = 0; k <= steps; k++) {
            const uu = ua + (d * k) / steps;
            const zz = 0.035 + (scene.calm ? 0 : Math.abs(Math.sin(t * 9 + k * 1.9)) * 0.03);
            this.P(uu, zz, tmpA);
            if (k === 0) v.move(tmpA[0], tmpA[1]);
            else v.to(tmpA[0], tmpA[1]);
          }
          any = true;
        }
      }
      if (any) v.glow(this.hue, 1.2, 0.9);
    }
    for (const ship of w.ships) {
      if (ship.gone) {
        // A player who went: their ship fades over half a second.
        const k = 1 - (performance.now() - (ship.goneAt || 0)) / 500;
        if (k > 0) {
          this.frame(this.interpU(ship, scene.alpha), 0, f);
          v.begin();
          this.strokes(SHIP_SHAPES[ship.type] || SHIP_SHAPES[0], f, 1, 1.05);
          v.glow(scene.tints[ship.idx] || WHITE, 1.4, 0.8 * k);
        }
        continue;
      }
      const u = this.interpU(ship, scene.alpha);
      const tint = scene.tints[ship.idx] || WHITE;
      const z = this.camZ > 0 ? this.camZ / 0.92 : 0;
      if (ship.state === 'live') {
        this.frame(u, this.camZ > 0 ? this.camZ + 0.001 : 0, f);
        v.begin();
        // It sits on the rim; its base just outside the edge.
        f.cx -= f.dx * 0.06;
        f.cy -= f.dy * 0.06;
        this.strokes(SHIP_SHAPES[ship.type] || SHIP_SHAPES[0], f, 1, 1.05);
        const inv = ship.inv > w.step;
        const bright = inv ? (scene.calm ? 0.6 : 0.55 + 0.35 * Math.abs(Math.sin(t * 5))) : 1;
        v.glow(tint, 1.7, bright);
        if (ship.shield) {
          v.begin();
          this.strokes([ARC], f, 1.15, 1.15);
          v.glow(tint, 1.1, 0.7);
        }
        // Sustain charging: a growing bar under the ship.
        if (ship.charge > 0) {
          const k = Math.min(1, ship.charge / STEPS_PER_BEAT);
          v.begin();
          this.strokes([[-0.8 * k, -0.35, 0.8 * k, -0.35]], f);
          v.glow(k >= 1 ? WHITE : tint, 1.2, 0.6 + 0.4 * k);
        }
      } else if (ship.state === 'down' || ship.state === 'out') {
        this.frame(u, 0, f);
        v.begin();
        this.strokes(WRECK, f, 1, 1);
        v.glow(tint, 1.2, scene.calm ? 0.5 : 0.35 + 0.25 * Math.abs(Math.sin(t * 3)));
        // A wreck that can be revived shows a ring that empties.
        const wr = w.wrecks.find((x) => x.idx === ship.idx);
        if (wr && Number.isFinite(wr.until)) {
          const left = Math.max(0, Math.min(1, (wr.until - w.step) / (STEPS_PER_BEAT * 8)));
          v.begin();
          const r = f.len * 1.3;
          for (let i = 0; i <= 20 * left; i++) {
            const ang = -Math.PI / 2 + (Math.PI * 2 * i) / 20;
            const x = f.cx + Math.cos(ang) * r;
            const y = f.cy + Math.sin(ang) * r;
            if (i === 0) v.move(x, y);
            else v.to(x, y);
          }
          v.glow(WHITE, 1, 0.6);
        }
      }
      void z;
    }
  }

}

Object.assign(View.prototype, hazardMethods);

const TIP = [[0, -0.6, 0.5, 0, 0, 0.6, -0.5, 0, 0, -0.6]];
const ARC = (() => {
  const out = [];
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (Math.PI * i) / 10;
    out.push(Math.cos(a) * 1.05, Math.sin(a) * 0.6 + 0.1);
  }
  return out;
})();

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
