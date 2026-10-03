// Every call to the Onceworlds SDK goes through here. The SDK is absent when the page runs on its own (posters, a
// plain local server): then saves live in memory, there are no badges or boards, and rooms.join gives a local room
// that keeps a match the way the platform's rooms do, so the game runs the same code alone. Nothing here throws.

const sdk = typeof window !== 'undefined' && window.onceworlds && typeof window.onceworlds === 'object' ? window.onceworlds : null;

function safe(fn, fallback) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

async function safeAsync(fn, fallback) {
  try {
    const v = await fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

const memory = new Map();
const listeners = new Map();

export const platform = {
  get present() {
    return Boolean(sdk) && safe(() => sdk.mode, 'standalone') !== 'standalone';
  },
  get sdk() {
    return sdk;
  },
  now() {
    return safe(() => (sdk && typeof sdk.now === 'function' ? sdk.now() : Date.now()), Date.now());
  },

  // ---------------------------------------------------------------- saves
  save: {
    async get(key) {
      if (!sdk?.save) return memory.has(key) ? structuredCloneSafe(memory.get(key)) : null;
      return safeAsync(() => sdk.save.get(key), null);
    },
    async set(key, value) {
      if (!sdk?.save) {
        memory.set(key, structuredCloneSafe(value));
        return true;
      }
      return safeAsync(() => sdk.save.set(key, value).then(() => true), false);
    },
  },

  // ---------------------------------------------------------------- badges, boards
  award(id) {
    if (!sdk?.badges) return Promise.resolve(false);
    return safeAsync(() => sdk.badges.award(id), false);
  },
  submit(board, score) {
    if (!sdk?.leaderboards || !Number.isFinite(score) || score <= 0) return Promise.resolve(null);
    return safeAsync(() => sdk.leaderboards.submit(board, Math.floor(score)), null);
  },

  // ---------------------------------------------------------------- player
  async player() {
    if (!sdk?.player) return { id: 'me', name: 'YOU', guest: true };
    return safeAsync(() => sdk.player.get(), { id: 'me', name: 'YOU', guest: true });
  },
  async avatar(id) {
    if (!sdk?.player?.avatarUrl) return null;
    return safeAsync(() => sdk.player.avatarUrl(id, 'head'), null);
  },

  // ---------------------------------------------------------------- touch controls and settings
  setControls(layout) {
    if (!sdk?.controls) return;
    safe(() => sdk.controls.set(layout));
  },
  get touch() {
    return safe(() => Boolean(sdk?.controls?.touch), false);
  },
  pressed(id) {
    return safe(() => Boolean(sdk?.controls?.pressed?.(id)), false);
  },
  get quality() {
    return safe(() => sdk?.settings?.quality, 'high') || 'high';
  },
  get reducedMotion() {
    const media = safe(() => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches : false), false);
    return safe(() => (sdk?.settings ? Boolean(sdk.settings.reducedMotion) : media), media);
  },
  pixelRatio(max = 2) {
    const fallback = Math.min(max, (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1) || 1);
    const pr = safe(() => (sdk?.settings?.pixelRatio ? sdk.settings.pixelRatio(max) : fallback), fallback);
    return Number.isFinite(pr) && pr > 0 ? Math.min(max, pr) : fallback;
  },
  onSettings(fn) {
    if (!sdk?.settings?.on) return () => {};
    return safe(() => sdk.settings.on('change', fn), () => {});
  },
  on(event, fn) {
    if (!sdk?.on) return () => {};
    return safe(() => sdk.on(event, fn), () => {});
  },
  showInvite() {
    safe(() => sdk?.ui?.showInvite?.());
  },
  setOrientation(o) {
    safe(() => sdk?.ui?.setOrientation?.(o));
  },

  // ---------------------------------------------------------------- rooms
  /** Joins (or, standalone, makes a local room). Resolves with the room, or null if joining failed. */
  async join(options) {
    if (sdk?.rooms?.join) {
      try {
        return await sdk.rooms.join(options);
      } catch (err) {
        if (safe(() => sdk.mode, '') !== 'standalone') {
          console.warn('join failed', err);
          return null;
        }
      }
    }
    return new LocalRoom(options);
  },
};

function structuredCloneSafe(v) {
  try {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  } catch {
    return null;
  }
}

/**
 * A room with nobody else in it, for a page that runs without the platform: the same match cycle (lobby, play,
 * pause, end), the same clocks and the same events the game listens to.
 */
export class LocalRoom {
  constructor(options = {}) {
    this.options = options;
    this.kind = 'solo';
    this.me = { id: 'me', name: 'YOU', presence: null, team: 0, connected: true };
    this.players = new Map([[this.me.id, this.me]]);
    this.host = this.me.id;
    this.state = {};
    this.private = {};
    this.connected = true;
    this.budget = { messagesPerSecond: 60, presenceHz: 20, bytesPerSecond: 131072 };
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.handlers = new Map();
    this.invite = null;
    this.closed = false;
  }
  get isHost() {
    return true;
  }
  get online() {
    return [...this.players.values()];
  }
  get participants() {
    return this.match.phase === 'lobby' ? [] : [this.me];
  }
  get spectators() {
    return [];
  }
  get spectating() {
    return false;
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  get canStart() {
    return this.match.phase === 'lobby';
  }
  get allReady() {
    return true;
  }
  get notReady() {
    return [];
  }
  get leftOut() {
    return [];
  }
  isParticipant(id = this.me.id) {
    return this.match.phase !== 'lobby' && id === this.me.id;
  }
  matchNow() {
    const m = this.match;
    if (m.phase !== 'playing' || m.startedAt === undefined) return 0;
    const now = Date.now();
    const waited = (m.pausedMs || 0) + (m.paused ? Math.max(0, now - m.paused.since) : 0);
    return Math.max(0, now - m.startedAt - waited);
  }
  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }
  emit(event, ...args) {
    for (const fn of [...(this.handlers.get(event) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(err);
      }
    }
  }
  setMatch(next) {
    const previous = this.match;
    this.match = next;
    this.emit('match', next, previous);
    if (next.phase === 'starting' && previous.phase !== 'starting') this.emit('starting', next);
    if (next.phase === 'playing' && previous.phase !== 'playing') this.emit('matchstart', next);
    if (next.phase === 'lobby' && previous.phase !== 'lobby') this.emit('matchend', next, previous);
    if (next.paused && !previous.paused) this.emit('matchpause', next);
    if (!next.paused && previous.paused && next.phase === 'playing') this.emit('matchresume', next);
  }
  startMatch() {
    if (this.match.phase !== 'lobby') return;
    const n = this.match.n + 1;
    const id = `local${n}.${Math.floor(Math.random() * 1e9)}`;
    queueMicrotask(() =>
      this.setMatch({ phase: 'playing', n, min: 1, id, seed: Math.floor(Math.random() * 2 ** 32), participants: [this.me.id], startedAt: Date.now(), pausedMs: 0 }),
    );
  }
  endMatch() {
    if (this.match.phase === 'lobby') return;
    queueMicrotask(() => this.setMatch({ phase: 'lobby', n: this.match.n, min: 1 }));
  }
  pauseMatch(paused = true) {
    const m = this.match;
    if (m.phase !== 'playing') return;
    const now = Date.now();
    if (paused && !m.paused) this.setMatch({ ...m, paused: { since: now, reason: 'host' } });
    else if (!paused && m.paused) {
      const { paused: held, ...rest } = m;
      this.setMatch({ ...rest, pausedMs: (m.pausedMs || 0) + Math.max(0, now - held.since) });
    }
  }
  setState(key, value) {
    if (value === null || value === undefined) delete this.state[key];
    else this.state[key] = structuredCloneSafe(value);
    this.emit('state', key, this.state[key] ?? null, this.me.id);
  }
  setPresence(p) {
    this.me.presence = p;
  }
  presenceAt(id) {
    return this.players.get(id)?.presence ?? null;
  }
  setPrivate(key, value) {
    if (value === null) delete this.private[key];
    else this.private[key] = structuredCloneSafe(value);
  }
  privateOf(id) {
    return id === this.me.id ? this.private : {};
  }
  setPrivateFor() {}
  send() {}
  setReady() {}
  clearReady() {}
  admit() {}
  hideLobby() {}
  setOpen() {}
  transferHost() {}
  leave() {
    this.closed = true;
  }
}
