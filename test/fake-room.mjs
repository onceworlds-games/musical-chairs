// A small stand-in for the platform's rooms: several pages (FakeRoom, the same surface as the SDK's Room for what the game
// uses) joined to one FakeServer, with latency, a host, ready flags, a public server's countdown and match, presence,
// shared state and messages stamped with the room's clock. Not a test itself.

export class FakeServer {
  constructor({ latency = 40, seed = 777 } = {}) {
    this.latency = latency;
    this.seed = seed;
    this.clients = new Map();
    this.order = [];
    this.hostId = null;
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.state = {};
    this.ready = new Set();
    this.log = [];
  }

  now() {
    return Date.now();
  }

  later(fn, ms = this.latency) {
    setTimeout(fn, ms);
  }

  matchNow() {
    const m = this.match;
    return m.phase === 'playing' && m.startedAt !== undefined ? this.now() - m.startedAt : 0;
  }

  join(id, name) {
    const room = new FakeRoom(this, id, name);
    for (const other of this.clients.values()) {
      room.players.set(other.me.id, { id: other.me.id, name: other.me.name, presence: other.me.presence, team: 0, ...(this.ready.has(other.me.id) ? { ready: true } : {}) });
    }
    room.state = JSON.parse(JSON.stringify(this.state));
    room.host = this.hostId ?? id;
    room.match = JSON.parse(JSON.stringify(this.match));
    if (room.match.phase !== 'lobby') room.frozen = { ...room.chosen() };
    this.clients.set(id, room);
    this.order.push(id);
    if (!this.hostId) this.hostId = id;
    for (const other of this.clients.values()) {
      if (other === room) continue;
      this.later(() => other.apply(() => {
        other.players.set(id, { id, name, presence: null, team: 0 });
        other.emit('join', other.players.get(id));
      }));
    }
    return room;
  }

  /**
   * A page reload: the same player comes back with a new page (their seat held, their last presence handed back). If they were
   * the host the role has moved to someone else, and stays there.
   */
  reload(id) {
    const old = this.clients.get(id);
    old.closed = true;
    const room = new FakeRoom(this, id, old.me.name);
    for (const other of this.clients.values()) {
      if (other === old) continue;
      room.players.set(other.me.id, { id: other.me.id, name: other.me.name, presence: other.me.presence, team: 0, ...(this.ready.has(other.me.id) ? { ready: true } : {}) });
    }
    room.me.presence = old.me.presence;
    room.state = JSON.parse(JSON.stringify(this.state));
    if (this.hostId === id) {
      const next = this.order.find((x) => x !== id);
      if (next) {
        this.hostId = next;
        for (const other of this.clients.values()) {
          if (other === old) continue;
          this.later(() => other.apply(() => {
            other.host = next;
            other.emit('host', next);
          }));
        }
      }
    }
    room.host = this.hostId;
    room.match = JSON.parse(JSON.stringify(this.match));
    if (room.match.phase !== 'lobby') room.frozen = { ...room.chosen() };
    this.clients.set(id, room);
    return room;
  }

  leave(id) {
    const room = this.clients.get(id);
    if (!room) return;
    this.clients.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.ready.delete(id);
    const hostLeft = this.hostId === id;
    if (hostLeft) this.hostId = this.order[0] ?? null;
    for (const other of this.clients.values()) {
      this.later(() => other.apply(() => {
        const p = other.players.get(id);
        other.players.delete(id);
        if (p) other.emit('leave', p, false);
        if (hostLeft) {
          other.host = this.hostId;
          other.emit('host', this.hostId);
        }
      }));
    }
    this.checkStart();
  }

  setReady(id, flag) {
    if (flag) this.ready.add(id);
    else this.ready.delete(id);
    for (const other of this.clients.values()) {
      if (other.me.id === id) continue;
      this.later(() => other.apply(() => {
        const p = other.players.get(id);
        if (!p) return;
        if (flag) p.ready = true;
        else delete p.ready;
        other.emit('ready', p);
      }));
    }
    this.checkStart();
  }

  checkStart() {
    if (this.match.phase !== 'lobby') return;
    const ids = [...this.clients.keys()];
    if (ids.length === 0 || !ids.every((id) => this.ready.has(id))) return;
    const n = this.match.n + 1;
    this.setMatch({ phase: 'starting', n, min: 1, id: `m${n}`, seed: this.seed + n, participants: ids.slice(), startsAt: this.now() + 3000 });
    this.ready.clear();
    for (const c of this.clients.values()) delete c.me.ready;
    setTimeout(() => {
      const { startsAt, ...rest } = this.match;
      void startsAt;
      this.setMatch({ ...rest, phase: 'playing', startedAt: this.now(), pausedMs: 0 });
    }, 3000);
  }

  setMatch(next) {
    this.match = next;
    const copy = JSON.stringify(next);
    for (const c of this.clients.values()) this.later(() => c.apply(() => c.applyMatch(JSON.parse(copy))));
  }

  end() {
    if (this.match.phase === 'lobby') return;
    this.setMatch({ phase: 'lobby', n: this.match.n, min: 1 });
    this.ready.clear();
  }

  setState(from, key, value) {
    if (value === null) delete this.state[key];
    else this.state[key] = value;
    const copy = JSON.stringify(value);
    for (const c of this.clients.values()) {
      if (c === from) continue;
      this.later(() => c.apply(() => {
        if (copy === undefined || value === null) delete c.state[key];
        else c.state[key] = JSON.parse(copy);
        c.emit('state', key, value, from.me.id);
      }));
    }
  }

  presence(from, d) {
    const copy = JSON.stringify(d);
    for (const c of this.clients.values()) {
      if (c === from) continue;
      this.later(() => c.apply(() => {
        const p = c.players.get(from.me.id);
        if (p) p.presence = JSON.parse(copy);
        if (p) c.emit('presence', p);
      }));
    }
  }

  deliver(from, data, to) {
    const copy = JSON.stringify(data);
    for (const c of this.clients.values()) {
      if (c === from || (to && c.me.id !== to)) continue;
      this.later(() => c.apply(() => {
        const sender = c.players.get(from.me.id) ?? { id: from.me.id, name: '?', presence: null, team: 0 };
        c.emit('message', JSON.parse(copy), sender, this.now(), c.matchNow());
      }));
    }
  }
}

export class FakeRoom {
  constructor(server, id, name) {
    this.server = server;
    this.me = { id, name, presence: null, team: 0 };
    this.players = new Map([[id, this.me]]);
    this.state = {};
    this.host = id;
    this.connected = true;
    this.closed = false;
    this.kind = 'public';
    this.match = { phase: 'lobby', n: 0, min: 1 };
    this.frozen = null;
    this.listeners = new Map();
    this.hidden = null;
    this.sent = { messages: 0 };
  }

  /** Runs `fn` unless this page has left. */
  apply(fn) {
    if (!this.closed) fn();
  }

  chosen() {
    const w = this.state['ow.settings'];
    return { rounds: w && [1, 2, 3].includes(w.rounds) ? w.rounds : 2 };
  }

  get settings() {
    return this.frozen ?? this.chosen();
  }
  get isHost() {
    return this.connected && !this.closed && this.host === this.me.id;
  }
  get online() {
    return [...this.players.values()].filter((p) => p.connected !== false);
  }
  get participants() {
    if (this.match.phase === 'lobby') return [];
    return (this.match.participants || []).map((id) => this.players.get(id)).filter(Boolean);
  }
  isParticipant(id = this.me.id) {
    return this.match.phase !== 'lobby' && Boolean(this.match.participants && this.match.participants.includes(id));
  }
  get spectating() {
    return this.match.phase !== 'lobby' && !this.isParticipant();
  }
  get running() {
    return this.match.phase === 'playing' && !this.match.paused;
  }
  matchNow() {
    const m = this.match;
    return m.phase === 'playing' && m.startedAt !== undefined ? Math.max(0, this.server.now() - m.startedAt) : 0;
  }
  get allReady() {
    return true;
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.listeners.get(event).delete(fn);
  }
  emit(event, ...args) {
    for (const fn of this.listeners.get(event) || []) fn(...args);
  }

  setReady(flag = true) {
    if (flag) this.me.ready = true;
    else delete this.me.ready;
    this.server.setReady(this.me.id, flag);
  }
  clearReady() {}
  hideLobby(hidden = true) {
    this.hidden = hidden;
  }
  setSetting(id, value) {
    if (!this.isHost || this.match.phase !== 'lobby' || id !== 'rounds' || ![1, 2, 3].includes(value)) return;
    const v = { ...(this.state['ow.settings'] || {}), rounds: value };
    this.state['ow.settings'] = v;
    this.server.setState(this, 'ow.settings', v);
    this.emit('settings', this.settings);
  }
  startMatch() {}
  endMatch() {
    if (this.isHost) this.server.end();
  }
  admit() {}
  setPresence(d) {
    this.me.presence = d;
    this.server.presence(this, d);
  }
  presenceAt(id) {
    const p = this.players.get(id);
    return p ? p.presence : null;
  }
  setState(key, value) {
    if (value === null || value === undefined) delete this.state[key];
    else this.state[key] = value;
    this.server.setState(this, key, value ?? null);
  }
  send(data, opts = {}) {
    this.sent.messages++;
    this.server.deliver(this, data, opts.to);
  }
  leave() {
    if (this.closed) return;
    this.server.leave(this.me.id);
    this.closed = true;
    this.emit('close', 'left');
  }

  applyMatch(next) {
    const previous = this.match;
    this.match = next;
    if (next.phase !== 'lobby' && !this.frozen) this.frozen = { ...this.chosen() };
    else if (next.phase === 'lobby') this.frozen = null;
    this.emit('match', next, previous);
    if (previous.phase !== 'starting' && next.phase === 'starting') this.emit('starting', next);
    if (previous.phase !== 'playing' && next.phase === 'playing') this.emit('matchstart', next);
    if (previous.phase !== 'lobby' && next.phase === 'lobby') this.emit('matchend', next, previous);
  }
}
