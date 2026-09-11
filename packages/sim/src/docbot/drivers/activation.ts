/**
 * FAMILY DRIVER — ACTIVATION: the §10.1 minimum-activation case for every card contract whose effects no
 * MAGNITUDE family can read — copies, transforms, refreshes, steals, casts of a named spell, and the
 * scaler shapes ("+1 per 4 spells", "every 3rd Dwarf") whose first activation does not print the contract's
 * number. The question is the playDifferential / combatDifferential one, generalized over this directory's
 * stagers: DID THE EFFECT ACT WHEN ITS TRIGGER FIRED?
 *
 * Measurement: the trigger is staged twice — once with the contract's body, once with the vanilla control
 * wearing the same stats, keywords and tribes (the stat-clone rule both differential lanes settled on) —
 * and the two outcomes are compared with bookkeeping and identity stripped. Shop: every run field except the
 * per-event telemetry both lanes learned to ignore (`shoutsThisTurn`, `lastEotFires`, `attachmentsThisTurn`,
 * …), with the body's own identity masked. Combat: the whole `simulate()` result, identity-masked
 * (`combatMasked`). Different ⇒ the effect acted (activation verified, the differing surface named in the
 * evidence); equal across every staged variant ⇒ 'runtime-unobserved' — the case ran and nothing acted
 * here, which is data (the combatDifferential's 54 scenario-conditional cards are this shape), never a pass.
 *
 * This driver never asserts a magnitude: the planner types the contract's 'plain' template as
 * `contract-states-no-magnitude` (nothing numeric stated) or `no-driver-for-shape` (a scaler, keys named).
 */
import { CARD_INDEX } from '@game/content';
import type { ContentContract } from '@game/rules/contracts/schema';
import type { CasePlan } from '../isolatedCases';
import type { RunState } from '../../state';
import { stageableTrigger } from './families';
import { combatMasked, stageCombat, stageShop, type DriverCtx } from './shared';
import { VANILLA_CONTROL_ID } from '../playScan';

export const DRIVER = 'activation';

/** Run noise + per-event telemetry that ticks for ANY body of a class (the lessons of playScan's NOISE and
 *  combatScan's telemetry strip, joined). */
const NOISE: ReadonlySet<string> = new Set([
  'rngCursor', 'uidCounter', 'uidSeq', 'presentation', 'fx', 'beats', 'log', 'shoutsThisTurn', 'firstShoutUid', 'auraFxSeq', 'auraFx',
  'lastShoutFires', 'lastEchoFires', 'lastRallyFires', 'lastEotFires', 'spellsCast', 'spellsThisTurn', 'lastSpellCastId',
  'firstSpellThisTurnId', 'lastSpellThisTurnId', 'goldSpent', 'goldSpentThisTurn', 'spellsCastIds', 'alesCastThisTurn', 'playedThisTurn',
  'spellsOnThisTurn', 'spellCostOffTurn', 'cardsPlayedTotal', 'attachmentsThisTurn', 'karwindFlash', 'alignSpark', 'minionsPlayedThisTurn',
  'minionsPlayed', 'questTendrilFx', 'weldFxBaseSeq', 'gainCardFiredUids', 'gainAttackFiredUids', 'equipmentSpellCasts', 'cardBuffs',
]);

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
};

/** The comparable view of a shop state: noise stripped, `Fx`/`Seq` stamps dropped, the source / control
 *  body's identity masked wherever it sits (board, hand, tavern). Returned per top-level key so the evidence
 *  can name WHAT differed. */
function view(s: RunState, ids: ReadonlySet<string>): Record<string, string> {
  const maskCard = (c: Record<string, unknown>): Record<string, unknown> =>
    (typeof c.cardId === 'string' && ids.has(c.cardId) ? { ...c, cardId: 'BODY', tribe: 'X', name: undefined } : c);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(s as unknown as Record<string, unknown>)) {
    if (NOISE.has(k) || v === undefined || /Fx|Seq$/.test(k)) continue;
    const masked = (k === 'board' || k === 'hand' || k === 'shop') ? (v as Record<string, unknown>[]).map(maskCard) : v;
    out[k] = stable(masked);
  }
  return out;
}

export function driveActivation(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const templates = new Set(plan.cases.filter((x) => x.driver === DRIVER).map((x) => x.template));
  if (!templates.has('minimum-activation')) return;
  const trig = stageableTrigger(c);
  if (!trig || !CARD_INDEX[c.contentId]) return;
  const ids: ReadonlySet<string> = new Set([c.contentId, VANILLA_CONTROL_ID]);

  if (trig.phase === 'shop') {
    const stages = stageShop(c, trig.event, false);
    if (stages.length === 0) return;
    let refusedAll = true;
    for (const st of stages) {
      if (st.refused) continue;
      refusedAll = false;
      if (!st.baseline) {
        // A spell has no control body: its activation is the playDifferential question — the cast changed
        // something beyond its own bookkeeping — answered against the pre-cast state.
        const a = view(st.after, ids); const b = view(st.before, ids);
        const diff = Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k] && k !== 'embers' && k !== 'hand');
        if (diff.length) {
          ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `shop: ${st.variant}; the cast changed ${diff.slice(0, 4).join(', ')} beyond its own bookkeeping` });
          return;
        }
        continue;
      }
      const a = view(st.after, ids); const b = view(st.baseline, ids);
      const diff = Object.keys({ ...a, ...b }).filter((k) => a[k] !== b[k]);
      if (diff.length) {
        ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `shop: ${st.variant}; differs from the vanilla-control twin in ${diff.slice(0, 4).join(', ')} — the effect acted` });
        return;
      }
    }
    ctx.executed.push({
      contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `shop: ${stages[0]!.variant}`,
      unobserved: refusedAll ? 'the play was refused by the reducer (the fixture cannot satisfy its play condition)' : `the staging with the body equals the staging with a vanilla control in every fixture variant — the effect did not act here (scenario-conditional, like the combatDifferential's inert queue)`,
    });
    return;
  }

  const stages = stageCombat(c, trig.event, false, { control: true });
  if (stages.length === 0) return;
  for (const st of stages) {
    if (st.control && combatMasked(st.sim, ids) !== combatMasked(st.control, ids)) {
      ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `combat: ${st.variant}; the fight differs from its vanilla-control twin (identities masked) — the effect acted` });
      return;
    }
  }
  ctx.executed.push({
    contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `combat: ${stages[0]!.variant}`,
    unobserved: 'the fight with the body equals the fight with a stat-clone control in every staged variant — the effect did not act here (scenario-conditional)',
  });
}
