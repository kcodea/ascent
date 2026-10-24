# 2026-10-24 — A Start-of-Turn triple waits for the Shop (Bug Board c49f912b)

**Report.** A golden formed at Start of Turn played its gild during the return-to-shop transition; on a rune turn it
should wait for the rune pick. Confirmed from the capsule (set2, Runeguard, wave 8): Rune of Unbroken Vein's recurring
Cave Cutter grant (Start-of-Turn beat `{ kind: 'gift', handGrants: ['b65'] }`) completed a triple inside `resolveCombat`,
leaving golden `b66` in hand with a Runeforge offer open.

**Root cause (presentation only).** `resolveCombat` is dispatched at `coveredOut`, under the full curtain. The gild had
no wait of its own: the Shop's coalesce/gild layout effect played `playGildTrail` in that commit, and the store's
`actionSfx` rang `sfx.triple()` on the dispatch. The Start-of-Turn beat system (R-SOT-BEAT-01) could not cover it: its
arrival cue names the GRANTED copy (`b65`), which the triple consumed, so the golden (a new uid) was never held and sat in
the hand at the reveal, and under the Runeforge.

**Fix.** `packages/ui/src/turnStartGild.ts` + `Recruit.tsx`: a triple whose commit lands while the wipe is moving is
PARKED during render (its trail sources resolved against the pre-combat gild snapshot, which the next recruit commit
overwrites) and its golden is held out of the hand and board rows. It plays (trail + triple sound) once the wipe is at
rest, the Start-of-Turn beats are done and no offer covers the Shop: the Runeforge until its rune is picked and the
lock-in flight ends, and equally a Discover / quest / power / Ancient offer, scout, or Choose One. A peeked offer
releases it. Leaving the Shop first drops it unplayed. `actionSfx` skips the triple sound for exactly that case
(`resolveCombat`, recruit, `wipeIdle` false). Run state is untouched. Rule R-SOT-GILD-01 (gilding).

**Checked, not sharing the issue.** Start-of-Turn beats (gains, arrivals, rune badge procs) already wait for the wipe;
Start-of-Turn offers (Runeforge, Discover, quest, power) are already held by `overlaysHeld` until the wipe rests and the
beats finish. Still open, out of scope here: `actionSfx`'s Taunt/Ward grant sounds would also ring on the
`resolveCombat` dispatch if a Start-of-Turn effect granted those keywords.
