/**
 * FAMILY DRIVER — ECONOMY: "gain N Gold", "gain N Gold next turn", "raise your max Gold by N", "gain N
 * Armor", "N free refreshes" — every effect whose contract states a single economic magnitude.
 *
 * Claim shape driven: a kind naming an economy axis (gold / ember / mana / armor / roll) whose const amount
 * is exactly one of {amount, gold, count} (a second key means a rate or a threshold — not driven here).
 *
 * Measurement (shop): every top-level numeric run field is diffed before/after the staged trigger, the Gold
 * the staging itself spent (a spell's cost, an offer's price) is added back to `embers`, and the contract's
 * N must appear as an exact delta on one of the economy fields (`embers`, `bonusEmbersNextTurn`, `maxEmbers`,
 * `maxGoldBonus`, `armor`, `freeRolls`, …). Observed at `effects.<i>.amount.plain.<key>` as the delta of the
 * field that moved (the closest mover when none matched exactly — visible, never rounded away). In combat the
 * only economy channel a driver can read is the `maxGold` event.
 * Gilded: N × the declared factor, metamorphic, over the same field.
 */
import type { ContentContract } from '@game/rules/contracts/schema';
import type { CasePlan } from '../isolatedCases';
import { checkMetamorphic } from '../variantDiff';
import { economyEffects, gildFactor, stageableTrigger } from './families';
import { combatMaxGold, numericFieldDeltas, stageCombat, stageShop, type DriverCtx } from './shared';

export const DRIVER = 'economy';

const ECON_FIELD = /ember|gold|mana|armor|roll|refresh/i;

export function driveEconomy(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const templates = new Set(plan.cases.filter((x) => x.driver === DRIVER).map((x) => x.template));
  const trig = stageableTrigger(c);
  const claims = economyEffects(c);
  if (!trig || claims.length === 0) return;

  /** The economy field deltas of the first variant where an economy field moved. */
  const run = (golden: boolean, branch: number | null): { deltas: Record<string, number>; variant: string; refused?: boolean } | null => {
    const chooseIndex = branch === null ? 0 : branch - 1;
    if (trig.phase === 'shop') {
      const stages = stageShop(c, trig.event, golden, { chooseIndex });
      if (stages.length === 0) return null;
      for (const st of stages) {
        if (st.refused) continue;
        const raw = numericFieldDeltas(st);
        const deltas: Record<string, number> = {};
        for (const [k, v] of Object.entries(raw)) if (ECON_FIELD.test(k) && !/Fx|Seq|Spent|ThisTurn|Tick/.test(k)) deltas[k] = v;
        if (st.costPaid) deltas.embers = (deltas.embers ?? 0) + st.costPaid;
        if (deltas.embers === 0) delete deltas.embers;
        if (Object.keys(deltas).length) return { deltas, variant: st.variant };
      }
      return { deltas: {}, variant: stages[0]!.variant, ...(stages.every((s) => s.refused) ? { refused: true } : {}) };
    }
    const stages = stageCombat(c, trig.event, golden);
    if (stages.length === 0) return null;
    for (const st of stages) {
      const mg = combatMaxGold(st.sim);
      if (mg) return { deltas: { maxGold: mg }, variant: st.variant };
    }
    return { deltas: {}, variant: stages[0]!.variant };
  };

  // One staging per Choose One branch (the player picks ONE); the gilded law reads the first branch.
  const branches = [...new Set(claims.map((x) => x.branch))];
  const plainByBranch = new Map(branches.map((b) => [b, run(false, b)] as const));
  const plain = plainByBranch.get(branches[0]!) ?? null;
  if (!plain) return;
  const fields = Object.entries(plain.deltas);

  for (const cl of claims) {
    const p = plainByBranch.get(cl.branch);
    if (!p) return;
    const where = `${trig.phase}: ${p.variant}`;
    const fields = Object.entries(p.deltas);
    if (fields.length === 0) {
      ctx.executed.push({
        contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `${where}; no economy field moved`,
        unobserved: p.refused ? 'the play was refused by the reducer (the fixture cannot satisfy its play condition)' : `no economy field (embers / bonusEmbersNextTurn / maxEmbers / armor / …) moved after the trigger fired (expected ${cl.key} ${cl.value})`,
      });
      continue;
    }
    const exact = fields.find(([, v]) => v === cl.value);
    const closest = exact ?? fields.reduce((b, f) => (Math.abs(f[1] - cl.value) < Math.abs(b[1] - cl.value) ? f : b));
    const evidence = exact
      ? `${where}; ${exact[0]} moved by exactly ${exact[1]} (staging cost added back: ${fields.map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')})`
      : `${where}; no economy field moved by ${cl.value} — closest ${closest[0]} moved ${closest[1]} (all: ${fields.map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')})`;
    if (templates.has('plain')) {
      ctx.obs(c.contentId, `effects.${cl.index}.amount.plain.${cl.key}`, closest[1], evidence);
      ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: DRIVER, evidence });
    }
    ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `${where}; one trigger fire moved ${fields.map(([k]) => k).join(', ')}` });
  }

  if (templates.has('gilded')) {
    const f = gildFactor(c);
    const gilded = run(true, branches[0]!);
    const cl = claims[0]!;
    const where = `${trig.phase}: ${plain.variant}`;
    const pf = fields.find(([, v]) => v === cl.value)?.[0] ?? fields[0]?.[0];
    if (f && gilded && pf && gilded.deltas[pf] !== undefined) {
      ctx.metamorphic.push(checkMetamorphic('gilded-delta-satisfaction', c.contentId,
        `${pf} delta of a gilded body's activation must be plain × ${f} (declared 'multiply')`,
        () => plain.deltas[pf]!, () => gilded.deltas[pf]!, { kind: 'times', factor: f }));
      ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: DRIVER, evidence: `${where}; gilded body re-staged, ×${f} law checked on ${pf}` });
    } else if (gilded) {
      ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: DRIVER, evidence: `${where}; gilded body re-staged`, unobserved: 'the economy field did not move in the gilded (or plain) activation, so no ×factor could be measured' });
    }
  }
}
