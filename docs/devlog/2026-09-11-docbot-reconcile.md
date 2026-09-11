# 2026-09-11 — Doc Bot reconcile: the vacuous spell gate, one regen command, one backlog, a two-page contract

The closing PR of the "Doc Bot to 75" day (audit: `docs/audit-docbot-balance-bots-2026-09-11.md`; the six
work-package PRs #1425–#1430 all merged the same afternoon). Four things the merges left open.

## 1. The play-differential spell gate was vacuously green since it shipped (instrument bug, fixed)

Found by #1428's entry-path lane: its own differential compared two POST-`reduce` states and noticed that the
older spell sub-lane compared post-cast against the PRE-`reduce` fixture. A probe over all 107 castable spells
(`playScan.ts` header records the method) showed what changes on **every** cast regardless of effect:

| Keys changed in 107/107 casts | Why |
|---|---|
| `weldFxBaseSeq`, `lastShoutFires`, `lastEchoFires`, `lastRallyFires`, `lastEotFires`, `questTendrilFx`, `fodderEaten`, `shopEaten`, `gainCardFiredUids`, `gainAttackFiredUids`, `equipmentSpellCasts` | `reduce` zero-initialises them (`undefined → 0 / []`) on every play |
| `cardsPlayedTotal` | play bookkeeping, absent from the exclusion list |
| `playedThisTurn` | already excluded |

So `strip(after) === strip(before)` was never true and **no spell could ever read as inert** — the four
targeted Gifts no-oped for a month under a green lane. The projection is now a pure, exported function,
`spellCastReadsInert(before, after, paid)`, with three corrections:

1. a key ABSENT before that holds its zero value after is initialisation, not an effect;
2. `cardsPlayedTotal` joins the bookkeeping set (`SPELL_BOOKKEEPING`, exported);
3. Gold and the hand are no longer excluded wholesale — the first honest run surfaced **Gold Pouch, Golden
   Ale (Gold gains hidden by the `embers` exclusion) and Hand Soap (a hand buff hidden by the `hand`
   exclusion)** as false inerts. The cast's price is added back so a gain shows; only the cast card's own
   departure is normalised away so a buff shows.

Insurance Policy also read inert on that run and got a `SPELL_STAGERS` entry (the L3 stager doctrine, per
spell: patch the condition in, demand the cast act, and demand it be inert WITHOUT the patch or the entry is
stale). The stale check fired immediately: the fixture's last combat is already a loss, so the 5 Gold shows
once the price is accounted for. The stager mechanism stays (empty); the entry went.

**Sabotage proof** (`playDifferential.test.ts`): the exact shape of a no-op cast after `reduce` (card gone,
price paid, counters bumped, zero-inits present) reads INERT; one Gold beyond the price, one hand buff, or one
non-zero initialisation each reads EFFECTFUL. The old projection read all four as effectful.

After the fix: 0 inert spells, 19 refused (unchanged — the refused queue was always honest), all 73 lanes green.

## 2. `npm run docbot:sync` — the one regen step for a content PR

`contracts:extract → docbot:text → rules:seed → docbot:report -- --check`. The Set 3 PRs each hand-ran a
different subset and each touched 5–8 registry files; the audit called that the authoring tax. The generated
registries are never hand-edited; the final report's prose is, and the check names the drifted line.

## 3. The CLI and the report count the backlog from one object

`npm run docbot` printed "pending owner questions: 0" beside a final report listing 63 dormant convention cards
(they counted different things — `effective === 'needs-ruling'` vs the reachable decks). The CLI's rulebook
block now reads `buildFinalReport().rules` — total, approved, retired, needs-ruling, the three dormant decks and
any release blockers — so the two surfaces cannot disagree.

## 4. `docs/docbot.md` is a two-page contract; the history moved

What gates, what a content PR must do, what runs on a schedule and where a red run goes, the number Doc Bot is
scored on, how to read a failure, the honest ceiling, the commands. No counts anywhere in it. The 278-line
narrative of how each lane was born is `docs/docbot-history.md`, unchanged.

## Verification

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build:web` (results in the PR body);
`npm run docbot:report -- --check` agrees on all headline numbers; `npm run docbot` prints the reconciled
rulebook block and the `docbot:sync` command.
