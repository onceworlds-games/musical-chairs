// The audio engine: one AudioContext, a master chain with a high shelf and a limiter (thirty pings never become a
// hiss or a clip), and a look-ahead scheduler that maps the song's clock onto the audio clock. The song clock is the
// game's (the room's match time); the audio offset follows it smoothly, so the beat never drifts and a hitch never
// skips a note. Every instrument is synthesized here.

export class Engine {
  constructor() {
    this.ctx = null;
    this.ok = false;
    this.offset = 0; // ctx.currentTime - songT, smoothed
    this.synced = false;
    this.latency = 0.03;
    this.noise = null;
    this.voices = 0;
    this.tickHandler = null;
    this.bpm = 120;
    this.songT = 0;
    this.nextTick = 0;
    this.running = false;
    this.timer = 0;
  }

  /** Starts (or resumes) audio. Call from a tap or key press inside the game. */
  start() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.build();
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      this.ok = true;
      if (!this.timer) this.timer = setInterval(() => this.pump(), 25);
      return true;
    } catch {
      this.ok = false;
      return false;
    }
  }

  get live() {
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.shelf = ctx.createBiquadFilter();
    this.shelf.type = 'highshelf';
    this.shelf.frequency.value = 6500;
    this.shelf.gain.value = -5;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -9;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 14;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.14;
    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    this.master.connect(this.shelf);
    this.shelf.connect(this.limiter);
    this.limiter.connect(this.duck);
    this.duck.connect(ctx.destination);
    // Busses: music (with a sidechain gain the kick pumps) and effects.
    this.music = ctx.createGain();
    this.music.gain.value = 0.55;
    this.side = ctx.createGain(); // bass and pad pass through this; the kick ducks it
    this.side.gain.value = 1;
    this.side.connect(this.music);
    this.tone = ctx.createBiquadFilter(); // the whole band's brightness (opens with intensity, closes on a death)
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 9000;
    this.tone.Q.value = 0.4;
    this.music.connect(this.tone);
    this.tone.connect(this.master);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);
    // A short echo for the lead and the stabs.
    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = 0.25;
    this.feedback = ctx.createGain();
    this.feedback.gain.value = 0.28;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.22;
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.wet);
    this.wet.connect(this.master);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (seed / 0x7fffffff) * 2 - 1;
    }
    this.latency = Math.min(0.25, Math.max(0, (ctx.outputLatency || 0) + (ctx.baseLatency || 0)));
  }

  /** The platform menu is open, or the game paused: the mix steps back. */
  setDuck(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duck.gain.cancelScheduledValues(t);
    this.duck.gain.setTargetAtTime(on ? 0.3 : 1, t, 0.08);
  }

  /** iOS parks a context as 'interrupted' (a call, the lock screen): try again when we are back. */
  wake() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  // ---------------------------------------------------------------- the clock

  /**
   * The song is at songT seconds (bpm): keep the audio clock mapped to it. Called every frame.
   * paused: the song is standing still (no new notes).
   */
  sync(songT, bpm, paused = false) {
    this.bpm = bpm;
    this.paused = paused;
    if (!this.ctx) return;
    const sample = this.ctx.currentTime - songT;
    if (!this.synced || Math.abs(sample - this.offset) > 0.08 || paused) {
      // A jump (a new zone, a pause, a long hitch): snap, and start scheduling from here.
      this.offset = sample;
      this.synced = true;
      const t16 = 60 / bpm / 4;
      this.nextTick = Math.max(0, Math.ceil((songT + 0.01) / t16));
    } else this.offset += (sample - this.offset) * 0.04;
    this.songT = songT;
    this.pump();
  }

  /** A song clock that jumped (a new zone, a new tempo): the next sync snaps. */
  resync() {
    this.synced = false;
  }

  /** Audio time at which song time t is heard. */
  at(songT) {
    return songT + this.offset - this.latency * 0.5;
  }

  pump() {
    if (!this.ctx || !this.synced || this.paused || !this.tickHandler || this.ctx.state !== 'running') return;
    const t16 = 60 / this.bpm / 4;
    const horizon = this.ctx.currentTime + 0.12;
    let guard = 0;
    while (guard++ < 32) {
      const songAt = this.nextTick * t16;
      const when = this.at(songAt);
      if (when > horizon) break;
      if (when >= this.ctx.currentTime - 0.02) {
        try {
          this.tickHandler(this.nextTick, Math.max(when, this.ctx.currentTime), t16);
        } catch (err) {
          console.error(err);
        }
      }
      this.nextTick++;
    }
  }

  /** The audio time of the next sixteenth at or after now (for quantizing a note). */
  nextGrid(div = 1) {
    if (!this.ctx) return 0;
    const t16 = (60 / this.bpm / 4) * div;
    const songNow = this.ctx.currentTime - this.offset + this.latency * 0.5;
    const k = Math.ceil((songNow + 0.004) / t16);
    return Math.max(this.ctx.currentTime, this.at(k * t16));
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ---------------------------------------------------------------- building blocks

  env(g, t, a, peak, d, sustain = 0) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain || 0.0001), t + a + d);
  }

  osc(type, freq, t, stop, out) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(out);
    o.start(t);
    o.stop(stop);
    return o;
  }

  noiseSrc(t, stop, out, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = rate;
    s.loop = true;
    s.connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(stop);
    return s;
  }

  gain(v, out) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    g.connect(out);
    return g;
  }

  filter(type, freq, q, out) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(out);
    return f;
  }

  /** Counts voices so a crowded moment drops notes instead of overloading the device. */
  room(cost = 1) {
    if (!this.ctx || this.ctx.state !== 'running') return false;
    const t = this.ctx.currentTime;
    if (t - (this.voiceT || 0) > 0.05) {
      this.voiceT = t;
      this.voiceN = 0;
    }
    this.voiceN = (this.voiceN || 0) + cost;
    return this.voiceN <= 22;
  }
}

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ------------------------------------------------------------------ instruments

export function kick(e, t, vel = 1) {
  if (!e.room(2)) return;
  const g = e.gain(0, e.music);
  e.env(g, t, 0.002, 0.95 * vel, 0.32);
  const o = e.osc('sine', 150, t, t + 0.4, g);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const c = e.gain(0, e.music);
  e.env(c, t, 0.001, 0.25 * vel, 0.02);
  e.noiseSrc(t, t + 0.03, e.filter('highpass', 3000, 0.7, c));
  // The sidechain: bass and pad dip under the kick.
  e.side.gain.setValueAtTime(0.35, t);
  e.side.gain.setTargetAtTime(1, t + 0.02, 0.07);
}

export function snare(e, t, vel = 1) {
  if (!e.room(2)) return;
  const g = e.gain(0, e.music);
  e.env(g, t, 0.001, 0.42 * vel, 0.16);
  e.noiseSrc(t, t + 0.2, e.filter('bandpass', 1900, 0.8, g));
  const b = e.gain(0, e.music);
  e.env(b, t, 0.001, 0.28 * vel, 0.08);
  const o = e.osc('triangle', 196, t, t + 0.12, b);
  o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
}

export function clap(e, t, vel = 1) {
  if (!e.room(2)) return;
  const f = e.filter('bandpass', 1300, 1.1, e.music);
  for (let i = 0; i < 3; i++) {
    const g = e.gain(0, f);
    const ti = t + i * 0.011;
    e.env(g, ti, 0.001, (i === 2 ? 0.5 : 0.3) * vel, i === 2 ? 0.14 : 0.012);
    e.noiseSrc(ti, ti + 0.16, g);
  }
}

export function hat(e, t, open = false, vel = 1) {
  if (!e.room(1)) return;
  const g = e.gain(0, e.music);
  e.env(g, t, 0.001, 0.16 * vel, open ? 0.22 : 0.035);
  e.noiseSrc(t, t + (open ? 0.3 : 0.06), e.filter('highpass', 7500, 0.6, g), 1.2);
}

export function shaker(e, t, vel = 1) {
  if (!e.room(1)) return;
  const g = e.gain(0, e.music);
  e.env(g, t, 0.012, 0.07 * vel, 0.05);
  e.noiseSrc(t, t + 0.09, e.filter('bandpass', 5200, 2.2, g), 1.4);
}

export function bass(e, t, note, dur, vel = 1, grit = 0) {
  if (!e.room(2)) return;
  const g = e.gain(0, e.side);
  e.env(g, t, 0.004, 0.42 * vel, dur * 0.9, 0.0001);
  const lp = e.filter('lowpass', 900, 5, g);
  lp.frequency.setValueAtTime(300 + 1600 * vel, t);
  lp.frequency.exponentialRampToValueAtTime(180, t + dur);
  const f = mtof(note);
  e.osc('sawtooth', f, t, t + dur + 0.05, lp);
  e.osc('square', f / 2, t, t + dur + 0.05, e.gain(0.6, lp));
  if (grit) {
    const shaper = e.ctx.createWaveShaper();
    shaper.curve = gritCurve();
    shaper.connect(lp);
    e.osc('sawtooth', f * 1.005, t, t + dur + 0.05, e.gain(0.35 * grit, shaper));
  }
}

let grit = null;
function gritCurve() {
  if (grit) return grit;
  grit = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i / 128 - 1) * 3;
    grit[i] = Math.tanh(x);
  }
  return grit;
}

export function pad(e, t, notes, dur, vel = 1, dark = 0) {
  if (!e.room(4)) return;
  const g = e.gain(0, e.side);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.07 * vel, t + Math.min(0.5, dur * 0.3));
  g.gain.setValueAtTime(0.07 * vel, t + dur * 0.75);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  const lp = e.filter('lowpass', dark ? 700 : 1500, 0.7, g);
  for (const n of notes) {
    const f = mtof(n);
    e.osc('sawtooth', f * 0.997, t, t + dur + 0.05, lp);
    e.osc('sawtooth', f * 1.004, t, t + dur + 0.05, lp);
  }
}

export function pluck(e, t, note, vel = 1, bright = 1) {
  if (!e.room(1)) return;
  const g = e.gain(0, e.music);
  e.env(g, t, 0.002, 0.13 * vel, 0.2);
  const lp = e.filter('lowpass', 2400 * bright, 3, g);
  lp.frequency.setValueAtTime(3800 * bright, t);
  lp.frequency.exponentialRampToValueAtTime(600, t + 0.18);
  e.osc('square', mtof(note), t, t + 0.25, lp);
}

/** The player's voice: a short bright note (with a touch of echo), panned by where on the web it was played. */
export function lead(e, t, note, vel = 1, pan = 0) {
  if (!e.room(1)) return;
  let dest = e.sfx;
  if (e.ctx.createStereoPanner) {
    const p = e.ctx.createStereoPanner();
    p.pan.value = Math.max(-0.7, Math.min(0.7, pan));
    p.connect(e.sfx);
    dest = p;
  }
  const g = e.gain(0, dest);
  e.env(g, t, 0.003, 0.14 * vel, 0.14);
  // A few cents either way: never quite the same blip twice.
  const f = mtof(note) * (1 + (Math.random() - 0.5) * 0.006);
  e.osc('triangle', f, t, t + 0.18, g);
  e.osc('sawtooth', f * 2, t, t + 0.06, e.gain(0.16, g));
  g.connect(e.gain(0.25, e.delay));
}

export function stab(e, t, notes, vel = 1) {
  if (!e.room(3)) return;
  const g = e.gain(0, e.sfx);
  e.env(g, t, 0.002, 0.12 * vel, 0.22);
  const hp = e.filter('highpass', 220, 0.6, g);
  for (const n of notes) e.osc('sawtooth', mtof(n), t, t + 0.26, hp);
  g.connect(e.gain(0.3, e.delay));
}

export function chime(e, t, note, vel = 1) {
  if (!e.room(1)) return;
  const g = e.gain(0, e.sfx);
  e.env(g, t, 0.002, 0.12 * vel, 0.6);
  const f = mtof(note);
  e.osc('sine', f, t, t + 0.7, g);
  e.osc('sine', f * 2.76, t, t + 0.25, e.gain(0.25, g));
  g.connect(e.gain(0.35, e.delay));
}

export function sweep(e, t, from, to, dur, vel = 1, q = 3) {
  if (!e.room(2)) return;
  const g = e.gain(0, e.sfx);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16 * vel, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const bp = e.filter('bandpass', from, q, g);
  bp.frequency.setValueAtTime(from, t);
  bp.frequency.exponentialRampToValueAtTime(to, t + dur);
  e.noiseSrc(t, t + dur + 0.05, bp);
}

export function thud(e, t, vel = 1) {
  if (!e.room(1)) return;
  const g = e.gain(0, e.sfx);
  e.env(g, t, 0.002, 0.3 * vel, 0.2);
  const o = e.osc('sine', 90, t, t + 0.25, g);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.18);
}

export function blip(e, t, freq, vel = 1, dur = 0.06, type = 'square') {
  if (!e.room(1)) return;
  const g = e.gain(0, e.sfx);
  e.env(g, t, 0.001, 0.08 * vel, dur);
  e.osc(type, freq, t, t + dur + 0.02, g);
}

export function clink(e, t, vel = 1) {
  if (!e.room(1)) return;
  const g = e.gain(0, e.sfx);
  e.env(g, t, 0.001, 0.07 * vel, 0.12);
  e.osc('square', 1780, t, t + 0.14, g);
  e.osc('square', 2630, t, t + 0.1, e.gain(0.6, g));
}

export function burst(e, t, vel = 1, dur = 0.5) {
  if (!e.room(2)) return;
  const g = e.gain(0, e.sfx);
  e.env(g, t, 0.003, 0.4 * vel, dur);
  const lp = e.filter('lowpass', 2400, 0.7, g);
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(120, t + dur);
  e.noiseSrc(t, t + dur + 0.05, lp);
  thud(e, t, vel);
}
