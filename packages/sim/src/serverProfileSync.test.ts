import { describe, it, expect } from 'vitest';
import { adoptServerRank, adoptServerRating, initialProfile, legacyRatingChangeOf, resolveServerProfile, resolveServerRank } from './playerRating';
import { RANK_SEASON, initialRankedProfile, rankScalar, settleRank } from './rank';

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


/**
 * MEDAL RANK (2026-09-20) — the same three-way ruling for the RANKED profile, plus the revision compare that
 * keeps a late, older answer from rolling a newer mirror back.
 */
describe('resolveServerRank / adoptServerRank — the medal mirror', () => {
  const fresh = initialProfile();
  const two = settleRank(settleRank(initialRankedProfile(), 1, 'a').profile, 1, 'b'); // rev 2, Bronze III 80
  const three = settleRank(two.profile, 2, 'c');                                     // rev 3, Bronze III 100 (gate)
  const mirrorAt2 = adoptServerRank(fresh, two.profile)!;

  it('KEEPS the local mirror when we could not ask', () => {
    expect(resolveServerRank(mirrorAt2, undefined)).toBeNull();
  });

  it('RESETS to a fresh profile when the server answers "no row" — and reports no change when already fresh', () => {
    const next = resolveServerRank(mirrorAt2, null);
    expect(next).not.toBeNull();
    expect(next!.rank).toEqual(initialRankedProfile());
    expect(next!.rating).toBe(0);
    expect(next!.highestRating).toBe(0);
    expect(resolveServerRank(fresh, null)).toBeNull();
  });

  it('ADOPTS a newer server profile and re-derives the numeric fields from it', () => {
    const next = resolveServerRank(mirrorAt2, three.profile)!;
    expect(next.rank).toEqual(three.profile);
    expect(next.rating).toBe(rankScalar(three.profile.position));
    expect(next.highestRating).toBe(rankScalar(three.profile.highest));
    expect(next.season).toBe(RANK_SEASON);
  });

  it('REFUSES an OLDER server profile in the same season (a late answer never rolls the mirror back)', () => {
    const mirrorAt3 = adoptServerRank(fresh, three.profile)!;
    expect(adoptServerRank(mirrorAt3, two.profile)).toBeNull();
    expect(resolveServerRank(mirrorAt3, two.profile)).toBeNull();
  });

  it('reports NO CHANGE when the server agrees with the mirror', () => {
    expect(adoptServerRank(mirrorAt2, two.profile)).toBeNull();
  });

  it('a DIFFERENT season always adopts, whatever the revisions (a new season is newer by definition)', () => {
    const older = { ...two.profile, seasonId: RANK_SEASON - 1, revision: 40 };
    const mirror = adoptServerRank(fresh, older)!;
    expect(mirror.rank.revision).toBe(40);
    const next = adoptServerRank(mirror, { ...initialRankedProfile(), revision: 1 });
    expect(next).not.toBeNull();
    expect(next!.rank.seasonId).toBe(RANK_SEASON);
  });

  it('legacyRatingChangeOf projects the APPLIED delta + scalars for the surfaces still reading numbers', () => {
    const won = settleRank(three.profile, 1, 'd'); // gate won → Bronze II 10 (the landing cushion, owner 2026-09-21)
    const change = legacyRatingChangeOf(won.result, adoptServerRank(fresh, won.profile)!);
    expect(change.ratingBefore).toBe(100);
    expect(change.ratingAfter).toBe(110);
    expect(change.ratingDelta, 'the scalar moved by the landing, not the award').toBe(10);
    expect(change.promoted).toBe(true);
    expect(change.profile.rating).toBe(110);
  });
});
