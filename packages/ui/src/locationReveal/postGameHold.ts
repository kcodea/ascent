/**
 * THE POST-GAME HOLD (postGame.tsx), on its own so the announcer can read it without loading the reveal: while the journey to Terys
 * Gate plays, the post-game screen is mounted behind the doors, and what it says and shows waits for the wave to reach it.
 */
let held = false;
const subs = new Set<() => void>();
const released = new Set<() => void>();

/** Hold (or let go of) the post-game screen while the journey plays over it. Letting go tells every `onPostGameRelease`. */
export function holdPostGame(v: boolean): void {
  if (held === v) return;
  held = v;
  for (const f of subs) f();
  if (!v) for (const f of released) { try { f(); } catch (err) { console.warn('[postGame] release', err); } }
}
export const isPostGameHeld = (): boolean => held;
export const subscribePostGameHold = (f: () => void): (() => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** Run `f` each time the hold is let go (the wave reached the screen, or the gate ended without it). */
export const onPostGameRelease = (f: () => void): (() => void) => { released.add(f); return () => { released.delete(f); }; };
