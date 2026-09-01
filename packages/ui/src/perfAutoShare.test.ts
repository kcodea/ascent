import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * PERF AUTO-SHARE IS NOT BEHIND THE HUD TOGGLE (owner report 2026-08-31: *"we are NOT getting automatically
 * delivered results to that table ... it's important that we do"*).
 *
 * ── What was wrong ────────────────────────────────────────────────────────────────────────────────────────
 *
 * The sampler and the end-of-game upload both lived inside an effect that opened with
 * `if (!perfOn) { perfMonitor.stop(); return; }`. `perfOn` defaults to `import.meta.env.DEV` — FALSE in a
 * production build, and the desktop exe is a production build. So on the client the devs actually play,
 * nothing was ever sampled and the upload was never even subscribed. It could not fail; it never ran.
 *
 * ── Why a SOURCE test ─────────────────────────────────────────────────────────────────────────────────────
 *
 * The failure is structural — a gate in the wrong place — and it is invisible to any unit test of the parts:
 * `uploadRun` was fine, `isRealPlayRun` was fine, the subscription was fine. Only their ARRANGEMENT was
 * wrong. So this reads the arrangement, which is the thing that regressed and the thing a future edit could
 * quietly restore.
 */
const GAME = readFileSync(join(__dirname, 'Game.tsx'), 'utf8');

/** The effect that owns the sampler + the auto-share subscription, from its opening to its dependency list. */
function samplerEffect(): string {
  const marker = GAME.indexOf('perfMonitor.registerContext(');
  expect(marker, 'the sampler effect is still recognisable').toBeGreaterThan(-1);
  // From the effect's OPENING, not from the marker: the gate that caused the bug sits between the two, so a
  // slice starting at the marker cannot see it. (The first cut of this lane did exactly that and passed with
  // the bug restored — found by sabotage, which is the only reason this comment exists.)
  const start = GAME.lastIndexOf('useEffect(() => {', marker);
  expect(start, 'its opening is still recognisable').toBeGreaterThan(-1);
  const end = GAME.indexOf('perfMonitor.stop();', start);
  expect(end, 'its teardown is still recognisable').toBeGreaterThan(start);
  // …through the dependency array that follows the teardown.
  return GAME.slice(start, GAME.indexOf('}, [', end) + 8);
}

describe('perf auto-share', () => {
  it('does not early-return on the HUD toggle', () => {
    const body = samplerEffect();
    expect(/if \(!perfOn\)[^\n]*return/.test(body),
      'the sampler must not stand down when the HUD is closed — that is what emptied the shared tab')
      .toBe(false);
  });

  it('does not depend on the HUD toggle at all', () => {
    // A `[perfOn]` dependency would tear the subscription down and rebuild it with the toggle, which is the
    // same bug wearing a different shape: a game finished with the HUD closed would publish nothing.
    const body = samplerEffect();
    const deps = body.slice(body.lastIndexOf('}, ['));
    expect(deps.includes('perfOn'), `the effect still keys on perfOn: ${deps}`).toBe(false);
  });

  it('still subscribes the end-of-game publish, and still only for finished games', () => {
    const body = samplerEffect();
    expect(body.includes('useGame.subscribe'), 'the auto-share subscription is inside this effect').toBe(true);
    expect(body.includes("'gameover'") && body.includes("'victory'"),
      'it publishes on the terminal phases only — an abandoned run is not a data point').toBe(true);
    expect(body.includes('isRealPlayRun'), 'and only for real play runs, never practice or the sandbox').toBe(true);
  });
});
