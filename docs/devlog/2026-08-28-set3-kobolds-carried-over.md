# Set 3 gets a tribe: eleven Kobolds carried over from Set 2

*2026-08-28*

The owner's roster: Beggy, Chipwick Prospector, Geode Guardian, Blazer, Gemheart Carver, Kobe, Veinbreaker,
Boulderdash, Kobebes, Deepdelve (Paragon) and (Alchemist) Brisbane — eleven of Set 2's twenty-three Kobolds,
into Set 3's pool.

## Shared definitions, not forks

Opted in **by id** through `SET2_KOBOLDS_IN_SET3`, the same manifest pattern Karwind, the Set-1 Beasts and the
Set-1 Neutrals already use. Two consequences worth stating plainly:

- A new Set-2 Kobold cannot leak into Set 3 by being added to `SET2_KOBOLDS`. The manifest names what it takes.
- These are the **same card objects**, so re-speccing one for Set 3 would rebalance Set 2 with it. If Set 3
  ever wants its own version, fork it into `cards/set3/` under a new id rather than editing the Set-2 card.

Set 2 keeps all eleven — a test asserts its Kobold count is unchanged, because "carried over" quietly becoming
"moved" is the failure mode that would not show up anywhere else.

## The Ruby engine came along for free

Every one of the eleven is a Ruby card. Nothing had to be added for that: `ruby` and the Gemheart Golem are
`token: true` and live in the global `ALL_CARDS`, so they resolve through `CARD_INDEX` in any set.

That is the set doctrine working as designed — **set membership governs only what can be DRAWN**, and a token
is never drawn, only reached through a card that names it. So Set 3 gets the Ruby mechanic without opting into
Set 2's Ruby *spells* (Ruby Shipment, Ruby Transfer, Ruby Excavation), which remain Set 2's.

## Two things that had to move together

**`tribes: []` → `['kobold']`.** `selectRunTribes` picks a run's active tribes from that list, so a pool full
of Kobolds with an empty `tribes` could never roll a Kobold run — the cards would be present and unreachable
as a tribe. The pin now asserts both.

**Order is the assertion.** Shop draws index into the resolved pool, so the scaffold test pins the buyable ids
as an ordered list rather than a set: the Kobolds are **appended** after the Equipment minions, and a card
inserted mid-list instead would silently reseed every Set 3 shop.

## Still disabled

Set 3's `enabled` stays `false`, and the pin that guarantees it stays that way is untouched. The owner asked
for cards in the pool, not for Set 3 to go live — flipping that switch puts *every new run* on Set 3, which is
its own decision. Play it in the Scene Builder, whose set picker offers disabled sets for exactly this.

The roster spans T1 → T7 (two T1s, a T2, four T4s, two T5s, a T6, a T7), so it reads as a curve rather than a
slice of the tribe: it plays as a tribe from the first shop rather than only turning up late.
