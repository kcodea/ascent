# 2026-11-16 — Duos: a pass to a full hand waits instead of failing (R-DUOS-PASS-WAITS-01)

Owner ruling (Priestess / passing): "A passed minion when a teammates hand is full should actually not fail, and should
enter the teammates hand when they have space." Supersedes 2026-10-25's "Pass is refused if hand is full".

Why now: ancients audit 3, F1. Priestess × Bonds gives +10/+10 on every pass, and a full-hand refusal refunded the card,
the Gold and the Passaria use but left the buff behind. The same card could be passed over and over for a free +10/+10.

What changed:
- **One waiting queue for every card pass.** `receiveDuosPass` no longer refuses a card for a full hand. Every card pass
  (the drag, Passaria, pass spells, sales, Magic Hat copies) is received (answered `landed`) and, if the hand is full or
  cards are already waiting, joins `duos.waiting` (FIFO). `landWaitingPasses` already ran after every action for effect
  passes (R-DUOS-EFFECT-PASS-QUEUE-01); the drag now shares it. Everything that fires on receipt (Bonds' teammate half,
  the pass watchers, Playing Catch's team count) fires once, when the pass is received, whether the card lands or waits.
- **The room never says `hand_full`.** `groupMatch.pass` (`workers/versus`) dropped the hand-room check; this covers
  Versus Duos and Ranked Duos (`RankedEngine` extends `GroupEngine`). `duos_hand_room` is still accepted and reported,
  but refuses nothing now.
- **Refunds take Bonds back.** The other refusals stay (clock, 10 card passes per round, teammate away / out, a Golden
  minion by a pass spell, bad card). Those can still be farmed (the 11th pass of a round is refused every time), so
  `ancientOnPassMade` records `bondsUid` on the entry and `refundDuosPass` takes the +a/+h back off that minion (stats
  and the buff ledger line; Health floors at 1). Mirrored gains (Sable's bond, Shared Spoils) are not unwound.
- **Client.** `duosPassBlocked` lost its `mateHandFull` argument and the `hand_full` reason; `hand_full` left the refusal
  sets in `duosPasses.ts` and `versusBotDriver.ts` and the portrait texts. When the teammate's live frame shows a full
  hand, the sender's teammate portrait says "Their hand is full. It waits for room." once the room takes the pass. The
  receiver's existing "Hand full: N cards waiting" pill now covers drag passes too.
- **Scene Builder.** `sbWorkerRefusal` no longer mirrors `hand_full`; a waiting delivery is a `landed` event with
  `waiting: true`, and the rig shows the same note.
- **Protocol 4.** A rules change with no content change, so `VERSUS_CF_PROTOCOL` 3 -> 4 (R-VERSUS-WORKER-RULES-01): a v3
  client would still refuse a full-hand pass and refund it against a v4 room.

Calls made (owner can overrule):
- A waiting card belongs to the receiver the moment it is received: it survives a reload and later rounds, and is
  never sent back, even if the receiver leaves or goes away after it arrived. It ends with the game.
- The room-side expiry (R-DUOS-PASS-EXPIRE-01) is unchanged: a pass still `sent` (not yet answered) when the receiver
  goes away is refused and refunded as before.

Deploy: the Worker (`workers/versus`, new name `ascent-versus-v4-<rev>`) ships with the next build; nothing deployed
here. No SQL (Supabase Versus is retired; `versusDuos.db.test.ts` pins the retired SQL and was left alone).

Tests: `packages/sim/src/duosPassWaits.test.ts` (full-hand drag waits, FIFO, no overtaking, Bonds once and the card
lands when room opens, room refusals take Bonds back), plus updated `ancientsPriestess`, `sbDuosChannel`, worker
`duosCore` and `ancientsDuos` tests.
