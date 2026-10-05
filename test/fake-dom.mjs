// A just-enough browser for running main.js in node: a canvas whose context accepts every call, window and document
// stand-ins, key and pointer events, an animation-frame loop you drive by hand and a fake Web Audio. Not a test itself.

export function fakeCtx(hashing = false) {
  const state = { globalAlpha: 1, lineWidth: 1, font: '10px sans', textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '#000', strokeStyle: '#000', lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, globalCompositeOperation: 'source-over' };
  const grad = { addColorStop() {} };
  let depth = 0;
  let hash = 2166136261; // a running hash of everything drawn: two identical pictures draw identically
  const mix = (v) => {
    if (!hashing) return;
    const t = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
    for (let i = 0; i < t.length; i++) hash = Math.imul(hash ^ t.charCodeAt(i), 16777619) >>> 0;
  };
  return new Proxy(
    {},
    {
      get(t, k) {
        if (k === 'measureText') return (s) => ({ width: String(s).length * 9 });
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
        if (k === 'save') return () => depth++;
        if (k === 'restore') return () => {
          depth--;
          if (depth < 0) throw new Error('restore without save');
        };
        if (k === 'drawImage') return (img) => {
          if (!img) throw new Error('drawImage of nothing');
        };
        if (k === 'depth') return depth;
        if (k === 'hash') return hash;
        if (k in state) return state[k];
        // every other call: like a real canvas, refuse what would throw there, and flag NaN (which a real one silently skips)
        return (...args) => {
          if (hashing) {
            mix(String(k));
            for (const a of args) mix(a);
          }
          for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`canvas ${String(k)}() called with ${a}`);
          if (k === 'arc' && args[2] < 0) throw new Error('arc with a negative radius');
          if (k === 'ellipse' && (args[2] < 0 || args[3] < 0)) throw new Error('ellipse with a negative radius');
          if (k === 'arcTo' && args[4] < 0) throw new Error('arcTo with a negative radius');
        };
      },
      set(t, k, v) {
        if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`canvas property ${String(k)} set to ${v}`);
        if (hashing) {
          mix(String(k));
          mix(v);
        }
        state[k] = v;
        return true;
      },
    },
  );
}

class FakeAudioParam {
  constructor() {
    this.value = 0;
  }
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}

export class FakeAudioContext {
  get currentTime() {
    return (Date.now() - this.t0) / 1000;
  }
  constructor() {
    this.t0 = Date.now();
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.destination = {};
    this.nodes = 0;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  createGain() {
    this.nodes++;
    return { gain: new FakeAudioParam(), connect() {}, disconnect() {} };
  }
  createOscillator() {
    this.nodes++;
    return { type: '', frequency: new FakeAudioParam(), connect() {}, start() {}, stop() {} };
  }
  createBiquadFilter() {
    this.nodes++;
    return { type: '', frequency: new FakeAudioParam(), Q: new FakeAudioParam(), connect() {} };
  }
  createBuffer(ch, len) {
    return { getChannelData: () => new Float32Array(len) };
  }
  createBufferSource() {
    this.nodes++;
    return { buffer: null, loop: false, connect() {}, start() {}, stop() {} };
  }
}

const dom = { page: null, pending: new Set(), shared: null };

export function installGlobals({ width = 844, height = 390 } = {}) {
  if (dom.shared) return dom.shared;
  const g = globalThis;
  g.window = g;
  g.innerWidth = width;
  g.innerHeight = height;
  g.devicePixelRatio = 2;
  g.location = { search: '' };
  g.AudioContext = FakeAudioContext;
  g.Image = class {
    constructor() {
      this.complete = false;
      this.naturalWidth = 0;
    }
    set src(v) {
      this._src = v;
      this.complete = true;
      this.naturalWidth = 10;
      if (this.onload) this.onload();
    }
  };
  g.requestAnimationFrame = (fn) => {
    if (!fn.page) fn.page = dom.page;
    dom.pending.add(fn);
    return 1;
  };
  g.matchMedia = () => ({ matches: false });
  g.addEventListener = (type, fn) => {
    if (!dom.page) return;
    (dom.page.listeners[type] ||= []).push(fn);
  };
  g.document = {
    getElementById: () => dom.page.canvas,
    createElement: () => makeCanvas(),
    body: { style: {}, dataset: {} },
    fonts: { load: async () => [], ready: Promise.resolve() },
    activeElement: null,
    addEventListener: () => {},
  };
  dom.shared = { width, height };
  return dom.shared;
}

function makeCanvas(hashing = false) {
  const listeners = {};
  return {
    width: 0,
    height: 0,
    style: {},
    ctx: null,
    getContext() {
      if (!this.ctx) this.ctx = fakeCtx(hashing);
      return this.ctx;
    },
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 844, height: 390 }),
    listeners,
  };
}

/** A page (a tab): its own canvas and its own listeners. Import main.js right after calling this. */
export function newPage(ow, { hash = false } = {}) {
  const page = { canvas: makeCanvas(hash), listeners: {}, ow };
  dom.page = page;
  globalThis.onceworlds = ow;
  page.key = (type, code, extra = {}) => {
    for (const fn of page.listeners[type] || []) fn({ code, key: code, repeat: false, preventDefault() {}, isTrusted: true, ...extra });
  };
  page.pointer = (x, y) => {
    for (const fn of page.canvas.listeners.pointerdown || []) fn({ clientX: x, clientY: y, button: 0 });
  };
  page.pressKey = (code) => {
    page.key('keydown', code);
  };
  page.releaseKey = (code) => {
    page.key('keyup', code);
  };
  return page;
}

export function runFrame(ts) {
  const fns = [...dom.pending];
  dom.pending.clear();
  for (const fn of fns) {
    if (fn.page && fn.page.stopped) continue; // a closed tab
    fn(ts);
  }
}

export function pendingFrames() {
  return dom.pending.size;
}

/** A platform stand-in for one page: everything the game calls on window.onceworlds. */
export function makeOw(room, extra = {}) {
  const calls = { badges: [], saves: {}, scores: [], controls: [], orientation: [] };
  const ow = {
    calls,
    rooms: { join: async () => room, on() {}, current: room },
    ui: { setOrientation: (o) => calls.orientation.push(o), setMenuPosition() {}, requestFullscreen() {}, showInvite() {} },
    controls: {
      stick: { x: 0, y: 0 },
      touch: false,
      held: new Set(),
      set(opts) {
        calls.controls.push(opts);
      },
      pressed(id) {
        return ow.controls.held.has(id);
      },
    },
    settings: { quality: 'high', reducedMotion: false, scale: 1, choice: 'auto', pixelRatio: () => 1, on() {} },
    now: () => Date.now(),
    save: {
      get: async (k) => calls.saves[k] ?? null,
      set: async (k, v) => {
        calls.saves[k] = JSON.parse(JSON.stringify(v));
      },
    },
    badges: {
      award: async (id) => {
        calls.badges.push(id);
        return true;
      },
    },
    leaderboards: {
      submit: async (b, s) => {
        calls.scores.push([b, s]);
        return null;
      },
    },
    player: { get: async () => ({ id: room.me.id, name: room.me.name }), avatarUrl: async (id) => `https://example.test/avatar/${id}/head.svg` },
    ...extra,
  };
  return ow;
}
