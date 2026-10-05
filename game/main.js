// Musical Chairs. Dance while the music plays; when it stops, grab a chair: there is always one too few.
// main.js boots the page, runs the loop and the screens. The rules live in rules.js (the Engine the host's page runs),
// movement in sim.js, the bots in bots.js, drawing in draw.js and ui.js, the room and messages in net.js.

import { W, H, RADIUS, GOLD, BOT_NAMES, makeRoster, spawnPoint, colorOf, sanitizeG, sinceDip, hashStr } from './rules.js';
import { stepActor, tryBump, knock, WOBBLE } from './sim.js';
import { World, Practice, syncField, canSit } from './world.js';
import { Fx } from './fx.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { fitCamera, buildFloor, drawArena, updateVis, squash } from './draw.js';
import { createUI, drawTitle, drawLobbyTop, drawHud, drawWatching, drawCountdown, drawBanner, drawBetween, drawPodium, drawStart } from './ui.js';
import { connect, Session } from './net.js';
import { label, clamp, r1, r2, roundRect } from './gfx.js';

const ow = window.onceworlds || null;
const canvas = document.getElementById('c');
const posterName = new URLSearchParams(location.search).get('poster');

if (posterName) {
  const { runPoster } = await import('./poster.js');
  await runPoster(posterName, canvas);
} else await start();

async function start() {
  // Join first, before anything heavy is built, so a reload doesn't miss its seat.
  const joined = await connect(ow);
  try {
    if (ow && ow.ui && ow.ui.setOrientation) ow.ui.setOrientation('landscape');
  } catch (err) {
    /* desktop and some phones ignore it */
  }
  boot(joined);
}

function boot(joined) {
  const ctx = canvas.getContext('2d');
  const STEP = 1 / 60;
  const TITLE_CAST = Array.from({ length: 8 }, (_, i) => ({ id: `title${i + 1}`, b: 1, n: BOT_NAMES[i] }));
  const TITLE_IDS = TITLE_CAST.map((e) => e.id);

  let room = null;
  let session = null;
  let screen = 'title'; // 'title' | 'game'
  let acc = 0;
  let lastTs = 0;
  let cheers = 0;
  let cheerCd = 0;
  let controlsKey = '';
  let lastError = '';
  let closedReason = null;
  let stats = { matches: 0, wins: 0, games: 0, bumps: 0 };
  let statsReady = false;
  let rosterCache = { id: '', roster: [] };
  let gCache = { raw: null, mid: '', g: null };
  let lobbyIds = [];

  const fx = new Fx();
  const audio = createAudio();
  const input = createInput(ow);
  const practice = new Practice(7);
  const ui = createUI();

  const S = {
    w: 0, h: 0, pr: 1, u: 1, cam: { s: 1, ox: 0, oy: 0 }, t: 0, now: 0, beat: 0, titleT: 0,
    lobby: false, meId: null, youT: 99, dim: 0, flash: 0, reduced: false, goldAge: 1,
    floor: null, floorKey: '', fx, world: null, people: new Map(), drawList: [], ui, g: null, me: null,
    banner: null, phaseT0: 0, podiumT0: 0, results: null, names: (id) => (S.people.get(id) || {}).name || 'Player',
  };

  const track = { mid: '', n: -1, ph: '', seats: [], out: null, fmode: '', music: 'off', landed: '', rose: '', statsDone: '', quickDone: '', thief: null, finalG: null, cdLast: 99, cdGo: false, bumpsHit: 0 };

  // ---------------------------------------------------------------- the cast

  const world = new World({
    claim: (a, chair) => onClaim(a, chair),
    bonk: (a) => onBonk(a),
    knockRemote: (bot, human, nx, ny) => session && session.botBump(bot, human, nx, ny),
    landed: (a, o) => onLanded(a, o),
  });
  S.world = world;
  const meEnv = { list: world.list, field: world.field, canSit: false, claim: (a, i) => onClaim(a, i), bonk: (a) => onBonk(a), hit: (a, o, nx, ny) => myHit(a, o, nx, ny) };

  const clock = () => {
    try {
      return ow && ow.now ? ow.now() : Date.now();
    } catch (err) {
      return Date.now();
    }
  };

  function attach(r) {
    room = r;
    session = new Session(room, world, { knockMe });
    track.mid = '';
    gCache = { raw: null, mid: '', g: null };
    closedReason = null;
    room.on('starting', onStarting);
    room.on('matchstart', onMatchStart);
    room.on('matchend', onMatchEnd);
    room.on('host', () => (room.isHost ? session.adopt() : session.drop()));
    room.on('disconnect', () => session.drop());
    room.on('reconnect', () => {
      session.drop();
      session.adopt();
    });
    room.on('close', (reason) => {
      closedReason = reason || 'disconnected';
    });
    if (screen === 'title') room.hideLobby(true);
    session.adopt();
  }

  /** The room's record of this match, checked; on the host's page it is the live one. */
  function currentG() {
    const m = room.match;
    if (m.phase !== 'playing') return null;
    if (session.active) return session.engine.g;
    const raw = room.state.g;
    if (raw === gCache.raw && gCache.mid === m.id) return gCache.g;
    gCache = { raw, mid: m.id, g: sanitizeG(raw, m.id) };
    return gCache.g;
  }

  function localRoster(m) {
    if (rosterCache.id !== m.id) rosterCache = { id: m.id, roster: makeRoster(m.participants || [], m.seed) };
    return rosterCache.roster;
  }

  function lobbySpot(id) {
    const h = hashStr(id);
    return { x: 8 + (h % 400) / 100, y: 5 + ((h >> 8) % 300) / 100 };
  }

  /** Who should be in the room right now, in order. */
  function castPlan(g) {
    if (screen === 'title') return TITLE_CAST;
    const m = room.match;
    if (m.phase === 'lobby') {
      const ids = [];
      for (const p of room.players.values()) {
        if (p.id === room.me.id || (p.presence && typeof p.presence === 'object')) ids.push(p.id);
      }
      ids.sort();
      lobbyIds = ids;
      return ids.map((id) => ({ id }));
    }
    return g ? g.roster : localRoster(m);
  }

  function ensureAvatar(person) {
    if (person.asked || person.bot || !ow || !ow.player || !ow.player.avatarUrl) return;
    person.asked = true;
    Promise.resolve(ow.player.avatarUrl(person.id, 'head'))
      .then((url) => {
        if (!url) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          person.img = img;
        };
        img.src = url;
      })
      .catch(() => {});
  }

  function reconcile(g) {
    const entries = castPlan(g);
    const m = room.match;
    const meId = room.me.id;
    const spectating = screen === 'game' && room.spectating;
    const botKind = screen === 'title' || (m.phase === 'playing' && room.isHost) ? 'bot' : 'view';
    const keep = new Set();
    entries.forEach((e, i) => {
      if (e.id === meId && (spectating || screen === 'title')) return;
      keep.add(e.id);
      const isMe = e.id === meId;
      const kind = isMe ? 'me' : e.b ? botKind : 'remote';
      let a = world.get(e.id);
      if (!a) {
        let p;
        const pres = isMe ? room.me.presence : (room.players.get(e.id) || {}).presence;
        if (pres && Number.isFinite(pres.x) && Number.isFinite(pres.y) && m.phase === 'lobby') p = { x: pres.x, y: pres.y };
        else if (m.phase === 'lobby') p = lobbySpot(e.id);
        else p = spawnPoint(i, entries.length);
        world.seed = m.seed || 0;
        a = world.add(e.id, kind, clamp(p.x, RADIUS, W - RADIUS), clamp(p.y, RADIUS, H - RADIUS));
      } else if (a.kind !== kind) world.add(e.id, kind, a.x, a.y);
      let person = S.people.get(e.id);
      if (!person) {
        person = { id: e.id, name: e.n || '', color: '#fff', bot: Boolean(e.b), img: null, asked: false };
        S.people.set(e.id, person);
      }
      if (!e.b) {
        const pl = room.players.get(e.id);
        if (pl && typeof pl.name === 'string') person.name = pl.name;
        else if (!person.name) person.name = 'Player';
        ensureAvatar(person);
      } else if (e.n) person.name = e.n;
      person.color = colorOf(i);
      a.color = person.color;
      a.name = person.name;
      if (screen === 'game' && m.phase === 'lobby') {
        const pl = room.players.get(e.id);
        const ready = Boolean(pl && pl.ready);
        if (ready && !a.ready) a.v.readyAt = S.t;
        a.ready = ready;
      } else a.ready = false;
    });
    for (const a of [...world.list]) if (!keep.has(a.id)) world.remove(a.id);
    S.me = world.get(meId) && world.get(meId).kind === 'me' ? world.get(meId) : null;
    S.meId = S.me ? meId : null;
  }

  // ---------------------------------------------------------------- screens

  function startPlay() {
    if (screen !== 'title') return;
    audio.unlock();
    audio.sfx('pop');
    screen = 'game';
    S.youT = 0;
    input.reset();
    room.hideLobby(false);
    world.clear();
    reconcile(currentG());
  }

  function onPointer(e) {
    if (e.button !== undefined && e.button > 0) return;
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    const id = ui.hit(e.clientX - r.left, e.clientY - r.top);
    if (screen === 'title' && !id && room.match.phase !== 'lobby') return startPlay();
    if (!id) return;
    ui.pressed = id;
    setTimeout(() => {
      if (ui.pressed === id) ui.pressed = null;
    }, 140);
    audio.unlock();
    if (id === 'play') startPlay();
    else if (id.startsWith('games')) {
      const v = Number(id.slice(5));
      if (room.isHost && room.match.phase === 'lobby') {
        room.setSetting('rounds', v);
        audio.sfx('tick');
      }
    } else if (id === 'start') {
      room.startMatch();
      audio.sfx('pop');
    } else if (id === 'rejoin') rejoin();
  }

  async function rejoin() {
    closedReason = null;
    const next = await connect(ow);
    attach(next);
  }

  addEventListener('keydown', (e) => {
    if (screen === 'title' && !e.repeat && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      startPlay();
    }
  });
  canvas.addEventListener('pointerdown', onPointer);

  // ---------------------------------------------------------------- my own character

  function onClaim(a, chair) {
    const F = world.field;
    if (a.kind === 'me') {
      audio.sfx('sit', chair);
      squash(a, 0.3);
    }
    if (F.mode === 'match' && session) session.claim(a, chair);
  }

  function onBonk(a) {
    squash(a, 0.3);
    if (a.kind === 'me') {
      audio.sfx('bonk');
      fx.addShake(0.2);
      fx.floater('Bonk!', a.x, a.y - 1.2, '#ff8a8a', 20);
    }
    fx.sparks(a.x, a.y - 0.3, 6, '#fff');
  }

  /** A bump of mine lands on `o`. */
  function myHit(a, o, nx, ny) {
    const F = world.field;
    if (session) session.bump(o, nx, ny);
    fx.sparks((a.x + o.x) / 2, (a.y + o.y) / 2 - 0.3, 10);
    fx.spawn('star', (a.x + o.x) / 2, (a.y + o.y) / 2 - 0.5, { life: 0.35, size: 0.35, color: '#fff6a0', rot: 0.3 });
    fx.addShake(0.3);
    fx.hitStop(0.06);
    audio.sfx('hit');
    squash(o, 0.32);
    stats.bumps++;
    // "chair thief": bumping someone who is about to sit, then taking that chair
    if (F.ph === 'race' && F.mode === 'match') {
      let near = -1;
      let nd = 1.3;
      for (let i = 0; i < F.chairs.length; i++) {
        if (F.seats[i] !== null && F.seats[i] !== undefined) continue;
        const d = Math.hypot(F.chairs[i][0] - o.x, F.chairs[i][1] - o.y);
        if (d < nd) {
          nd = d;
          near = i;
        }
      }
      if (near >= 0) track.thief = { rid: F.rid, chair: near };
    }
  }

  /** The host's bots bumped someone (anyone on this page sees the hit). */
  function onLanded(a, o) {
    fx.sparks((a.x + o.x) / 2, (a.y + o.y) / 2 - 0.3, 8);
    squash(o, 0.3);
    if (o.kind === 'me') {
      audio.sfx('hit');
      fx.addShake(0.25);
    }
    if (a.kind === 'bot' && session && session.active) session.engine.noteBump(a.id);
  }

  /** Someone bumped me. */
  function knockMe(nx, ny) {
    const me = S.me;
    if (!me || !knock(me, nx, ny)) return;
    squash(me, 0.3);
    fx.sparks(me.x, me.y - 0.3, 8);
    fx.addShake(0.3);
    audio.sfx('hit');
  }

  function fakeWindow(F) {
    return F.mode === 'match' && F.ph === 'music' && (F.music === 'dip' || sinceDip(F.stops, F.now) < 150);
  }

  function stepMe(dt) {
    const me = S.me;
    if (!me) return;
    const F = world.field;
    const inp = input.read(dt);
    if (cheerCd > 0) cheerCd -= dt;
    if (F.ph === 'over' && F.winner === me.id) {
      me.x = GOLD.x;
      me.y = GOLD.y;
      me.vx = me.vy = me.kx = me.ky = 0;
      return;
    }
    if (me.ghost) {
      if (inp.bump && cheerCd <= 0) {
        input.consume();
        cheerCd = 0.45;
        cheers++;
        audio.sfx('cheer');
        squash(me, -0.25);
        fx.confetti(me.x, me.y - 0.8, 16, 0.7, 0.8);
      }
    } else if (inp.bump && me.chair < 0 && me.wob <= 0) {
      if (fakeWindow(F)) {
        // "Ha!": it was a fake-out
        input.consume();
        me.wob = WOBBLE;
        me.bubble = 'Ha!';
        me.bubbleT = 1;
        audio.sfx('ha');
      } else if (tryBump(me)) {
        input.consume();
        audio.sfx('bump');
      }
    }
    meEnv.canSit = canSit(F, me);
    stepActor(me, inp.mx, inp.my, dt, meEnv);
    if (F.mode === 'match' && me.chair >= 0 && !me.sat && session) session.resend(me);
  }

  // ---------------------------------------------------------------- other pages' characters

  function updateRemotes(dt) {
    for (const a of world.list) {
      if (a.kind === 'remote') {
        const p = room.presenceAt(a.id, { snap: 5 });
        if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          a.x = clamp(p.x, RADIUS, W - RADIUS);
          a.y = clamp(p.y, RADIUS, H - RADIUS);
          a.vx = Number.isFinite(p.vx) ? clamp(p.vx, -12, 12) : 0;
          a.vy = Number.isFinite(p.vy) ? clamp(p.vy, -12, 12) : 0;
          a.kx = 0;
          a.ky = 0;
          const sp = Math.hypot(a.vx, a.vy);
          if (sp > 0.4) {
            a.fx = a.vx / sp;
            a.fy = a.vy / sp;
          }
          a.bumpT = p.b > 0.5 ? 0.1 : 0;
          const wob = p.w > 0.5;
          if (wob && !a.wob) {
            a.bubble = 'Ha!';
            a.bubbleT = 1;
          }
          a.wob = wob ? 0.5 : 0;
          a.sitFlag = p.s > 0.5;
        }
        const raw = (room.players.get(a.id) || {}).presence;
        if (raw && typeof raw.c === 'number') {
          if (a.cheerSeen === undefined) a.cheerSeen = raw.c;
          else if (raw.c > a.cheerSeen) {
            a.cheerSeen = raw.c;
            audio.sfx('cheer');
            fx.confetti(a.x, a.y - 0.8, 12, 0.7, 0.8);
          }
        }
      }
      if (a.kind !== 'me' && a.kind !== 'bot' && a.bubbleT > 0) {
        a.bubbleT -= dt;
        if (a.bubbleT <= 0) a.bubble = '';
      }
    }
  }

  // ---------------------------------------------------------------- the match

  function onStarting(m) {
    S.results = null;
    track.cdLast = 99;
    track.cdGo = false;
    S.youT = 0;
    session.clearSnaps();
    if (screen === 'title') room.hideLobby(true);
    // everyone gathers on the ring round the rug
    const roster = localRoster(m);
    const me = S.me || world.get(room.me.id);
    const i = roster.findIndex((e) => e.id === room.me.id);
    if (me && i >= 0 && screen === 'game') {
      const p = spawnPoint(i, roster.length);
      me.x = p.x;
      me.y = p.y;
      me.vx = me.vy = me.kx = me.ky = 0;
      me.chair = -1;
    }
  }

  function onMatchStart() {
    S.results = null;
    track.finalG = null;
    session.clearSnaps();
    session.adopt();
    input.reset();
    S.youT = 0;
    if (screen === 'title') room.hideLobby(true);
  }

  function onMatchEnd(m, prev) {
    if (prev && prev.phase === 'playing' && track.finalG && track.finalG.mid === prev.id) S.results = { g: track.finalG, until: S.t + 7 };
    else S.results = null;
    session.drop();
    session.clearSnaps();
    input.reset();
    S.dim = 0;
    if (screen === 'title') room.hideLobby(true);
    else room.hideLobby(false);
  }

  function banner(text, dur = 1.4, color = '#fff', y = 0.25, big = false) {
    S.banner = { text, t0: S.t, dur, color, y, big };
  }

  /** Round by round: what each page makes of the room's record (sounds, banners, bursts). Nothing is replayed after a reload. */
  function watchRecord(g, F) {
    if (!g) {
      track.mid = '';
      return;
    }
    const first = track.mid !== g.mid;
    if (first) {
      track.mid = g.mid;
      track.n = -1;
      track.ph = '';
      track.seats = g.seats.slice();
      track.out = null;
      track.quickDone = '';
      track.thief = null;
    }
    const me = S.me;
    if (track.n !== g.n) {
      track.n = g.n;
      S.youT = 0;
      S.dim = 0;
      track.seats = g.seats.slice();
      if (g.ph === 'music' && (!first || F.now < 2500)) {
        if (g.step === 1 && g.game > 1) banner(`GAME ${g.game}!`, 1.5, '#ffd23f', 0.25, true);
        else banner('DANCE!', 1.3, '#fff');
      }
    }
    if (track.ph !== g.ph) {
      const prev = track.ph;
      track.ph = g.ph;
      S.phaseT0 = S.t;
      const start = g.ph === 'out' ? g.until - 1500 : g.ph === 'over' ? g.until - 3200 : g.ph === 'between' ? g.until - 4000 : g.ph === 'final' ? g.until - 9000 : 0;
      const fresh = prev !== '' || F.now - start < 800;
      if (g.ph === 'out' && fresh && g.out) {
        const a = world.get(g.out);
        if (a) {
          a.bubble = 'OUT!';
          a.bubbleT = 1.4;
          fx.puff(a.x, a.y - 0.4, 8);
        }
        audio.sfx('wah');
        if (me && g.out === me.id) {
          banner("YOU'RE OUT!", 1.6, '#ff6b6b', 0.25, true);
          fx.addShake(0.35);
        }
      } else if (g.ph === 'over' && fresh) {
        audio.sfx('fanfare');
        audio.sfx('confetti');
        banner('WINNER!', 2.4, '#ffd23f', 0.2, true);
        fx.addShake(0.2);
      } else if (g.ph === 'final') {
        S.podiumT0 = S.t;
        track.finalG = JSON.parse(JSON.stringify(g));
        if (fresh) {
          audio.sfx('win');
          fx.confetti(W / 2, H * 0.4, 40, 1.4, 1.2);
        }
        finishMatchOnce(g);
      }
    }
    // a seat was given out
    for (let i = 0; i < g.seats.length; i++) {
      const id = g.seats[i];
      if (!id || track.seats[i] === id) continue;
      const c = g.chairs[i];
      if (c) {
        fx.puff(c[0], c[1], 5, 0.22);
        fx.confetti(c[0], c[1] - 0.3, 6, 0.5, 0.6);
      }
      if (me && id === me.id) onMySeat(g, i);
      else audio.sfx('sit', i);
    }
    track.seats = g.seats.slice();
    if (g.ph === 'over') S.goldAge = Math.min(1, (S.t - S.phaseT0) / 0.8);
    if (g.ph === 'over' || g.ph === 'final') if (Math.random() < 0.25) fx.rain(W, 2);
  }

  function onMySeat(g, chair) {
    const me = S.me;
    fx.floater('SAFE!', me.x, me.y - 1.4, '#7bed4f', 26);
    if (g.sat[me.id] !== undefined && g.sat[me.id] <= 1000 && track.quickDone !== `${g.mid}.${g.n}`) {
      track.quickDone = `${g.mid}.${g.n}`;
      award('quick-sit');
      fx.floater('FAST!', me.x, me.y - 2, '#ffd23f', 22);
    }
    if (track.thief && track.thief.rid === `${g.mid}.${g.n}` && track.thief.chair === chair) award('chair-thief');
  }

  /** The room's clocks on the field: sounds for the music stopping, a fake-out, chairs landing and flying away. */
  function watchField(F) {
    if (track.fmode !== F.mode) {
      track.fmode = F.mode;
      track.music = F.music;
      track.landed = '';
      track.rose = '';
    }
    if (F.music !== track.music) {
      const prev = track.music;
      track.music = F.music;
      if (prev === 'play' && F.music === 'stop') {
        audio.sfx('scratch');
        S.flash = 1;
        S.dim = 1;
        fx.addShake(0.25);
        banner('GRAB A CHAIR!', 1.5, '#ffd23f', 0.22, true);
      } else if (prev === 'play' && F.music === 'dip') {
        audio.sfx('dun');
        fx.addShake(0.12);
      } else if (prev === 'dip' && F.music === 'play') banner('FAKE!', 1, '#6ad1ff', 0.22);
    }
    if (F.ph === 'race' && F.now >= F.dropAt && track.landed !== F.rid) {
      track.landed = F.rid;
      if (F.now - F.dropAt < 700) {
        audio.sfx('thud', F.chairs.length);
        fx.addShake(0.3);
        for (const c of F.chairs) fx.puff(c[0], c[1] + 0.3, 6, 0.3);
      }
    }
    if (F.riseAt < Infinity && F.now >= F.riseAt && track.rose !== F.rid) {
      track.rose = F.rid;
      if (F.now - F.riseAt < 700) audio.sfx('whoosh');
    }
  }

  // ---------------------------------------------------------------- saves, badges

  function award(id) {
    try {
      if (ow && ow.badges) Promise.resolve(ow.badges.award(id)).catch(() => {});
    } catch (err) {
      /* guests and standalone pages earn nothing */
    }
  }

  function finishMatchOnce(g) {
    if (track.statsDone === g.mid) return;
    track.statsDone = g.mid;
    const me = S.me;
    if (!me || !g.roster.some((e) => e.id === me.id)) return;
    const won = g.rank[0] === me.id;
    stats.matches++;
    if (won) stats.wins++;
    stats.games += g.wins[me.id] ?? 0;
    try {
      if (ow && ow.save && statsReady) Promise.resolve(ow.save.set('stats', stats)).catch(() => {});
      if (won) {
        award('first-win');
        if (ow && ow.leaderboards) Promise.resolve(ow.leaderboards.submit('wins', stats.wins)).catch(() => {});
      }
      if (stats.matches >= 10) award('party-guest');
    } catch (err) {
      /* ignore */
    }
  }

  try {
    if (ow && ow.save) {
      Promise.resolve(ow.save.get('stats'))
        .then((s) => {
          if (s && typeof s === 'object') {
            stats = { matches: Number(s.matches) || 0, wins: Number(s.wins) || 0, games: Number(s.games) || 0, bumps: Number(s.bumps) || 0 };
          }
        })
        .catch(() => {})
        .then(() => {
          statsReady = true;
        });
    }
  } catch (err) {
    /* ignore */
  }

  // ---------------------------------------------------------------- the step and the frame

  function practiceSeats() {
    const F = world.field;
    if (F.chairs.length === 0) return;
    const seats = F.seats;
    seats.fill(null);
    for (const a of world.list) {
      if (a.ghost) continue;
      let i = -1;
      if (a.kind === 'remote') {
        if (a.sitFlag) {
          let bd = 0.9 * 0.9;
          for (let k = 0; k < F.chairs.length; k++) {
            const d2 = (a.x - F.chairs[k][0]) ** 2 + (a.y - F.chairs[k][1]) ** 2;
            if (d2 < bd) {
              bd = d2;
              i = k;
            }
          }
        }
      } else if (a.chair >= 0) i = a.chair;
      if (i >= 0 && i < seats.length && (seats[i] === null || a.id < seats[i])) seats[i] = a.id;
    }
  }

  function step(dt, g) {
    const m = room.match;
    const playing = m.phase === 'playing' && screen === 'game';
    if (m.phase === 'playing' && !room.running) return; // too few players: the match waits, and so does everything in it
    const F = world.field;
    if (screen === 'title') practice.fill(F, clock(), 7, TITLE_IDS);
    else if (playing && g) syncField(F, g, room.matchNow());
    else if (m.phase === 'lobby') practice.fill(F, clock(), Math.max(2, Math.min(10, lobbyIds.length + 1)), lobbyIds);
    else {
      syncField(F, null, 0);
      F.music = m.phase === 'starting' ? 'play' : 'off';
    }
    if (F.mode === 'practice') practiceSeats();
    world.afterField();
    stepMe(dt);
    if (screen === 'title' || (playing && room.isHost)) world.stepBots(dt);
    if (playing && room.isHost) session.tick(room.matchNow());
  }

  function resize() {
    S.w = Math.max(200, window.innerWidth || 800);
    S.h = Math.max(150, window.innerHeight || 450);
    let pr = 1;
    try {
      pr = ow && ow.settings && ow.settings.pixelRatio ? ow.settings.pixelRatio(2) : Math.min(window.devicePixelRatio || 1, 2);
    } catch (err) {
      pr = 1;
    }
    S.pr = clamp(pr || 1, 0.5, 3);
    canvas.width = Math.round(S.w * S.pr);
    canvas.height = Math.round(S.h * S.pr);
    S.u = clamp(Math.min(S.w / 844, S.h / 390), 0.7, 2.2);
    S.cam = fitCamera(S.w, S.h);
    S.floor = null;
  }

  function applySettings() {
    try {
      const st = ow && ow.settings;
      S.reduced = Boolean(st && st.reducedMotion);
      fx.setQuality(st && st.quality, S.reduced);
    } catch (err) {
      /* defaults */
    }
  }

  function updateControls() {
    let key = 'off';
    const m = room.match;
    const g = S.g;
    if (screen === 'game' && S.me && !room.spectating && !closedReason) {
      if (m.phase === 'lobby') key = S.results ? 'off' : 'play';
      else if (m.phase === 'starting') key = 'play';
      else if (m.phase === 'playing' && g && g.ph !== 'final' && g.ph !== 'between') key = S.me.ghost ? 'cheer' : 'play';
      else if (m.phase === 'playing' && !g) key = 'play';
    }
    if (key === controlsKey) return;
    controlsKey = key;
    try {
      if (!ow || !ow.controls) return;
      if (key === 'off') ow.controls.set(null);
      else ow.controls.set({ stick: 'analog', buttons: [{ id: 'bump', label: key === 'cheer' ? 'Cheer' : 'Bump', key: ' ' }] });
    } catch (err) {
      /* controls are optional */
    }
  }

  function updateAudio(g, F, dt) {
    const m = room.match;
    let mode = 'off';
    if (screen === 'game') {
      if (m.phase === 'lobby') mode = F.music === 'play' ? 'lobby' : 'off';
      else if (m.phase === 'playing' && g) mode = F.music === 'play' ? 'play' : F.music === 'party' ? 'party' : 'off';
    }
    if (audio.ready()) {
      if (mode === 'off') audio.musicOff();
      else if (mode === 'play') audio.musicOn(g.n % 6, Math.min(130, 112 + 2 * (g.step - 1)), 0.85);
      else if (mode === 'party') audio.musicOn(3, 120, 0.6);
      else audio.musicOn(((F.n % 6) + 6) % 6, 112, 0.42);
    }
    // the beat the floor lights and the dancing follow: the music's own when it plays, a steady one before the first tap
    if (F.music === 'play' || F.music === 'party') S.beat = audio.playing ? audio.beats() : S.beat + dt * (115 / 60);
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    try {
      tick(ts);
    } catch (err) {
      const msg = String((err && err.stack) || err);
      if (msg !== lastError) {
        lastError = msg;
        console.error('[musical-chairs]', err);
      }
    }
  }

  function tick(ts) {
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, 0.1);
    S.t += dt;
    S.now = S.t;
    S.titleT += dt;
    S.youT += dt;
    fx.update(dt);
    S.dim = Math.max(0, S.dim - dt * 1.3);
    S.flash = Math.max(0, S.flash - dt * 5);
    if (S.results && S.t > S.results.until) S.results = null;
    const m = room.match;
    // whoever runs the match runs it from the game screen, even if they never tapped PLAY
    if (screen === 'title' && room.isHost && m.phase === 'playing') startPlay();
    const g = currentG();
    S.g = g;
    S.lobby = screen === 'game' && m.phase === 'lobby';
    reconcile(g);
    updateRemotes(dt);
    if (m.phase === 'playing' && !room.isHost) {
      session.readBots();
      const botIds = (g ? g.roster : localRoster(m)).filter((e) => e.b).map((e) => e.id);
      session.applyBots(room.matchNow(), botIds);
    }
    if (fx.freeze > 0) acc = 0;
    else {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 6) {
        step(STEP, g);
        acc -= STEP;
        n++;
      }
      if (acc > STEP * 6) acc = 0;
    }
    const F = world.field;
    watchField(F);
    watchRecord(g, F);
    updateCountdown(m);
    for (const a of world.list) {
      a.v.forceSeat = F.ph === 'over' && F.winner === a.id;
      updateVis(a, dt, S);
    }
    updateAudio(g, F, dt);
    updateControls();
    publish();
    render(g, F, m);
  }

  function publish() {
    const me = S.me;
    if (me && room.connected && screen === 'game') {
      try {
        room.setPresence({ x: r2(me.x), y: r2(me.y), vx: r1(me.vx + me.kx), vy: r1(me.vy + me.ky), b: me.bumpT > 0 ? 1 : 0, w: me.wob > 0 ? 1 : 0, s: me.chair >= 0 ? 1 : 0, c: cheers });
      } catch (err) {
        /* a presence that can't be sent is skipped */
      }
    }
    if (room.isHost && room.match.phase === 'playing') session.publishBots(room.matchNow());
  }

  // ---------------------------------------------------------------- drawing

  let cdText = '';
  let cdAge = 0;
  function updateCountdown(m) {
    cdText = '';
    if (screen !== 'game') return;
    if (m.phase === 'starting' && typeof m.startsAt === 'number') {
      const rem = m.startsAt - clock();
      const n = Math.ceil(rem / 1000);
      if (n >= 1) {
        cdText = String(Math.min(3, n));
        cdAge = (Math.min(3, n) * 1000 - rem) / 1000;
        if (n !== track.cdLast) {
          track.cdLast = n;
          audio.sfx('beep', n);
        }
      } else {
        cdText = 'GO!';
        cdAge = clamp(-rem / 1000, 0, 1);
        if (!track.cdGo) {
          track.cdGo = true;
          audio.sfx('beep', 0);
        }
      }
    } else if (m.phase === 'playing' && room.matchNow() < 800 && track.cdGo) {
      cdText = 'GO!';
      cdAge = room.matchNow() / 1000;
    }
  }

  function render(g, F, m) {
    const key = `${S.w}x${S.h}x${S.pr}`;
    if (!S.floor || S.floorKey !== key) {
      try {
        S.floor = buildFloor(S);
      } catch (err) {
        S.floor = null;
      }
      S.floorKey = key;
    }
    ctx.setTransform(S.pr, 0, 0, S.pr, 0, 0);
    ui.reset();
    drawArena(ctx, S);
    if (closedReason) return drawClosed();
    if (screen === 'title') {
      drawTitle(ctx, S);
    } else if (m.phase === 'lobby') {
      if (S.results) drawPodium(ctx, S, S.results.g, S.t - S.podiumT0);
      else {
        const games = Number(room.settings.rounds) || 2;
        drawLobbyTop(ctx, S, room.isHost, games);
        if (room.stub) drawStart(ctx, S);
      }
    } else if (m.phase === 'starting') {
      if (cdText) drawCountdown(ctx, S, cdText, cdAge);
      if (room.spectating) drawWatching(ctx, S);
    } else if (m.phase === 'playing') {
      if (room.spectating) drawWatching(ctx, S);
      if (g) {
        if (g.ph === 'between') drawBetween(ctx, S, g, S.t - S.phaseT0);
        else if (g.ph === 'final') drawPodium(ctx, S, g, S.t - S.podiumT0);
        else drawHud(ctx, S, g, S.meId);
      }
      if (cdText) drawCountdown(ctx, S, cdText, cdAge);
    }
    if (S.banner) {
      if (S.t - S.banner.t0 > S.banner.dur) S.banner = null;
      else drawBanner(ctx, S, S.banner);
    }
  }

  function drawClosed() {
    const { w, h, u } = S;
    ctx.fillStyle = 'rgba(20,5,50,0.6)';
    ctx.fillRect(0, 0, w, h);
    const text = closedReason === 'kicked' ? 'You were removed' : closedReason === 'replaced' ? 'Playing in another tab' : 'Disconnected';
    label(ctx, text, w / 2, h * 0.38, 44 * u);
    // one button: join again
    const bw = 220 * u;
    const bh = 70 * u;
    ui.add('rejoin', w / 2 - bw / 2, h * 0.58 - bh / 2, bw, bh);
    ctx.save();
    ctx.translate(w / 2, h * 0.58);
    ctx.fillStyle = '#2ed573';
    ctx.strokeStyle = '#2d1650';
    ctx.lineWidth = 4;
    roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 20 * u);
    ctx.fill();
    ctx.stroke();
    label(ctx, closedReason === 'replaced' ? 'PLAY HERE' : 'PLAY', 0, 0, 34 * u);
    ctx.restore();
  }

  // ---------------------------------------------------------------- go

  window.addEventListener('resize', () => resize());
  try {
    if (ow && ow.settings && ow.settings.on) {
      ow.settings.on('change', () => {
        applySettings();
        resize();
      });
    }
  } catch (err) {
    /* ignore */
  }
  applySettings();
  resize();
  attach(joined);
  try {
    if (ow && ow.rooms && ow.rooms.on) ow.rooms.on('moved', (next) => next && typeof next.on === 'function' && attach(next));
  } catch (err) {
    /* ignore */
  }
  try {
    if (document.fonts && document.fonts.load) document.fonts.load('800 40px "Baloo 2"').catch(() => {});
  } catch (err) {
    /* the fallback font will do */
  }
  requestAnimationFrame(frame);
}
