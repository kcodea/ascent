# 2026-09-15 — Balance pilot: player-legal scouting, scouted fight panel, survival term

**Branch:** `feat/balance-scout` → PR against `feat/balance-bot`.

## What

The balance pilot now receives the SCOUTING a real player has in the shipped lobby, and its fight evaluation can
use the actual field instead of a generic wave panel.

- **The rule** (documented with file:line in `packages/sim/src/productionBots/scout.ts`): while shopping a player
  knows the next opponent (`LobbyPanel.tsx:87` → `playerOpponent`, the NEXT chip) and can hover every seat's
  scout card (`LobbyPanel.tsx:205`): hero, live Resolve/Armor, tier / triples / dominant tribe + count / quests /
  runes (`SeatIntel`, recorded at settle from the last fielded board, `runLobby.ts:584-586`; this-round board
  for the next foe only, `LobbyPanel.tsx:89-91`), last three results. Never another seat's minion list. The only
  bodies a player has seen are the boards they themselves fought.
- **`SeatContext`** (additive): `nextOpponent`, `field`, `myHealth` / `myArmor` / `lossCap`, plus
  `seatedRecordings` (a fairness guard, not player information). Filled by the pinned runner from the real table
  and by the self-play runner from settled seat state (own combat memory in both; settle-committed intel so a
  later-shopping seat cannot read a this-round board).
- **`fightScore`**: a `scouted` panel (next opponent ≥ 60% of the weight: its recently fought board + pool boards
  of its scouted shape; the field at half weight; pool fill, seated recordings excluded) and
  `expectedDamageTaken`. Opened per decision through `withScout` (the pilot's smallest hook — `evaluate` sits
  between the pilot and `fightScore`).
- **Survival**: `survivalTerm = −(capped hit ÷ cap) × lethalRisk`, folded into the utility at
  `budget.survivalWeight` (default 0) through an optional `score` argument on `pilotSearch` / `bestOf`.
- Manifest schema accepts `policy.budget.scouting` / `survivalWeight`; both default off so old jobs reproduce.

## Verified

- `productionBots/scout.test.ts` (17): risk / survival shape, shape matching, the seated-recording exclusion, panel
  composition and weights, `panel: 'scouted'`, the scope.
- `balance/scoutContext.test.ts` (9): both runners — the next opponent is the seat then fought; next-foe intel is
  this round's tier/triples with no bodies; every other seat's intel is from a strictly earlier round; a remembered
  board is the board of the round the pilot fought it and equals NO later wave of that recording.
- `npm run typecheck && npm run lint && npm test` green.

## Measured (100 pinned set-2 lobbies each, smoke budget, real recorded population)

| job (100 pinned set-2 lobbies, smoke budget) | mean placement [95% CI] | 1st | top-4 | elim. median | win% by round 5 / 6 / 7 / 8 |
|---|---|---|---|---|---|
| baseline `set2-pinned-gen-smoke100` | 6.80 [6.55, 7.05] | 0% | 6% | r9 | 56 / 36 / 20 / 12 |
| + scouting (`set2-pinned-scout-smoke100`) | 6.87 [6.62, 7.11] | 0% | 6% | r9 | 59 / 42 / 19 / 17 |
| + scouting + survival 8 | 6.87 [6.62, 7.11] | 0% | 6% | r9 | 59 / 42 / 19 / 17 |
| + scouting + survival 20 | 6.84 [6.58, 7.09] | 0% | 7% | r9 | 59 / 42 / 19 / 18 |

Scouting does not move the pilot, and the round logs say why: it wins rounds 1–5 (real players are tiering) and
then fields the same seven tier-1/2 bodies from round 6 on while its hand grows from 3.6 to 9 unplayed cards
(board 6.8–7.0 full from round 6; tier keeps pace with the recordings by round 10). At the smoke budget a sell
reads as pure loss, `forcedSpend` keeps buying into a full board, and there is no sell → play replacement chain —
a B3/B4 competence defect, not an information defect. The scouting layer is in place for when the pilot can act
on it.
