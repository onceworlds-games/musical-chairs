// The track the game plays, and the sounds that play along with it. Each world has a key, a mode, a four-chord loop
// and a groove; the band adds layers as play heats up (kick and hats, then bass and backbeat, then the arp, then
// Overdrive's doubled parts) and drops a layer, with a tape stop, when a ship goes down. Every shot is a note of the
// world's scale, chosen by the lane and played on the next sixteenth; kills are chord stabs in key.
import { kick, snare, clap, hat, shaker, bass, pad, pluck, lead, stab, chime, sweep, thud, blip, clink, burst, mtof } from './engine.js';

const MODES = {
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

// Grooves: which sixteenths of the bar each part plays on. 'b' marks bass hits (o: the chord's fifth, O: octave).
const GROOVES = {
  floor: { kick: [0, 4, 8, 12], snare: [], clap: [4, 12], hat: [2, 6, 10, 14], open: [14], bass: 'r.r.o.r.r.r.o.O.' },
  break: { kick: [0, 7, 10], snare: [4, 12], clap: [], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [6], bass: 'r..r..o.r..r.O..' },
  half: { kick: [0, 10], snare: [8], clap: [], hat: [0, 4, 8, 12, 14], open: [], bass: 'r.......o...r...' },
  drive: { kick: [0, 4, 8, 12, 14], snare: [4, 12], clap: [], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [2, 10], bass: 'rrOrrrOrrrOrrOro' },
  sync: { kick: [0, 3, 8, 11], snare: [4, 12], clap: [12], hat: [2, 6, 10, 14], open: [6], bass: '.r.r.o.r.r.O.r.o' },
  roll: { kick: [0, 4, 8, 12], snare: [4, 12], clap: [4, 12], hat: [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14], open: [14], bass: 'rOrorOrorOrorOro' },
};
const WORLD_GROOVE = { mint: 'floor', amber: 'break', ice: 'half', vermilion: 'drive', lime: 'sync', rose: 'roll', gold: 'break', sky: 'half' };

export class Music {
  constructor(engine) {
    this.e = engine;
    this.layer = 0;
    this.want = 0;
    this.grit = 0;
    this.setWorld({ key: 'mint', root: 50, mode: 'dorian', chords: [0, 3, 5, 3] });
    this.lastShot = new Map();
    this.lastKill = 0;
    this.dropUntil = -1;
    engine.tickHandler = (k, when, t16) => this.tick(k, when, t16);
  }

  setWorld(def) {
    this.world = def;
    this.scale = MODES[def.mode] || MODES.dorian;
    this.root = def.root || 50;
    this.chords = def.chords || [0, 3, 5, 3];
    this.groove = GROOVES[WORLD_GROOVE[def.key] || 'floor'];
    // The pentatonic the shots use: degrees 1, 2, 3, 5 and 6 of the mode.
    this.penta = [0, 1, 2, 4, 5].map((d) => this.scale[d]);
  }

  /** How much of the band plays: 0 (the hub) to 4 (Overdrive). Takes effect on the next bar line. */
  setLayer(n, grit = 0) {
    this.want = Math.max(0, Math.min(4, n | 0));
    this.grit = grit;
  }

  /** Triad on a scale degree, as MIDI notes from a base octave. */
  chord(degree, base) {
    const s = this.scale;
    const note = (d) => base + s[d % 7] + 12 * Math.floor(d / 7);
    return [note(degree), note(degree + 2), note(degree + 4)];
  }

  /** The chord playing at sixteenth k (one chord per bar, four bars a loop). */
  chordAt(k) {
    const bar = Math.floor(k / 16);
    return this.chords[((bar % 4) + 4) % 4];
  }

  tick(k, when, t16) {
    const e = this.e;
    const step = ((k % 16) + 16) % 16;
    if (step === 0) {
      this.layer = this.dropUntil > k ? Math.max(0, this.want - 1) : this.want;
      // The band's brightness follows the layer.
      const t = e.tone.frequency;
      t.cancelScheduledValues(when);
      t.setTargetAtTime([2200, 4000, 7000, 9000, 14000][this.layer], when, 0.25);
    }
    const L = this.layer;
    const g = this.groove;
    const deg = this.chordAt(k);
    const rootNote = this.root + this.scale[deg % 7] - 12;
    if (step === 0) pad(e, when, this.chord(deg, this.root + 12), t16 * 16 * 0.98, L === 0 ? 0.9 : 0.7, this.grit);
    if (L >= 1) {
      if (g.kick.includes(step)) kick(e, when, step === 0 ? 1 : 0.85);
      if (g.hat.includes(step)) hat(e, when, false, 0.55 + 0.25 * (step % 4 === 2));
    } else if (step === 0 || step === 8) kick(e, when, 0.35);
    if (L >= 2) {
      if (g.snare.includes(step)) snare(e, when, 0.8);
      if (g.clap.includes(step)) clap(e, when, 0.8);
      if (g.open.includes(step)) hat(e, when, true, 0.6);
      const b = g.bass[step];
      if (b && b !== '.') {
        const note = b === 'o' ? rootNote + 7 : b === 'O' ? rootNote + 12 : rootNote;
        bass(e, when, note, t16 * (L >= 4 ? 0.9 : 1.6), 0.85, this.grit);
      }
    }
    if (L >= 3) {
      // The arp: chord tones climbing, eighths (sixteenths in Overdrive, an octave up on the off-beats).
      if (L >= 4 || step % 2 === 0) {
        const tones = this.chord(deg, this.root + 24);
        const i = (step >> (L >= 4 ? 0 : 1)) % 4;
        const note = i === 3 ? tones[0] + 12 : tones[i];
        pluck(e, when, note + (L >= 4 && step % 2 ? 12 : 0), 0.9, L >= 4 ? 1.3 : 1);
      }
      if (step % 4 === 2) shaker(e, when, 0.8);
    }
  }

  // ---------------------------------------------------------------- sounds of play

  /** The pitch a lane plays: low at the bottom of the web, highest across it (a line: low left, high right). */
  laneNote(lane, n, closed) {
    let i;
    if (closed) {
      const half = n / 2;
      const d = lane <= half ? lane : n - lane;
      i = Math.round((d / half) * 9);
    } else i = Math.round((lane / Math.max(1, n - 1)) * 9);
    const oct = Math.floor(i / 5);
    return this.root + 12 + this.penta[i % 5] + 12 * oct;
  }

  /** A bolt left: its note waits for the next sixteenth (the bolt itself never waits). */
  shot(lane, n, closed, owner = 0, onBeat = false, mine = true) {
    const e = this.e;
    if (!e.live) return;
    const when = e.nextGrid(1);
    const key = owner;
    if (this.lastShot.get(key) === when) return; // one note per player per sixteenth
    this.lastShot.set(key, when);
    const note = this.laneNote(lane, n, closed);
    const pan = closed ? Math.sin(((lane + 0.5) / n) * Math.PI * 2) * 0.6 : (lane / Math.max(1, n - 1) - 0.5) * 1.2;
    lead(e, when, note, (mine ? 0.9 : 0.45) * (onBeat ? 1.25 : 1), pan);
  }

  kill(type, lane, n, closed, big = false) {
    const e = this.e;
    if (!e.live) return;
    const when = e.nextGrid(1);
    if (when - this.lastKill < 0.03 && !big) return;
    this.lastKill = when;
    const deg = this.chordAt(Math.floor((when - e.offset) / (60 / e.bpm / 4)));
    const reg = this.laneNote(lane, n, closed) >= this.root + 24 ? 12 : 0;
    stab(e, when, this.chord(deg, this.root + 12 + reg), big ? 1.2 : 0.75);
    if (big) thud(e, when, 0.6);
  }

  hit() {
    if (!this.e.live) return;
    blip(this.e, this.e.now(), 920 + Math.random() * 160, 0.25, 0.03, 'triangle');
  }

  chordBurst(count) {
    const e = this.e;
    if (!e.live) return;
    const when = e.nextGrid(2);
    const deg = this.chordAt(Math.floor((when - e.offset) / (60 / e.bpm / 4)));
    const tones = this.chord(deg, this.root + 24);
    tones.forEach((n, i) => chime(e, when + i * 0.035, n, 0.9));
    if (count >= 4) chime(e, when + 0.12, tones[0] + 12, 0.8);
    sweep(e, when, 600, 5000, 0.35, 0.6);
  }

  perfect() {
    const e = this.e;
    if (!e.live) return;
    const when = e.nextGrid(4);
    const tones = this.chord(0, this.root + 36);
    tones.forEach((n, i) => chime(e, when + i * 0.05, n, 0.55));
  }

  overdrive(on) {
    const e = this.e;
    if (!e.live) return;
    const when = e.nextGrid(1);
    if (on) sweep(e, when, 300, 8000, 0.9, 1, 2);
    else sweep(e, when, 6000, 200, 0.6, 0.7, 2);
  }

  pickup(kind) {
    const e = this.e;
    if (!e.live) return;
    const when = e.nextGrid(1);
    const tones = this.chord(0, this.root + 24);
    const order = kind === 2 ? [0, 1, 2, 0] : kind === 1 ? [2, 1, 0] : [0, 2];
    order.forEach((i, j) => chime(e, when + j * 0.06, tones[i] + (j === 3 ? 12 : 0), 0.8));
  }

  hop(onBeat) {
    const e = this.e;
    if (!e.live) return;
    const t = e.now();
    sweep(e, t, 1800, 400, 0.14, 0.5, 1.5);
    if (onBeat) blip(e, t, mtof(this.root + 36), 0.5, 0.08, 'triangle');
  }

  zap() {
    const e = this.e;
    if (!e.live) return;
    const t = e.now();
    sweep(e, t, 8000, 60, 0.9, 1.3, 1.2);
    const g = e.gain(0, e.sfx);
    e.env(g, t, 0.01, 0.5, 1.1);
    const o = e.osc('sine', 110, t, t + 1.2, g);
    o.frequency.exponentialRampToValueAtTime(30, t + 1.0);
  }

  /** A ship goes down: the band drops a layer for two bars, and the fall plays in the player's chosen sound. */
  down(style = 'stop') {
    const e = this.e;
    if (!e.live) return;
    const t = e.now();
    const f = e.tone.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.exponentialRampToValueAtTime(260, t + 0.45);
    f.setTargetAtTime([2200, 4000, 7000, 9000, 14000][Math.max(0, this.layer - 1)], t + 0.5, 0.6);
    const g = e.gain(0, e.sfx);
    if (style === 'spin') {
      // A record pulled to a stop: a wobbling fall.
      e.env(g, t, 0.005, 0.28, 0.9);
      const o = e.osc('sawtooth', mtof(this.root + 24), t, t + 0.95, e.filter('lowpass', 1400, 2, g));
      o.frequency.exponentialRampToValueAtTime(mtof(this.root - 12), t + 0.85);
      const lfo = e.osc('sine', 9, t, t + 0.95, e.gain(30, o.frequency));
      void lfo;
    } else if (style === 'crush') {
      // A chunky square falling in steps.
      e.env(g, t, 0.002, 0.22, 0.55);
      const o = e.osc('square', mtof(this.root + 19), t, t + 0.6, g);
      for (let i = 1; i <= 6; i++) o.frequency.setValueAtTime(mtof(this.root + 19 - i * 5), t + i * 0.07);
    } else if (style === 'sigh') {
      // A soft chord that sinks.
      e.env(g, t, 0.02, 0.18, 1.1);
      for (const n of this.chord(this.chords[0], this.root + 12)) {
        const o = e.osc('triangle', mtof(n), t, t + 1.2, g);
        o.frequency.exponentialRampToValueAtTime(mtof(n - 5), t + 1.1);
      }
    } else {
      e.env(g, t, 0.005, 0.32, 0.6);
      const o = e.osc('sawtooth', mtof(this.root + 12), t, t + 0.65, e.filter('lowpass', 900, 1, g));
      o.frequency.exponentialRampToValueAtTime(mtof(this.root - 24), t + 0.55);
    }
    burst(e, t, 0.6, 0.4);
    const k = Math.floor((t - e.offset) / (60 / e.bpm / 4));
    this.dropUntil = (Math.floor(k / 16) + 3) * 16;
  }

  respawn() {
    const e = this.e;
    if (!e.live) return;
    const when = e.nextGrid(1);
    const tones = this.chord(0, this.root + 24);
    tones.forEach((n, i) => chime(e, when + i * 0.04, n, 0.5));
  }

  charge(lane, n, closed) {
    const e = this.e;
    if (!e.live) return;
    const t = e.nextGrid(1);
    const g = e.gain(0, e.sfx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.9);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.0);
    const o = e.osc('square', mtof(this.laneNote(lane, n, closed) - 12), t, t + 1.05, e.filter('lowpass', 1400, 4, g));
    o.frequency.exponentialRampToValueAtTime(mtof(this.laneNote(lane, n, closed)), t + 0.95);
  }

  pulse() {
    const e = this.e;
    if (!e.live) return;
    const t = e.now();
    sweep(e, t, 3000, 900, 0.3, 0.8, 6);
    blip(e, t, 70, 0.6, 0.25, 'sawtooth');
  }

  count(n) {
    const e = this.e;
    if (!e.live) return;
    blip(e, e.now(), n <= 1 ? 1400 : 980, 0.35, 0.05, 'square');
  }

  boom() {
    if (!this.e.live) return;
    burst(this.e, this.e.now(), 0.9, 0.55);
  }

  eshot() {
    if (!this.e.live) return;
    blip(this.e, this.e.now(), 2400, 0.12, 0.04, 'square');
  }

  rim() {
    if (!this.e.live) return;
    thud(this.e, this.e.now(), 0.35);
  }

  spike() {
    if (!this.e.live) return;
    blip(this.e, this.e.now(), 300 + Math.random() * 80, 0.18, 0.04, 'square');
  }

  clink() {
    if (!this.e.live) return;
    clink(this.e, this.e.now(), 0.6);
  }

  bossHit() {
    if (!this.e.live) return;
    blip(this.e, this.e.now(), 160 + Math.random() * 40, 0.3, 0.07, 'sawtooth');
  }

  bossIn() {
    const e = this.e;
    if (!e.live) return;
    const t = e.nextGrid(4);
    sweep(e, t, 120, 2400, 1.6, 1, 2);
    const g = e.gain(0, e.sfx);
    e.env(g, t, 0.05, 0.3, 2);
    for (const n of this.chord(0, this.root - 12)) e.osc('sawtooth', mtof(n), t, t + 2.1, e.filter('lowpass', 600, 2, g));
  }

  bossDown() {
    const e = this.e;
    if (!e.live) return;
    const t = e.nextGrid(4);
    burst(e, t, 1.2, 1.2);
    const tones = this.chord(0, this.root + 12);
    for (let i = 0; i < 6; i++) chime(e, t + i * 0.07, tones[i % 3] + 12 * Math.floor(i / 3), 0.9);
  }

  tele() {
    if (!this.e.live) return;
    blip(this.e, this.e.nextGrid(1), mtof(this.root + 31), 0.2, 0.09, 'sawtooth');
  }

  warp() {
    const e = this.e;
    if (!e.live) return;
    sweep(e, e.now(), 200, 9000, 2.2, 1, 1.5);
  }

  clear() {
    const e = this.e;
    if (!e.live) return;
    const t = e.nextGrid(4);
    const tones = this.chord(this.chords[0], this.root + 24);
    tones.forEach((n, i) => chime(e, t + i * 0.09, n, 0.9));
  }

  life() {
    const e = this.e;
    if (!e.live) return;
    const t = e.nextGrid(1);
    [0, 4, 7, 12].forEach((d, i) => chime(e, t + i * 0.06, this.root + 24 + d, 0.7));
  }

  // UI
  tickUi() {
    if (!this.e.live) return;
    blip(this.e, this.e.now(), 1200, 0.18, 0.025, 'triangle');
  }
  pick() {
    const e = this.e;
    if (!e.live) return;
    const t = e.now();
    chime(e, t, this.root + 36, 0.7);
    chime(e, t + 0.06, this.root + 43, 0.6);
  }
  denied() {
    if (!this.e.live) return;
    blip(this.e, this.e.now(), 140, 0.3, 0.12, 'square');
  }
}
