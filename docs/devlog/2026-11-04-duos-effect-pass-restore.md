# 2026-11-04: a reload replays effect passes (R-DUOS-PASS-RESTORE-EFFECT-01)

A reload rebuilds a Versus run from its last lock, which drops the round's unlocked Shop actions. The server's pass rows
stand, so `replayRestore` plays mine again. It only searched the hand, which is right for a drag and wrong for an effect
pass: Handout, CueBee's Pass, Passaria and Salesman send a board or Shop minion. That minion stayed on the sender while
the teammate held it, and the sender's lock and snapshot carried it.

- New run action `restoreEffectPass` takes the minion off the board or Shop by uid and card id, accepted in any phase.
- The wire now carries `passPower` / `passPaid` on a hero power's pass, so Passaria pays its Gold and charge once on replay.
  The receiver strips them. The Worker stores the card as sent and needs no change.
- The replayed entry is `restored`, and `watchedPasses` skips it, so the stands do not see it stream twice.

**Left as is:** the cast is not replayed, so a Handout cast before the reload comes back to hand with its Gold. That is the
standing restore model (a reload drops unlocked actions), but here the pass stays delivered, so a reload can gain a card.
