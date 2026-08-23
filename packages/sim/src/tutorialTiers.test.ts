/**
 * THE TUTORIAL'S TIER LADDER — the course must reach Tier 6 by the end (owner ask 2026-08-22).
 *
 * Each tier step is HARD-GATED, so an unaffordable one does not read as "expensive", it soft-locks the
 * course: the coach demands an upgrade the player cannot buy and no other verb is allowed. That is the risk
 * these tests exist for — the ladder itself is one number per step, but the BUDGET is what breaks.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { CONFIG, LEARN_ASCENT, type TutorialStep } from './index';

/** Every `tierAtLeast` the course asks for, in round order. */
const ladder = LEARN_ASCENT.turns.flatMap((t) =>
  t.steps
    .filter((s): s is TutorialStep & { completion: { kind: 'tierAtLeast'; tier: number } } => s.completion.kind === 'tierAtLeast')
    .map((s) => ({ turn: t.turn, tier: s.completion.tier })),
);

describe('the tier ladder', () => {
  it('climbs to Tier 6 by the final round', () => {
    expect(ladder.at(-1)!.tier, 'the course must finish at the top tier').toBe(6);
    expect(ladder.at(-1)!.turn, 'reached before the last round, so it is played at Tier 6').toBeLessThan(LEARN_ASCENT.turns.length);
  });

  it('asks for every tier in order, never skipping one', () => {
    expect(ladder.map((l) => l.tier)).toEqual([2, 3, 4, 5, 6]);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i]!.turn, 'each step is on a later round than the last').toBeGreaterThan(ladder[i - 1]!.turn);
    }
  });

  it('never puts a tier step on a Runeforge round', () => {
    // Rounds 6 and 9 already spend on a minion AND a rune; an upgrade on top does not fit in 10 Gold.
    const forgeRounds = LEARN_ASCENT.turns.filter((t) => t.runeOffer).map((t) => t.turn);
    for (const l of ladder) expect(forgeRounds, `round ${l.turn} has both a forge and a tier step`).not.toContain(l.turn);
  });

  it('every step is AFFORDABLE alongside what its round already forces you to buy', () => {
    // The real rules: the tutorial pays a flat allowance each round, an unspent upgrade gets 1 cheaper per
    // wave, and buying one re-bases the price to the next tier's.
    const GOLD = CONFIG.embersCap;
    let cost = CONFIG.upgradeCost[2]!;
    let tier = 1;
    for (let turn = 1; turn <= LEARN_ASCENT.turns.length; turn++) {
      if (turn > 1) cost = Math.max(CONFIG.upgradeCostFloor, cost - CONFIG.upgradeDiscountPerWave);
      const t = LEARN_ASCENT.turns[turn - 1]!;
      // What the round's own hard-gated steps already commit: each `bought` step is a card at its price, and
      // each coached `refreshed` step is a paid reroll (Round 7 buys one to SHOW what tiering up unlocked).
      const forced = t.steps.reduce((sum, s) => {
        if (s.completion.kind === 'bought') return sum + (CARD_INDEX[(s.completion as { cardId: string }).cardId]?.cost ?? CONFIG.minionCost);
        if (s.completion.kind === 'refreshed') return sum + CONFIG.refreshCost;
        return sum;
      }, 0);
      const step = ladder.find((l) => l.turn === turn);
      if (!step) continue;
      expect(forced + cost, `round ${turn}: buys (${forced}g) + upgrade (${cost}g) exceeds the ${GOLD}g allowance`).toBeLessThanOrEqual(GOLD);
      tier = step.tier;
      cost = CONFIG.upgradeCost[tier + 1] ?? 0;
    }
    expect(tier).toBe(6);
  });

  it('every tier step SPOTLIGHTS the tavern-up button', () => {
    // Owner report 2026-08-23: step 31 (Reach Tier 3) named the button and highlighted nothing. `noScrim`
    // reads like a dimming preference, but the controller drops the dim AND the spotlight together — so a
    // hard-gated "click this control" step must not set it. Asserted on the ANCHOR and the scrim together,
    // because either one alone leaves the player with no highlight: an anchor with no scrim draws no cutout,
    // and a scrim with no anchor dims the board around nothing.
    const steps = LEARN_ASCENT.turns.flatMap((t) => t.steps).filter((s) => s.completion.kind === 'tierAtLeast');
    expect(steps.length).toBe(5);
    for (const s of steps) {
      const ui = s.anchors.filter((a) => a.kind === 'ui').map((a) => (a as { id: string }).id);
      expect(ui, `${s.id} does not point at the tavern-up button`).toContain('tavern-up');
      expect(s.noScrim, `${s.id} sets noScrim, which suppresses its own spotlight`).toBeFalsy();
    }
  });
});
