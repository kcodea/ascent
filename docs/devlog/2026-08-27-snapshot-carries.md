# 2026-08-27 — Snapshot carries: marks, grafted Echoes and the Imp bank ride into combat

Implements the four snapshot-carry owner rulings from the 2026-08-27 triage board
(`packages/rules/src/registry/decisions.json`, `q-snap-*`): the per-instance fields Doc Bot's
snapshot-fidelity ratchet had flagged as silently dropped now cross every boundary they should.

## The rulings and what shipped

- **q-snap-one-combat-marks (approve)** — `partingCry`, `resummon` (Soren's Reclaim) and `closedCasket`
  now carry through board capture exactly like `bloodlust` (the same one-combat-mark shape): `cleanBoard`
  emits them, `opponentBoard` restores them, so a SERVED board fights with the marks its owner paid for.
  The reducer's own player mapping already carried all three — capture was the only gap.
- **q-snap-granted-effects (approve)** — runtime shop grafts (`grantedEffects`: Echo Mimic, Grave Body,
  Contract Rewrite's quest graft, Rune of Rebirth's shop half) now ride the player combat mapping AND
  capture. `BoardMinion` gained the slot; `instantiate` folds them into the live `Minion.effects` through
  the same channel `copiedEcho` already used, so a grafted Deathrattle fires as a real one.
- **q-snap-echostripped (revise — owner wording honoured)** — the `echoStripped` mark ("summon a copy
  WITHOUT the Echo": Exgalloper, Rune of Rebirth's shop copies) now rides both boundaries, and
  `instantiate` filters the `onDeath` effects out of the live minion — the same rule combat's own
  `stripEchoes` applies to copies made mid-fight. A shop-cleansed copy no longer summons itself when
  killed in combat. (The owner's upcoming "Rebirth" keyword rename is theirs; nothing was renamed.)
- **q-snap-impbank (approve)** — Ashen Heir's banked Imp stats ride: `BoardMinion.impBank` added,
  threaded through the player mapping, capture and restore, and seeded (CLONED) onto `Minion.impBank`
  at `instantiate`, where the existing combat factory `impInheritOnSummon` already pays it out to an Imp
  summoned mid-fight.

## Judgement calls

- **Combat-banked amounts stay combat-local (documented choice).** The bank crosses INTO combat as a
  clone (like `chefGrantedLast`), and neither combat banking nor a combat payout writes back to the run's
  `BoardCard.impBank`. Rationale: the existing carry-back channels (`playerSummonBonus` /
  `playerHpGrantBonus` / … keyed by `sourceUid`) would have needed a new `CombatResult` field and a
  simulate seam a sibling PR was actively touching; and a payout to a combat-transient Imp consuming the
  run's permanent bank would LOSE the value outright (the Imp evaporates at settle). Keeping the run bank
  intact is both the lean and the value-preserving reading. Revisit if the owner rules the bank should be
  spent-once across phases.
- **Soren's Reclaim mis-mark fixed via a snapshot flag.** New captures stamp `BoardSnapshot.marksCarried`
  and carry the EXACT player-marked instance; `opponentBoard` skips its best-Echo-body reconstruction
  heuristic for them (including a genuinely markless new capture). LEGACY snapshots (no flag) still get
  the heuristic, byte-identically — pinned `servedBoards` and old pool boards reproduce unchanged.

## Ratchet + compatibility

- `SNAPSHOT_EXCUSED`: the six resolved `capture:*` needs-triage entries deleted;
  `SNAPSHOT_TRIAGE_COUNT` 9 → 3 (remaining: `capture:rallySpreadAtk`, `combat:addedTribes`,
  `combat:chefGrantedLast`). The three new `BoardMinion` fields were classified at the `combat` boundary
  the day they were born (`folded` ×2, `consumed-live`).
- Boards recorded before this change simply lack the fields — absent = undefined = prior behaviour;
  covered by an explicit legacy-snapshot test.
- Behavioral pins in `packages/sim/src/snapshotCarries20260827.test.ts` (17 tests): served Parting
  Cry/Closed Casket fire, Soren exact-mark + legacy fallback, grafted Echo in player fight (both the
  direct instantiate path and the full `faceOmen` reducer path) and on served boards, stripped copies
  silent everywhere, the bank paying a mid-fight Imp, and the run bank never consumed by a fight.
