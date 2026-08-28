# Choose One branch art + the Apples / Kringle / Chef changes

## The art

The owner dropped six Choose One second-option masters (2026-08-28, 09:14–09:55). The wiring convention
already existed from #722: option index N renders `<cardId><N+1>`, so option 0 keeps the base file and the
second option is `<cardId>2`. `npm run art:wire` understands both `<Name>2.png` and `<Name>Alt.png`.

Wired: `beetle2`, `k_veinbreaker2`, `n2_spellsword2`, `crestclimb2`, `facetwright2`, `fieldmaneuvers2`.

Already had branch art and were left alone: `shaper2` (Jul 25), `b2_elderhorn2` / `d2_orivax2` /
`n2_fatecarver2` (the `Alt` files, Jul 29–30). Still without: The Godfodder, Contract Imp, Apples.

### A dead alias, found on the way

`ALIASES` mapped `copperspellsword → 'n2_coppercoat'` — **an id no card has**. The card is `n2_spellsword`.
Both `CopperSpellsword.png` and its new branch file wired to `n2_coppercoat*`, which nothing ever asks for,
so the art rendered nowhere and a dead 52 KB master sat in the tree. It was invisible because someone had
hand-copied the same image to `n2_spellsword.webp` (byte-identical), so the card looked right. Alias fixed,
dead master deleted.

### Two process notes

`npm run art:wire --apply` re-encodes every file in the jobs it runs, and webp encoding is not byte-stable —
a `--only=minions,spells` pass showed **282 modified files** for 6 real additions. The noise was reverted and
only the intended files kept. Do the same next time: apply, then revert everything that is not the change.

The apply also leaves PNG intermediates on disk, which trips `artNoRedundantMasters`. `npm run optimize-art`
would fix that but regenerates every webp, reintroducing the 282-file diff — deleting the redundant PNGs
directly is the surgical fix.

## The card changes (owner, 2026-08-28)

**Apples** — Choose One: give **this shop +2/+4** (was +1/+3), or **2 random friendly minions +1/+1**
(replacing "bank +2/+4 for the next shop"). Both halves used to buff shops, which left the card with nothing
to say to a board you already own. "2 friendly minions" is 2 RANDOM ones (owner, asked): `spellBuffRandomFriendlies`
already picks N *distinct* bodies seeded off the run cursor, so a reload or replay picks identically.

`spellBuffNextShop` lost its only user, so its presentation-policy key became a ghost and was removed. The
factory itself stays — the coverage ratchet will demand a fresh policy if a future card picks it up.

**Kringle** — End of Turn: the **left AND right-most** Dwarves, +1/+2 for each card played this turn. The
factory was renamed `endOfTurnBuffLeftmostTribePerCard` → `endOfTurnBuffEndsTribePerCard`, because a factory
called `Leftmost` that buffs two minions is the kind of lie a future session reads as a bug. With one Dwarf on
board, both ends are that Dwarf and it is buffed **once** — the card names two bodies, not two grants, so the
ends are deduped by identity. The live text (`perCardPlayedText`) names both ends too.

*Interaction worth knowing:* **Rune of Shared Spoils** mirrors a left-most Dwarf's gain onto the right-most.
Kringle now buffs both ends directly, so with that rune the right-most Dwarf receives Kringle's grant twice.
Each does exactly what it prints; flagged for balance, not fixed.

**Chef Gary Toast** — +4/+4 per Dwarf played, up from +3/+3 (golden +8/+8). The stale "magnitude climbs with
Ales cast this turn" comment was removed; the effect has been flat for some time.

## A test-fixture trap

The new Apples branch test first asserted on a board of three identical minions — which **tripled** the moment
the play resolved, so the board was gone before the branch ran. It read exactly like the effect doing nothing.
Board fixtures for anything that asserts on board state need three DISTINCT cardIds.
