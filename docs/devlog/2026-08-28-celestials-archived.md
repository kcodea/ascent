# Set 3 is empty of minions again — the Celestial tribe is archived

Owner, 2026-08-28: *"celestials have been extremely and completely re-worked. please remove the current
minions that are in set 3 from the game, leaving set 3 empty of minions now."*

All sixteen `SET3_CELESTIALS` moved to the MINION ARCHIVE. `SET3_CELESTIALS` is now an empty array and set 3
draws no minions — only its shared neutral spell pool, which the rework never touched.

## Archived, not deleted

Exactly what happened to the seven Celestial TEST UNITS this tribe itself replaced on 2026-08-05, and for the
same reason the archive exists: a saved run, a replay, a captured board or a Scene Builder scenario from this
fortnight still has to resolve those ids. Archived cards belong to no set pool, so they are unreachable in a
shop, a Discover or any random grant — which is what "removed from the game" means here — while `CARD_INDEX`
still answers for them.

That choice paid off immediately in the tests. `celestial.test.ts` and the mechanics half of
`set3Celestials.test.ts` — 30-odd tests driving real Alignment and Orbit behaviour through the reducer — kept
passing untouched, because they exercise archived defs. They remain the pinned specification of the two
mechanics the reworked tribe will be built on. Deleting the cards would have deleted that specification too.

The mechanics themselves are untouched: the `celestial` tribe and flag, `align` gating, the `orbit` /
`orbitFired` triggers and their factories all still exist, so a new roster is card DATA. Both classes stay
PARKED in `@game/rules/parked`, which keeps them out of the rules deck while the design is open.

## Two ratchets that had to become invariants

Archiving the tribe emptied the entire PARKED surface — `celestial` and `orbit` had no other members — and two
tests were pinning its population rather than its behaviour:

- `parked.test.ts` asserted **more than 10** parked contracts exist. Zero is now the correct state, so the
  test asserts the invariant that count was standing in for: every contract MATCHING a parked class carries a
  stamp. That holds at zero and starts biting again the moment one reworked Celestial lands.
- The same file's "a parked contract can never be approved" test read `parked[0]`, so it crashed on an empty
  array — the validator rule stopped being tested exactly when nothing was parked. It builds a SYNTHETIC
  parked contract now and is independent of live content.

`contractOracle`'s scale floor moved 900 → 880 (885 today), and every headline in `docs/docbot2/final-report.md`
dropped by the 16 archived contracts. The drift rail caught all of them, which is what it is for.
