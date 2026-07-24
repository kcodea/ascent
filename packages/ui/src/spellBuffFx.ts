import { spellBuffHoldMs } from './spellBuffFxConfig';

/**
 * The SPELL BUFF cue's fire-from-anywhere bus (owner ask 2026-07-24).
 *
 * The cue — a hand spell/Ruby grows, shrinks and blasts sparks when its printed value goes UP — originally lived
 * as React state inside `Recruit`, which meant only Recruit's own hand watcher could ever start it. It now has to
 * play from several places that aren't that watcher: END OF TURN, START OF COMBAT, and MID-COMBAT off an
 * Echo/Avenge. So the burst state moved out here, into a tiny module-level store.
 *
 * The contract is deliberately minimal — **`fireSpellBuff([uid])` from literally anywhere** (a React effect, a
 * combat-replay beat, an imperative store callback, the dev tuner) and any mounted `Card` with that uid plays the
 * cue. Callers need no ref, no context, and no knowledge of who renders the card; if the uid isn't on screen the
 * call is simply a no-op that expires on its own.
 *
 * Why a store rather than a prop: a prop has to be threaded from whoever owns the state down to every surface
 * that renders a card, so each new surface (combat arena, end-of-turn overlay) means new plumbing. Cards
 * subscribe here instead, via `useSyncExternalStore`, so a new surface costs nothing. Re-render cost stays
 * per-card: every subscriber is notified, but `useSyncExternalStore` only re-renders the ones whose own snapshot
 * actually changed — the other cards bail out on an unchanged number.
 */

/** uid → current BURST ID. Absent = that card isn't bursting. The id increments on every retrigger so `Card` can
 *  restart the animation rather than swallow a buff that lands mid-burst. */
const seqByUid = new Map<string, number>();
/** uid → its pending clear. Tracked so a retrigger can CANCEL the old one: fire-and-forget timers meant an
 *  earlier burst's clear landed mid-way through a later burst and cut it short (measured: a 1010ms hold ending
 *  after 404ms). */
const timerByUid = new Map<string, number>();
let counter = 0;
const listeners = new Set<() => void>();

const emit = (): void => { for (const l of listeners) l(); };

/** Subscribe to burst changes (the `useSyncExternalStore` subscribe arg). */
export function subscribeSpellBuff(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** This uid's current burst id, or `undefined` when it isn't bursting (the `getSnapshot` arg). Returns a
 *  primitive, so an unchanged value can't cause a re-render. */
export function getSpellBuffSeq(uid: string): number | undefined {
  return seqByUid.get(uid);
}

/**
 * Play (or RESTART) the spell-buff cue on these card uids. Safe to call from any phase, any surface, and as
 * often as you like — each call restarts the cue rather than being swallowed, because the owner wants every
 * trigger to read as its own hit even if that cuts the previous one off.
 *
 * Unknown/unmounted uids are harmless: nothing renders them and the entry clears itself after the hold.
 */
export function fireSpellBuff(uids: readonly string[]): void {
  if (uids.length === 0) return;
  const hold = spellBuffHoldMs();
  for (const uid of uids) {
    seqByUid.set(uid, ++counter);
    const pending = timerByUid.get(uid);
    if (pending !== undefined) clearTimeout(pending);
    timerByUid.set(uid, window.setTimeout(() => {
      timerByUid.delete(uid);
      seqByUid.delete(uid);
      emit();
    }, hold));
  }
  emit();
}

/** Drop every in-flight burst — used when the board is torn down (run reset / screen change) so a pending timer
 *  can't fire the cue onto a card that has since been replaced at the same uid. */
export function clearAllSpellBuffs(): void {
  if (seqByUid.size === 0 && timerByUid.size === 0) return;
  for (const t of timerByUid.values()) clearTimeout(t);
  timerByUid.clear();
  seqByUid.clear();
  emit();
}
