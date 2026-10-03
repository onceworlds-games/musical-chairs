// The heads-up display drawn against a stand-in for the vector display: every state, every screen shape, no throw.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../game/src/render/hud.js';

const calls = [];
const vec = new Proxy({}, { get: (_, name) => (...a) => (calls.push([name, a]), name === 'measure' || name === 'text' ? 10 : 0) });

test('the HUD draws in every state on every screen shape', () => {
  for (const [W, H] of [[360, 640], [390, 844], [844, 390], [1100, 760], [1920, 1080], [320, 480]]) {
    for (const calm of [false, true]) {
      for (const touch of [false, true]) {
        for (const boss of [null, { name: 'MAESTRO', hp: 400, max: 1000 }]) {
          const hud = new Hud(vec);
          hud.say('CHORD', { life: 1, priority: 2 });
          hud.say('PERFECT BAR', { kind: 'small', life: 1 });
          hud.say('PERFECT BAR', { kind: 'small', life: 1 });
          hud.showHint('HOLD SPACE TO FIRE');
          hud.update(0.1);
          assert.equal(typeof hud.draw, 'function');
          hud.draw({ W, H, hue: '#3dffb0', score: 99_999_999, mult: 8, lives: 8, zaps: 2, res: 60, od: 0.5, zone: 'ZONE 4-BOSS', boss, beat: 0.3, calm, touch, watching: true, practice: false, short: H < 520 && W > H });
          hud.draw({ W, H, hue: '#ff4a2b', score: 0, mult: 1, lives: 0, zaps: 0, res: 0, od: 0, zone: '', boss: null, beat: 0, calm, touch, watching: false, practice: true });
        }
      }
    }
  }
  assert.ok(calls.length > 100);
});

test('the same word twice lights one message, and small words are limited to three', () => {
  const hud = new Hud(vec);
  hud.say('ZAP', { kind: 'small' });
  hud.say('ZAP', { kind: 'small' });
  assert.equal(hud.msgs.length, 1);
  for (const w of ['A', 'B', 'C', 'D', 'E']) hud.say(w, { kind: 'small' });
  assert.equal(hud.msgs.filter((m) => m.kind === 'small').length, 3);
});
