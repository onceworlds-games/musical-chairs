// The synthesizer against a fake Web Audio: every effect plays, every tune schedules notes in time, a stop silences the music, and
// nothing is created before the first tap.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { installGlobals } from './fake-dom.mjs';
import { createAudio } from '../game/audio.js';

test('sound: nothing before a tap, every effect, six tunes, a stop that is silent', () => {
  mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 9_000_000 });
  try {
    installGlobals();
    const audio = createAudio();
    assert.equal(audio.ready(), false);
    audio.sfx('sit'); // before the first tap: silently nothing
    audio.musicOn(0, 112, 0.5);
    assert.equal(audio.playing, false);
    assert.equal(audio.unlock(), true);
    assert.equal(audio.ready(), true);
    for (const name of ['tick', 'pop', 'beep', 'scratch', 'thud', 'sit', 'bonk', 'bump', 'hit', 'wah', 'dun', 'ha', 'whoosh', 'cheer', 'confetti', 'win', 'fanfare']) {
      assert.doesNotThrow(() => audio.sfx(name, 3), name);
    }
    assert.doesNotThrow(() => audio.sfx('nothing-like-it'));
    for (let song = 0; song < 6; song++) {
      audio.musicOn(song, 112 + song * 2, 0.6);
      assert.equal(audio.playing, true);
      // four bars at 112 bpm is about 8.6 s
      for (let i = 0; i < 560; i++) mock.timers.tick(17);
      assert.ok(audio.beats() > 8, `beats ${audio.beats()}`);
      audio.musicOff();
      assert.equal(audio.playing, false);
      assert.equal(audio.beats(), 0);
    }
    // the same song again just changes the level
    audio.musicOn(2, 120, 0.3);
    audio.musicOn(2, 122, 0.6);
    assert.equal(audio.playing, true);
    audio.musicOff();
    audio.musicOff();
  } finally {
    mock.timers.reset();
  }
});

test('sound: a browser with no Web Audio is fine', () => {
  const saved = globalThis.AudioContext;
  delete globalThis.AudioContext;
  try {
    installGlobals();
    const audio = createAudio();
    assert.equal(audio.unlock(), false);
    assert.doesNotThrow(() => {
      audio.sfx('sit');
      audio.musicOn(0, 112, 1);
      audio.musicOff();
    });
  } finally {
    globalThis.AudioContext = saved;
  }
});
