// A tiny static server for dist/ and a headless Chrome driven over the
// DevTools protocol (used by the smoke test and the store-art capture).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };

export function serve(dir, port = 0) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let file = join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(port, '127.0.0.1', () => r({ server, port: server.address().port })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CHROME: the browser to drive (Chrome for Testing if it's installed, else
// Google Chrome); CDP_PORT: its DevTools port (0 picks a free one).
const TESTING = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const CHROME = process.env.CHROME ?? (existsSync(TESTING) ? TESTING : '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

export async function launch({ width = 1280, height = 720, gpu = false } = {}) {
  const profile = mkdtempSync(join(process.env.TMP_PROFILES ?? tmpdir(), 'hb-chrome-'));
  const args = [
    '--headless=new',
    '--hide-scrollbars',
    '--mute-audio',
    `--remote-debugging-port=${Number(process.env.CDP_PORT ?? 0)}`,
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    'about:blank',
  ];
  if (!gpu) args.unshift('--disable-gpu-sandbox');
  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  // Never leave a browser behind, even when a test crashes.
  process.on('exit', () => {
    try {
      chrome.kill('SIGKILL');
    } catch {}
  });
  let port = Number(process.env.CDP_PORT ?? 0);
  for (let i = 0; i < 300 && !port; i++) {
    try {
      port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]);
    } catch {}
    if (!port) await sleep(100);
  }
  let page;
  for (let i = 0; i < 300 && !page; i++) {
    try {
      page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
    } catch {}
    if (!page) await sleep(100);
  }
  const main = await connectPage(page.webSocketDebuggerUrl, width, height);
  return {
    ...main,
    port,
    /** Another tab in the same browser (shares BroadcastChannel and storage). */
    async open(url) {
      const res = await main.send('Target.createTarget', { url: 'about:blank' });
      const id = res.result.targetId;
      let t;
      for (let i = 0; i < 50 && !t; i++) {
        t = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((x) => x.id === id);
        if (!t) await sleep(100);
      }
      const pg = await connectPage(t.webSocketDebuggerUrl, width, height);
      await pg.send('Page.navigate', { url });
      return pg;
    },
    close: () => {
      main.closeWs();
      try {
        chrome.kill('SIGKILL');
      } catch {}
    },
  };
}

async function connectPage(wsUrl, width, height) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method) for (const fn of listeners) fn(msg);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.result?.exceptionDetails) return { error: res.result.exceptionDetails.exception?.description ?? res.result.exceptionDetails.text };
    return res.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  return {
    send,
    evaluate,
    on: (fn) => listeners.push(fn),
    closeWs: () => {
      try {
        ws.close();
      } catch {}
    },
    closeTab: () => send('Page.close'),
  };
}

export { sleep };
