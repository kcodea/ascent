# 2026-09-11 — Doc Bot text parser: 582 → 55 unresolved parses

**Branch:** `feat/docbot-text-parser-coverage` · **Lane:** `packages/sim/src/docbot/textParse/`

## Why

The text-intelligence lane (`npm run docbot:text`, gate `textParse/textParse.test.ts`) classified 582 of 972
active objects (59%) as `unresolved-parse`, and every content PR was RAISING the grow-loudly cap instead of
extending the grammar (577 → 582 on the Celestials PR alone). Because the live-text hard rule makes printed
text the spec, the parser is the biggest single lever for turning Doc Bot from a wiring checker into a
correctness checker — and a parser that cannot read 59% of the corpus checks nothing about it.

## What was found first — the histogram

Every unresolved span was dumped and clustered by sentence shape. The build order (top shapes, objects):

| # | Shape | Objects | Root cause |
|---|---|---|---|
| 1 | **Mid-text trigger prefix** ("Taunt. Echo: …", "Ward. Avenge (3): …") | ~45 | the sentence splitter kept the leading space, so every prefix after the first sentence failed on `^Echo` — a bug, not a grammar gap |
| 2 | Conditional clauses with unmapped events ("When you spend N Gold", "When a friendly Demon deals damage", "Whenever you trigger a Rally", "When a friendly minion Rises", "When a Ruby is cast on …", "Whenever you get a Dwarven Ale", "When a card is added to your hand", "When you consume", …) | ~60 | 13-row lexicon |
| 3 | "The first X you Y each turn/combat …" (runes) | 33 spans | no subject-first grammar |
| 4 | Subject-first stat sentences ("your Rubies gain +1 Attack", "this gains +4 Attack", "Minions summoned in combat gain +2/+3") | ~30 | verb-first grammar only |
| 5 | Improvement clauses ("Improves +3/+3 every 3 Beasts summoned", "Improve this by … every 5 times", "then increase that by 1") | ~30 | none |
| 6 | Stat transfers / multiplies / sets ("give this minion's Attack to …", "gains its stats", "double its stats", "Set … to 20/20") | ~30 | none |
| 7 | Scalers ("for each X", "for every N X", "per Gold spent", "plus +1/+1 for each …") | ~25 | none |
| 8 | "cast N Rubies on <target>" | ~25 | none |
| 9 | Hero-power prose (limits, costs, calendar prefixes, recharges) | 50 objects | none |
| 10 | "Repeat every Start of Turn" | 20 | none |
| 11 | Get/Discover with comma lists, no-article names, "get another" | ~20 | narrow name grammar |
| 12 | Consume family ("It Consumes a minion in the Shop", "adjacent minions each Consume a Fodder") | ~15 | none |
| 13 | "Equip <Name> (N): …" | 12 | none |
| 14 | Cost / sell-value sentences ("cost 1 less", "Sells for 2 Gold", "Costs 11 Gold, reduced by 1 each turn") | ~20 | none |
| 15 | Token bodies ("A 1/1 Beast token.", "A 3/1 Dwarf that attacks immediately when summoned.") | 10 | none |
| 16 | Choose One with elided verbs ("…, or +4 Health", "or your Fodder +2/+2") | 10 | none |
| 17 | Positional / located targets ("the right-most minion in the Shop", "a minion of each type", "your left and right-most minions", "a random minion in your hand") | many | three-shape target grammar |
| 18 | Parenthetical notes and limits ("(max 3)", "(Once per turn)", "(9 times)", "Once per combat.") | ~25 | none |
| 19 | Ability grants ("Your Gemheart Golems gain Echo: …") | 8 | none |
| 20 | "also casts on <target>" / "trigger 2 extra times" variants | ~10 | narrow multiplier grammar |
| 21 | Actions (steal / swap / destroy / sell / transform / gild / magnetize / mark / archive / scout) | ~25 | none |
| 22 | Hand summons ("summon the highest-Health minion from your hand", "summon a random Spirit") | 8 | named-token-only summon |
| 23 | Refresh / free refresh | 8 | none |
| 24 | Notes ("Needs a free board slot.", "Progress carries between turns.", "Dwarven Ales do not count.") | ~12 | none |
| 25 | Damage with a target / "Immune while attacking" / Engraved grants | ~8 | partial |

## What shipped

- `targets.ts` — a general target sub-grammar: `[determiner] [modifiers…] NOUN [tails…]`, with the tribe/class
  noun set, positional modifiers, location and relation tails, ownership tails (`'s Deathrattle`), tribe
  alternations ("Mech or Demon"), capitalized card-name plurals as subjects ("Your Dawnclaws"), and honest
  cardinality (a bare plural is `all`, a printed count is `exactly`).
- `parser.ts` — the sentence loop now trims (the #1 bug), peels leading gates (conditions, aura gates,
  "Once per turn,", "For each X,", "The first time …,"), reads a second trigger prefix (Equip → Choose One),
  cadence prefixes ("Every 5 Gold spent,"), inline and trailing conditionals, and dispatches subject-first
  sentences (including the "The first X you Y each turn" window) through the same recognizers. Twenty new /
  extended recognizers (see the effect-kind union in `types.ts`). Every modifier tail the grammar consumes is
  LISTED in `consumedModifiers` — nothing read is invisible (§4.3).
- `lexicon.ts` — trigger prefixes (Start of Turn, Equip (N), calendar prefixes), a cadence lexicon, and a
  conditional lexicon mapped onto the content `on` vocabulary (`text:` ids for printed events the engine has
  no `on` word for: consumed, never compared).
- `classify.ts` — the clauses map onto comparators: conditional and Equip trigger events (with the
  `onTribePlayed`↔`onSummon` alias — both are "you played a minion of tribe X"), composite `const` amounts
  (attack/health beside `every`/`count`/`improve`), **wrong-target-count** (new in the implemented taxonomy),
  improvement steps and countdowns, Ruby-cast counts (`play` before `count`), cadence-prefix thresholds
  (`per` / trigger threshold only — `every` is ambiguous beside an improvement countdown).
- Sabotage-proofed: each comparator convicts a doctored contract in `textParse.test.ts`; each family has a
  positive fixture and a near-miss negative.

## What the parser found once it could read

| Object | Verdict | Action |
|---|---|---|
| `k_gemgorge` | **genuine text defect** — "When you cast 3 spells" for a factory on `rubyCast` | text + gilded text fixed to "3 Rubies"; patch note |
| `brood` | draft-contract gap — the extractor read the golden-text diff as a whole-card ×2, but only the Avenge buff doubles (the Imp summon stays 1, max 3) | curated contract, `gildedDelta: reshape` |
| `cling` | draft-contract gap — `effects: []`, the swarm buff is an id-keyed engine path | curated contract stating the effect |
| `k3_porkbelly` | draft-contract gap — `effects: []`, the Golem is the `vanguardGolem` def flag in `simulate.ts` | curated contract stating the summon |
| `b2_moonhowl` | parser vocabulary — "when you buy a Shop spell" is `spellBought`, not `onBuy` | lexicon row |
| `bloodbinder` | parser vocabulary — "Every 4 attacks" names Bleed's counter, not a Rally trigger | cadence prefixes are never compared as dispatching triggers |
| `cryptdrake`, `patchjob`, `dw_mountainbond`, `k_geode` | comparator over-reach (ambiguous `every`; `baseAttack` beside `attack`; `count` = minted not cast; a Ruby cast beside a summon) | comparators narrowed, each with the reason in code |

## Before / after

| | Before | After |
|---|---|---|
| parsed-equivalent | 390 | 917 |
| verified-mismatch | 0 | 0 |
| unresolved-parse | **582 (59.9%)** | **55 (5.7%)** |
| `UNRESOLVED_CAP` | 582 (raised on every content PR) | 55, plus a HARD ceiling: unresolved share < 35% of active objects |

Remaining top shapes (all bespoke prose): hero-power flavour ("Play a minion, cast a spell or upgrade to
travel", "Bind … stats gained by one are gained by the other"), "alternates between Attack and Health",
"Gain +Attack/+Health equal to the Fodder consumed", "Rubies applied in combat give 2× stats", "Your X also
buffs herself / enchant / can target …" rune glosses, "The next 2 minions you buy each come with a free extra
copy", "Every 5th Echo minion you play triggers its Echo", and two placeholder/flavour tokens.

## Lessons

- **Read the corpus before writing grammar.** The single largest shape (~45 objects) was a trim bug, not a
  missing rule. The histogram is the build order; the audit dump (every effect the parser emits, per object)
  is how over-consumption was caught — five silent mis-reads were found only by reading the parse, not by
  the unresolved count.
- **A comparator is only as good as the contract field it names.** Half the first mismatches were the
  comparator picking the wrong `const` key (`every` vs an improvement's `every`; `count` minted vs `play`
  cast). Each narrowing is documented at the comparison site.
- **The ratchet needed a ceiling.** A cap that is raised on every content PR is not a ratchet; the share
  ceiling makes "extend the parser" the only way past 35% again.
