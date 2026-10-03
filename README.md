# Rimshot

Ride the rim of a vector tunnel and shoot down its lanes on the beat. Every shot is a note, every kill a chord: the
game plays its own track, and playing well writes it.

Play it at [onceworlds.com/play/rimshot](https://onceworlds.com/play/rimshot).

## How to play

Things climb the lanes from the far end of the tunnel. Shoot them before they reach the rim, where they crawl round
toward you. Two kills inside one beat raise the multiplier (up to x8); kills in three lanes on one beat make a chord;
a bar with kills and nothing reaching the rim is a Perfect Bar. Kills fill Resonance; full Resonance is Overdrive
(faster fire, bolts that pierce, double points, the band at full tilt). A hop on the beat also lifts the multiplier.

Pulsars light their lane on the bar line after a half-bar build-up; mines count down four beats; ghosts only bite on
the beat. Spikes block your bolts and catch you in the warp at the end of a zone, so shoot them down first.

After every zone you pick one of three mods. A run is six worlds of three zones and a boss.

## Controls

| | Keyboard | Mouse | Touch | Gamepad |
| --- | --- | --- | --- | --- |
| Move round the rim | Left / Right (A / D); tap for one lane, hold to run | point at a lane | drag anywhere: the ship turns with your finger | stick or d-pad (on a closed web the stick points at a lane) |
| Fire | Space (hold); F toggles auto-fire | hold the left button | automatic | A |
| Hop three lanes | Shift or Up | right click | Hop button, or a tap with a second finger | B |
| Zap (once a zone) | Down or Ctrl | wheel down | Zap button | X |
| Pause (alone) | P or Esc | | the platform menu | Start |

In the lobby: Left / Right choose a ship or a mod, Space takes the mod, Enter starts (or readies).

## What is in it

- **Modes.** Run (six worlds, three zones and a boss each), Descent (endless, the tempo climbs, two worlds of its own),
  Daily (one seeded run a day with a fixed ship and starting mods, the same for everyone) and Practice (any zone, at 80
  to 120 percent tempo, nothing lost when you fall).
- **Overclock 1-8.** Each rung adds a rule: faster and denser, flippers that shoot more, crawlers that double-step,
  taller spikes, pulsars every bar, two ships, two mods to pick from, bosses that go further. Clearing a run unlocks the
  next rung.
- **Ships (6).** Plectrum (steady sixteenths), Mallet (three lanes, close range), Reed (notes that seek), Bow (a
  piercing beam), Chime (drones play along), Fork (two tines and a hum on the rim). Each is opened by a milestone.
- **Mods (30).** Pierce, Spread, Echo, Ricochet, Counterpoint, Tremolo, Staccato, Sustain, Metronome, Syncopate,
  Glissando, Chain, Downbeat, Phase Hop, Grace Note, Bass Drop, Forte, Shield Beat, Encore, Undertow, Rim Guard,
  Resonator, Overtone, Feedback, Harmonic, Crescendo, Magnet, Drone, Spikebreaker and Unison (with friends only).
- **Enemies (11 kinds) and bosses (6).** Flippers, tankers, spikers, fuseballs, pulsars, ghosts, weavers, bombers and
  their mines, choirs of sirens, enemy shots; the Hydra, the Gate, the Conductor, the Tide, the Mirror and the Maestro.
- **Worlds (8).** Mint Circuit, Amber Fold, Ice Spire, Vermilion Gate, Lime Ribbon, Rose Orbit, and the Descent's Gold
  and Sky. Each has its own colour, web shapes (closed loops, open lines, a spiral), tempo, mode and groove.
- **Earned looks.** Ship tints, trails, rim styles and the sound your ship makes when it falls.
- **Calm.** A setting (and the platform's Reduce motion) that removes shake, colour splits, fast pulses and the zap's
  wash. Nothing on screen ever flashes faster than three times a second.

## Playing together

Rimshot is a friends game for one to four ships on one rim: lives and Overdrive are shared, ships within three lanes
of each other are joined by a tether that burns crawlers between them, and a fallen ship is revived by flying over its
wreck. The host's page runs the zone and publishes snapshots a few times a second; everyone else mirrors it with the
same rules, flies their own ship and sends their hits to the host, so a reload, a dropped connection or a new host
carries on where the zone was.

Each zone is a platform match: between zones the lobby is the draft (pick a mod, ready up, the host starts), and a
friend who arrives mid-zone watches until the next one.

## How it is built

No build step: plain ES modules and Canvas 2D, served from `game/`.

- `game/src/sim/` is the pure, deterministic simulation (no DOM, seeded randomness, eight steps per sixteenth note):
  web shapes and lanes (`web.js`), every number (`data.js`), the zone's score of spawns (`levelgen.js`), enemies on
  the beat grid (`enemies.js`), the bosses (`bosses.js`), ships, bolts, scoring and co-op (`world.js`), runs and
  drafts (`run.js`), the save (`profile.js`), bot ships (`bot.js`) and whole runs without a screen (`headless.js`).
- `game/src/render/` draws it: glowing vector lines and the stroke font (`vector.js`), the tunnel and everything on
  it (`view.js`), shapes, effects and the HUD.
- `game/src/audio/` is the beat clock and the band: a look-ahead scheduler that keeps the audio clock on the room's
  match clock, synthesized drums, bass, pads, arps and the player's notes (`engine.js`, `music.js`).
- `game/src/net/` holds the room and the run record (`session.js`) and the snapshots and batches (`sync.js`).
- `game/src/ui/` the screens, `input.js` every way to play, `platform.js` the only place the platform's SDK is called.
- `test/` runs with `node --test`; `scripts/` holds the balance harness, the smoke test, the store capture and a static
  server.

## Running it

```
npm run dev       # http://localhost:5173: the game alone, without the platform
npm test          # the simulation, saves, snapshots and the run's lifecycle
npm run balance   # the balance harness (or: node scripts/balance.mjs quick survival final ships mods)
npm run smoke     # headless Chrome plays a zone from the title to the draft, desktop and phone; fails on any error
npm run store     # store art and badge icons from the game's own ?poster= scenes
```

To play with the platform's rooms, deploy the folder to a local Onceworlds with its CLI
(`node packages/cli/src/index.ts deploy <this folder> --api http://localhost:8787` from the platform repo) and open
`/play/rimshot`.

## Balance

`scripts/balance.mjs` flies bot ships of three skills (they react, notice and aim like a novice, an average and an
expert player) through the simulation with random drafts. Last run (300 runs per row):

| | novice | average | expert |
| --- | --- | --- | --- |
| Clears zone 1-1 | 98% | 100% | 100% |
| Clears world 3 | 4% | 91% | 100% |
| Beats the Maestro with a good build | 0% | 0% | 46% |
| Mean run length | 7 min | 19 min | 22 min |

Top-decile score over the median: 2.3x for the average bot. Every ship clears world 4 with its own best build within
eleven points of the others (65-76% for the average bot).

## Badges and boards

Badges: First Zone, Perfect Bar, Chord Master, Overdrive, Hydra Down, Conductor Down, Maestro Down, Flawless,
Tethered, Overclock 4, Daily Run, Deep Descent.

Leaderboards: `high-score` (Run), `descent-score` and `deepest-level` (Descent).

## License

MIT. See `LICENSE`. The UI typeface is Chakra Petch (SIL Open Font License, `licenses/chakra-petch-OFL.txt`).
