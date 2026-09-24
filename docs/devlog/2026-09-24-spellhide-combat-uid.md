# 2026-09-24: Rune of Spellhide finds its Beast in combat

Owner ask (verbatim): *"Fix Rune of Spellhide never finding its Beast in combat."*

## The bug

Rune of Spellhide ("The first stat-granting Shop spell you cast on a Beast each turn is cast on it again at Start
of Combat") records `{ spellId, uid }` in `recruit.ts` with the RUN board card's uid. The reducer threads that list
into the combat side as `spellhide`. `simulate()` gives every combat body a fresh uid (`mkUid`: `m0`, `m1`, ...) and
keeps the run uid on `sourceUid` (the reducer bridge sets `sourceUid: b.uid`). The Start-of-Combat re-cast matched
`m.uid === rec.uid`, so through the real pipeline it never found the Beast and silently skipped. Its comment claimed
`instantiate` carried the run uid onto the body; it does not.

The Doc Bot carry-over scan had already flagged exactly this on 2026-08-26 (`spellhidePending`, `needs-triage`),
parked because the rune was archived on 2026-08-12. It still resolves for saved runs that hold it.

## The fix

- `packages/core/src/combat/simulate.ts` (RUNE OF SPELLHIDE): match `m.sourceUid === rec.uid`, with `m.uid` as a
  fallback for a hand-built side that names the combat uid. Comment corrected.
- Test `packages/sim/src/spellhideCombatUid.test.ts` drives the reducer (buy the rune, cast Spirit Fire on a Beast,
  `faceOmen`) and checks the `runeSpellhide` trigger fires once and the +2/+3 lands on the Beast's combat body. It
  failed before the fix and passes after.
- Doc Bot: the `spellhidePending` needs-triage excuse is gone (the scan now sees the field change the fight, which is
  what failed the stale-excuse check), and the needs-triage ratchet drops from 2 to 0.
- Oracle: R-RUNE-16 in `packages/rules/src/registry/approved/runes.ts`.

## Checked for the same bug elsewhere

Every other `uid ===` lookup in `simulate.ts` / `factories.ts` compares combat uids with combat uids, or hand uids
with the hand list (`handMinions`). The carry-backs (`playerSummonBonus`, `playerPermaBuffs`, ...) already key on
`sourceUid`. No other instance of this bug class was found.

The rune is a boolean flag (copies do not stack) and records one spell per turn, so there is no golden or copies
behaviour to cover.
