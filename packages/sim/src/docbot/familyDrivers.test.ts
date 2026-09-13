/**
 * DOC BOT 2.0 WP D — the FAMILY DRIVERS' gate + sabotage proofs (§4.5: every oracle family proves it can fail).
 *
 * The contract oracle's family drivers (drivers/*.ts — stat-grant, card-grant, economy, keyword-grant,
 * equipment, vanilla-body, activation) took `no-driver-for-shape` from 471 applicable cases to under 150 on
 * 2026-09-11. A driver that could not FAIL would be theatre, so each one is sabotaged here the way
 * contractOracle.test.ts / missDrivenOracles.test.ts do it: a doctored contract (the intent leg) or a
 * doctored staging subject (the engine leg) that the driver MUST catch — as a mismatch, a broken metamorphic
 * law, a failed limit check, or a 'runtime-unobserved' skip that refuses to count as an execution.
 *
 * Runtime: the whole file stages a few dozen reducer plays and small fights — well under a second.
 */
import { describe, expect, it } from 'vitest';
import { allContracts } from '@game/rules/contracts';
import { CARD_INDEX } from '@game/content';
import type { ContentContract } from '@game/rules/contracts/schema';
import { runContractSweep } from './contractOracle';
import { planCases } from './isolatedCases';
import { familiesOf, statGrantEffects, cardGrantEffects, economyEffects, keywordGrantEffects, equipmentEffects, isVanillaContract } from './drivers/families';
import { stageShop, stageCombat, unitDeltas, gainedCards } from './drivers/shared';
import { PLAY_EXCUSED } from './historyRegistry';

const CONTRACTS = allContracts();
const byId = new Map(CONTRACTS.map((c) => [c.contentId, c]));

/** The first contract of one family whose plain case the sweep OBSERVED (a subject the fixture can drive). */
function observedSubject(family: string, pick: (c: ContentContract) => boolean = () => true): ContentContract {
  const candidates = CONTRACTS.filter((c) => familiesOf(c).includes(family as never) && pick(c));
  const sweep = runContractSweep({ contracts: candidates });
  const ok = sweep.executed.find((e) => e.driver === family && (e.template === 'plain' || family === 'keyword-grant' || family === 'activation') && !e.unobserved);
  expect(ok, `no observed ${family} subject — the family driver never fires in this content state`).toBeDefined();
  return byId.get(ok!.contractId)!;
}

const sweepOne = (c: ContentContract) => runContractSweep({ contracts: [c] });

describe('family drivers — every family has subjects and the planner routes them', () => {
  it('each family claims at least one contract, and the planner gives every claimed contract executable cases', () => {
    const SHAPE = ['combat-death-summon', 'avenge-threshold', 'shop-battlecry-summon', 'copy-policy', 'gilded-shape'];
    for (const fam of ['stat-grant', 'card-grant', 'economy', 'keyword-grant', 'equipment', 'vanilla-body', 'activation'] as const) {
      const claimed = CONTRACTS.filter((c) => familiesOf(c).includes(fam));
      expect(claimed.length, `family ${fam} claims no contract`).toBeGreaterThan(0);
      for (const c of claimed) {
        const plan = planCases(c);
        // An object-shape driver (a death summon with a stat rider, say) keeps its contract — the family is
        // only planned where no shape driver claimed it.
        if (plan.cases.some((x) => SHAPE.includes(x.driver)) || plan.skipped.some((s) => s.reason === 'covered-by-slice-oracle')) continue;
        expect(plan.cases.some((x) => x.driver === fam), `${c.contentId}: ${fam} claimed but not planned`).toBe(true);
      }
    }
  });

  it('the families are disjoint from the object-shape drivers (a contract those own is never re-planned here)', () => {
    for (const c of CONTRACTS) {
      const plan = planCases(c);
      const shape = plan.cases.some((x) => ['combat-death-summon', 'avenge-threshold', 'shop-battlecry-summon', 'copy-policy', 'gilded-shape'].includes(x.driver));
      const family = plan.cases.some((x) => ['stat-grant', 'card-grant', 'economy', 'keyword-grant', 'equipment', 'vanilla-body', 'activation'].includes(x.driver));
      expect(shape && family, `${c.contentId} is planned by both an object-shape driver and a family driver`).toBe(false);
    }
  });

  it('an unobserved record is a SKIP, never an execution (§4.3)', () => {
    const sweep = runContractSweep({ contracts: CONTRACTS });
    const unobserved = sweep.executed.filter((e) => e.unobserved);
    expect(unobserved.length, 'some case must be honestly unobserved in this content state').toBeGreaterThan(0);
    // Every unobserved (contract, template) that no OTHER record observed must be counted under runtime-unobserved.
    const observedKeys = new Set(sweep.executed.filter((e) => !e.unobserved).map((e) => `${e.contractId}|${e.template}`));
    const purelyUnobserved = unobserved.filter((e) => !observedKeys.has(`${e.contractId}|${e.template}`));
    expect(sweep.skippedByReason['runtime-unobserved'] ?? 0).toBeGreaterThanOrEqual(new Set(purelyUnobserved.map((e) => `${e.contractId}|${e.template}`)).size);
  });
});

describe('family drivers — sabotage (§4.5)', () => {
  it('stat-grant: a doctored AMOUNT is a mismatch at the effect path (the engine measured the real number)', () => {
    const subject = observedSubject('stat-grant', (c) => statGrantEffects(c).some((e) => e.stated.includes('attack') && e.attack > 0) && !(c.tags ?? []).includes('choose-one'));
    const claim = statGrantEffects(subject).find((e) => e.stated.includes('attack') && e.attack > 0)!;
    const doctored = structuredClone(subject);
    (doctored.effects![claim.index]!.amount as { plain: Record<string, number> }).plain.attack = claim.attack + 7;
    const r = sweepOne(doctored);
    const m = r.mismatches.find((x) => x.path === `effects.${claim.index}.amount.plain.attack`);
    expect(m, `doctored +7 Attack on ${subject.contentId} must mismatch`).toBeDefined();
    expect(m!.expected).toBe(claim.attack + 7);
    expect(m!.observed).toBe(claim.attack);
    expect(sweepOne(subject).mismatches, 'the undoctored contract agrees').toEqual([]);
  });

  it('stat-grant: a doctored GILDED factor breaks the metamorphic law', () => {
    const subject = observedSubject('stat-grant', (c) => c.gildedDelta?.kind === 'multiply' && c.contentType !== 'spell' && !(c.tags ?? []).includes('choose-one'));
    const base = sweepOne(subject);
    const law = base.metamorphic.find((m) => m.law === 'gilded-delta-satisfaction');
    if (!law || !law.diff.ok) {
      // Pick a subject whose gilded law actually ran and held.
      const subjects = CONTRACTS.filter((c) => familiesOf(c).includes('stat-grant') && c.gildedDelta?.kind === 'multiply' && c.contentType !== 'spell' && !(c.tags ?? []).includes('choose-one'));
      const held = subjects.find((c) => sweepOne(c).metamorphic.some((m) => m.law === 'gilded-delta-satisfaction' && m.diff.ok))!;
      expect(held, 'some stat-grant subject holds the ×2 law').toBeDefined();
      const doctored = structuredClone(held);
      doctored.gildedDelta = { kind: 'multiply', factor: 3, description: 'sabotage' };
      expect(sweepOne(doctored).metamorphic.find((m) => m.law === 'gilded-delta-satisfaction')!.diff.ok, 'factor 3 must fail against a measured ×2').toBe(false);
      return;
    }
    const doctored = structuredClone(subject);
    doctored.gildedDelta = { kind: 'multiply', factor: 3, description: 'sabotage' };
    expect(sweepOne(doctored).metamorphic.find((m) => m.law === 'gilded-delta-satisfaction')!.diff.ok, 'factor 3 must fail against a measured ×2').toBe(false);
  });

  it('card-grant: a doctored REF (the wrong card named) and a doctored COUNT are both mismatches', () => {
    const withRef = observedSubject('card-grant', (c) => cardGrantEffects(c).some((x) => x.refs?.length === 1 && !x.implicitOne));
    const claim = cardGrantEffects(withRef).find((x) => x.refs?.length === 1)!;
    const doctored = structuredClone(withRef);
    doctored.effects![claim.index]!.refs = ['sandbag']; // the engine hands over the real card, never a sandbag
    const r = sweepOne(doctored);
    const m = r.mismatches.find((x) => x.path === `effects.${claim.index}.refs`);
    expect(m, `doctored ref on ${withRef.contentId} must mismatch`).toBeDefined();
    expect(m!.expected).toEqual(['sandbag']);

    const withCount = observedSubject('card-grant', (c) => cardGrantEffects(c).some((x) => x.count !== undefined && !x.implicitOne));
    const cc = cardGrantEffects(withCount).find((x) => x.count !== undefined)!;
    const doctoredCount = structuredClone(withCount);
    (doctoredCount.effects![cc.index]!.amount as { plain: Record<string, number> }).plain.count = cc.count! + 5;
    const mc = sweepOne(doctoredCount).mismatches.find((x) => x.path === `effects.${cc.index}.amount.plain.count`);
    expect(mc, `doctored count on ${withCount.contentId} must mismatch`).toBeDefined();
    expect(mc!.expected).toBe(cc.count! + 5);
  });

  it('economy: a doctored Gold amount is a mismatch on the field that actually moved', () => {
    const subject = observedSubject('economy');
    const claim = economyEffects(subject)[0]!;
    const doctored = structuredClone(subject);
    (doctored.effects![claim.index]!.amount as { plain: Record<string, number> }).plain[claim.key] = claim.value + 9;
    const m = sweepOne(doctored).mismatches.find((x) => x.path === `effects.${claim.index}.amount.plain.${claim.key}`);
    expect(m, `doctored ${claim.key} on ${subject.contentId} must mismatch`).toBeDefined();
    expect(m!.expected).toBe(claim.value + 9);
    expect(m!.observed).toBe(claim.value);
  });

  it('keyword-grant: a contract that CLAIMS a keyword grant on a body that grants none is unobserved, not executed', () => {
    const subject = observedSubject('keyword-grant');
    expect(keywordGrantEffects(subject).length).toBeGreaterThan(0);
    // The engine leg: keep the claim, swap the staged body for a vanilla token that grants nothing.
    const doctored = { ...structuredClone(subject), contentId: 'omen' };
    const r = sweepOne(doctored);
    const rec = r.executed.filter((e) => e.driver === 'keyword-grant');
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.every((e) => e.unobserved), 'a vanilla body must NOT count as a keyword-grant execution').toBe(true);
    expect(r.templateTotals['minimum-activation'].executed).toBe(0);
    expect(r.skippedByReason['runtime-unobserved'] ?? 0).toBeGreaterThan(0);
  });

  it('equipment: the granted Equipment identity is checked (a body that grants none fails to execute)', () => {
    const subject = CONTRACTS.find((c) => equipmentEffects(c).length > 0)!;
    expect(subject).toBeDefined();
    const good = sweepOne(subject);
    expect(good.limitChecks.find((l) => l.limit === 'equipment-identity')?.ok).toBe(true);
    const doctored = { ...structuredClone(subject), contentId: 'omen' };
    const r = sweepOne(doctored);
    expect(r.executed.filter((e) => e.driver === 'equipment').every((e) => e.unobserved)).toBe(true);
  });

  it('vanilla-body: a contract that HIDES a real effect (states none) is caught as unstated behaviour', () => {
    // Take an effectful Shout minion the fixture can play, and strip its contract to a vanilla claim. A PLAY_EXCUSED
    // card is one the clean fixture CANNOT exercise (its Shout needs a condition the fixture never stages — Shooting
    // Star's spells-this-turn, 2026-09-12), so it can never surface a hidden effect here: skip those.
    const effectful = CONTRACTS.find((c) => c.contentType === 'minion' && (c.effects ?? []).some((e) => /^battlecryBuff/.test(e.kind))
      && (c.triggers ?? []).some((t) => t.event === 'onPlay') && !(c.tags ?? []).includes('choose-one') && !!CARD_INDEX[c.contentId]
      && !PLAY_EXCUSED[c.contentId])!;
    expect(effectful).toBeDefined();
    const doctored: ContentContract = { ...structuredClone(effectful), triggers: [], effects: [] };
    delete (doctored as { multiplier?: unknown }).multiplier;
    expect(isVanillaContract(doctored) || familiesOf(doctored).includes('vanilla-body')).toBe(true);
    const r = sweepOne(doctored);
    const m = r.mismatches.find((x) => x.path === 'effects');
    expect(m, `a hidden Shout on ${effectful.contentId} must surface as unstated behaviour`).toBeDefined();
    expect(String(m!.observed)).toContain('unstated behaviour');
    // And a genuinely vanilla body agrees.
    const vanilla = CONTRACTS.find((c) => isVanillaContract(c) && c.contentId === 'omen') ?? CONTRACTS.find(isVanillaContract)!;
    expect(sweepOne(vanilla).mismatches).toEqual([]);
  });

  it('activation: a claimed effect on a body that does nothing is unobserved, never executed', () => {
    const subject = observedSubject('activation');
    const doctored = { ...structuredClone(subject), contentId: 'omen' };
    const r = sweepOne(doctored);
    const rec = r.executed.filter((e) => e.driver === 'activation');
    expect(rec.length).toBeGreaterThan(0);
    expect(rec.every((e) => e.unobserved), 'a vanilla body must NOT count as an activation').toBe(true);
    expect(r.templateTotals['minimum-activation'].executed).toBe(0);
    // Its magnitude template is a TYPED skip, never an execution, even on the real subject.
    const plan = planCases(subject);
    expect(plan.skipped.some((s) => s.template === 'plain' && (s.reason === 'contract-states-no-magnitude' || s.reason === 'no-driver-for-shape'))).toBe(true);
  });

  it('staging: a baseline-subtracted shop stage attributes nothing to a vanilla body, and a Rally fixture fires ONE Rally', () => {
    const omen = byId.get('omen')!;
    for (const st of stageShop(omen, 'onPlay', false)) {
      expect(st.refused).toBeFalsy();
      expect(unitDeltas(st), 'a vanilla play moves no stat once the baseline is subtracted').toEqual([]);
      expect(gainedCards(st).filter((g) => g.uid !== st.sourceUid), 'a vanilla play grants no card').toEqual([]);
    }
    // One-activation contract: the 0/1 sandbag dies to the first swing.
    const rally = CONTRACTS.find((c) => (c.triggers ?? []).some((t) => t.event === 'onAttack') && familiesOf(c).includes('card-grant'))!;
    const st = stageCombat(rally, 'onAttack', false)[0]!;
    const attacks = st.sim.events.filter((e) => e.type === 'attack' && (e as { attacker: string }).attacker === st.sim.initial.player[0]!.uid);
    expect(attacks.length, 'exactly one Rally activation per staged fight').toBe(1);
  });
});
