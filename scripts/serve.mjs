// A plain static server for the game folder: `npm run dev`, then open http://localhost:5173 (no platform: the game
// plays alone, with saves in memory). To play with the platform, deploy to a local Onceworlds (see README).
import { serve } from './cdp.mjs';
const port = Number(process.env.PORT || 5173);
const { port: p } = await serve(new URL('../game', import.meta.url).pathname, port);
console.log(`Rimshot on http://localhost:${p}`);
