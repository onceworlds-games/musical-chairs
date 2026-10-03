// The controls, driven without a browser: a few stand-ins for the DOM, then real key presses against a real world.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, PHASE } from '../game/src/sim/world.js';
import { zoneFor } from '../game/src/sim/run.js';

globalThis.addEventListener = () => {};
globalThis.document = { addEventListener() {}, hidden: false, activeElement: null };
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => [] }, configurable: true });
const { Input } = await import('../game/src/input.js');

function rig() {
  let now = 1000;
  const real = performance.now.bind(performance);
  performance.now = () => now;
  const w = new World({ zone: zoneFor({ mode: 'run', seed: 5, oc: 0 }, 5), players: [{ id: 'a', ship: 0, kind: 'driven' }], carry: { lives: 9 } });
  w.spawns = [];
  const input = new Input({ addEventListener() {}, setPointerCapture() {} }, { web: w.web });
  input.enabled = true;
  const ship = w.ships[0];
  while (w.phase !== PHASE.PLAY) {
    ship.in.target = Math.round(ship.u);
    w.update();
  }
  const key = (k, down) => input.onKey({ key: k, repeat: false, preventDefault() {} }, down);
  const frames = (n) => {
    for (let f = 0; f < n; f++) {
      now += 16.7;
      const intent = input.read(ship, w.web);
      if (intent.target !== null) ship.in.target = intent.target;
      else if (ship.in.target === null) ship.in.target = Math.round(ship.u);
      if (intent.hop) ship.in.hop = true;
      for (let s = 0; s < 4; s++) w.update();
    }
  };
  return { w, ship, input, key, frames, done: () => (performance.now = real) };
}

test('a tap on an arrow moves exactly one lane and the ship stays there', () => {
  const r = rig();
  try {
    r.frames(10);
    const start = r.ship.u;
    r.key('ArrowRight', true);
    r.key('ArrowRight', false);
    r.frames(30);
    assert.equal(r.ship.u, start + 1);
  } finally {
    r.done();
  }
});

test('a hop stays where it lands: keys, pointer and finger no longer pull the ship back', () => {
  const r = rig();
  try {
    r.frames(10);
    r.key('ArrowRight', true);
    r.key('ArrowRight', false);
    r.frames(30);
    const from = r.ship.u;
    r.key('Shift', true);
    r.key('Shift', false);
    r.frames(40);
    assert.equal(r.ship.u, from + 3, 'three lanes on, and still there');
    // And steering carries on from the new lane.
    r.key('ArrowLeft', true);
    r.key('ArrowLeft', false);
    r.frames(30);
    assert.equal(r.ship.u, from + 2);
  } finally {
    r.done();
  }
});

test('a respawn elsewhere is not undone by the controls either', () => {
  const r = rig();
  try {
    r.frames(10);
    r.key('ArrowRight', true);
    r.key('ArrowRight', false);
    r.frames(30);
    const placed = (r.ship.u + 7) % r.w.n;
    r.ship.u = r.ship.pu = placed; // put somewhere else, as a respawn on a clear lane does
    r.frames(40);
    assert.equal(r.ship.u, placed, 'it stays where it was put');
  } finally {
    r.done();
  }
});
