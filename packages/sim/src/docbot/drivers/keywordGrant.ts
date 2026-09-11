/**
 * FAMILY DRIVER — KEYWORD GRANT: "give a minion Taunt / Ward / Reborn / Magnetic / Shield", "next combat
 * your minions have …". The extractor lists the keyword string under `extraction.unparsed` (it is neither a
 * number nor a card id), so the contract states the FAMILY (the kind) but no magnitude — the driver can
 * verify ACTIVATION (a keyword arrived on a player unit, or is queued for next combat) and record which
 * keyword, but has no declared value to compare, so it never writes an observation the comparator could
 * mistake for a magnitude check. Gilded is typed 'gild-shape-not-countable' by the planner: a keyword has no
 * ×2.
 */
import type { ContentContract } from '@game/rules/contracts/schema';
import type { CasePlan } from '../isolatedCases';
import { keywordGrantEffects, stageableTrigger } from './families';
import { combatKeywords, gainedKeywords, stageCombat, stageShop, type DriverCtx } from './shared';

export const DRIVER = 'keyword-grant';

export function driveKeywordGrant(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const templates = new Set(plan.cases.filter((x) => x.driver === DRIVER).map((x) => x.template));
  if (!templates.has('minimum-activation')) return;
  const trig = stageableTrigger(c);
  if (!trig || keywordGrantEffects(c).length === 0) return;

  let granted: string[] = [];
  let variant = '';
  let refused = false;
  if (trig.phase === 'shop') {
    const stages = stageShop(c, trig.event, false);
    if (stages.length === 0) return;
    variant = stages[0]!.variant;
    refused = stages.every((s) => s.refused);
    for (const st of stages) {
      if (st.refused) continue;
      const g = gainedKeywords(st).filter((k) => k.key !== st.subjectUid);
      if (g.length) { granted = g.map((k) => `${k.keyword}→${k.key}`); variant = st.variant; break; }
    }
  } else {
    const stages = stageCombat(c, trig.event, false);
    if (stages.length === 0) return;
    variant = stages[0]!.variant;
    for (const st of stages) {
      const g = combatKeywords(st.sim);
      if (g.length) { granted = g.map((k) => `${k.keyword}→${k.target}`); variant = st.variant; break; }
    }
  }
  const where = `${trig.phase}: ${variant}`;
  if (granted.length === 0) {
    ctx.executed.push({
      contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `${where}; no keyword arrived`,
      unobserved: refused ? 'the play was refused by the reducer (the fixture cannot satisfy its play condition)' : 'no player unit gained a keyword (and none was queued for next combat) after the trigger fired',
    });
    return;
  }
  ctx.executed.push({
    contractId: c.contentId, template: 'minimum-activation', driver: DRIVER,
    evidence: `${where}; keyword(s) granted: ${granted.slice(0, 4).join(', ')} — activation verified; the contract states no keyword value to compare (extractor lists it under unparsed)`,
  });
}
