// Every number the game is made of: the beat grid, enemies, worlds, ships, mods and the Overclock ladder.
// Tuned against scripts/balance.mjs (headless bots across seeds); change a number here, run the harness.

// ------------------------------------------------------------------ the beat grid
export const STEPS_PER_TICK = 8; // a tick is a sixteenth note; the simulation steps 8 times per tick
export const TICKS_PER_BEAT = 4;
export const BEATS_PER_BAR = 4;
export const TICKS_PER_BAR = 16;
export const STEPS_PER_BEAT = STEPS_PER_TICK * TICKS_PER_BEAT; // 32
export const STEPS_PER_BAR = STEPS_PER_BEAT * BEATS_PER_BAR; // 128

export const COUNTIN_BARS = 2;
export const STANZA_BARS = 8;
export const STANZAS = 3;
export const BOSS_BARS = 40; // a boss that outlasts this many bars starts to hurry (its attacks double)
export const VAMP_BARS = 8; // after the last stanza, survivors get this long before they scatter
export const WARP_BARS = 1;

/** Seconds per simulation step at a tempo. */
export const stepSeconds = (bpm) => 60 / bpm / TICKS_PER_BEAT / STEPS_PER_TICK;

// ------------------------------------------------------------------ the ship
export const SHIP = {
  speed: 14, // lanes per second at full tilt
  boltSpeed: 1.6, // z per second
  hopLanes: 3,
  hopInvuln: 0.25, // seconds
  zapRadius: 4, // lanes either side
  respawnInvulnBeats: 2,
  lives: 3,
  maxLives: 6,
  contactGraceTicks: 1.5, // a crawler that lands in your lane has a dotted sixteenth before it catches you
  maxBolts: 200, // across every ship
};

// ------------------------------------------------------------------ enemies
export const E = {
  FLIPPER: 1,
  TANKER: 2,
  SPIKER: 3,
  FUSEBALL: 4,
  PULSAR: 5,
  GHOST: 6,
  WEAVER: 7,
  BOMBER: 8,
  MINE: 9,
  SIREN: 10,
  SHOT: 11,
  PART: 12, // a piece of a boss
};

/**
 * climb: z per beat at world 1 (multiplied by the world's pace). cost: what the zone budget pays to spawn one.
 * res: Resonance a kill adds. points: base score.
 */
export const ENEMIES = {
  [E.FLIPPER]: { key: 'flipper', name: 'FLIPPER', hp: 1, points: 150, res: 4, cost: 2, climb: 0.21 },
  [E.TANKER]: { key: 'tanker', name: 'TANKER', hp: 2, points: 100, res: 3, cost: 4, climb: 0.13 },
  [E.SPIKER]: { key: 'spiker', name: 'SPIKER', hp: 1, points: 50, res: 2, cost: 3, climb: 0.24 },
  [E.FUSEBALL]: { key: 'fuseball', name: 'FUSEBALL', hp: 1, points: 250, res: 6, cost: 5, climb: 0.2 },
  [E.PULSAR]: { key: 'pulsar', name: 'PULSAR', hp: 1, points: 200, res: 5, cost: 5, climb: 0.11 },
  [E.GHOST]: { key: 'ghost', name: 'GHOST', hp: 1, points: 300, res: 5, cost: 4, climb: 0.22 },
  [E.WEAVER]: { key: 'weaver', name: 'WEAVER', hp: 2, points: 200, res: 4, cost: 3, climb: 0.17 },
  [E.BOMBER]: { key: 'bomber', name: 'BOMBER', hp: 3, points: 400, res: 8, cost: 7, climb: 0.12 },
  [E.MINE]: { key: 'mine', name: 'MINE', hp: 1, points: 50, res: 1, cost: 0, climb: 0.32 },
  [E.SIREN]: { key: 'siren', name: 'SIREN', hp: 1, points: 100, res: 3, cost: 2, climb: 0.13 },
  [E.SHOT]: { key: 'shot', name: 'SHOT', hp: 1, points: 10, res: 1, cost: 0, climb: 0.6 },
  [E.PART]: { key: 'part', name: 'BOSS', hp: 6, points: 500, res: 2, cost: 0, climb: 0 },
};

export const CHOIR_BONUS = 1500;
export const CHORD_POINTS = 1000; // per lane past two
export const PERFECT_BAR_POINTS = 500;
export const FLAWLESS_POINTS = 5000; // times the world number
export const ZONE_POINTS = 1000; // times world x level
export const RESONANCE_MAX = 100;
export const OVERDRIVE_SECONDS = 10;
export const MULT_CAP = 8;

/** Pickups: they climb from a kill to the rim; a ship in that lane catches them. */
export const PICKUPS = {
  ZAP: 1,
  LIFE: 2,
  TEMPO: 3,
};

// ------------------------------------------------------------------ worlds
// pace multiplies every climb speed; budget is threat points per stanza at level 1; pool lists the enemies it uses
// with spawn weights. Modes name the scale the music plays in.
export const WORLDS = [
  {
    key: 'mint',
    name: 'MINT CIRCUIT',
    hue: '#3dffb0',
    bpm: 108,
    root: 50, // D3
    mode: 'dorian',
    chords: [0, 3, 5, 3], // scale degrees: i IV VI IV
    shapes: ['circle', 'square', 'clover'],
    bossShape: 'circle',
    boss: 'hydra',
    pace: 1,
    tough: 1, // hit points of a plain enemy here
    budget: 40,
    pool: { [E.FLIPPER]: 10, [E.TANKER]: 3, [E.SPIKER]: 3 },
    cargo: E.FLIPPER,
    shots: 0.05,
  },
  {
    key: 'amber',
    name: 'AMBER FOLD',
    hue: '#ffb13d',
    bpm: 114,
    root: 55, // G3
    mode: 'mixolydian',
    chords: [0, 6, 3, 0],
    shapes: ['square', 'bowtie', 'triangle'],
    bossShape: 'octagon',
    boss: 'gate',
    pace: 1.08,
    tough: 1, // hit points of a plain enemy here
    budget: 50,
    pool: { [E.FLIPPER]: 9, [E.TANKER]: 3, [E.SPIKER]: 3, [E.FUSEBALL]: 3, [E.WEAVER]: 3 },
    cargo: E.FLIPPER,
    shots: 0.08,
  },
  {
    key: 'ice',
    name: 'ICE SPIRE',
    hue: '#8fe3ff',
    bpm: 120,
    root: 53, // F3
    mode: 'lydian',
    chords: [0, 1, 4, 0],
    shapes: ['star', 'vee', 'diamond'],
    bossShape: 'star',
    boss: 'conductor',
    pace: 1.12,
    tough: 1.5, // hit points of a plain enemy here
    budget: 50,
    pool: { [E.FLIPPER]: 8, [E.TANKER]: 3, [E.SPIKER]: 2, [E.FUSEBALL]: 3, [E.WEAVER]: 2, [E.PULSAR]: 3, [E.GHOST]: 3 },
    cargo: E.PULSAR,
    shots: 0.11,
  },
  {
    key: 'vermilion',
    name: 'VERMILION GATE',
    hue: '#ff4a2b',
    bpm: 126,
    root: 52, // E3
    mode: 'phrygian',
    chords: [0, 1, 3, 1],
    shapes: ['hourglass', 'cross', 'heptagon'],
    bossShape: 'hourglass',
    boss: 'tide',
    pace: 1.4,
    tough: 2, // hit points of a plain enemy here
    budget: 104,
    pool: { [E.FLIPPER]: 8, [E.TANKER]: 3, [E.SPIKER]: 3, [E.FUSEBALL]: 3, [E.WEAVER]: 2, [E.PULSAR]: 2, [E.GHOST]: 2, [E.BOMBER]: 2 },
    cargo: E.FUSEBALL,
    shots: 0.16,
  },
  {
    key: 'lime',
    name: 'LIME RIBBON',
    hue: '#b6ff3d',
    bpm: 132,
    root: 57, // A3
    mode: 'aeolian',
    chords: [0, 5, 2, 6],
    shapes: ['flat', 'cup', 'spiral'],
    bossShape: 'flat',
    boss: 'mirror',
    pace: 1.55,
    tough: 2, // hit points of a plain enemy here
    budget: 124,
    pool: { [E.FLIPPER]: 8, [E.TANKER]: 2, [E.SPIKER]: 2, [E.FUSEBALL]: 3, [E.WEAVER]: 3, [E.PULSAR]: 2, [E.GHOST]: 2, [E.BOMBER]: 2, [E.SIREN]: 3 },
    cargo: E.FLIPPER,
    shots: 0.19,
  },
  {
    key: 'rose',
    name: 'ROSE ORBIT',
    hue: '#ff5c8a',
    bpm: 138,
    root: 48, // C3
    mode: 'harmonic',
    chords: [0, 5, 3, 4],
    shapes: ['rose', 'pentagon', 'circle'],
    bossShape: 'circle',
    boss: 'maestro',
    pace: 1.7,
    tough: 2, // hit points of a plain enemy here
    budget: 144,
    pool: { [E.FLIPPER]: 8, [E.TANKER]: 3, [E.SPIKER]: 2, [E.FUSEBALL]: 3, [E.WEAVER]: 2, [E.PULSAR]: 3, [E.GHOST]: 2, [E.BOMBER]: 2, [E.SIREN]: 3 },
    cargo: E.PULSAR,
    spin: 0.11, // radians per second: these webs turn
    shots: 0.22,
  },
  // The Descent's own worlds (after the six, they alternate with the others at rising tempo).
  {
    key: 'gold',
    name: 'GOLD DEPTHS',
    hue: '#ffd23d',
    bpm: 124,
    root: 55,
    mode: 'ionian',
    chords: [0, 4, 5, 3],
    shapes: ['zigzag', 'steps', 'octagon', 'hourglass'],
    bossShape: 'octagon',
    boss: 'gate',
    pace: 1.45,
    tough: 2, // hit points of a plain enemy here
    budget: 110,
    pool: { [E.FLIPPER]: 8, [E.TANKER]: 3, [E.SPIKER]: 3, [E.FUSEBALL]: 3, [E.WEAVER]: 3, [E.PULSAR]: 2, [E.GHOST]: 2, [E.BOMBER]: 2, [E.SIREN]: 2 },
    cargo: E.FUSEBALL,
    shots: 0.18,
  },
  {
    key: 'sky',
    name: 'SKY DEPTHS',
    hue: '#5cb8ff',
    bpm: 128,
    root: 53,
    mode: 'lydian',
    chords: [0, 1, 5, 4],
    shapes: ['clover', 'vee', 'star', 'spiral'],
    bossShape: 'star',
    boss: 'conductor',
    pace: 1.5,
    tough: 2, // hit points of a plain enemy here
    budget: 116,
    pool: { [E.FLIPPER]: 8, [E.TANKER]: 3, [E.SPIKER]: 2, [E.FUSEBALL]: 3, [E.WEAVER]: 3, [E.PULSAR]: 3, [E.GHOST]: 3, [E.BOMBER]: 2, [E.SIREN]: 2 },
    cargo: E.PULSAR,
    spin: 0.07,
    shots: 0.18,
  },
];

export const RUN_WORLDS = 6;
export const LEVELS_PER_WORLD = 4; // three zones and a boss

// secs: how long a lone Plectrum firing without a miss needs to bring it down (its HP scales with the tempo).
export const BOSSES = {
  hydra: { name: 'HYDRA', secs: 30 },
  gate: { name: 'GATE', secs: 34 },
  conductor: { name: 'CONDUCTOR', secs: 16 },
  tide: { name: 'TIDE', secs: 38 },
  mirror: { name: 'MIRROR', secs: 40 },
  maestro: { name: 'MAESTRO', secs: 90 },
};

// ------------------------------------------------------------------ ships
// rate: ticks between bolts (1 = sixteenths). dmg per bolt. speed in z/s. range: where bolts fade (1 = the far end).
export const SHIPS = [
  { key: 'plectrum', name: 'PLECTRUM', rate: 1, dmg: 1, speed: 1.6, range: 1, tag: 'STEADY SIXTEENTHS' },
  { key: 'mallet', name: 'MALLET', rate: 2, dmg: 1.1, speed: 2.1, range: 0.7, spread: 1, tag: 'THREE LANES, CLOSE' },
  { key: 'reed', name: 'REED', rate: 1, dmg: 0.95, speed: 1.45, range: 1, homing: 1, tag: 'NOTES THAT SEEK' },
  { key: 'bow', name: 'BOW', rate: 2, dmg: 2.3, speed: 2.7, range: 1, pierceAll: 1, tag: 'A BEAM THAT PIERCES' },
  { key: 'chime', name: 'CHIME', rate: 2, dmg: 1.4, speed: 1.7, range: 1, drones: 2, tag: 'DRONES PLAY ALONG' },
  { key: 'fork', name: 'FORK', rate: 2, dmg: 1.45, speed: 1.7, range: 1, tines: 1, tag: 'TWO TINES, ONE HUM' },
];

/** What unlocks each ship (checked against the profile). */
export const SHIP_UNLOCKS = {
  plectrum: null,
  mallet: { worldsCleared: 1, label: 'BEAT THE HYDRA' },
  reed: { reached: 3, label: 'REACH WORLD 3' },
  bow: { best: 1000000, label: 'SCORE 1M' },
  chime: { chords: 25, label: '25 CHORDS' },
  fork: { worldsCleared: 3, label: 'BEAT THE CONDUCTOR' },
};

// ------------------------------------------------------------------ mods
// max: how many times it stacks. coop: offered only when others play. Every effect lives in world.js.
export const MODS = [
  { key: 'pierce', name: 'PIERCE', max: 2, tag: 'BOLTS PASS THROUGH' },
  { key: 'spread', name: 'SPREAD', max: 2, tag: 'SIDE LANES TOO' },
  { key: 'echo', name: 'ECHO', max: 2, tag: 'REPEAT NEXT BEAT' },
  { key: 'ricochet', name: 'RICOCHET', max: 1, tag: 'BOUNCE OFF THE FAR END' },
  { key: 'counterpoint', name: 'COUNTERPOINT', max: 1, tag: 'A BOLT ACROSS THE WEB' },
  { key: 'tremolo', name: 'TREMOLO', max: 1, tag: 'TRIPLETS: FASTER FIRE' },
  { key: 'staccato', name: 'STACCATO', max: 2, tag: 'FASTER BOLTS' },
  { key: 'sustain', name: 'SUSTAIN', max: 2, tag: 'HOLD STILL TO CHARGE' },
  { key: 'metronome', name: 'METRONOME', max: 2, tag: 'ON-BEAT BOLTS HIT HARD' },
  { key: 'syncopate', name: 'SYNCOPATE', max: 2, tag: 'OFFBEAT BOLTS FLY' },
  { key: 'glissando', name: 'GLISSANDO', max: 1, tag: 'BOLTS BEND TO TARGETS' },
  { key: 'chain', name: 'CHAIN', max: 2, tag: 'KILLS ARC SIDEWAYS' },
  { key: 'downbeat', name: 'DOWNBEAT', max: 2, tag: 'FIRST KILL BLASTS ITS LANE' },
  { key: 'phasehop', name: 'PHASE HOP', max: 2, tag: 'HOPS BURN THE RIM' },
  { key: 'gracenote', name: 'GRACE NOTE', max: 2, tag: 'LONGER, QUICKER HOPS' },
  { key: 'bassdrop', name: 'BASS DROP', max: 2, tag: 'KILLS RECHARGE ZAP' },
  { key: 'forte', name: 'FORTE', max: 2, tag: 'WIDER ZAP' },
  { key: 'shieldbeat', name: 'SHIELD BEAT', max: 2, tag: 'A SHIELD NOW AND THEN' },
  { key: 'encore', name: 'ENCORE', max: 1, tag: 'A SHIP, SLOWER RESONANCE' },
  { key: 'undertow', name: 'UNDERTOW', max: 2, tag: 'SLOW THE NEAR END' },
  { key: 'rimguard', name: 'RIM GUARD', max: 1, tag: 'A SPARK EVERY 2 BARS' },
  { key: 'resonator', name: 'RESONATOR', max: 2, tag: 'FASTER RESONANCE' },
  { key: 'overtone', name: 'OVERTONE', max: 2, tag: 'LONGER OVERDRIVE' },
  { key: 'feedback', name: 'FEEDBACK', max: 1, tag: 'KILLS EXTEND OVERDRIVE' },
  { key: 'harmonic', name: 'HARMONIC', max: 2, tag: 'BIGGER CHORDS' },
  { key: 'crescendo', name: 'CRESCENDO', max: 2, tag: 'HIGHER MULTIPLIER' },
  { key: 'magnet', name: 'MAGNET', max: 2, tag: 'PICKUPS COME TO YOU' },
  { key: 'drone', name: 'DRONE', max: 2, tag: 'A DRONE FIRES TOO' },
  { key: 'spikebreaker', name: 'SPIKEBREAKER', max: 1, tag: 'SPIKES SHATTER' },
  { key: 'unison', name: 'UNISON', max: 2, coop: 1, tag: 'A STRONGER TETHER' },
];
export const MOD_INDEX = Object.fromEntries(MODS.map((m, i) => [m.key, i]));

// ------------------------------------------------------------------ Overclock: each rung adds to the ones below
export const OVERCLOCK = [
  { n: 0, name: 'OFF', rule: '' },
  { n: 1, name: 'OC 1', rule: 'FASTER, DENSER' },
  { n: 2, name: 'OC 2', rule: 'FLIPPERS SHOOT MORE' },
  { n: 3, name: 'OC 3', rule: 'CRAWLERS DOUBLE-STEP' },
  { n: 4, name: 'OC 4', rule: 'TALLER SPIKES' },
  { n: 5, name: 'OC 5', rule: 'PULSARS EVERY BAR' },
  { n: 6, name: 'OC 6', rule: 'TWO SHIPS' },
  { n: 7, name: 'OC 7', rule: 'TWO MODS TO PICK' },
  { n: 8, name: 'OC 8', rule: 'BOSSES GO FURTHER' },
];
export const OC_BPM = 2; // per rung
export const OC_BUDGET = 0.07; // per rung
