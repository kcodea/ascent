# 2026-08-20 — Rune of Fresh Pages pays on purchase, and five minions get real types

Owner pass, two unrelated items that landed together because both are one-line content changes.

**Rune of Fresh Pages** read *"Start of Turn: Discover a Shop Spell"*, which meant a 3-cost rune did nothing
at all on the turn you bought it. Owner reword: *"Discover a spell. Repeat at start of turn."* Implemented the
same way Rune of the Long Shift was fixed on 2026-08-17 — the grant case queues the first Discover immediately
and leaves the Start-of-Turn repeat armed, rather than adding a separate one-shot flag. Text now reads
`Discover a **Shop Spell**. Repeat at **Start of Turn**.` and there is now a test (there wasn't one before),
mirroring the Long Shift's.

**Five minions moved off `neutral`:**

| card | set | new type |
| --- | --- | --- |
| Lazarus | 1 | Undead |
| Ancient Wanderer | 2 | Mech |
| Clockwork Assistant | 2 | Mech |
| Muckslinger | 2 | Beast |
| Muster General | 2 | Dwarf |

Worth noting *why this is safe* even though **Mech is not one of Set 2's five tribes**
(`kobold, dragon, beast, demon, dwarf`): all four Set 2 cards here are `token: true` — forge-only rune
rewards, never drawn from the Shop pool, so the pool's tribe filter never sees them. The retribe changes what
they count as **on the board** (tribe synergies, tribe runes, Paragon/Standard Bearer counts), which is exactly
the intent. Lazarus is Set 1 content and Set 1 is disabled, so that one is forward-looking only.

The roster fixture in `runeMinionsAug20.test.ts` asserts each rune minion's `[tribe, tier, attack, health]`, so
four rows moved with the data — an expected fixture update, not a routed-around failure.

Gates: typecheck ✅ · lint 0 errors ✅ · 6296 tests / 385 files ✅ · build:web ✅ · `npm run audit` clean.
