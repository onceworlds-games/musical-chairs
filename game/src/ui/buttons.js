// Real buttons for a canvas game: each one the screen declares becomes a transparent <button> over the canvas (so
// keyboards, screen readers and taps all work), and is drawn underneath in the stroke font. Focus and hover light the
// drawn button. Labels come from the game (never from other players).

export class Buttons {
  constructor(layer, onPress) {
    this.layer = layer;
    this.onPress = onPress;
    this.els = new Map();
    this.list = [];
    this.hover = null;
    this.focus = null;
    this.pressedAt = new Map();
  }

  /** The buttons this frame: [{ id, x, y, w, h, label, key, on (selected), off (disabled), small, aria }]. */
  set(list) {
    this.list = list;
    const keep = new Set();
    for (const b of list) {
      keep.add(b.id);
      let el = this.els.get(b.id);
      if (!el) {
        el = document.createElement('button');
        el.type = 'button';
        el.className = 'hit';
        el.addEventListener('click', (e) => {
          e.preventDefault();
          const cur = this.list.find((x) => x.id === el.dataset.id);
          if (!cur || cur.off) return;
          // A double press (two taps at once, a bouncing switch) counts once.
          const last = this.pressedAt.get(cur.id) || 0;
          const now = performance.now();
          if (now - last < 180) return;
          this.pressedAt.set(cur.id, now);
          this.onPress(cur.id, cur);
        });
        el.addEventListener('pointerenter', () => (this.hover = el.dataset.id));
        el.addEventListener('pointerleave', () => {
          if (this.hover === el.dataset.id) this.hover = null;
        });
        el.addEventListener('focus', () => (this.focus = el.dataset.id));
        el.addEventListener('blur', () => {
          if (this.focus === el.dataset.id) this.focus = null;
        });
        el.dataset.id = b.id;
        this.layer.appendChild(el);
        this.els.set(b.id, el);
      }
      const style = el.style;
      const px = (n) => `${Math.round(n)}px`;
      if (style.left !== px(b.x)) style.left = px(b.x);
      if (style.top !== px(b.y)) style.top = px(b.y);
      if (style.width !== px(b.w)) style.width = px(b.w);
      if (style.height !== px(b.h)) style.height = px(b.h);
      const label = b.aria || b.label;
      if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
      el.disabled = Boolean(b.off);
      el.setAttribute('aria-pressed', b.on ? 'true' : 'false');
    }
    for (const [id, el] of this.els) {
      if (keep.has(id)) continue;
      if (this.hover === id) this.hover = null;
      if (this.focus === id) this.focus = null;
      el.remove();
      this.els.delete(id);
    }
  }

  clear() {
    this.set([]);
  }

  /** Draws the declared buttons. */
  draw(vec, hue, t, calm, touch = false) {
    const now = performance.now();
    for (const b of this.list) {
      if (b.hidden) continue;
      const lit = b.id === this.hover || b.id === this.focus;
      // A press answers at once: a short wash of light inside the box.
      const age = now - (this.pressedAt.get(b.id) || -1e9);
      if (age < 200 && !b.off) {
        const c = vec.ctx;
        c.fillStyle = b.on ? '#ffffff' : hue;
        c.globalAlpha = 0.22 * (1 - age / 200);
        c.fillRect(b.x, b.y, b.w, b.h);
        c.globalAlpha = 1;
      }
      // The one big button breathes slowly (not in Calm): it is the thing to press.
      const k = (b.off ? 0.3 : b.on ? 1 : lit ? 0.95 : 0.6) + (b.big && !calm && !b.off ? 0.12 * Math.sin(t * 2.6) : 0);
      const col = b.on || lit ? '#ffffff' : b.color || hue;
      if (b.frame !== false) {
        // A box with bright corner ticks.
        const c = Math.min(10, b.w / 4, b.h / 3);
        vec.begin();
        vec.move(b.x, b.y + c);
        vec.to(b.x, b.y);
        vec.to(b.x + c, b.y);
        vec.move(b.x + b.w - c, b.y);
        vec.to(b.x + b.w, b.y);
        vec.to(b.x + b.w, b.y + c);
        vec.move(b.x + b.w, b.y + b.h - c);
        vec.to(b.x + b.w, b.y + b.h);
        vec.to(b.x + b.w - c, b.y + b.h);
        vec.move(b.x + c, b.y + b.h);
        vec.to(b.x, b.y + b.h);
        vec.to(b.x, b.y + b.h - c);
        vec.glow(col, 1.2, k);
        vec.begin();
        vec.move(b.x + c, b.y);
        vec.to(b.x + b.w - c, b.y);
        vec.move(b.x + c, b.y + b.h);
        vec.to(b.x + b.w - c, b.y + b.h);
        vec.move(b.x, b.y + c);
        vec.to(b.x, b.y + b.h - c);
        vec.move(b.x + b.w, b.y + c);
        vec.to(b.x + b.w, b.y + b.h - c);
        vec.thin(col, 1, 0.22 * k + (b.on ? 0.2 : 0));
      }
      if (b.draw) b.draw(vec, b, lit, k, t, calm);
      else if (b.label) {
        const size = Math.min(b.small ? 12 : b.big ? 26 : 17, (b.h - 18) * 0.9, (b.w - 16) / Math.max(1, b.label.length * 0.95));
        vec.text(b.label, b.x + b.w / 2, b.y + b.h / 2 - size / 2, Math.max(8, size), col, 0.5, Math.min(1, k + 0.15));
      }
      if (b.key && !b.small && !touch) {
        vec.text(b.key, b.x + b.w - 6, b.y + 5, 8, col, 1, 0.6);
      }
    }
  }
}
