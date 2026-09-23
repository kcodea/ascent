/**
 * APPROVED RULES — domain `auras`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { HANDOFF } from './shared';

export const AURAS_RULES: GameRule[] = [
  {
    id: 'R-AURA-01',
    title: 'Auras are global modifiers',
    statement:
      'An Aura is a global modifier affecting an eligible type, card or population wherever the Aura defines. '
      + 'Auras can affect existing and future eligible cards. Plain copies remain plain but receive any '
      + 'independently applicable Aura. Every Aura contract must state its zone coverage and lifetime. '
      + '`Aura` becomes explicit keyword terminology once approved wording is wired.',
    domain: 'auras',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'An Aura is a global modifier affecting an eligible type, card, or population wherever the Aura defines.' }],
    // DELIBERATELY UNENFORCED (in the approved-but-unenforced queue): no probe yet pins the load-bearing
    // behavioral halves (auras reach future eligibles; plain copies stay plain yet receive applicable
    // auras; per-aura zone coverage + lifetime). auraFx.test.ts checks the FX stamp, not this contract.
  },
  {
    id: 'R-AURA-02',
    title: 'An Aura-affecting spell is permanent from any phase — Lantern of Souls in combat included',
    statement:
      'A spell whose effect changes an Aura (Lantern of Souls: "your Undead Aura gets +3 Attack") is permanent '
      + 'wherever it is cast. A combat cast — a Rally, an Avenge, an Echo — raises the run-wide Aura exactly as a '
      + 'shop cast does: carried back at settle and in force for the rest of the run. There is no combat-only Aura.',
    domain: 'auras',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (triple confirmation)', quote: 'lantern of souls is always permanent since it is an aura affecting spell … therefore, lantern of soul casts in combat are always permanent.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts grantUndeadAura → CombatResult.playerUndeadAuraGain; packages/sim/src/reducer.ts settle → undeadAttackBonus' },
    ],
    contentIds: ['lanternofsouls', 'watcher', 'u3_hierophant', 'anubis'],
    currentBehaviour:
      'Conforms: every combat Lantern cast goes through the arena verbs `castRepeat` + `grantUndeadAura`, whose gain is '
      + 'carried back on `playerUndeadAuraGain` and added to the run Aura at settle. Pinned by the Hierophant case '
      + '(a combat Avenge cast carries +3 back) and the shop cast in run.test.ts.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts', 'packages/sim/src/run.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
];
