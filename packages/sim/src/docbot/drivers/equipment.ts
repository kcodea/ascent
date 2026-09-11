/**
 * FAMILY DRIVER — EQUIPMENT (`equip` → `grantEquipment`): the Set 3 Equipment cards hand the PLAYER an
 * Equipment entry as they enter play (resolved before the Shout, on its own beat — recruit.ts). The contract
 * cannot state the equipment id (a string the extractor lists under `unparsed`), so the driver reads it off
 * the card's own effect params, plays the body through the real reducer, and verifies that exactly that
 * Equipment is now available — activation plus identity, recorded as evidence. A gilded source over an empty
 * slot grants the gilded entry (`equipIsNews`), which the gilded template records.
 */
import { CARD_INDEX } from '@game/content';
import type { ContentContract } from '@game/rules/contracts/schema';
import type { CasePlan } from '../isolatedCases';
import { equipmentEffects } from './families';
import { stageShop, type DriverCtx } from './shared';

export const DRIVER = 'equipment';

export function driveEquipment(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const templates = new Set(plan.cases.filter((x) => x.driver === DRIVER).map((x) => x.template));
  const def = CARD_INDEX[c.contentId];
  if (!def || equipmentEffects(c).length === 0) return;
  const wanted = def.effects.filter((e) => e.on === 'equip').map((e) => String((e.params as { equipmentId?: string } | undefined)?.equipmentId ?? ''));

  const measure = (golden: boolean): { ids: string[]; gilded: boolean[]; refused: boolean } => {
    const st = stageShop(c, 'equip', golden)[0];
    if (!st || st.refused) return { ids: [], gilded: [], refused: true };
    const before = new Set((st.before.equipment?.available ?? []).map((g) => g.equipmentId));
    const gained = (st.after.equipment?.available ?? []).filter((g) => !before.has(g.equipmentId));
    return { ids: gained.map((g) => g.equipmentId), gilded: gained.map((g) => !!(g as { golden?: boolean }).golden), refused: false };
  };

  const plain = measure(false);
  const hit = wanted.every((id) => plain.ids.includes(id));
  if (plain.refused || plain.ids.length === 0) {
    ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `reducer: played ${c.contentId}; no Equipment granted`, unobserved: plain.refused ? 'the play was refused by the reducer' : `no Equipment entry appeared (expected '${wanted.join("','")}')` });
    return;
  }
  const evidence = `reducer: playing ${c.contentId} granted Equipment '${plain.ids.join("','")}' (card params name '${wanted.join("','")}' — ${hit ? 'match' : 'MISMATCH'})`;
  ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence });
  if (templates.has('plain')) {
    // The identity is checked as a limit-style verdict (the contract has no field to address it at).
    ctx.limitChecks.push({ contractId: c.contentId, limit: 'equipment-identity', ok: hit, detail: evidence });
    ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: DRIVER, evidence });
  }
  if (templates.has('gilded')) {
    const g = measure(true);
    ctx.executed.push({
      contractId: c.contentId, template: 'gilded', driver: DRIVER,
      evidence: `reducer: the gilded ${c.contentId} granted '${g.ids.join("','")}' (gilded flags: ${g.gilded.join(',')})`,
      ...(g.ids.length === 0 ? { unobserved: 'the gilded play granted no Equipment' } : {}),
    });
  }
}
