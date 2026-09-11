/**
 * FAMILY DRIVER — STAT GRANT (+A/+H): the largest contract family (Shout / Rally / Echo / spell / watcher
 * buffs on a target, self, adjacent, a tribe, the board, the hand, the tavern, or a run-wide aura).
 *
 * Claim shape driven: an effect whose const amount has `attack` and/or `health` keys (optionally `count`)
 * and NOTHING ELSE — an `every` / `step` / `improve` / `per` / `pct` key means the first activation's
 * magnitude is NOT the printed number, and those shapes stay honestly un-driven until a scaler-aware driver
 * exists (the planner types them `no-driver-for-shape` with the offending keys named).
 *
 * Measurement: the trigger is staged (shared.ts) — once per Choose One branch, since the player picks ONE —
 * and every {attack, health}-bearing thing the run state owns is diffed before/after (board, hand, tavern
 * riders, run-wide auras); in combat every player-side buff event is read off the authoritative log. The
 * contract's (A, H) must appear as an exact delta on at least one unit. Two readings are accepted, in order:
 *   1. per effect — some unit moved by exactly this effect's (A, H);
 *   2. stacked — no unit matched one effect alone, but a unit moved by the SUM of the branch's stat effects
 *      ("+3/+4 twice" is one unit at +6/+8; a Shout with two +1/+1 riders on the same target is +2/+2).
 * Only the keys the contract STATES are observed (`effects.<i>.amount.plain.attack|health`); the frozen
 * comparator judges. A unit that moved but not by either reading is reported as the closest UNEXPLAINED
 * mover — a visible mismatch, never rounded away — but only when the attribution is unambiguous: every
 * effect of the branch is a stat claim and some mover matches none of them. When the contract also carries
 * an amount-less effect (an Imp-Aura fold, a per-tribe scaler) that may own the unexplained movers, or when
 * every mover is explained by the contract's OTHER claims (an overflow rider the fixture never overflowed),
 * the unmatched claim is 'runtime-unobserved' with that reason. Nothing moved at all = 'runtime-unobserved'.
 *
 * Gilded: the declared 'multiply' factor as a metamorphic law — the TOTAL stat delta of a gilded body's
 * activation must be ×factor the plain one (shop; folds both a doubled amount and a doubled count), or the
 * LARGEST single buff event ×factor (combat, where a bigger body changes how long the fight runs).
 */
import type { ContentContract } from '@game/rules/contracts/schema';
import type { CasePlan } from '../isolatedCases';
import { checkMetamorphic } from '../variantDiff';
import { gildFactor, stageableTrigger, statGrantEffects } from './families';
import { combatBuffs, stageCombat, stageShop, unitDeltas, type DriverCtx, type ShopStage } from './shared';

export const DRIVER = 'stat-grant';

interface Mover { key: string; dA: number; dH: number; label: string }

/** Shop: the movers of one stage, excluding the subject played past a watcher (its own body is not a grant). */
function shopMovers(st: ShopStage): Mover[] {
  return unitDeltas(st)
    .filter((d) => d.key !== st.subjectUid)
    .map((d) => ({ key: d.key, dA: d.dA, dH: d.dH, label: `${d.zone}:${d.cardId ?? d.key}` }));
}

const dist = (m: Mover, A: number, H: number): number => Math.abs(m.dA - A) + Math.abs(m.dH - H);

export function driveStatGrant(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const templates = new Set(plan.cases.filter((x) => x.driver === DRIVER).map((x) => x.template));
  const trig = stageableTrigger(c);
  const effects = statGrantEffects(c);
  if (!trig || effects.length === 0) return;

  /** Run the staging once (plain or gilded, one branch); the movers of the FIRST variant where anything moved. */
  const run = (golden: boolean, branch: number | null): { movers: Mover[]; variant: string; refused?: boolean } | null => {
    const chooseIndex = branch === null ? 0 : branch - 1;
    if (trig.phase === 'shop') {
      const stages = stageShop(c, trig.event, golden, { chooseIndex });
      if (stages.length === 0) return null;
      for (const st of stages) {
        if (st.refused) continue;
        const movers = shopMovers(st);
        if (movers.length) return { movers, variant: st.variant };
      }
      return { movers: [], variant: stages[0]!.variant, ...(stages.every((s) => s.refused) ? { refused: true } : {}) };
    }
    const stages = stageCombat(c, trig.event, golden);
    if (stages.length === 0) return null;
    for (const st of stages) {
      const movers = combatBuffs(st.sim).map((b) => ({ key: b.target, dA: b.attack, dH: b.health, label: `buff→${b.target}` }));
      if (movers.length) return { movers, variant: st.variant };
    }
    return { movers: [], variant: stages[0]!.variant };
  };

  const branches = [...new Set(effects.map((e) => e.branch))];
  let plainForGild: { movers: Mover[]; variant: string } | null = null;

  for (const branch of branches) {
    const plain = run(false, branch);
    if (!plain) return;
    if (branch === branches[0]) plainForGild = plain;
    const where = `${trig.phase}: ${plain.variant}`;
    const branchEffects = effects.filter((e) => e.branch === branch);
    const sumA = branchEffects.reduce((n, e) => n + e.attack, 0);
    const sumH = branchEffects.reduce((n, e) => n + e.health, 0);
    const stacked = branchEffects.length > 1 ? plain.movers.filter((m) => m.dA === sumA && m.dH === sumH) : [];
    const matchesEffect = (m: Mover, e: { attack: number; health: number; stated: string[] }): boolean =>
      (!e.stated.includes('attack') || m.dA === e.attack) && (!e.stated.includes('health') || m.dH === e.health);
    const unexplained = plain.movers.filter((m) => !branchEffects.some((e) => matchesEffect(m, e)) && !(m.dA === sumA && m.dH === sumH));
    // Attribution is unambiguous only when every effect of this branch is a stat claim this driver reads.
    const allClaimed = effects.length === (c.effects ?? []).length;

    for (const e of branchEffects) {
      if (plain.movers.length === 0) {
        ctx.executed.push({
          contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `${where}; no stat moved`,
          unobserved: plain.refused ? 'the play was refused by the reducer (the fixture cannot satisfy its play condition)' : `no {attack, health} delta anywhere in the ${trig.phase} surface after the trigger fired`,
        });
        continue;
      }
      const exact = plain.movers.filter((m) => matchesEffect(m, e));
      if (exact.length === 0 && stacked.length === 0 && (unexplained.length === 0 || !allClaimed)) {
        ctx.executed.push({
          contractId: c.contentId, template: 'plain', driver: DRIVER, evidence: `${where}; ${plain.movers.length} mover(s), none by +${e.attack}/+${e.health}`,
          unobserved: unexplained.length === 0
            ? `every mover is explained by the contract's other stat effects — this effect found no eligible target in the fixture (a rider the staging did not reach)`
            : `the contract also carries an amount-less effect that may own the unexplained movers (${unexplained.slice(0, 2).map((m) => `${m.label} +${m.dA}/+${m.dH}`).join(', ')}) — attribution is ambiguous, so no magnitude is asserted`,
        });
        ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `${where}; one trigger fire moved ${plain.movers.length} unit(s)` });
        continue;
      }
      const pool = unexplained.length ? unexplained : plain.movers;
      const closest = pool.reduce((b, m) => (dist(m, e.attack, e.health) < dist(b, e.attack, e.health) ? m : b));
      let observed: { dA: number; dH: number };
      let evidence: string;
      if (exact.length) {
        observed = { dA: e.attack, dH: e.health };
        evidence = `${where}; ${exact.length} unit(s) moved by exactly +${e.attack}/+${e.health} (${exact.slice(0, 3).map((m) => m.label).join(', ')})`;
      } else if (stacked.length) {
        observed = { dA: e.attack, dH: e.health };
        evidence = `${where}; ${stacked.length} unit(s) moved by +${sumA}/+${sumH} = the SUM of this branch's ${branchEffects.length} stat effects (${stacked.slice(0, 3).map((m) => m.label).join(', ')}) — read as stacked on one target`;
      } else {
        observed = { dA: closest.dA, dH: closest.dH };
        evidence = `${where}; nothing moved by +${e.attack}/+${e.health}${branchEffects.length > 1 ? ` (nor by the stacked +${sumA}/+${sumH})` : ''} — closest unexplained mover ${closest.label} moved +${closest.dA}/+${closest.dH} (${plain.movers.length} mover(s) total)`;
      }
      if (templates.has('plain')) {
        if (e.stated.includes('attack')) ctx.obs(c.contentId, `effects.${e.index}.amount.plain.attack`, observed.dA, evidence);
        if (e.stated.includes('health')) ctx.obs(c.contentId, `effects.${e.index}.amount.plain.health`, observed.dH, evidence);
        ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: DRIVER, evidence });
      }
      ctx.executed.push({
        contractId: c.contentId, template: 'minimum-activation', driver: DRIVER,
        evidence: `${where}; one trigger fire moved ${plain.movers.length} unit(s)` + (e.count !== undefined ? ` (contract count ${e.count}; ${exact.length} matched exactly — cardinality is not asserted here)` : ''),
      });
    }
  }

  if (templates.has('gilded') && plainForGild) {
    const f = gildFactor(c);
    const plain = plainForGild;
    const gilded = run(true, branches[0]!);
    if (f && gilded && plain.movers.length && gilded.movers.length) {
      const total = (ms: Mover[]): number => ms.reduce((n, m) => n + m.dA + m.dH, 0);
      const largest = (ms: Mover[]): number => ms.reduce((n, m) => Math.max(n, m.dA + m.dH), 0);
      const measure = trig.phase === 'shop' ? total : largest;
      ctx.metamorphic.push(checkMetamorphic('gilded-delta-satisfaction', c.contentId,
        `${trig.phase === 'shop' ? 'total stat delta' : 'largest single buff'} of a gilded body's activation must be plain × ${f} (declared 'multiply')`,
        () => measure(plain.movers), () => measure(gilded.movers), { kind: 'times', factor: f }));
      ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: DRIVER, evidence: `${trig.phase}: ${plain.variant}; gilded body re-staged, ×${f} law checked` });
    } else if (gilded) {
      ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: DRIVER, evidence: `${trig.phase}: ${plain.variant}; gilded body re-staged`, unobserved: 'the gilded (or plain) activation moved no stat, so no ×factor could be measured' });
    }
  }
}
