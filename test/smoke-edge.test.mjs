// The less usual paths of main.js: keyboard start, a rotated phone, touch controls, a paused match, a closed room and the way
// back in, a party move, and a change of graphics settings.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals, newPage, runFrame, makeOw } from './fake-dom.mjs';
import { FakeServer } from './fake-room.mjs';
import { SoloRoom } from '../game/net.js';

function setup() {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 3_000_000 });
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));
  installGlobals();
  let ts = 0;
  const pages = [];
  const frames = (ms) => {
    for (let i = 0; i < Math.round(ms / 17); i++) {
      ts += 17;
      mock.timers.tick(17);
      runFrame(ts);
      for (const p of pages) assert.equal(p.canvas.ctx.depth, 0);
    }
  };
  return { errors, frames, pages, done: () => { console.error = orig; mock.timers.reset(); globalThis.innerWidth = 844; globalThis.innerHeight = 390; } };
}

test('Space starts from the title; a rotated phone, touch controls and a graphics change are all fine', async () => {
  const env = setup();
  try {
    const room = new SoloRoom();
    const ow = makeOw(room);
    const page = newPage(ow);
    env.pages.push(page);
    await import('../game/main.js?edge1');
    env.frames(500);
    assert.equal(ow.calls.controls.at(-1), null);
    page.key('keydown', 'Space');
    env.frames(300);
    assert.equal(ow.calls.controls.at(-1).buttons[0].id, 'bump', 'Space went to the lobby');
    // touch: the stick moves me, the button bumps
    const x0 = room.me.presence.x;
    ow.controls.stick.x = 1;
    ow.controls.stick.y = 0;
    env.frames(500);
    assert.ok(room.me.presence.x > x0 + 1.5, `the stick moved me: ${x0} -> ${room.me.presence.x}`);
    ow.controls.stick.x = 0;
    ow.controls.held.add('bump');
    env.frames(300);
    ow.controls.held.delete('bump');
    // a phone turned upright
    globalThis.innerWidth = 390;
    globalThis.innerHeight = 844;
    for (const fn of page.listeners.resize || []) fn();
    env.frames(500);
    assert.equal(page.canvas.width, 390);
    assert.equal(page.canvas.height, 844);
    globalThis.innerWidth = 844;
    globalThis.innerHeight = 390;
    for (const fn of page.listeners.resize || []) fn();
    env.frames(200);
    assert.equal(page.canvas.width, 844);
    // the player picks Reduce motion and Low graphics
    ow.settings.reducedMotion = true;
    ow.settings.quality = 'low';
    for (const [event, fn] of ow.calls.settings) if (event === 'change') fn();
    env.frames(2000);
    assert.deepEqual(env.errors, []);
  } finally {
    env.done();
  }
});

test('a paused match stands still, a closed room says so with one button that joins again, and a party move picks up the new room', async () => {
  const env = setup();
  try {
    const server = new FakeServer({ latency: 20, seed: 55 });
    const roomA = server.join('a', 'Ann');
    const ow = makeOw(roomA);
    const page = newPage(ow);
    env.pages.push(page);
    await import('../game/main.js?edge2');
    env.frames(300);
    page.pointer(422, 390 * 0.78);
    env.frames(500);
    roomA.setReady(true);
    env.frames(4000);
    assert.equal(roomA.match.phase, 'playing');
    env.frames(2000);
    // too few players are connected: the match waits
    const before = { ...roomA.me.presence };
    const gBefore = roomA.state.g.until;
    roomA.match = { ...roomA.match, paused: { since: Date.now(), reason: 'players' } };
    ow.controls.stick.x = 1;
    env.frames(1000);
    assert.equal(roomA.me.presence.x, before.x, 'nothing moves while it waits');
    assert.equal(roomA.state.g.until, gBefore);
    roomA.match = { ...roomA.match, pausedMs: 1000, paused: undefined };
    delete roomA.match.paused;
    ow.controls.stick.x = 0;
    env.frames(500);
    // the room closes under me: one message, one button
    roomA.emit('close', 'kicked');
    env.frames(300);
    assert.equal(ow.calls.joins, 1, 'joined once, when the page started');
    const second = server.join('a2', 'Ann again');
    ow.calls.nextRoom = second;
    page.pointer(422, 390 * 0.58);
    env.frames(300);
    assert.equal(ow.calls.joins, 2, 'the button joined again');
    // the platform moves the party into a new server
    const third = server.join('a3', 'Ann in a party');
    const moved = ow.calls.moved.find(([e]) => e === 'moved');
    assert.ok(moved);
    moved[1](third);
    env.frames(500);
    assert.deepEqual(env.errors, []);
  } finally {
    env.done();
  }
});

test('the hidden host still moves the match on', async () => {
  const env = setup();
  try {
    const room = new SoloRoom();
    const ow = makeOw(room);
    const page = newPage(ow);
    env.pages.push(page);
    await import('../game/main.js?edge3');
    env.frames(300);
    page.pointer(422, 390 * 0.78);
    env.frames(300);
    page.pointer(422, 390 - 56);
    env.frames(5000);
    assert.equal(room.match.phase, 'playing');
    const n = room.state.g.n;
    // the tab goes to the background: no animation frames, only the slow timer
    globalThis.document.hidden = true;
    for (let i = 0; i < 600; i++) mock.timers.tick(250);
    globalThis.document.hidden = false;
    assert.ok(room.state.g.n > n || room.state.g.ph !== 'music', 'the match moved on while hidden');
    env.frames(300);
    assert.deepEqual(env.errors, []);
  } finally {
    env.done();
  }
});
