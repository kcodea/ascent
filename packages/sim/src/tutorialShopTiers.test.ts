import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { LEARN_ASCENT } from './tutorial/learnAscent';

/**
 * TIER LEGALITY of the scripted tutorial shop (owner report 2026-08-23: "there is a t2 minion while im t1 here").
 *
 * A scripted shop is served VERBATIM — `rollTutorialShop` returns the authored ids without consulting the pool
 * or `state.tier`, which is exactly what makes the course reliable and exactly what makes this mistake silent.
 * A real shop can never offer above its tier, so an over-tier authored offer teaches the player a rule the game
 * does not have — and the course spends Round 2 and Round 7 explaining that very rule.
 *
 * The tier a round is PLAYED at is derived from the course's own `tierAtLeast` steps rather than hardcoded, so
 * moving a rung on the ladder moves this check with it.
 */

/** Tier the shop rolls at, per round: the tier reached by the END of the previous round. A `tierAtLeast` step
 *  fires DURING its round, and tiering up does not retroactively change offers already on the table — so the
 *  round that upgrades is still judged at its opening tier. */
function tierAtRoundStart(): Map<number, number> {
  const byRound = new Map<number, number>();
  let tier = 1;
  for (const turn of LEARN_ASCENT.turns) {
    byRound.set(turn.turn, tier);
    for (const step of turn.steps) {
      const c = step.completion as { kind: string; tier?: number };
      if (c.kind === 'tierAtLeast' && c.tier) tier = Math.max(tier, c.tier);
    }
  }
  return byRound;
}

describe('Learn Ascent — the scripted shop never offers above its tier', () => {
  const tiers = tierAtRoundStart();

  it('every authored offer is legal at the tier its round opens on', () => {
    const illegal: string[] = [];
    for (const turn of LEARN_ASCENT.turns) {
      const openTier = tiers.get(turn.turn)!;
      turn.shopRolls.forEach((roll, rollIdx) => {
        // A roll served by a REFRESH lands after any upgrade the round coached, so it is judged at the tier the
        // round ends on. Roll 0 is the turn-start offer and is judged at the opening tier.
        const rollTier = rollIdx === 0 ? openTier : endTier(turn.turn);
        for (const id of [...roll.minions, ...(roll.spell ? [roll.spell] : [])]) {
          const card = CARD_INDEX[id];
          expect(card, `${id} (round ${turn.turn}) is not a real card`).toBeDefined();
          if (card!.tier > rollTier) illegal.push(`round ${turn.turn} roll ${rollIdx}: ${id} is T${card!.tier} in a T${rollTier} shop`);
        }
      });
    }
    expect(illegal).toEqual([]);
  });

  function endTier(round: number): number {
    const turn = LEARN_ASCENT.turns.find((t) => t.turn === round)!;
    let tier = tiers.get(round)!;
    for (const step of turn.steps) {
      const c = step.completion as { kind: string; tier?: number };
      if (c.kind === 'tierAtLeast' && c.tier) tier = Math.max(tier, c.tier);
    }
    return tier;
  }

  it('every card a step asks the player to BUY is in that round shop and legal there', () => {
    const problems: string[] = [];
    for (const turn of LEARN_ASCENT.turns) {
      for (const step of turn.steps) {
        const c = step.completion as { kind: string; cardId?: string };
        if (c.kind !== 'bought' || !c.cardId) continue;
        const offered = turn.shopRolls.some((r) => r.minions.includes(c.cardId!) || r.spell === c.cardId);
        if (!offered) problems.push(`round ${turn.turn}: step ${step.id} buys ${c.cardId}, which no roll offers`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('Round 7 teaches the tier rule by SHOWING it: the pre-upgrade roll cannot contain the Tier-4 keystone', () => {
    // This is the demonstration the owner asked for — the lesson is the DIFFERENCE between the two rolls, so it
    // only works if roll 0 genuinely lacks the card and roll 1 genuinely holds it.
    const r7 = LEARN_ASCENT.turns.find((t) => t.turn === 7)!;
    expect(r7.shopRolls.length).toBeGreaterThanOrEqual(2);
    expect(r7.shopRolls[0]!.minions).not.toContain('b2_echohorn');
    expect(r7.shopRolls[1]!.minions).toContain('b2_echohorn');
    expect(CARD_INDEX['b2_echohorn']!.tier).toBe(4);
    // The upgrade and the refresh both have to be coached, in that order, before the buy.
    const ids = r7.steps.map((s) => s.id);
    expect(ids.indexOf('r7-tavern')).toBeLessThan(ids.indexOf('r7-refresh'));
    expect(ids.indexOf('r7-refresh')).toBeLessThan(ids.indexOf('r7-buy'));
  });
});
