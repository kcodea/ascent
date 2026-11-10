# 2026-11-10: Ancients × Priestess and Magician (the two Duos heroes)

Twelve Ancient pairings for the two Duos-only heroes, in the owner's words ("just build them so they work. we arent
turning ancients on just yet, but build it out"). They are built end to end and proven in a real two-browser Duos game,
and **Ancients are still off in every Duos game a player can reach**. Rules R-ANCDUOS-01, R-ANCPRIESTESS-01..06,
R-ANCMAGICIAN-01..06. Data in `ANCIENT_PAIRINGS`, hooks in the "DUOS HEROES" block at the foot of
`packages/sim/src/ancients.ts`, the one combat half in `simulate.ts` (`ancientMateSwap`).

| Hero | Ancient | What it does |
| --- | --- | --- |
| Priestess | Death | A minion with an Echo gains Rise when she passes it (any pass she makes). The teammate receives it with Rise. |
| Priestess | Fortune | Passaria costs 0 (the pairing's `power` override; no primitive). |
| Priestess | War | Start of Combat: +2/+2 to her minions per card she passed this turn (`ancientPassesThisTurn` x Braum's `ancientSocBuffAll`). |
| Priestess | Genesis | Passaria costs 4 and also puts a plain copy of the passed minion in her hand. |
| Priestess | Time | Passaria twice a turn (`usesPerTurn: 2`, Merrin × Fortune's shape). |
| Priestess | Bonds | Every pass: her left-most minion +4/+4 now, her teammate's left-most +4/+4 when the card is received. |
| Magician | Death | A hat copy of a minion with an Echo gains Rise or Taunt (seeded; never one it already has). |
| Magician | Fortune | Each hat trigger takes 4 Gold off the Shop upgrade (floor 0, the current upgrade only). |
| Magician | War | Tag-team Start of Combat: a card both teammates hold: the left-most copy on each board gains the other's stats. |
| Magician | Genesis | The hat needs 8 buys; a minion copy arrives Gilded, a spell arrives as 3 copies. |
| Magician | Time | Start of Turn: a plain copy of a random card she has passed this game (hat copies and her own passes). |
| Magician | Bonds | No per-turn cap. |

## The seam (how a Duos run gets Ancients, and why players cannot)

- `createVersusRun(..., dev?: { ancients })` calls `enableAncients` on a Duos run, exactly as the Scene Builder does for
  a solo one. It is a function argument, not a room option: it is not on the wire and the Worker never sees it.
- The UI passes it from `versusDevAncients()` (`packages/ui/src/versus/versusDevAncients.ts`), whose first line is a
  STATIC build check (`import.meta.env.DEV || import.meta.env.VITE_PERF_BENCH === '1'`). A player bundle folds the
  function to `undefined`. On a DEV server or a bench bundle a tab sets `localStorage['ascent.dev.duosAncients']`
  (`1`, or `cost:<n>` for a short meter). Each tab sets its own.
- A test pins that this is the only call site that passes `ancients`, and that nothing else in the UI calls
  `enableAncients` except the Scene Builder.

## Decisions a future session would otherwise re-derive

- **What a pairing gives the teammate rides the passed card.** Priestess × Bonds' +4/+4 is `passBonds` on the wire card
  and Magician × Genesis' spell count is `passCopies`. The receiving run applies them in the one action that records the
  pass key (`receivePass`), so they land exactly once and never without the card. A separate team-effect row was the
  other option and was rejected: a reload between the two sends would lose it, and a restore's replay would send it
  twice. The amounts are clamped on receipt (the payload comes from another client).
- **The Worker is untouched and `VERSUS_CF_PROTOCOL` stays 3.** No Worker source changed, no message shape changed, and
  the room's pass rules already cover the new payloads (a pass card is opaque to the room; a Gilded `sale` pass was
  already legal). The engine the Worker bundles gains `ancientMateSwap`, which only runs when a locked side carries
  it, and no player build can lock such a side. **Turning Ancients on in Duos for players must bump the protocol**
  (the Worker would then resolve fights under rules a v3 Worker does not have).
- **"A pass" = every pass the run makes**: the hand drag, Passaria, a pass spell (Handout), a sold minion a rune
  passes. One hook, `ancientOnPassMade`, called from the two places an outbox pass is recorded (the reducer's
  `passCard`, recruit's `effectPassCard`). A team effect and a Magic Hat copy are not passes (the hat's own rule).
- **A pass that comes back undoes what it gave the card**: Death's Rise is stripped from the returned minion
  (`ancRise`), Genesis' copy leaves the hand if it is still there (`copyUid`), Time's use comes back. Bonds' own
  +4/+4 stays (a buff cannot be un-given cleanly, and the hand drag is already blocked client-side when the
  teammate's hand is full).
- **A reload mid-turn** drops the turn's actions and replays the passes the room holds (`replayRestore`). The hook
  runs on those replays too, so the sender's own gains come back (the Bonds buff, the Genesis copy, Fortune's upgrade
  cut via `restoreMagicHatSend`), and the teammate's run ignores keys it already answered.
- **Magician × War fires once per fight, at the opening, off either board of the team.** Whoever fights first, both
  copies gain. The fighting copy gets a labelled combat buff; the waiting copy is changed on the per-fight locked
  reserve (Pep Talk's precedent), so it steps in bigger with no beat of its own. Left-most copy on each board; a
  Gilded copy pairs with a plain one; current stats.
- **The hat's shape is one read.** `magicHatView` folds `ancientHatShape` (Genesis: need 8; Bonds: `noCap`), so the
  buy, the text, the counter badge and the armed glow (`heroPowerArmed`) cannot disagree.
- **Magician × Fortune is for the upgrade in front of you**: it cuts `upgradeCost`, which every tier-up resets.

## What is still needed to turn Ancients on in Duos for players

1. **A switch.** A room option (or a mode rule) that both clients and the Worker agree on, replacing the dev seam, and a
   `VERSUS_CF_PROTOCOL` bump with a Worker deploy before the build ships.
2. **The meter in a live match.** It fills on Refreshes and combats as in the Scene Builder and the offer opens over the
   Shop (seen working in the local check). Its numbers (16 / 1 / 2) were tuned for a solo test mode, not a timed turn.
   The offer pauses the Shop (every action but the pick is refused, End Turn included) while the turn timer keeps
   running. Built here so a match can never hang on it: the timeout policy (`versusAutoResolve` /
   `legalModalAnswers`) answers an open Ancient offer like every other open decision, with a seeded random pick.
   Whether a timed match should instead keep the offer for next turn is an owner call.
3. **Recorded seats.** `BoardSnapshot` does not carry the picked Ancient or its combat mods (no Ancient is
   snapshotted today). Ranked Duos' recorded teams would fight with the permanent results on their boards (Rise, the
   +4/+4, Gilded copies) but without the Start of Combat halves (Priestess × War, Magician × War). The same is true of
   every other hero's Ancient combat half.
4. **The other 40 heroes in Versus.** Their pairings were written for a solo Set 3 run; several keep run state that a
   Versus reload (restore from the last lock) has not been tested against.
5. **Spectators and the teammate view** read the run as it is, so the meter and the power text show, but nothing was
   designed for a watcher seeing the offer.

## Verification

Unit and scenario tests: `packages/core/src/combat/ancientMateSwap.test.ts`,
`packages/sim/src/ancientsPriestess.test.ts`, `packages/sim/src/ancientsMagician.test.ts`,
`workers/versus/test/ancientsDuos.test.ts` (two runs through the room core), `packages/ui/src/versus/ancientsDuos.test.ts`
(the seam, the hat badge, the restore replay). Live: `scripts/versus-qa/ancients-duos.mjs`, two headless browsers in a
Ranked Duos party against `wrangler dev`, every non-local host blocked.
