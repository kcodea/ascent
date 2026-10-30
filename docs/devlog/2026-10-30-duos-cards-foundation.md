# 2026-10-30 · Duos-only cards: the foundation (pool, team channel, five proof cards)

Owner design 2026-10-30: a batch of Duos-only minions and spells. This PR (`feat/duos-cards-foundation`) is the
foundation other builders add cards on as data. Rules R-DUOS-CARDS-01..04.

## Pool membership (R-DUOS-CARDS-01)

- `CardDef.duos: true`; cards live in `packages/content/src/cards/duos/` (one file per tribe, `DUOS_CARDS` in `index.ts`),
  in no set manifest, in the global `CARD_INDEX`.
- `duosPoolFor(setId)` (sets.ts) = the set's pool + every Duos card whose tribe (or second tribe) is in `SETS[id].tribes`,
  neutrals and spells always, APPENDED (no set position moves). Owner: "this is for set 2 right now. but cards that sit in
  tribes in both will carry into set 3/4 etc", so membership is by tribe, never a set list.
- `poolOf(state)` reads it when `state.duos` is present. `createRun(..., { duos: true })` stamps `duos` at creation so the
  stock and the opening Shop come from the Duos pool (`createVersusRun` passes it for `duos` / `ranked_duos`). The client
  run, restores, replays and the Worker all go through `poolOf`.

## The team channel (R-DUOS-CARDS-02)

A team effect (`TeamEffect` in core types: `maxGold`, `upgradeDiscount`, `gift`, `gold`, `tripleReward`, `sold`) rides the
existing pass channel as an outbox entry with `team` (wire `passFrom: 'team'`). Sender: own half now (the shop arena's
`sendTeam`), teammate half queued. Receiver: the recorded `receivePass` action lands it through `receiveTeamEffect`
(recruit.ts), which resolves random picks on ITS run (board, pool, RNG). The restore replay already lands unanswered rows
in server order, so a reload or reconnect reproduces it. Combat bodies push to `ShoutCarry.teamEffects`; settle applies
the own half and queues the teammate's (so a combat gift arrives at settle, not mid-fight: flagged to the owner).

Worker (`groupMatch.pass`): team rows skip the pass cap (own cap `DUOS_TEAM_FX_CAP` = 60/round), the hand-room check
(the receiver's run refuses a gift its full hand cannot take) and the Shop-phase check (a combat Echo's effect is sent at
settle). Delivery (owner 2026-10-30, "duos requires 2 live players"): connected = now; disconnected (auto / paused) =
recorded, lands on reconnect; LEFT the party or OUT = skipped (`duosTeamFxRefusal`, `no_teammate`). Card passes keep
their old rules. A spell pass travels as `passFrom: 'spell'` and obeys the card-pass rules (cap, hand room).

## Passing (R-DUOS-CARDS-03)

- Only the MANUAL drag pass costs Gold (owner 2026-10-30). `duosPassCost(s)` is the one price (refusal, charge, UI):
  0 while Brian's Pal has a free pass left this turn (`duos.freePassesUsed`/`freePassWave`; Gilded frees 2). Each outbox
  entry records `paid`, and a refund returns exactly that (a free pass gets its allowance back). The coin in the send FX
  only flies when Gold was paid.
- `effectPassCard(state, card, from, index)` is THE effect pass: free, never a Golden card, counts as a pass for every
  watcher. Handout (`passTargetMinion`) uses it; a refused Shop minion goes back to the Shop row, never your hand.
  The UI streams a spell pass from the minion's element into the teammate portrait (`playSpellPass`).
- Triggers: `passedCard` (you passed; `params.spellOnly` for "a Shop Spell"), `teamPassedCard` (either teammate; fires on
  the sender at the pass and on the receiver when it lands), `teammateSold` (the sold body as `target`). `params.oncePerTurn`
  latches per instance (`BoardCard.duosOnce`). Every sale in a Duos run sends a `sold` team effect.

## Most common type (R-DUOS-CARDS-04)

`mostCommonTribe(state, rng)`: run tribes by minions on board through `isTribe`; ties (owner: "50/50") a seeded pick among
the tied; an empty board ties every run tribe.

## Proof cards

Hitchhiker (T1 2/3), Brian's Pal (T2 3/4), Richmond (T5 Dragon 7/3), Handout (T4 spell, 2), Share the Wealth (T3 spell, 3).
No art. A `Pass` glossary pill + rules-wiki answer.

## How to add the next Duos card

1. Put the def in `cards/duos/<tribe>.ts` with `duos: true`, append it to `DUOS_CARDS`.
2. Team primitives: `teamGainMaxGold`, `teamUpgradeDiscount`, `giftTeammate` (`cardId` / `randomSpellTier` / `mateTribe` /
   `randomMinion` / `fromPayload: 'spell' | 'card'`), `giftTeammateGold`, `giftTeammateTripleReward`, `passTargetMinion`,
   `duosFirstPassFree`, `teamPassBuffSelf`, `teammateSoldGainStats`; triggers `passedCard` / `teamPassedCard` /
   `teammateSold`. Add a presentation-policy row (`factory:<id>:<trigger>`) for each new pairing.
3. Live text if it scales, a patch note, a test on two runs (`duosCards.test.ts` has the `ship` helper).

## Investigated: can a recorded or bot TEAMMATE be seated? (owner 2026-10-30)

No production path. Ranked Duos starts only when both party seats p1 and p2 press the gate (`roomCore` gate, `ranked_duos`
min = max = 2 seats); recorded duo / paired solo snapshots and generated seats fill teams b-d only (opponents). Versus Duos
starts only with exactly four seated members. The only "bot teammate" is the DEV-only Versus Bots + Duos tuner (test
accounts playing live client runs in the host's tab; the dev menu is stripped from production builds; owner-requested
2026-10-25). Nothing was removed.

## Not built (needs a new primitive)

- Discover where the teammate gets the other options (Disco), and Discover-then-pass (Matchmaker): needs a Discover
  continuation hook (`discover` is a plain id list today).
- Matchmaker's "teammate's most common type" on the SENDER side: the sender's run has no copy of the teammate's board; needs
  a recorded "mate info" action fed by the client.
- Salandaman's game-wide tally across copies, Galfagan's "(Once per turn)" copy, Bratworst's "(Twice per turn)": data on the
  existing triggers plus small factories (`oncePerTurn` exists; a twice-per-turn count does not).
- Proxus (a Demon consumes a Shop minion on pass): a factory on `passedCard` reusing the consume path.
- Monstrocity ("when you buy or Discover this, your teammate gets a copy"): an `onBuy` / Discover hook calling `giftTeammate`.
- Real-time combat delivery of a combat gift (today: at settle).
