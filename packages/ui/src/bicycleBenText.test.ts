import { describe, it, expect } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import { overflowPerPlayedText } from './cardText';
import { liveCardText, liveBoardView } from './instView';

/**
 * BICYCLE BEN's live text (owner handoff 2026-09-18; the CLAUDE.md hard rule): "give a random Undead +1/+1. Improves
 * for every Undead played this turn" must print the CURRENT grant — (1 + Undead played) × gild — in place, green,
 * on the shop/board/hand chain (`liveCardText` / `instView`, from the run's `playedThisTurn` ids) AND on the combat
 * chain (`Unit.tsx` passes the per-side `tribesPlayed` map — a served foe's snapshot value).
 */
const base = { tier: 6, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0, undeadBuyAtk: 0, soulsmanGold: 0 };

describe('Bicycle Ben — the printed grant is the current one', () => {
  it('helper: null before any Undead is played (the printed base is exact); the live value in place after', () => {
    expect(overflowPerPlayedText('u3_bicycleben', false, () => 0)).toBeNull();
    expect(overflowPerPlayedText('u3_bicycleben', false, (t) => (t === 'undead' ? 2 : 0))).toBe(
      'When a summoned minion does not fit, give a random **Undead {{+3/+3}}**. Improves for every Undead played this turn.');
    expect(overflowPerPlayedText('u3_bicycleben', true, (t) => (t === 'undead' ? 2 : 0))).toContain('{{+6/+6}}');
    expect(overflowPerPlayedText('u3_noggin', false, () => 5), 'other cards fall through').toBeNull();
  });
  it('shop/board/hand chain: counts the run\'s played ids through the shared tribe predicate (all-types counts, a Dwarf does not)', () => {
    expect(liveCardText('u3_bicycleben', { ...base, playedThisTurn: ['dw_brunni'] }).text).not.toContain('{{');
    expect(liveCardText('u3_bicycleben', { ...base, playedThisTurn: ['u3_noggin', 'n2_paragon', 'dw_brunni'] }).text).toContain('{{+3/+3}}');
    expect(liveCardText('u3_bicycleben', { ...base, golden: true, playedThisTurn: ['u3_bicycleben'] }).text).toContain('{{+4/+4}}');
    // The board surface, from a real run state.
    const run = { ...createRun(3, 'drakko'), setId: 'set3', playedThisTurn: ['u3_poochy', 'mumi'] } as RunState;
    const view = liveBoardView({ uid: 'b', cardId: 'u3_bicycleben', tribe: 'undead', attack: 3, health: 9, keywords: [], golden: false }, run);
    expect(view.text).toContain('{{+3/+3}}');
  });
  it('combat chain: a per-side `tribesPlayed` map wins over the ids (a served foe carries no ids, only the map)', () => {
    expect(liveCardText('u3_bicycleben', { ...base, playedThisTurn: 4, tribesPlayed: { undead: 1 } }).text).toContain('{{+2/+2}}');
    expect(liveCardText('u3_bicycleben', { ...base, playedThisTurn: 4 }).text, 'a bare number is Pack Leader\'s Beast count, not Undead').not.toContain('{{');
  });
});
