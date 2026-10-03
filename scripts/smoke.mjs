// The smoke test: serves game/, opens it in headless Chrome with the test hook and the autopilot, and plays from the
// title through a whole zone into the draft, at a desktop and at a phone size (touch). Any uncaught error or console
// error fails it. `npm run smoke` (set SMOKE_OUT=<dir> to keep a screenshot of each screen).
import { writeFileSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const root = new URL('..', import.meta.url).pathname;
const out = process.env.SMOKE_OUT;
const sizes = [
  ['desktop', 1100, 760, false],
  ['phone', 390, 844, true],
];

const { server, port } = await serve(`${root}game`);
let failed = false;
try {
  for (const [name, width, height, touch] of sizes) {
    const b = await launch({ width, height });
    const errors = [];
    b.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text);
    });
    const shot = async (what) => {
      if (!out) return;
      const r = await b.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(`${out}/smoke-${name}-${what}.png`, Buffer.from(r.result.data, 'base64'));
    };
    const state = () =>
      b.evaluate(`(() => { const a = window.__rimshot; if (!a) return null; const s = a.session, w = s.world, r = s.run;
        return { screen: a.screen, phase: w ? w.phase : -1, step: w ? w.step : 0, score: r ? r.score : 0, status: r ? r.status : '', lobby: s.lobbyScreen() }; })()`);
    try {
      if (touch) await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await b.send('Page.navigate', { url: `http://127.0.0.1:${port}/?test=bot` });
      let st = null;
      for (let i = 0; i < 100 && !st; i++) (await sleep(100)), (st = await state());
      if (!st) throw new Error('the game never came up');
      await sleep(1500);
      await shot('title');
      await b.evaluate(`(() => { const a = window.__rimshot; a.profile.first = false; a.press('play'); return 1; })()`);
      await sleep(800);
      await shot('hub');
      await b.evaluate(`window.__rimshot.press('start'), 1`);
      // The autopilot flies the zone; it ends in the draft (or, rarely, in the results).
      const t0 = Date.now();
      let mid = false;
      for (;;) {
        await sleep(500);
        st = await state();
        if (!mid && st.phase === 1 && Date.now() - t0 > 20000) (mid = true), await shot('play');
        if (st.status === 'draft' || st.status === 'over') break;
        if (Date.now() - t0 > 150000) throw new Error(`the zone never ended (${JSON.stringify(st)})`);
      }
      await sleep(800);
      await shot(st.status);
      console.log(`${name}: zone played in ${((Date.now() - t0) / 1000).toFixed(0)} s, run ${st.status}, score ${st.score}`);
    } catch (e) {
      errors.push(String(e?.message || e));
    } finally {
      b.close();
    }
    if (errors.length) {
      failed = true;
      console.log(`${name}: ${errors.length} error(s)\n  ${errors.slice(0, 10).join('\n  ')}`);
    } else console.log(`${name}: no errors`);
  }
} finally {
  server.close();
}
process.exit(failed ? 1 : 0);
