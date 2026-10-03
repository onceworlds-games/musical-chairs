// Measures the sound without listening: the real engine and band are scheduled into an OfflineAudioContext the way
// the game schedules them (a look-ahead pump fed by a frame clock), rendered, and checked in numbers: level, clipping,
// holes in the music, the kick against the beat grid, and how much a busy fight adds on top of the band.
// `npm run audio` (headless Chrome; fails on clipping, a hole in the music or a kick off the grid).
import { serve, launch, sleep } from './cdp.mjs';

const root = new URL('..', import.meta.url).pathname;
const { server, port } = await serve(`${root}game`);
const browser = await launch({ width: 400, height: 300 });
let failed = false;

const PAGE = `(async () => {
  const { Engine } = await import('/src/audio/engine.js');
  const { Music } = await import('/src/audio/music.js');
  const { WORLDS } = await import('/src/sim/data.js');
  const SR = 44100;

  /** Schedules a scenario into an offline context. script(vt, music, engine, step) is called every frame (1/60 s). */
  async function render({ world, seconds, script, layerAt }) {
    const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
    let vt = 0;
    Object.defineProperty(ctx, 'currentTime', { get: () => vt });
    Object.defineProperty(ctx, 'state', { get: () => 'running' });
    const e = new Engine();
    e.ctx = ctx;
    e.ok = true;
    e.build();
    e.latency = 0;
    const m = new Music(e);
    m.setWorld(WORLDS[world]);
    const bpm = WORLDS[world].bpm;
    let frame = 0;
    // The frame loop: the song clock is the page clock; the engine's pump schedules 120 ms ahead.
    for (; vt < seconds - 0.4; vt += 1 / 60, frame++) {
      m.setLayer(layerAt ? layerAt(vt) : 3, 0);
      e.sync(vt, bpm, false);
      if (script) script(vt, m, e, frame);
    }
    vt = seconds;
    const buf = await ctx.startRendering();
    return { buf, bpm };
  }

  const db = (x) => 20 * Math.log10(Math.max(1e-9, x));
  function stats(buf, from = 0) {
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const n = L.length;
    let peak = 0, clipped = 0, sum = 0, hf = 0;
    for (let i = Math.floor(from * SR); i < n; i++) {
      const a = Math.abs(L[i]), b = Math.abs(R[i]);
      const p = Math.max(a, b);
      if (p > peak) peak = p;
      if (p >= 0.9999) clipped++;
      sum += (L[i] * L[i] + R[i] * R[i]) / 2;
      if (i > 1) { const d = L[i] - 2 * L[i - 1] + L[i - 2]; hf += d * d; }
    }
    const count = n - Math.floor(from * SR);
    const rms = Math.sqrt(sum / count);
    // Short-term level: 400 ms windows.
    const win = Math.round(0.4 * SR);
    let lo = 1e9, hi = -1e9;
    for (let s = Math.floor(from * SR); s + win <= n; s += win) {
      let q = 0;
      for (let i = s; i < s + win; i++) q += (L[i] * L[i] + R[i] * R[i]) / 2;
      const d = db(Math.sqrt(q / win));
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    // Holes: 80 ms windows with nothing in them, after the first second.
    const hw = Math.round(0.08 * SR);
    let holes = 0, longest = 0, run = 0;
    for (let s = Math.floor(Math.max(from, 1) * SR); s + hw <= n; s += hw) {
      let q = 0;
      for (let i = s; i < s + hw; i++) q += L[i] * L[i] + R[i] * R[i];
      if (Math.sqrt(q / (2 * hw)) < 0.0006) { holes++; run++; longest = Math.max(longest, run); } else run = 0;
    }
    return { peak: +db(peak).toFixed(2), clipped, rms: +db(rms).toFixed(1), shortLo: +lo.toFixed(1), shortHi: +hi.toFixed(1), holes, longestHoleMs: longest * 80, hfDb: +db(Math.sqrt(hf / Math.max(1e-12, sum * count))).toFixed(1) };
  }

  /** Kick onsets (the low band's rises) against the beat grid. The band is rendered alone at layer 1: kick on every beat. */
  function grid(buf, bpm, from) {
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    const beat = 60 / bpm;
    // One-pole low-pass at ~110 Hz, then a 2 ms envelope.
    const a = 1 - Math.exp(-2 * Math.PI * 110 / SR);
    let y = 0;
    const env = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) { y += a * ((L[i] + R[i]) / 2 - y); env[i] = Math.abs(y); }
    const errs = [];
    for (let k = Math.ceil(from / beat); (k + 0.5) * beat < buf.duration - 0.2; k++) {
      // The strongest rise within +-60 ms of the beat is the kick's attack: take where it first crosses half its peak.
      const t0 = Math.floor((k * beat - 0.06) * SR), t1 = Math.floor((k * beat + 0.06) * SR);
      let pk = 0;
      for (let i = t0; i < t1; i++) pk = Math.max(pk, env[i]);
      if (pk < 0.004) continue;
      let at = t0;
      for (let i = t0; i < t1; i++) if (env[i] > pk * 0.5) { at = i; break; }
      errs.push((at / SR - k * beat) * 1000);
    }
    const mean = errs.reduce((s, x) => s + x, 0) / Math.max(1, errs.length);
    const sd = Math.sqrt(errs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / Math.max(1, errs.length));
    return { beats: errs.length, meanMs: +mean.toFixed(1), sdMs: +sd.toFixed(1), maxAbsDevMs: +Math.max(0, ...errs.map((x) => Math.abs(x - mean))).toFixed(1) };
  }

  const out = {};
  // 1. The band alone, layer by layer, in the calmest and the hottest world.
  for (const [name, world] of [['mint', 0], ['rose', 5], ['vermilion', 3]]) {
    const { buf, bpm } = await render({ world, seconds: 26, layerAt: (t) => (t < 6 ? 0 : t < 12 ? 1 : t < 18 ? 2 : t < 22 ? 3 : 4) });
    out['band-' + name] = { bpm, ...stats(buf, 1) };
    const { buf: kb } = await render({ world, seconds: 16, layerAt: () => 1 });
    out['grid-' + name] = grid(kb, bpm, 2);
  }
  // 2. A hub: the quietest thing the game plays.
  { const { buf } = await render({ world: 0, seconds: 12, layerAt: () => 0 }); out.hub = stats(buf, 1); }
  // 3. The loudest fight: Overdrive, four players firing every sixteenth, kills on every one, chords, hops, zaps.
  for (const [name, world] of [['mint', 0], ['rose', 5]]) {
    const { buf } = await render({
      world, seconds: 24, layerAt: () => 4,
      script: (vt, m, e, frame) => {
        const t16 = 60 / WORLDS[world].bpm / 4;
        const k = Math.floor(vt / t16);
        if (k !== e._k) {
          e._k = k;
          for (let p = 0; p < 4; p++) m.shot((k * 3 + p * 5) % 16, 16, true, p, k % 4 === 0, p === 0);
          for (let q = 0; q < 3; q++) m.kill(1 + ((k + q) % 10), (k * 7 + q * 5) % 16, 16, true, q === 0 && k % 8 === 0);
          if (k % 16 === 3) m.chordBurst(4);
          if (k % 16 === 8) m.perfect();
          if (k % 8 === 5) m.hop(true);
          if (k % 4 === 2) m.boom();
          if (k % 32 === 17) m.overdrive(true);
          if (k % 24 === 11) m.pickup(1 + (k % 3));
          if (k % 9 === 4) m.hit();
        }
        if (Math.abs(vt - 12) < 1 / 120) m.zap();
        if (Math.abs(vt - 17) < 1 / 120) m.down('stop');
        if (Math.abs(vt - 20) < 1 / 120) m.bossDown();
      },
    });
    out['fight-' + name] = stats(buf, 1);
  }
  return out;
})()`;

try {
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?poster=none` });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if ((await browser.evaluate('window.__posterReady === true')) === true) break;
  }
  const res = await browser.evaluate(PAGE);
  if (!res || res.error) throw new Error(res?.error || 'no result');
  const rows = Object.entries(res);
  for (const [name, r] of rows) console.log(name.padEnd(16), JSON.stringify(r));
  // The bars the sound is held to.
  const bad = [];
  for (const [name, r] of rows) {
    if (name.startsWith('grid-')) {
      if (r.beats < 8) bad.push(`${name}: only ${r.beats} kicks found`);
      if (r.sdMs > 4) bad.push(`${name}: kicks wander ${r.sdMs} ms`);
      continue;
    }
    if (r.clipped > 0) bad.push(`${name}: ${r.clipped} clipped samples`);
    if (r.peak > -0.5) bad.push(`${name}: peak ${r.peak} dBFS`);
    if (r.holes > 0) bad.push(`${name}: ${r.holes} empty 80 ms windows`);
  }
  if (res['fight-mint'] && res['band-mint'] && res['fight-mint'].rms - res.hub.rms > 14) bad.push('a fight is more than 14 dB louder than the hub');
  if (bad.length) {
    failed = true;
    console.log('\nFAIL\n  ' + bad.join('\n  '));
  } else console.log('\nOK');
} catch (e) {
  failed = true;
  console.log(String(e?.message || e));
} finally {
  browser.close();
  server.close();
}
process.exit(failed ? 1 : 0);
