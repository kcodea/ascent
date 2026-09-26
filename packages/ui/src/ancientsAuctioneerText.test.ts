/**
 * ANCIENTS × the Auctioneer (War): a Pulsed minion wears the granted "Rally: trigger this minion's Shout" as a blue
 * rune-style note, on every surface (the shop/board chain reads the `grantedEffects` graft; combat reads the
 * snapshot's `grantedRallyShout`). Both feed the one `liveCardText`.
 */
import { describe, expect, it } from 'vitest';
import type { BoardCard } from '@game/sim';
import { GRANTED_RALLY_SHOUT_NOTE, instView, liveCardText } from './instView';

const base = { tier: 1, golden: false, spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0, spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0 };

describe('Auctioneer × War: the granted Rally prints on the card', () => {
  it('liveCardText appends the note only when the instance carries it', () => {
    expect(liveCardText('cleric', { ...base, grantedRallyShout: true } as never).text).toContain(GRANTED_RALLY_SHOUT_NOTE);
    expect(liveCardText('cleric', base as never).text).not.toContain('Rally');
  });

  it('a board instance with the graft prints it (instView reads grantedEffects)', () => {
    const c: BoardCard = {
      uid: 'c', cardId: 'cleric', tribe: 'dragon', attack: 2, health: 2, keywords: ['RL'], golden: false,
      grantedEffects: [{ on: 'onAttack', do: 'rallyTriggerOwnShout', params: {} }],
    };
    expect(instView(c).text).toContain(GRANTED_RALLY_SHOUT_NOTE);
    expect(GRANTED_RALLY_SHOUT_NOTE).not.toMatch(/—|--/);
  });
});
