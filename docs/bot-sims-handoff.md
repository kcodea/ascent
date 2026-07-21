# Handoff — Bots as our balance instrument (10–20× game data, on demand)

## The goal

ASCENT is a content-heavy roguelike built by a **two-person team**: ~119 minions, 37 spells, 79 quests,
61 runes, 24+ heroes today — and a Set 2 in design that adds three entirely new resource systems (Heat,
Rubies, Celestial alignment). We change that surface area constantly, and **we cannot hand-playtest it at the
rate we change it.** Ten manual games tell us almost nothing about whether a new card is broken.

So bot simulation isn't a nice-to-have — it's **the only realistic path to balance insight for a team this
size.** The goal of this workstream:

> A bot toolchain we can fire whenever we need it that produces **10–20× more legitimate game data than manual
> playtesting ever could**, piloting a *variety of strategies* so every card is evaluated by a bot that
> actually knows how to use it — and drives balance decisions from that data instead of guesswork.

"Legitimate" is the load-bearing word. We already *have* a bot; the problem is its data is noise.

## Why today's bot can't deliver this

The current balance report (`npm run report` → `packages/sim/src/balanceReport.ts`) runs 720 seeded games,
but the bot is a **"first legal option" policy** (`playAndRecordInto`, lines 69–99):

```
play hand[0]  →  buy shop[0]  →  upgrade if affordable  →  hero power on board[0]  →  end turn
```
and every choice (quest / rune / Discover / chooseOne) takes **index 0**; battlecries target **board[0]**.

Concretely it **never rerolls, never sells, never positions, never seeks triples, and never reads card
quality** — it buys whatever sits in the leftmost shop slot and plays cards in draw order. Consequences we
saw in the last report:
- **~2–3% overall win rate** (best hero Atrius 20%, 18 of 24 heroes at a flat 0/30).
- **`pick%` is meaningless** — it's "was this in slot 0", not a valuation.
- **`win%` is co-occurrence noise** on tiny samples — the top of the list is n=1 flukes.
- **Every synergy archetype is invisible.** Build-arounds the bot can't assemble (attachments/Mech scaling,
  Consume, Deathrattle, spell payoffs) show 0% pick and no data — so we learn nothing about the cards most
  likely to be mis-tuned.

A bot this weak literally cannot tell us what's strong.

## Why this is cheap to build (the architecture is already on our side)

Three facts, all confirmed in the code, make a good bot mostly *policy code* rather than an engineering slog:

1. **No engine work is required.** The reducer already exposes every action a smart bot needs, and validates
   them (it's what the UI dispatches) — `state.ts:718–738`:
   `buy · sell · play {toIndex, targetUid} · roll (reroll) · freeze · upgrade · reposition · heroPower ·
   discover · chooseOne · buyQuest · buyRune · battlecryTarget`. The current bot simply *chooses* not to use
   most of them. A better bot is a `policy(state) => Action` function over the existing action space.
2. **Combat is a pure, cheap, deterministic function**, and **opponents are pinned per wave** (`servedBoards` /
   deterministic matchmaking). So a bot can use `simulate()` as its *own* evaluation function — try candidate
   boards, sim them against the actual next opponent, keep the winner — instead of us hand-tuning a strength
   heuristic to death. Everything is seeded, so results are reproducible and debuggable.
3. **The harness already exists.** `playAndRecordInto` drives a full run via `reduce` and tallies
   offer/pick/win across many seeded games and heroes. Parameterize it with a policy and it runs *any* bot.
   The module is UI-free / Node-free, so it runs headless and fast, and identically in the CLI and the dev
   panel.

## The plan

Built incrementally; each phase is independently useful.

**Phase 0 — Pluggable policies (~1 hour).** Extract the inline greedy logic into `greedyPolicy(state)`, make
the run loop call an injected `policy`, and let the report run any registered policy. Everything below is then
additive.

**Phase 1 — One competent heuristic bot (~1–2 focused days for clearly-good).** Replace "first legal" with a
valuation at every decision, and *use the actions the greedy bot ignores*:
- Score offers/hand cards by stat efficiency (atk+hp vs cost/tier), keyword weight (Taunt/DS/Windfury/Venom),
  and board synergy (tribe count, does it feed my package, triple progress).
- **Reroll** when nothing clears a threshold (the single biggest gap — the bot currently sees one shop/turn).
- **Sell + reposition** — cut the weakest body when full; place Taunts front, put leftmost/rightmost/adjacency
  payoffs correctly (the engine is saturated with positional effects the bot currently randomizes).
- **Triple-seek**, real Discover/quest/rune/target picks, and a basic upgrade/economy curve.

**Phase 2 — Combat-rollout evaluator (~1 day, highest leverage).** At end of recruit, enumerate a handful of
candidate final boards/last buys, `simulate()` each against the pinned next opponent, and keep the best. This
grounds play in *real outcomes* rather than tuned weights — it's the fastest route to a genuinely strong bot
and the most architecture-aligned ("measure it, don't guess"). Lead with this if forced to choose.

**Phase 3 — Archetype panel (~1 day for 6–8 pilots).** A single strong bot converges on the easiest build and
starves every other card of data. So run a *panel* of strategy-biased pilots — Beast-go-wide, Demon-Consume,
Undead-Deathrattle, Mech-attachment, Dragon-spell, a pure-tempo baseline, a greedy-econ build — each just the
Phase 1/2 bot plus a package-bias weight table. **This is what makes the data "rounded":** every card gets
evaluated by a pilot trying to use it. A card is genuinely underpowered only if *its own* pilot can't win with
it; overpowered if it wins across many pilots.

**Phase 4 — Reporting upgrades (~half a day).** Per-archetype tables; **ablation for true per-card power** (sim
the final board *with vs without* a card against the pinned opponents — its marginal win contribution, far
cleaner than co-occurrence); and richer signals (reached-wave distribution, triple rate, board power by wave).

## Effort summary

- **~2–3 focused days** → Phase 0 + a heuristic bot + rollout board-picking. This alone flips the report from
  noise to signal: win rates into a real range, meaningful pick/win, cards reaching late waves so `n` grows.
- **~1 week total** → the full instrument (archetype panel + ablation) that exercises every card under a pilot
  that wants it. That's the "10–20× legitimate data on demand" tool.

## Honest caveats

- Tuning a heuristic bot to play *genuinely* well is iterative (watch it, catch dumb plays, retune) — which is
  exactly why we lead with **combat-rollout**: it's strong without endless tuning.
- Rollout is slower than the instant greedy bot (720 games could go from ~8 min to much longer). Mitigate with
  fewer candidates/turn, fewer games per archetype, or parallelism. Fine for an offline run.
- Archetype-bias design is light design work — deciding each pilot's package/payoff — but we know the
  archetypes cold.

## Success criteria

We'll know it's working when:
- Overall win rate lands in a plausible skilled-player band (not 2%), and varies sensibly by hero/archetype.
- `pick%` reflects real valuation and `win%` has large enough `n` on mid/high-tier cards to trust.
- Every card gets non-trivial data under at least one archetype pilot — no more invisible build-arounds.
- We can re-run on demand after any content change and get a stable, comparable read.

## Where to start (smallest legitimate step)

Phase 0 + one **rollout bot**: each turn buys by a simple value score, then picks its final board arrangement
by simming against the pinned next opponent. Keep it alongside `greedyPolicy` (both runnable) and re-run
`npm run report` to compare. That single bot already produces far more trustworthy data than everything the
current report shows.

## Key files
- `packages/sim/src/balanceReport.ts` — the bot policy + run loop + tallies (make `policy` pluggable here).
- `packages/tools/src/balance-report.ts` — the CLI front end (`npm run report`).
- `packages/sim/src/state.ts:718` — the `Action` union (the bot's full move set).
- `packages/core/src/*` — `simulate()` (pure combat, the rollout eval fn); opponents pinned via
  `packages/sim/src/opponents.ts`.
- `packages/ui/src/BalancePanel.tsx` — the in-app dev panel that also drives the report.
