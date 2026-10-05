// Keyboard and the platform's touch controls, combined: a movement vector and a button press (with a little buffer so a
// press just before the bump is ready still counts). Needs a window, so only main.js imports it.

const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const BUFFER = 0.14; // seconds a press waits for the bump to be ready

export function createInput(ow) {
  const keys = new Set();
  let tapped = false;
  let prevHeld = false;
  let buf = 0;
  const out = { mx: 0, my: 0, bump: false };

  const typing = () => {
    const el = document.activeElement;
    return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
  };

  addEventListener('keydown', (e) => {
    if (typing()) return;
    if (MOVE_KEYS[e.code] || e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Space') tapped = true;
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => {
    keys.clear();
    tapped = false;
  });

  function controls() {
    try {
      return ow && ow.controls ? ow.controls : null;
    } catch (err) {
      return null;
    }
  }

  return {
    /** The movement and the (buffered) bump for one step of `dt` seconds. */
    read(dt) {
      let mx = 0;
      let my = 0;
      for (const k of keys) {
        const m = MOVE_KEYS[k];
        if (m) {
          mx += m[0];
          my += m[1];
        }
      }
      const c = controls();
      let held = keys.has('Space');
      if (c) {
        const st = c.stick;
        if (st && Number.isFinite(st.x) && Number.isFinite(st.y) && (st.x !== 0 || st.y !== 0)) {
          mx += st.x;
          my += st.y;
        }
        if (c.pressed('bump')) held = true;
      }
      const len = Math.hypot(mx, my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      out.mx = mx;
      out.my = my;
      if ((held && !prevHeld) || tapped) buf = BUFFER;
      tapped = false;
      prevHeld = held;
      if (buf > 0) buf -= dt;
      out.bump = buf > 0;
      return out;
    },
    /** The press was used (a bump started): don't fire it again. */
    consume() {
      buf = 0;
    },
    reset() {
      keys.clear();
      tapped = false;
      buf = 0;
      prevHeld = false;
    },
  };
}
