// The heads-up display, in the stroke font: score and multiplier with the beat ring (top right), ships and zaps,
// the zone (top centre, clear of the platform's buttons at the top left), Resonance and Overdrive along the bottom,
// the boss's health, and the big words of the moment ("PERFECT BAR", "CHORD", "ZONE 3").
import { RESONANCE_MAX } from '../sim/data.js';

const WHITE = '#ffffff';

export class Hud {
  constructor(vec) {
    this.vec = vec;
    this.msgs = [];
    this.hint = null;
    this.scoreShown = 0;
    this.multPop = 0;
  }

  /** A word of the moment. kind: 'big' (centre), 'small' (under it). */
  say(text, { size = 1, life = 1.4, color = WHITE, kind = 'big', priority = 0 } = {}) {
    text = String(text);
    // The same word again (two zaps, a string of pickups) lights the one already up instead of stacking.
    const same = this.msgs.find((m) => m.text === text && m.kind === kind);
    if (same) {
      same.life = same.max = life;
      return;
    }
    if (kind === 'big') {
      // A new big word replaces a weaker one.
      this.msgs = this.msgs.filter((m) => m.kind !== 'big' || m.priority > priority);
    }
    // At most three small words at once: the newest push the oldest out.
    const smalls = this.msgs.filter((m) => m.kind !== 'big');
    if (kind !== 'big' && smalls.length >= 3) this.msgs.splice(this.msgs.indexOf(smalls[0]), 1);
    this.msgs.push({ text, size, life, max: life, color, kind, priority });
  }

  showHint(text) {
    this.hint = text ? { text, life: 4, max: 4 } : null;
  }

  clear() {
    this.msgs = [];
    this.hint = null;
  }

  update(dt) {
    for (const m of this.msgs) m.life -= dt;
    this.msgs = this.msgs.filter((m) => m.life > 0);
    if (this.hint) {
      const f = Math.min(1, this.hint.life, (this.hint.max - this.hint.life) * 4);
      // Up under the zone's name: clear of the ship at the rim, the thumbs below and the words in the middle.
      const hy = d.short ? 40 : W < 440 ? 100 : Math.max(40, H * 0.1);
      v.text(this.hint.text, W / 2, hy, small ? 13 : 16, WHITE, 0.5, 0.95 * f);
    }
  }
}
