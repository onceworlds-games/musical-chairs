// Sound: every effect and the music are synthesized with Web Audio (no files). The platform applies the player's volume and
// mute to everything. Nothing is created until unlock() runs from a tap in the game (iPhones need that).

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// Eight-note motifs in scale degrees (0 is a rest, 8 is the octave): a different one for each round.
const MOTIFS = [
  [5, 0, 5, 6, 5, 3, 0, 3],
  [1, 3, 5, 0, 5, 3, 6, 5],
  [3, 3, 5, 5, 6, 6, 5, 0],
  [8, 0, 6, 8, 5, 0, 3, 5],
  [1, 1, 3, 0, 5, 5, 3, 1],
  [5, 6, 8, 6, 5, 3, 1, 0],
];
const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const PROG = [0, 7, 9, 5]; // I V vi IV, in semitones from the key
const QUAL = [[0, 4, 7], [0, 4, 7], [0, 3, 7], [0, 4, 7]];
const KEYS = [60, 62, 64, 65, 67, 69, 57, 59];

export function createAudio() {
  let ctx = null;
  let sfxBus = null;
  let musicBus = null; // a fresh gain for each run of the music, so a stop silences what is already queued
  let noise = null;
  let timer = null;
  const music = { on: false, song: 0, bpm: 112, vol: 0.5, t0: 0, next: 0, step: 0, key: 60 };

  function unlock() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        sfxBus = ctx.createGain();
        sfxBus.gain.value = 0.9;
        sfxBus.connect(ctx.destination);
        const len = ctx.sampleRate;
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        timer = setInterval(schedule, 40);
      }
      if (ctx.state !== 'running' && ctx.resume) {
        const p = ctx.resume();
        if (p && p.catch) p.catch(() => {});
      }
      return true;
    } catch (err) {
      ctx = null;
      return false;
    }
  }

  const ready = () => Boolean(ctx) && ctx.state !== 'closed';

  function tone(o) {
    if (!ready()) return;
    try {
      const t0 = o.at !== undefined ? o.at : ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(Math.max(20, o.f), t0);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.dur);
      if (o.vib) {
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        lfo.frequency.value = o.vib;
        lg.gain.value = o.f * 0.025;
        lfo.connect(lg);
        lg.connect(osc.frequency);
        lfo.start(t0);
        lfo.stop(t0 + o.dur + 0.05);
      }
      const vol = Math.max(0.0002, o.vol || 0.2);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      let node = osc;
      if (o.lp) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = o.lp;
        osc.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(o.dest || sfxBus);
      osc.start(t0);
      osc.stop(t0 + o.dur + 0.04);
    } catch (err) {
      /* a sound that can't play is not worth a crash */
    }
  }

  function hiss(o) {
    if (!ready()) return;
    try {
      const t0 = o.at !== undefined ? o.at : ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = o.type || 'bandpass';
      f.frequency.setValueAtTime(o.f, t0);
      if (o.f2) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + o.dur);
      f.Q.value = o.q || 1;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.vol || 0.2), t0 + (o.attack || 0.004));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      src.connect(f);
      f.connect(g);
      g.connect(o.dest || sfxBus);
      src.start(t0);
      src.stop(t0 + o.dur + 0.04);
    } catch (err) {
      /* ignore */
    }
  }

  const fx = {
    tick: () => tone({ f: 880, dur: 0.05, vol: 0.12, type: 'triangle' }),
    pop: () => tone({ f: 520, f2: 980, dur: 0.1, vol: 0.14, type: 'sine' }),
    beep: (n) => tone({ f: n === 0 ? 1046 : 523, dur: n === 0 ? 0.42 : 0.14, vol: 0.2, type: 'square', lp: 2400 }),
    scratch: () => {
      hiss({ f: 3400, f2: 260, dur: 0.38, vol: 0.34, q: 2.5 });
      tone({ f: 700, f2: 70, dur: 0.4, vol: 0.18, type: 'sawtooth', lp: 1800 });
    },
    thud: (i = 0) => {
      const k = 1 + (i % 3) * 0.08;
      tone({ f: 170 * k, f2: 48, dur: 0.2, vol: 0.4, type: 'sine' });
      hiss({ f: 500, type: 'lowpass', dur: 0.09, vol: 0.2 });
    },
    sit: (i = 0) => {
      const k = 1 + (i % 4) * 0.06;
      tone({ f: 660 * k, f2: 990 * k, dur: 0.12, vol: 0.22, type: 'triangle' });
      tone({ f: 1320 * k, dur: 0.14, vol: 0.14, type: 'sine', at: ctx ? ctx.currentTime + 0.07 : 0 });
    },
    bonk: () => {
      tone({ f: 240, f2: 90, dur: 0.18, vol: 0.28, type: 'square', lp: 1400 });
      hiss({ f: 900, dur: 0.07, vol: 0.12 });
    },
    bump: () => hiss({ f: 1200, f2: 4200, dur: 0.14, vol: 0.2, q: 1.2 }),
    hit: () => {
      tone({ f: 320, f2: 70, dur: 0.14, vol: 0.34, type: 'square', lp: 1600 });
      hiss({ f: 1800, dur: 0.06, vol: 0.2 });
    },
    wah: () => {
      if (!ready()) return;
      const t = ctx.currentTime;
      [[233, 0, 0.28], [220, 0.3, 0.28], [208, 0.6, 0.28], [185, 0.9, 0.8]].forEach(([f, at, dur], i) => tone({ f, f2: f * 0.97, dur, vol: 0.22, type: 'sawtooth', lp: 900, at: t + at, vib: i === 3 ? 6 : 0, attack: 0.03 }));
    },
    dun: () => {
      if (!ready()) return;
      const t = ctx.currentTime;
      tone({ f: 196, dur: 0.26, vol: 0.28, type: 'sawtooth', lp: 700, at: t });
      tone({ f: 147, dur: 0.5, vol: 0.3, type: 'sawtooth', lp: 600, at: t + 0.3 });
    },
    ha: () => {
      tone({ f: 700, f2: 300, dur: 0.14, vol: 0.2, type: 'triangle' });
      tone({ f: 500, f2: 220, dur: 0.2, vol: 0.18, type: 'triangle', at: ctx ? ctx.currentTime + 0.12 : 0 });
    },
    whoosh: () => hiss({ f: 400, f2: 2600, dur: 0.3, vol: 0.16, q: 0.8 }),
    cheer: () => {
      tone({ f: 420, f2: 880, dur: 0.28, vol: 0.18, type: 'sawtooth', lp: 1800, vib: 9 });
      hiss({ f: 3000, dur: 0.12, vol: 0.1 });
    },
    confetti: () => {
      hiss({ f: 4200, dur: 0.18, vol: 0.18, q: 0.7 });
      tone({ f: 300, f2: 120, dur: 0.1, vol: 0.2, type: 'sine' });
    },
    win: () => {
      if (!ready()) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ f, dur: 0.22, vol: 0.2, type: 'square', lp: 3000, at: t + i * 0.09 }));
      [523, 659, 784].forEach((f) => tone({ f, dur: 0.8, vol: 0.12, type: 'triangle', at: t + 0.5 }));
    },
    fanfare: () => {
      if (!ready()) return;
      const t = ctx.currentTime;
      [[523, 0, 0.12], [523, 0.14, 0.12], [523, 0.28, 0.12], [659, 0.42, 0.42], [587, 0.88, 0.16], [659, 1.06, 0.7], [784, 1.06, 0.7]].forEach(([f, at, dur]) =>
        tone({ f, dur, vol: 0.2, type: 'sawtooth', lp: 2200, at: t + at, attack: 0.012 }),
      );
    },
  };

  function sfx(name, arg) {
    try {
      if (!ready() || !fx[name]) return;
      fx[name](arg);
    } catch (err) {
      /* ignore */
    }
  }

  // ---------------------------------------------------------------- music: a step sequencer (16ths) with a lookahead

  function playStep(k, t) {
    const spb = 60 / music.bpm;
    const s16 = spb / 4;
    const bar = Math.floor(k / 16) % 4;
    const i = k % 16;
    const root = music.key + PROG[bar] - (PROG[bar] > 7 ? 12 : 0);
    const bus = musicBus;
    if (!bus) return;
    // drums: kick on the beat, clap on 2 and 4, hats between
    if (i % 4 === 0) {
      tone({ f: 150, f2: 45, dur: 0.16, vol: 0.42, type: 'sine', at: t, dest: bus });
    }
    if (i === 4 || i === 12) hiss({ f: 1700, dur: 0.12, vol: 0.2, q: 0.9, at: t, dest: bus });
    if (i % 2 === 0) hiss({ f: 7000, type: 'highpass', dur: i % 4 === 2 ? 0.05 : 0.025, vol: i % 4 === 2 ? 0.1 : 0.06, at: t, dest: bus });
    // bass: roots on the off-beats
    if (i === 0 || i === 3 || i === 6 || i === 8 || i === 11 || i === 14) tone({ f: midi(root - 12), dur: s16 * 2.2, vol: 0.3, type: 'triangle', at: t, dest: bus, lp: 700 });
    // chord stabs on the off-beats
    if (i === 2 || i === 6 || i === 10 || i === 14) {
      for (const off of QUAL[bar]) tone({ f: midi(root + off), dur: s16 * 1.4, vol: 0.05, type: 'square', at: t, dest: bus, lp: 1800 });
    }
    // the tune: an eight-note motif a bar (the last bar plays it backwards, the third a step higher)
    if (i % 2 === 0) {
      const motif = MOTIFS[music.song % MOTIFS.length];
      const idx = i / 2;
      const deg = bar === 3 ? motif[7 - idx] : motif[idx];
      if (deg > 0) {
        const note = music.key + MAJOR[(deg - 1 + (bar === 2 ? 1 : 0)) % 8] + 12;
        tone({ f: midi(note), dur: s16 * 1.8, vol: 0.09, type: 'square', at: t, dest: bus, lp: 3200 });
        tone({ f: midi(note + 12), dur: s16 * 1.2, vol: 0.025, type: 'triangle', at: t, dest: bus });
      }
    }
  }

  function schedule() {
    if (!ready() || !music.on || !musicBus) return;
    const spb = 60 / music.bpm;
    const s16 = spb / 4;
    if (ctx.currentTime - music.next > 0.4) music.next = ctx.currentTime + 0.03; // we were away: don't play catch-up
    while (music.next < ctx.currentTime + 0.18) {
      playStep(music.step, music.next);
      music.next += s16;
      music.step++;
    }
  }

  /** Starts (or keeps) the music: `song` picks the tune and key, `bpm` the speed, `vol` the level (0-1). */
  function musicOn(song, bpm, vol) {
    if (!ready()) return;
    const level = Math.max(0, Math.min(1, vol));
    if (music.on && music.song === song) {
      music.bpm = bpm;
      musicBus.gain.setTargetAtTime(level, ctx.currentTime, 0.08);
      return;
    }
    if (music.on) musicOff();
    music.on = true;
    music.song = song;
    music.bpm = bpm;
    music.key = KEYS[song % KEYS.length];
    music.step = 0;
    music.next = ctx.currentTime + 0.04;
    music.t0 = music.next;
    musicBus = ctx.createGain();
    musicBus.gain.value = level;
    musicBus.connect(ctx.destination);
  }

  function musicOff() {
    if (!music.on) return;
    music.on = false;
    const bus = musicBus;
    musicBus = null;
    if (bus && ctx) {
      try {
        bus.gain.cancelScheduledValues(ctx.currentTime);
        bus.gain.setTargetAtTime(0, ctx.currentTime, 0.008);
        setTimeout(() => {
          try {
            bus.disconnect();
          } catch (err) {
            /* ignore */
          }
        }, 400);
      } catch (err) {
        /* ignore */
      }
    }
  }

  /** The beat as a number of beats since the music began (0 when it isn't playing). */
  function beats() {
    if (!ready() || !music.on) return 0;
    return Math.max(0, (ctx.currentTime - music.t0) / (60 / music.bpm));
  }

  return { unlock, ready, sfx, musicOn, musicOff, beats, get playing() { return music.on; } };
}
