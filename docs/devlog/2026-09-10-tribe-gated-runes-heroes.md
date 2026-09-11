# 2026-09-10 — Tribe-gated runes and heroes (`RuneDef.tribes`, `HeroDef.tribes`, the seed-first hero offer)

**Owner ruling (2026-09-10, Set 3 spell sheet):** "tribe-gated spells are important, as are tribe-gated runes
and heroes. (Tiff for Dragons)". Spells got `runSpells` in the manifest PR; this is the runes + heroes half.

## What was wrong

A run rolls five tribes from its set's roster. `RuneDef.sets` scoped runes by SET mechanics, but a set-agnostic
"give your Dragons +4/+5" rune was offerable in every run, including a set-3 run whose roster has no Dragons at
all. Same for heroes: Tiff's Dragon Discover has no pool in set 3, and she was still on the picker.

## Now

- **`RuneDef.tribes?: Tribe[]`** (core types + content schema). `runeforgePool` keeps a rune only when no tag is
  set or some tagged tribe is in `state.tribes`. Sixty-six runes are tagged. The rule (owner 2026-09-10): a rune
  is tagged when its text names the tribe on the board ("your Dwarves", "get a random Dragon"), when it GRANTS a
  body of the tribe (Kegheart, High King), or when it works Imps / Fodder (Imps are Demons). The Menageries are
  tagged with all five of their tribes (any-of). Cindara and Chaos (heroes) stay untagged by the same ruling.
- **`HeroDef.tribes?`** on Tiff (`dragon`) and Flint (`dwarf`). `playableHeroes`, `practiceHeroes` and
  `powerDiscoverPool` take an optional tribes argument; the four adoption sites (Mimic, Void, Power Shifter,
  turn-1 Mimic seed) pass the run's tribes. No argument = no filter, so every older caller is unchanged.
- **The seed comes first.** The store rolled `randomSeed()` inside `pickHero`, after the offer. Now every
  `start*` action rolls the seed into `pendingSeed`, derives the tribes with the new `runTribesForSeed` (which
  `createRun` itself now calls, so there is exactly one derivation), filters the offer, and `pickHero` creates the
  run from that same seed. Picker and run cannot disagree.
- **Contracts** carry `tribes` for runes (`contracts:extract` regenerated).

## What this changes today

Every set's roster is exactly five tribes and `TRIBES_PER_RUN` is five, so within a set the roll is the whole
roster. The gate bites across sets: set-agnostic Dragon / Beast / Demon / Mech runes stop appearing in set 3
(Kobold, Dwarf, Undead, Spirit, Celestial), and Tiff leaves the set-3 picker. It becomes fully live the day a set
carries more than five tribes.

## Tests

`packages/sim/src/tribeGate.test.ts`: text-vs-tag audit both ways (a tagged tribe must be named; a named tribe must
be tagged or in the body-grant allowlist), forge pool with and without Dragons in both forges, the hero and power
pools, and `runTribesForSeed === createRun(seed).tribes` across sets and seeds.
