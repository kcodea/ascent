# 2026-10-22: rune names drop "Rune of"

Owner ruling: "let's remove 'rune of' for all the runes, so they just show the rune name, like Borrowed Time.
etc". The owner chose to drop "the" too ("Rune of the Anvil" is now "Anvil"). This reverses the same morning's
ruling that the Set 3 Dragon runes take the prefix. Rule: R-RUNE-NAME-01.

## What changed

- **423 runes renamed** (every rune in every set, archived ones included). Happy Birthday and Merry Christmas
  never had the prefix. **Ids are unchanged**, so saves, replays, snapshots, Supabase rows and analytics keyed by
  id keep working.
- **Every string literal** that named a rune was rewritten the same way (buff labels, cast lines such as
  "Deep Breaths casts Growth", run-buff rows, live-text riders, achievements, docbot labels, approved oracle
  rule texts, test expectations). It was done with a TypeScript-scanner pass, so code comments were left alone,
  owner `quote` / `ref` evidence stays verbatim, and test titles keep the name they were filed under.
  `patchNotes.ts` history and `registry/retired.ts` were excluded. `docs/GAME-RULES.md` was rewritten too.
- **Rune buff FX:** `isRuneBuffSource` used to recognise a rune buff by its `'Rune…'` label prefix. It now also
  checks the set of rune names, and keeps the prefix test so a pre-rename save or snapshot still sparkles.
- **Old labels display bare:** `bareRuneLabel()` (content) strips a stored "Rune of (the)" label; the Inspect
  buff list uses it, so a recorded snapshot from before today reads like new data.
- **`wire-art`** registers each rune under its bare name AND the old "Rune of" / "Rune of the" forms, so the
  owner's `RuneOfTheAnvil.png` files still match. Dry run `--only=runes`: 358 matched before and after, same
  mapping. Happy Birthday / Merry Christmas are kept unprefixed there so their `RuneOf…` files stay unmatched
  (art is wired only on ask).

## Collisions found

- Rune vs rune: the three Menagerie twins (set 1 / 2 / 3) share "Menagerie". Never in the same set; unchanged.
- Rune vs card: 27 runes now share a name with the card they grant or are built around (Drakko, Sylus, Copycat,
  Den Mother, ...). Rune vs quest: War Council (quest set 2, rune set 3), Motherlode (both set 2, the rune is the
  quest's run-wide twin), Chimerus. Rune vs hero / power: Warden, Drakko, Cadence, Summit, Vanguard, Investment.
  Rune vs keyword: Rebirth, Overflow. None is resolved by keeping the prefix: everything that matters is keyed
  by id, and no surface parses a rune NAME for pills (the rune card runs keyword detection on its text only).
  Known cosmetic edge: a buff label equal to a rune name counts as a rune buff for the sparkle FX, so a card
  buff labelled with one of those card names would sparkle too.
