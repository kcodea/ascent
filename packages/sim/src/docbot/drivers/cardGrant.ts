/**
 * FAMILY DRIVER — CARD GRANT / SUMMON: "get a <named card>", "get N random <tier> minions / spells / Ales",
 * "Discover a …", "summon N <token>" — every effect that puts a NEW card somewhere (hand, board, tavern) and
 * whose contract states either the card it grants (`refs`) or how many (`count`), or both.
 *
 * Claim shapes driven:
 *  · `refs` on a grant-shaped kind (not a Cast / Transform / Steal / Destroy / Consume kind — those reference
 *    a card without granting it): the named card must arrive. Observed at `effects.<i>.refs` as the sorted
 *    distinct ids that arrived; a wrong card or none is a visible mismatch.
 *  · `count` with keys within {count, tier, tierOffset}: exactly `count` cards must arrive (of the ref when
 *    one is named, else of anything). Observed at `effects.<i>.amount.plain.count`. When a branch states
 *    SEVERAL unnamed counts (Deep Chef: "a Tier 1, Tier 3 and Tier 5 minion" is three count-1 effects), the
 *    arrivals must equal their SUM and each effect is then observed at its own count.
 *  · a combat summon kind with `count` but no `summons` field (random-tribe / copy summons the extractor
 *    could not name): `count` player-side summon events from ONE activation (the fixtures fire once).
 * Gilded: count × the declared factor, as a metamorphic law over the arrival count.
 */
import type { ContentContract } from '@game/rules/contracts/schema';
import type { CasePlan } from '../isolatedCases';
import { checkMetamorphic } from '../variantDiff';
import { cardGrantEffects, gildFactor, stageableTrigger } from './families';
import { combatSummons, combatToHand, gainedCards, stageCombat, stageShop, type DriverCtx } from './shared';

export const DRIVER = 'card-grant';

export function driveCardGrant(c: ContentContract, plan: CasePlan, ctx: DriverCtx): void {
  const templates = new Set(plan.cases.filter((x) => x.driver === DRIVER).map((x) => x.template));
  const trig = stageableTrigger(c);
  const claims = cardGrantEffects(c);
  if (!trig || claims.length === 0) return;

  /** Arrivals (card ids) of the first variant where anything arrived, for one branch. */
  const run = (golden: boolean, branch: number | null): { arrived: string[]; variant: string; refused?: boolean } | null => {
    const chooseIndex = branch === null ? 0 : branch - 1;
    if (trig.phase === 'shop') {
      const stages = stageShop(c, trig.event, golden, { chooseIndex });
      if (stages.length === 0) return null;
      for (const st of stages) {
        if (st.refused) continue;
        // The subject a watcher was fed is an arrival on the board, not a grant — exclude it; so is the
        // contract's own body arriving on the board from hand (same uid, so `gainedCards` never lists it).
        const arrived = gainedCards(st).filter((g) => g.uid !== st.subjectUid && g.uid !== st.sourceUid).map((g) => g.cardId);
        if (arrived.length) return { arrived, variant: st.variant };
      }
      return { arrived: [], variant: stages[0]!.variant, ...(stages.every((s) => s.refused) ? { refused: true } : {}) };
    }
    const stages = stageCombat(c, trig.event, golden);
    if (stages.length === 0) return null;
    for (const st of stages) {
      // Wolves' Den's own three wolves feed the onSummon fixture — they are not the contract's grant.
      const arrived = [...combatSummons(st.sim, st.sourceCardId).filter((id) => !(trig.event === 'onSummon' && id === 'cryptwolf')), ...combatToHand(st.sim, st.sourceCardId)];
      if (arrived.length) return { arrived, variant: st.variant };
    }
    return { arrived: [], variant: stages[0]!.variant };
  };

  const branches = [...new Set(claims.map((x) => x.branch))];
  let plainForGild: { arrived: string[]; variant: string } | null = null;

  for (const branch of branches) {
    const plain = run(false, branch);
    if (!plain) return;
    if (branch === branches[0]) plainForGild = plain;
    const where = `${trig.phase}: ${plain.variant}`;
    const branchClaims = claims.filter((x) => x.branch === branch);
    const unnamed = branchClaims.filter((x) => !x.refs && x.count !== undefined);
    const unnamedSum = unnamed.reduce((n, x) => n + x.count!, 0);
    const namedArrivals = plain.arrived.filter((id) => branchClaims.some((x) => x.refs?.includes(id)));
    const unnamedArrivals = plain.arrived.length - namedArrivals.length;
    const stackedOk = unnamed.length > 1 && unnamedArrivals === unnamedSum;

    for (const cl of branchClaims) {
      if (plain.arrived.length === 0) {
        ctx.executed.push({
          contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `${where}; nothing arrived`,
          unobserved: plain.refused ? 'the play was refused by the reducer (the fixture cannot satisfy its play condition)' : `no card arrived in hand/board/tavern after the trigger fired (${cl.refs ? `expected '${cl.refs.join("','")}'` : `expected ${cl.count}`})`,
        });
        continue;
      }
      const ofRefs = cl.refs ? plain.arrived.filter((id) => cl.refs!.includes(id)) : plain.arrived.filter((id) => !branchClaims.some((x) => x.refs?.includes(id)));
      let evidence = `${where}; arrived: ${plain.arrived.join(', ')}`;
      if (cl.implicitOne) {
        // A Discover yields exactly one card by construction — checked as a limit-style verdict, since the
        // contract has no count field to address it at.
        const ok = ofRefs.length === 1 || (unnamed.length === 0 && plain.arrived.length === branchClaims.filter((x) => x.implicitOne).length);
        ctx.limitChecks.push({ contractId: c.contentId, limit: 'discover-yields-one', ok, detail: `${evidence} — a Discover must hand over exactly one card (${ofRefs.length} unnamed arrival(s) for ${branchClaims.filter((x) => x.implicitOne).length} Discover effect(s))` });
        if (templates.has('plain')) ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: DRIVER, evidence: `${evidence} — the Discover's pick reached the hand (first offer taken)` });
        ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `${where}; the Discover opened and its pick arrived` });
        continue;
      }
      if (templates.has('plain')) {
        if (cl.refs) {
          ctx.obs(c.contentId, `effects.${cl.index}.refs`, ofRefs.length ? [...new Set(ofRefs)].sort() : [...new Set(plain.arrived)].sort(), evidence);
        }
        if (cl.count !== undefined) {
          if (!cl.refs && stackedOk) {
            evidence += ` — ${unnamedArrivals} unnamed arrival(s) = the SUM of this branch's ${unnamed.length} counted grants, read as ${cl.count} for this effect`;
            ctx.obs(c.contentId, `effects.${cl.index}.amount.plain.count`, cl.count, evidence);
          } else {
            ctx.obs(c.contentId, `effects.${cl.index}.amount.plain.count`, ofRefs.length, evidence);
          }
        }
        ctx.executed.push({ contractId: c.contentId, template: 'plain', driver: DRIVER, evidence });
      }
      ctx.executed.push({ contractId: c.contentId, template: 'minimum-activation', driver: DRIVER, evidence: `${where}; one trigger fire granted ${plain.arrived.length} card(s)` });
    }
  }

  if (templates.has('gilded') && plainForGild) {
    const f = gildFactor(c);
    const plain = plainForGild;
    const gilded = run(true, branches[0]!);
    if (f && gilded && plain.arrived.length && gilded.arrived.length) {
      ctx.metamorphic.push(checkMetamorphic('gilded-delta-satisfaction', c.contentId,
        `cards granted by a gilded body's activation must be plain × ${f} (declared 'multiply')`,
        () => plain.arrived.length, () => gilded.arrived.length, { kind: 'times', factor: f }));
      ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: DRIVER, evidence: `${trig.phase}: ${plain.variant}; gilded body re-staged, ×${f} law checked on the arrival count` });
    } else if (gilded) {
      ctx.executed.push({ contractId: c.contentId, template: 'gilded', driver: DRIVER, evidence: `${trig.phase}: ${plain.variant}; gilded body re-staged`, unobserved: 'no arrival in the gilded (or plain) activation, so no ×factor could be measured' });
    }
  }
}
