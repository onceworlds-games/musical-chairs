// The comfort check: plays the real game on a virtual 60 Hz clock (so a slow machine still sees every frame), forces
// the loudest moments (Overdrive, chord bursts, zaps, falls, a boss) and measures what the screen does in numbers:
// how much of it changes by 10% of white or more between frames (the general-flash test), how often the picture
// swings, and, with Calm on, that shake, colour split and the zap's wash are gone. `npm run comfort`.
import { serve, launch, sleep } from './cdp.mjs';

const root = new URL('..', import.meta.url).pathname;
const { server, port } = await serve(`${root}game`);
let failed = false;

// The virtual clock: the page's frame loop, Date.now and performance.now move only when the script steps them.
const CLOCK = `(() => {
  let T = 0; const base = 1.8e12; let cb = null;
  Date.now = () => base + T;
  performance.now = () => T;
  window.requestAnimationFrame = (f) => { cb = f; return 1; };
  window.cancelAnimationFrame = () => {};
  window.__step = (ms) => { T += ms; const f = cb; cb = null; if (f) f(T); };
})()`;

const PAGE = (scene, seconds, calm) => `(async () => {
  const app = window.__rimshot;
  app.profile.first = false;
  app.profile.calm = ${calm};
  app.applyQuality();
  app.press('play');
  app.session.setHub({ mode: 'practice', pw: ${scene.world}, pl: ${scene.level}, pt: 3 });
  for (let i = 0; i < 6; i++) window.__step(16.667);
  app.press('start');
  await new Promise((r) => setTimeout(r, 30)); // the room starts the match on a microtask
  for (let i = 0; i < 12; i++) { window.__step(16.667); await new Promise((r) => setTimeout(r, 0)); }
  if (!app.session.world) throw new Error('the zone never started');
  const cv = document.getElementById('screen');
  const sm = document.createElement('canvas');
  const SW = 48, SH = 30;
  sm.width = SW; sm.height = SH;
  const sc = sm.getContext('2d', { willReadFrequently: true });
  sc.imageSmoothingEnabled = true;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lut = new Float32Array(256); for (let i = 0; i < 256; i++) lut[i] = lin(i);
  const lum = (d, i) => 0.2126 * lut[d[i]] + 0.7152 * lut[d[i + 1]] + 0.0722 * lut[d[i + 2]];
  let prev = null, frames = 0;
  const R = { frames: 0, maxMean: 0, maxMeanStep: 0, maxBlockFrac: 0, maxShake: 0, maxFlash: 0, swings: [], means: [], blocksOver: 0, maxChange: 0, zaps: 0, downs: 0, od: 0 };
  const total = Math.round(${seconds} * 60);
  for (let f = 0; f < total; f++) {
    window.__step(16.667);
    if (f % 30 === 0) await new Promise((r) => setTimeout(r, 0));
    const w = app.session.world;
    if (w && w.auth) {
      // Stress: Overdrive whenever it is off, a zap and a fall now and then (the loudest things the game does).
      if (!w.overdrive && f % 300 === 150) w.addRes(100);
      if (f % 420 === 200 && w.ships[0].zaps > 0) { w.ships[0].in.zap = true; R.zaps++; }
      if (f % 540 === 270 && w.ships[0].state === 'live') { w.down(w.ships[0], 3, true); R.downs++; }
      if (w.overdrive) R.od++;
    }
    R.maxShake = Math.max(R.maxShake, Math.abs(app.play.shake[0]) + Math.abs(app.play.shake[1]));
    R.maxFlash = Math.max(R.maxFlash, app.play.flash);
    sc.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, SW, SH);
    const d = sc.getImageData(0, 0, SW, SH).data;
    let mean = 0;
    const cur = new Float32Array(SW * SH);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) { cur[p] = lum(d, i); mean += cur[p]; }
    mean /= SW * SH;
    R.means.push(mean);
    if (prev) {
      let over = 0, big = 0;
      for (let p = 0; p < cur.length; p++) { const c = Math.abs(cur[p] - prev[p]); if (c >= 0.1) over++; if (c > R.maxChange) R.maxChange = c; }
      // Blocks of 16 x 10 samples (a quarter of the width and a quarter of the height is 1/16 of the screen).
      R.maxBlockFrac = Math.max(R.maxBlockFrac, over / cur.length);
      R.blocksOver += over > 0 ? 1 : 0;
      R.maxMeanStep = Math.max(R.maxMeanStep, Math.abs(mean - prev.mean));
    }
    cur.mean = mean;
    prev = cur;
    R.maxMean = Math.max(R.maxMean, mean);
  }
  R.frames = total;
  // How often the picture swings: reversals of the mean level larger than 0.004 (a quarter of a percent of white... times 1)
  // in any second.
  const m = R.means; const win = 60; let worst = 0;
  const extrema = [];
  for (let i = 1; i < m.length - 1; i++) {
    if ((m[i] > m[i - 1] && m[i] >= m[i + 1]) || (m[i] < m[i - 1] && m[i] <= m[i + 1])) extrema.push([i, m[i]]);
  }
  const swings = [];
  for (let k = 1; k < extrema.length; k++) if (Math.abs(extrema[k][1] - extrema[k - 1][1]) >= 0.004) swings.push(extrema[k][0]);
  for (let i = 0; i < swings.length; i++) {
    let c = 0; for (let j = i; j < swings.length && swings[j] - swings[i] < win; j++) c++;
    worst = Math.max(worst, c);
  }
  const lo = Math.min(...m), hi = Math.max(...m);
  delete R.means; delete R.swings;
  R.swingsPerSecMax = worst; // reversals per second at 0.4% of white or more: 6 would be a 3 Hz flicker
  R.meanRange = [+lo.toFixed(4), +hi.toFixed(4)];
  return R;
})()`;

const scenes = [
  ['vermilion', { world: 3, level: 3 }, 24],
  ['maestro', { world: 5, level: 4 }, 24],
];
const results = [];
try {
  for (const calm of [false, true]) {
    for (const [name, scene, seconds] of scenes) {
      const b = await launch({ width: 480, height: 300 });
      const errors = [];
      b.on((m) => {
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      });
      try {
        await b.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK });
        await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/?test=bot` });
        for (let i = 0; i < 100; i++) {
          await sleep(100);
          if (await b.evaluate('!!window.__rimshot && !!window.__step')) break;
        }
        await sleep(300);
        const r = await b.evaluate(PAGE(scene, seconds, calm));
        if (!r || r.error) throw new Error(r?.error || 'no result');
        results.push({ name: `${name}${calm ? ' (calm)' : ''}`, r, errors });
        console.log(`${(name + (calm ? ' calm' : '')).padEnd(20)}`, JSON.stringify(r), errors.length ? `ERRORS ${errors}` : '');
      } finally {
        b.close();
      }
    }
  }
  const bad = [];
  for (const { name, r, errors } of results) {
    // The general flash test: no more than three flashes a second, none over a third of the screen. A flash is a change
    // of 10% of white or more; here nothing ever changes that much over more than a few cells.
    if (r.maxBlockFrac > 0.02) bad.push(`${name}: ${(r.maxBlockFrac * 100).toFixed(1)}% of the screen changes by 10% of white in one frame`);
    if (r.swingsPerSecMax > 6) bad.push(`${name}: the picture swings ${r.swingsPerSecMax} times in a second`);
    if (r.maxMeanStep > 0.03) bad.push(`${name}: the whole picture jumps ${r.maxMeanStep.toFixed(3)} in one frame`);
    if (errors.length) bad.push(`${name}: ${errors.length} page errors`);
    if (name.includes('calm') && (r.maxShake > 0 || r.maxFlash > 0)) bad.push(`${name}: Calm still shakes (${r.maxShake}) or washes (${r.maxFlash})`);
  }
  if (bad.length) {
    failed = true;
    console.log('\nFAIL\n  ' + bad.join('\n  '));
  } else console.log('\nOK');
} catch (e) {
  failed = true;
  console.log(String(e?.message || e));
} finally {
  server.close();
}
process.exit(failed ? 1 : 0);
