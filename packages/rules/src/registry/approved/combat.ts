/**
 * APPROVED RULES — domain `combat`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { HANDOFF, AVWIN_HANDOFF } from './shared';

export const COMBAT_RULES: GameRule[] = [
  {
    id: 'R-CEL-01',
    title: 'Celestial Alignment locks at combat start',
    statement:
      'Dawn, Dusk and Eclipsed are determined by board position. Alignment locks when combat begins; combat '
      + 'deaths and board contraction do not realign survivors. Eclipsed counts as both Dawn and Dusk. '
      + '(Provisional: Celestials are WIP and this may be revised.)',
    domain: 'combat',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'Alignment locks when combat begins.' }],
    // Alignment lock is pinned behaviorally: "locks at combat setup and combat never re-centres", the
    // ECLIPSE-runs-both-halves cases, and Dawn/Dusk-locked halves all live in celestial.test.ts.
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/celestial.test.ts'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'R-AVWIN-11',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'] },
    title: 'Rise returns at base Attack and 1 Health',
    statement:
      'A minion that Rises returns with its base Attack and exactly 1 Health, discarding its accumulated '
      + 'instance stats, unless the effect explicitly states a different return-stat rule. Independently '
      + 'applicable standing Auras are evaluated normally after the minion returns; they are not inherited '
      + 'instance buffs.',
    domain: 'combat',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: AVWIN_HANDOFF, quote: 'Rise returns at base Attack and 1 Health.' }],
    currentBehaviour:
      'Conforms: the Rise branch resets to `def.attack × (golden ? 2 : 1)` and health 1, sheds granted '
      + 'keywords/instance buffs, then `applyAuras` re-applies standing auras on top. SHARPENED by R-RISE-01 '
      + '(owner 2026-08-28): the return stats are the base values taken BEFORE any Aura or standing effect, '
      + 'with the Auras re-applied on top of the returned body — measured and pinned there.',
  },

  // ── Sitting-2 / keyword-convention rulings (owner triage 2026-08-28) ───────────────────────────────────
  {
    id: 'R-RISE-01',
    title: 'Rise returns at BASE stats first — Auras apply afterwards, and are never baked into the return',
    statement:
      'A minion that Rises returns at its printed base Attack (×2 while Gilded) and exactly 1 Health, taken '
      + 'BEFORE any Aura or standing effect is added — the return value is the printed body, never the body '
      + 'the Auras had grown. Every independently applicable Aura (Undead, Imp, Beast, Attachment, per-card '
      + 'enchants) is then re-applied to the returned body normally: a Rise under a +3/+2 Undead Aura comes '
      + 'back at base+3 Attack and 3 Health, not base/1 (Auras skipped) and not its pre-death stats (Auras '
      + 'baked in). This SHARPENS R-AVWIN-11 with the ordering: base first, Auras second.',
    domain: 'combat',
    status: 'approved',
    evidence: [{
      kind: 'owner-chat', ref: 'decisions.json q-conv-keyword-r (keyword conventions, 2026-08-28)',
      quote: 'it returns with 1 health and base attack before any auras or effects are added, i.e. undead aura.',
    }],
    currentBehaviour:
      'Conforms (measured 2026-08-28): the Rise branch in simulate.ts resets to `def.attack × (golden ? 2 : 1)` '
      + 'and Health 1, sheds granted keywords / instance buffs / rally gifts, and only THEN calls '
      + '`applyAuras(minion, true)` — the from-base pass that re-adds each side-scoped Aura (including the '
      + 'buy-time slices). Pinned by the Rise-aura probe in temporalWindow.test.ts.',
    enforcement: { kind: 'oracle', refs: ['temporalWindow'], lastVerifiedAt: '2026-08-28' },
  },
  {
    id: 'R-NEXTCOMBAT-02',
    title: 'Next-combat spells carry over to a served board and work for either side',
    statement:
      'A spell cast in the Shop for the next fight travels with the board snapshot and resolves for whichever side '
      + 'holds it: Fleeting Vigor buffs that side\'s starting minions, the banked keywords (Field Maneuvers, Last Stand, '
      + 'Executioner\'s Edge) stamp onto the same bodies, Open the Gates\' Imps join that side, Rallying Offensive '
      + 'doubles that side\'s Rallies, and Marked Target gives the holder\'s FOE\'s right-most minion Taunt at Start of '
      + 'Combat. The player\'s own fight resolves exactly as before. Pre-emptive Assault is the one exception for now: '
      + 'it is captured on the snapshot but only the player\'s applies, until the owner rules on both sides holding it.',
    domain: 'combat',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Next-combat spell audit, 2026-10-07 (the lost spells)', quote: 'these should carry over.' },
      { kind: 'owner-chat', ref: 'Next-combat spell audit, 2026-10-07', quote: 'rallying offensive and marked target should work for opponents.' },
      { kind: 'code', ref: 'packages/core/src/combat/bankedOpeners.ts applyBankedOpeners; packages/core/src/types.ts QuestCombatMods (rallyDouble, markFoeRightmostTaunt, fleetingVigor, bankedKeywords, bankedImps, attackFirstNext); packages/sim/src/reducer.ts nextCombatBankMods' },
    ],
    currentBehaviour:
      'Conforms from 2026-10-07. Before, these six spells were player-only: pre-baked into the player\'s combat board '
      + 'or a player-only CombatConfig flag, and spent before the snapshot was captured, so a served board lost them. '
      + 'The guard test fails a new next-combat bank that has no snapshot capture or no enemy-side application.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/nextCombatSpells.test.ts', 'packages/sim/src/nextCombatBanks.guard.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
];
