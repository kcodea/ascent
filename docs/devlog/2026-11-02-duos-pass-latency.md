# 2026-11-02: Duos passes land at once (R-DUOS-PASS-LATENCY-01)

**Report.** Live Versus Duos with the owner: "i watched you send over roomworks and it took like 8 seconds before it
showed up in my hand". The owner then: "sometimes passes take literally 10 seconds". So it was intermittent.

**Measured** (new `scripts/versus-qa/pass-latency.mjs`: two headless browsers on the local wrangler Worker, Ranked Duos
party, every socket frame naming a pass timestamped on one clock):

| receiver | before | after |
|---|---|---|
| on their own screen | ~70 ms send to hand (push 8 ms, then a 50 ms coalesce, then a read) | 9 to 23 ms |
| watching the sender, back after 1 s | 2.7 s and 11.0 s | 7 to 12 ms after they are back |

**Root cause.** The room's `pass` push was only a wake-up. The client waited 50 ms, then read the passes and landed
them through the game store. While the receiver watches their teammate ("View teammate"), the store holds the teammate's
render-only run with `replaying` set, which swallows every dispatch. So the pass was read, "landed" on nothing, and never
retried until the heartbeat's backstop read (every third beat, 12 s). That is the 0 to 12 s spread the players saw. The
server, the push and the send were all fast (send to push about 8 ms locally).

A second, latent hole: a send that failed for a transient reason (timeout, dropped socket) was retried only on the
sender's NEXT run change, so a player who passed and then waited could sit on an unsent card.

**Fix (client only, no Worker change, no redeploy).**
- `duosPushed`: the push carries the row; it lands at once. The coalesced read still follows as a backstop; applying a
  row twice lands it once (the run's `received` list).
- While watching the teammate, `applyRows` lands nothing (it would hit their run). Pushed rows are kept and land the
  moment the player is back on their own screen (`duosBackFromMate`, from the `useSpectate` teammate flag dropping),
  followed by a read for anything a push did not carry. The arrival lob plays then.
- `retrySoon`: a transient send failure retries after 1 s, doubling to an 8 s cap, reset by any answer. The server
  takes each seq once, so a retry never passes a card twice.

**Judgement call.** The pass does not land on the receiver's set-aside run while they are watching (that would bypass
the store's commit path: recording, replay, autosave). It lands when they come back, which is when their hand is on
screen anyway.
