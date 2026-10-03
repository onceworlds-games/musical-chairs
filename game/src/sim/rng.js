// Seeded randomness for the simulation. One 32-bit state (mulberry32), so a snapshot can carry it and a new host can
// continue the same stream. Never Math.random inside the simulation.

export function hash32(...parts) {
  let h = 0x811c9dc5;
  for (const part of parts) {
    const s = typeof part === 'number' ? String(Math.floor(part)) : String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export class Rng {
  constructor(seed = 1) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n) {
    return Math.floor(this.next() * n);
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  chance(p) {
    return this.next() < p;
  }
  pick(list) {
    return list[Math.floor(this.next() * list.length)];
  }
  sign() {
    return this.next() < 0.5 ? -1 : 1;
  }
  /** Weighted pick: weights is an array of numbers >= 0. Returns an index (0 when every weight is 0). */
  weighted(weights) {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return 0;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] > 0 ? weights[i] : 0;
      if (r < w) return i;
      r -= w;
    }
    return weights.length - 1;
  }
  shuffle(list) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    return list;
  }
}
