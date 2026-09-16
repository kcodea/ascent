# 2026-09-15 — the balance bot: four work packages integrated, first real report

Owner: "deploy as many agents as you need to get a balance bot that we can actually use". The roadmap
(`docs/balance-bot-roadmap.md`) was split into four parallel packages off one contract (`sim/balance/types.ts`),
then integrated on `feat/balance-bot`:

- **B0** (#1486) manifest + experiment identity + per-set census + the legacy measurement defects pinned as tests.
- **B1** (#1488) authoritative seat runner (real reducer, rejected actions = failure) + eight-seat self-play
  lobby with the shipped pairing / settlement, `faceOmen { deferFight }` + `resolveCombat { fight }` extracted
  behaviour-preservingly from the player path. Found the simulator's player-only carry-backs (own PR in flight).
- **B2/B3** (#1489) Equipment / Choose One / Discover / targets / Starform in the planning boundary, reveal by
  effect, `fightScore` on the full combat context with a visible `panel` source, the generalist pilot with
  smoke / dev / deep budgets and competence scenarios.
- **B5/B6** (#1487) recorder, effect attribution from accepted transitions, resumable job store,
  coverage-first report, lobby-level bootstrap CIs, A/B compare with A/A + positive-control checks.

Integration wired `balance:run` end to end, shared one surface-aware offers helper between runner and recorder
(the Runes table had been counting shop minions as rune offers), and retired defect pin (b). Operator guide +
trust ledger: `docs/balance-bot.md`.

First real numbers: greedy baseline 40 lobbies at ~220 ms each (a Tier-1 stalemate — the pilot never tiers);
generalist 20 lobbies at ~12 s each with a real tier curve (1 → 6 by round 16), 0 failures either way.
