# 2026-10-31: Duos, Golden minions pass from hand; pass spells still can't target them

Owner ruling (2026-10-31): "Duos rule clarification- gilded minions can be passed from hand but not targeted by spells
that pass". This revises R-DUOS-PASS-NO-GOLDEN-01 (#2467, 2026-10-30), now superseded by
**R-DUOS-PASS-GOLDEN-MANUAL-01**.

- **Manual pass** (drag onto the teammate portrait; 1 Gold, or free via Brian's Pal / Playing Catch): a Golden card
  passes and lands Golden. `duosPassBlocked` no longer returns `golden`; the portrait's "Golden minions cannot be passed"
  text is gone.
- **Targeted pass spells** (Handout, CueBee's Pass; `targetNoGolden`): a Golden board minion or Shop offer gets no target
  glow and is never the cast target (`castRefuses` in `dragDecision.ts`), and a drop on one snaps the spell back. The
  engine's refusal (`targetNoGolden`, `effectPassCard`) is unchanged.
- **Worker** (`groupMatch.pass`): refuses `golden` only for `passFrom: 'spell'`; `'hand'` and `'sale'` may carry one.
  The Scene Builder local channel (`sbWorkerRefusal`) mirrors it. Ships with the next Worker pack.
- **Untargeted effect passes** keep their own rules: Salesman of the Year (`allowGolden`) still passes a Golden sale;
  Matchmaker still routes through `effectPassCard` (a Golden pick would be kept, not passed); Disco / Monstrocity gifts
  unchanged.

The UI glow/drop guard keys off `def.targetNoGolden`, so Displacement and the other `targetNoGolden` Set 1 spells also
stop lighting Golden minions while aimed (the engine already refused them).
