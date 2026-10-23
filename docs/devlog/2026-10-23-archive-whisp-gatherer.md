# 2026-10-23: Whisp and Gatherer leave Set 3

Owner ask: "archive these dragons from set 3: * gatherer * whisp".

- **Whisp** (`d4_whisp`, T6 Dragon) and **Gatherer** (`d3_gatherer`, T4 Dragon): both were Set 3 only (`SET3_DRAGONS`
  is spread into no other set), so they moved verbatim to `cards/archive.ts` and belong to no set (the 2026-10-22
  Shredder / Jumpstart Jules precedent, #2221). **Whispwarder** (`d3_whispwarder`) is a different card and stays.
- No live card, rune, quest, hero, bot or guide generates either by id. Their factories (`whisperEchoOnDragon`,
  `rallyGrantRandomTribeMinion`), the Shop/combat Whisp echo paths and the art stay so old saves resolve; runes that
  mention Whisp only do so in comments. Every draw (shop roll, Discovers, random Dragon grants, Jar of Secrets) reads
  the run-pinned pool, so leaving the manifest removes them from all of them.
- Old Set 3 saves, snapshots and replays resolve both through `CARD_INDEX`: `set3Archives1023.test.ts`. The existing
  Whisp / Gatherer behaviour tests (`set4.test.ts`, `set3Dragons1014/1015.test.ts`, the Dragon rune tests) keep running
  against the ids and now double as old-save coverage.
- Oracle: `R-ARCHIVE-SET3-1023-02` (foundation). Doc Bot regenerated with `npm run docbot:sync`. `docs/GAME-RULES.md`
  notes both are archived.
