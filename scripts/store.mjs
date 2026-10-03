// Store art from the game's own renderer: serves game/, opens each ?poster= scene in headless Chrome at its size and
// writes the PNGs to store/ (thumbnails 1280x720, the icon 512x512, badge icons 256x256). `npm run store`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { serve, launch, sleep } from './cdp.mjs';

const root = new URL('..', import.meta.url).pathname;
const shots = [
  ['thumb1', 1280, 720, 'store/thumb-1.png'],
  ['thumb2', 1280, 720, 'store/thumb-2.png'],
  ['thumb3', 1280, 720, 'store/thumb-3.png'],
  ['thumb4', 1280, 720, 'store/thumb-4.png'],
  ['icon', 512, 512, 'store/icon.png'],
];
const badges = ['first-zone', 'perfect-bar', 'chord-master', 'overdrive', 'hydra-down', 'conductor-down', 'maestro-down', 'flawless', 'tethered', 'overclock-4', 'daily-run', 'deep-descent'];
for (const b of badges) shots.push([`badge-${b}`, 256, 256, `store/badges/${b}.png`]);
const only = process.argv.slice(2);

mkdirSync(`${root}store/badges`, { recursive: true });
const { server, port } = await serve(`${root}game`);
try {
  for (const [kind, w, h, file] of shots) {
    if (only.length && !only.some((o) => kind.includes(o))) continue;
    const browser = await launch({ width: w, height: h });
    try {
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${port}/?poster=${kind}` });
      let ready = false;
      for (let i = 0; i < 200 && !ready; i++) {
        await sleep(100);
        ready = (await browser.evaluate('window.__posterReady === true')) === true;
      }
      if (!ready) throw new Error(`${kind}: the poster never finished`);
      await sleep(150);
      const res = await browser.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
      writeFileSync(`${root}${file}`, Buffer.from(res.result.data, 'base64'));
      console.log(`${file}`);
    } finally {
      browser.close();
    }
  }
} finally {
  server.close();
}
