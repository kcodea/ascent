import { describe, it, expect } from 'vitest';
import { adoptServerRating, initialProfile, resolveServerProfile } from './playerRating';

/**
 * THE LOCAL MIRROR vs THE SERVER (owner report 2026-08-19).
 *
 * The Career rating is a local mirror of this account's `profiles` row. Truncating `profiles` cleared the
 * ladder but every client kept displaying its old rating — "RATING 1078" beside "No runs yet" — because the
 * read collapsed "couldn't reach the server" and "the server has no rating for you" into one `null`, and the
 * caller kept the local value for both.
 *
 * `resolveServerProfile` owns that ruling. The two failure-shaped inputs want OPPOSITE outcomes, which is the
 * whole point of the split and what these tests pin.
 */
describe('resolveServerProfile — reconciling the local mirror with the server', () => {
  const ranked = adoptServerRating(initialProfile(), 1078);

  it('KEEPS the local mirror when we could not ask (offline / no session / query error)', () => {
    // A network blip must never blank an established player's rating.
    expect(resolveServerProfile(ranked, undefined)).toBeNull();
  });

  it('RESETS to a fresh profile when the server answers "no rating for this account"', () => {
    // THE WIPE CASE. A deleted/truncated row is an answer, not a failure — so the stale mirror must go.
    const next = resolveServerProfile(ranked, null);
    expect(next).not.toBeNull();
    expect(next!.rating).toBe(initialProfile().rating);
  });

  it('clears the HIGH-WATER marks on that reset — a wipe must not leave "Highest: Rating 1078"', () => {
    // Why the reset is `initialProfile()` and not `adoptServerRating(p, 0)`: the latter's `Math.max` would
    // carry the old peak across the wipe, so the Career card would still advertise the deleted rating.
    expect(ranked.highestRating).toBe(1078);
    expect(resolveServerProfile(ranked, null)!.highestRating).toBe(initialProfile().highestRating);
  });

  it('ADOPTS a server rating over the local one', () => {
    const next = resolveServerProfile(initialProfile(), 1400);
    expect(next).not.toBeNull();
    expect(next!.rating).toBe(1400);
  });

  it('reports NO CHANGE when the server agrees with the mirror (skips a needless write + re-render)', () => {
    expect(resolveServerProfile(ranked, 1078)).toBeNull();
  });

  it('reports NO CHANGE when an already-fresh profile is told it is unranked', () => {
    // Boot on a fresh install with an empty ladder: nothing to write, so nothing should re-render.
    expect(resolveServerProfile(initialProfile(), null)).toBeNull();
  });
});
