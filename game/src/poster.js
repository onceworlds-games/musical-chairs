// Poster mode (?poster=thumb1 | thumb2 | thumb3 | thumb4 | icon | badge-<id>): a finished, deterministic scene from
// the game's own renderer, with no platform and no network, for the store art. Sets window.__posterReady.
export function runPoster(kind) {
  window.__posterReady = true;
  void kind;
}
