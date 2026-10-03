// The web: N lanes laid along a rim (a closed loop or an open line), each running away from the rim to a far point
// by the perspective s(z) = 1 / (1 + k z). Pure geometry in unit coordinates (y down, the rim fits in [-1, 1]); the
// renderer scales it to the screen. The simulation only needs `n` and `closed`.

const TAU = Math.PI * 2;

/** Lanes per edge, proportional to edge length, summing to n (every edge gets at least one lane). */
function distribute(lengths, n) {
  const total = lengths.reduce((a, b) => a + b, 0);
  const counts = lengths.map((l) => Math.max(1, Math.floor((l / total) * n)));
  let sum = counts.reduce((a, b) => a + b, 0);
  // Hand out (or take back) the remainder by the largest fractional parts.
  const order = lengths.map((l, i) => [i, (l / total) * n - Math.floor((l / total) * n)]).sort((a, b) => b[1] - a[1]);
  let k = 0;
  while (sum < n) counts[order[k++ % order.length][0]]++, sum++;
  k = order.length - 1;
  for (let guard = 0; sum > n && guard < order.length * (n + 4); guard++) {
    const i = order[((k % order.length) + order.length) % order.length][0];
    if (counts[i] > 1) counts[i]--, sum--;
    k--;
  }
  return counts;
}

/** Samples a polygon's edges into lane boundary points. Closed: n points; open: n + 1. */
function samplePolyline(verts, closed, n) {
  const edges = [];
  const m = closed ? verts.length : verts.length - 1;
  for (let i = 0; i < m; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    edges.push([a, b, Math.hypot(b[0] - a[0], b[1] - a[1])]);
  }
  const counts = distribute(
    edges.map((e) => e[2]),
    n,
  );
  const pts = [];
  edges.forEach(([a, b], i) => {
    for (let j = 0; j < counts[i]; j++) {
      const t = j / counts[i];
      pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  if (!closed) pts.push(verts[verts.length - 1].slice());
  return pts;
}

/** Samples a smooth closed curve r(θ) at equal arc length into n points, the first lane centred at the bottom. */
function sampleCurve(fn, n, closed = true, t0 = 0, t1 = 1) {
  const fine = 720;
  const raw = [];
  for (let i = 0; i <= fine; i++) raw.push(fn(t0 + ((t1 - t0) * i) / fine));
  const acc = [0];
  for (let i = 1; i < raw.length; i++) acc.push(acc[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const total = acc[acc.length - 1];
  const pts = [];
  const count = closed ? n : n + 1;
  const offset = closed ? -0.5 / n : 0; // closed: lane 0 straddles the start
  let j = 0;
  for (let i = 0; i < count; i++) {
    let target = ((closed ? i / n + offset : i / n) * total) % total;
    if (target < 0) target += total;
    if (!closed && i === n) target = total;
    while (j > 0 && acc[j] > target) j--;
    while (j < acc.length - 2 && acc[j + 1] < target) j++;
    const seg = acc[j + 1] - acc[j] || 1;
    const t = Math.min(1, Math.max(0, (target - acc[j]) / seg));
    pts.push([raw[j][0] + (raw[j + 1][0] - raw[j][0]) * t, raw[j][1] + (raw[j + 1][1] - raw[j][1]) * t]);
  }
  return pts;
}

/** A regular polygon's vertices, starting so that the bottom edge is centred (y down). */
function regular(sides, radius = 1, rot = 0) {
  const v = [];
  for (let i = 0; i < sides; i++) {
    const a = Math.PI / 2 + Math.PI / sides - (TAU * i) / sides + rot;
    v.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return v;
}

/** Rotates a vertex list so the edge whose midpoint is lowest comes first (the player's starting lane is at the bottom). */
function bottomFirst(verts) {
  let best = 0;
  let bestY = -Infinity;
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const y = (a[1] + b[1]) / 2 - Math.abs(a[0] + b[0]) * 0.001;
    if (y > bestY) (bestY = y), (best = i);
  }
  return verts.slice(best).concat(verts.slice(0, best));
}

/** Every web shape: closed loops and open lines. lanes: the default lane count. */
export const SHAPES = {
  circle: { closed: true, lanes: 16, curve: (t) => [Math.sin(TAU * t), Math.cos(TAU * t)] },
  square: { closed: true, lanes: 16, verts: () => regular(4, 1.18, 0) },
  octagon: { closed: true, lanes: 16, verts: () => regular(8, 1.05, 0) },
  triangle: { closed: true, lanes: 15, verts: () => regular(3, 1.25, Math.PI) },
  heptagon: { closed: true, lanes: 14, verts: () => regular(7, 1.05, 0) },
  diamond: {
    closed: true,
    lanes: 16,
    verts: () => [
      [0, 1.05],
      [1.0, 0],
      [0, -1.05],
      [-1.0, 0],
    ],
  },
  clover: {
    closed: true,
    lanes: 16,
    curve: (t) => {
      const a = TAU * t;
      const r = 0.8 + 0.2 * Math.cos(4 * a);
      return [Math.sin(a) * r * 1.12, Math.cos(a) * r * 1.12];
    },
  },
  star: {
    closed: true,
    lanes: 20,
    verts: () => {
      const v = [];
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 - (TAU * i) / 10 + Math.PI / 10;
        const r = i % 2 === 0 ? 1.12 : 0.55;
        v.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      return bottomFirst(v);
    },
  },
  bowtie: {
    closed: true,
    lanes: 16,
    verts: () =>
      bottomFirst([
        [-1.1, 0.75],
        [0, 0.32],
        [1.1, 0.75],
        [1.1, -0.75],
        [0, -0.32],
        [-1.1, -0.75],
      ]),
  },
  hourglass: {
    closed: true,
    lanes: 16,
    verts: () =>
      bottomFirst([
        [-0.8, 1.05],
        [0.8, 1.05],
        [0.28, 0],
        [0.8, -1.05],
        [-0.8, -1.05],
        [-0.28, 0],
      ]),
  },
  cross: {
    closed: true,
    lanes: 24,
    verts: () => {
      const a = 0.38;
      const b = 1.05;
      return bottomFirst([
        [-a, b],
        [a, b],
        [a, a],
        [b, a],
        [b, -a],
        [a, -a],
        [a, -b],
        [-a, -b],
        [-a, -a],
        [-b, -a],
        [-b, a],
        [-a, a],
      ]);
    },
  },
  rose: {
    closed: true,
    lanes: 18,
    curve: (t) => {
      const a = TAU * t;
      const r = 0.72 + 0.28 * Math.cos(3 * a);
      return [Math.sin(a) * r * 1.15, Math.cos(a) * r * 1.15];
    },
  },
  pentagon: { closed: true, lanes: 15, verts: () => regular(5, 1.1, 0) },
  // Open shapes: the rim is a line at the near side; the lanes run away to a vanishing point above it.
  flat: {
    closed: false,
    lanes: 14,
    vp: [0, -0.75],
    verts: () => [
      [-1.15, 0.7],
      [1.15, 0.7],
    ],
  },
  vee: {
    closed: false,
    lanes: 16,
    vp: [0, -0.8],
    verts: () => [
      [-1.15, -0.05],
      [0, 0.95],
      [1.15, -0.05],
    ],
  },
  cup: {
    closed: false,
    lanes: 16,
    vp: [0, -0.7],
    curve: (t) => {
      const a = Math.PI * (1 - t);
      return [Math.cos(a) * 1.05, Math.sin(a) * 0.95 - 0.05];
    },
    t0: 0,
    t1: 1,
  },
  zigzag: {
    closed: false,
    lanes: 14,
    vp: [0, -0.8],
    verts: () => [
      [-1.15, 0.35],
      [-0.58, 0.85],
      [0, 0.35],
      [0.58, 0.85],
      [1.15, 0.35],
    ],
  },
  steps: {
    closed: false,
    lanes: 14,
    vp: [0, -0.8],
    verts: () => [
      [-1.15, 0.2],
      [-0.6, 0.2],
      [-0.6, 0.55],
      [0.6, 0.55],
      [0.6, 0.9],
      [1.15, 0.9],
    ],
  },
  spiral: {
    closed: false,
    lanes: 18,
    vp: [0.05, -0.1],
    curve: (t) => {
      const a = Math.PI * 0.6 + t * Math.PI * 1.7;
      const r = 1.1 - t * 0.42;
      return [-Math.cos(a) * r, Math.sin(a) * r * 0.95];
    },
    t0: 0,
    t1: 1,
  },
};

/**
 * Builds a web: { shape, n, closed, rim: [[x, y]...] (n points closed, n + 1 open), vp: [x, y], k }.
 * `lanes` defaults to the shape's own count; it is clamped to 8..24.
 */
export function makeWeb(shapeId, lanes) {
  const shape = SHAPES[shapeId] ?? SHAPES.circle;
  const verts = shape.verts ? shape.verts() : null;
  // A polygon needs at least a lane per edge.
  const edges = verts ? (shape.closed ? verts.length : verts.length - 1) : 0;
  const n = Math.max(8, edges, Math.min(24, Math.round(Number(lanes) || shape.lanes)));
  let rim;
  if (shape.curve) rim = sampleCurve(shape.curve, n, shape.closed, shape.t0 ?? 0, shape.t1 ?? 1);
  else rim = samplePolyline(verts, shape.closed, n);
  // The player starts in the lane nearest the bottom centre of the screen.
  let start = 0;
  let best = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = rim[i];
    const b = rim[shape.closed ? (i + 1) % n : i + 1];
    const score = (a[1] + b[1]) / 2 - Math.abs(a[0] + b[0]) * 0.25;
    if (score > best + 1e-9) (best = score), (start = i);
  }
  return {
    shape: SHAPES[shapeId] ? shapeId : 'circle',
    n,
    closed: shape.closed,
    rim,
    start,
    vp: shape.vp ? shape.vp.slice() : [0, 0],
    k: shape.closed ? 4.2 : 3.4,
  };
}

// ------------------------------------------------------------------ topology (used by the simulation)

/** The lane a continuous position sits in: wraps on closed webs, clamps on open ones. */
export function laneOf(web, u) {
  const i = Math.round(u);
  if (web.closed) return ((i % web.n) + web.n) % web.n;
  return Math.max(0, Math.min(web.n - 1, i));
}

/** Wraps (closed) or clamps (open) a continuous lane position. */
export function wrapU(web, u) {
  if (web.closed) return ((u % web.n) + web.n) % web.n;
  return Math.max(0, Math.min(web.n - 1, u));
}

/** Signed shortest lane offset from a to b (the short way round on closed webs). */
export function laneDelta(web, a, b) {
  let d = b - a;
  if (web.closed) {
    d = ((d % web.n) + web.n) % web.n;
    if (d > web.n / 2) d -= web.n;
  }
  return d;
}

export function laneDist(web, a, b) {
  return Math.abs(laneDelta(web, a, b));
}

/** The lane across the web: opposite on a loop, mirrored on a line. */
export function opposite(web, lane) {
  return web.closed ? (lane + Math.floor(web.n / 2)) % web.n : web.n - 1 - lane;
}

/** A neighbour lane, or -1 past the end of an open web. */
export function neighbour(web, lane, dir) {
  const j = lane + dir;
  if (web.closed) return ((j % web.n) + web.n) % web.n;
  return j < 0 || j >= web.n ? -1 : j;
}

// ------------------------------------------------------------------ geometry (used by the renderer and input)

/** Perspective scale at depth z. */
export function persp(web, z) {
  return 1 / (1 + web.k * z);
}

/** The point at lane boundary j (0..n) and depth z, in unit coordinates, for a rim already transformed (spin/sway). */
export function boundaryPoint(web, rim, j, z, out) {
  const p = rim[web.closed ? ((j % web.n) + web.n) % web.n : Math.max(0, Math.min(web.n, j))];
  const s = 1 / (1 + web.k * z);
  out[0] = web.vp[0] + (p[0] - web.vp[0]) * s;
  out[1] = web.vp[1] + (p[1] - web.vp[1]) * s;
  return out;
}

/** The point at a continuous lane position u (lane centres are integers) and depth z. */
export function lanePoint(web, rim, u, z, out) {
  const n = web.n;
  let a;
  let f;
  if (web.closed) {
    const uu = ((u % n) + n) % n;
    a = Math.floor(uu + 0.5);
    f = uu + 0.5 - a;
    a = a % n;
  } else {
    const uu = Math.max(-0.5, Math.min(n - 0.5, u));
    a = Math.floor(uu + 0.5);
    f = uu + 0.5 - a;
    if (a >= n) (a = n - 1), (f = 1);
  }
  const p = rim[a];
  const q = rim[web.closed ? (a + 1) % n : a + 1];
  const x = p[0] + (q[0] - p[0]) * f;
  const y = p[1] + (q[1] - p[1]) * f;
  const s = 1 / (1 + web.k * z);
  out[0] = web.vp[0] + (x - web.vp[0]) * s;
  out[1] = web.vp[1] + (y - web.vp[1]) * s;
  return out;
}

/** Rim points turned by an angle around the centre (closed webs spin; open ones sway about their vanishing point). */
export function transformRim(web, angle, out) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const cx = web.closed ? 0 : web.vp[0];
  const cy = web.closed ? 0 : web.vp[1];
  for (let i = 0; i < web.rim.length; i++) {
    const p = web.rim[i];
    const x = p[0] - cx;
    const y = p[1] - cy;
    if (!out[i]) out[i] = [0, 0];
    out[i][0] = cx + x * c - y * s;
    out[i][1] = cy + x * s + y * c;
  }
  out.length = web.rim.length;
  return out;
}

/** Bounds of the web (rim and far ring) for fitting it to the screen. */
export function webBounds(web) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of web.rim) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  // A web that spins needs room for any angle.
  const r = Math.max(...web.rim.map((p) => Math.hypot(p[0], p[1])));
  return { x0, y0, x1, y1, r };
}
