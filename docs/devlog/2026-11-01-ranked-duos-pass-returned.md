# 2026-11-01: Ranked Duos passes were always refused (R-DUOS-PASS-RANKED-01)

Owner report (live build 8d8f71914): "duos keeps saying pass returned. why?" Then: "i was just trying to pass a lantern
light on both turns 1 and 2 with gold and time left, and he did not have a full hand".

## Cause

The Cloudflare room's `GroupEngine.pass` (`workers/versus/src/core/groupMatch.ts`) opened with
`if (!this.duos) fail('not_duos')`, and `duos` is `options.mode === 'duos'`. A Ranked Duos party runs on
`RankedEngine extends GroupEngine` with `mode: 'ranked_duos'`, so EVERY card pass in Ranked Duos was refused
`not_duos`. The client (`createVersusRun` gives a `ranked_duos` run its `duos` state, owner 2026-10-26: Ranked Duos
"passes the same way") refunded it and showed the generic "Pass returned. You got it back." The Supabase original
never had this bug: its `versus_duos__is` was `mode in ('duos', 'ranked_duos')`. The CF port narrowed it.

Reproduced on the core with a fake clock: a Lantern Light wire card (`duosWireOf` of a real `passCard` entry, Disco Dan
run, turn 1) is accepted in a four-player Versus Duos room and refused `not_duos` in a Ranked Duos party. Nothing in
the spell's shape, the round numbering, the deadline or the reconcile path was involved; the refusal repeats because
each new pass is refused fresh (no retry loop).

## Fix

- `GroupEngine.teamPasses` = `duos || mode === 'ranked_duos'`; `pass()` gates on it. Only the pass gate changed: the
  other `duos` reads (team pool, elimination, resolver) are Versus Duos behaviour RankedEngine overrides.
- The toast now names the reason for every refusal code (`passReturnedText` in `duosPassUi.ts`, used by the live
  transport and the Scene Builder's local channel); the generic text is kept for an unknown code, and the code is
  logged to the console (`[duos] pass returned: <code>`).

Ships with the next Worker pack (worker change). Tests: `workers/versus/test/rankedCore.test.ts` (turn 1 and 2 passes in
a Ranked Duos party), `packages/ui/src/versus/duosPassReturned.test.ts`.
