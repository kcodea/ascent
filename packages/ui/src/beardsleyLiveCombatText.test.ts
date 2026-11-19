import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { liveCardText, type LiveTextParams } from './instView';
import { computeFrame } from './useCombatReplay';

/**
 * BEARDSLEY (and Flo Rida) PRINT THE CURRENT GRANT MID-FIGHT (R-IMPROVE-LIVE-TEXT-01, owner 2026-11-18:
 * "beardsley's text isnt updating live in combat, and should improve by +2/+1 not +1/+1").
 *
 * The combat factory `onSummonTribeBuffFlat` counted each Beast on the body's `summonBonus` but never logged an
 * `improve` event, so the replay frame (`computeFrame`, what `Unit.tsx` reads) kept the pre-fight count and the card
 * printed its start-of-fight grant until settle. The improve is now logged on the beat for either side.
 */
const base: LiveTextParams = {
  tier: 1, golden: false,
  spellBonus: 0, spellBonusH: 0, frontToBackBonus: 0,
  spellsThisTurn: 0, spellsCast: 0, deathrattlesTriggered: 0,
  undeadBuyAtk: 0, soulsmanGold: 0,
};
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra });
const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 60, health: 400000 }];
/** `cardId` beside two Mama Pups (4 Pups summoned in the fight), on the chosen side. */
function fight(cardId: string, side: 'player' | 'enemy', extra: Partial<BoardMinion> = {}) {
  const team = [bm(cardId, 'B', 5, 999999, extra), bm('pack', 'P1', 0, 1), bm('pack', 'P2', 0, 1)];
  const mine = combatSide({ tier: 6, tribes: ['beast'] });
  return side === 'player'
    ? simulate(team, wall, makeRng(3), CARD_INDEX, mine, combatSide({ tier: 1 }))
    : simulate(wall, team, makeRng(3), CARD_INDEX, combatSide({ tier: 1 }), mine);
}
type Buff = Extract<CombatEvent, { type: 'buff' }>;
/** At every grant this body makes, the text printed on the frame JUST BEFORE it must name exactly that grant, and
 *  the frame at the end of the log must hold the count settle carries back (no jump). Returns the grants. */
function walk(cardId: string, side: 'player' | 'enemy', golden = false): string[] {
  const r = fight(cardId, side, golden ? { golden: true } : {});
  const uid = r.initial[side].find((m) => m.cardId === cardId)!.uid;
  const names = new Map<string, string>();
  const textAt = (upto: number): string => {
    const u = computeFrame(r.initial, r.events, upto, upto, names)[side].find((x) => x.uid === uid)!;
    const t = liveCardText(cardId, { ...base, golden, summonBonus: u.summonBonus });
    return (golden ? t.goldenText : t.text)!;
  };
  const grants: string[] = [];
  r.events.forEach((e, i) => {
    if (e.type !== 'buff' || (e as Buff).source !== uid) return;
    const g = `+${(e as Buff).attack}/+${(e as Buff).health}`;
    expect(textAt(i), `text before grant #${grants.length + 1} (${side})`).toContain(`{{${g}}}`);
    grants.push(g);
  });
  const end = computeFrame(r.initial, r.events, r.events.length, r.events.length, names)[side].find((x) => x.uid === uid)!;
  expect(end.summonBonus, 'the replay ends on the count the engine counted').toBe(grants.length);
  if (side === 'player') {
    expect(r.playerSummonBonus?.find((b) => b.sourceUid === 'B')?.bonus, 'settle banks the same count: no jump').toBe(end.summonBonus);
  }
  return grants;
}

describe('Beardsley: the improve step is +2/+1 (owner balance 2026-11-18)', () => {
  it('data: base +2/+1, improving +2/+1 on every Beast', () => {
    expect(CARD_INDEX.b2_beardsley!.effects).toEqual([{ on: 'onSummon', do: 'onSummonTribeBuffFlat',
      params: { tribe: 'beast', attack: 2, health: 1, improve: 2, improveHealth: 1, every: 1 } }]);
  });
  it('combat grants run +2/+1, +4/+2, +6/+3, +8/+4; gilded doubles the grant and the step', () => {
    expect(walk('b2_beardsley', 'player')).toEqual(['+2/+1', '+4/+2', '+6/+3', '+8/+4']);
    expect(walk('b2_beardsley', 'player', true)).toEqual(['+4/+2', '+8/+4', '+12/+6', '+16/+8']);
  });
});

describe('R-IMPROVE-LIVE-TEXT-01: the combat text shows the improved value on the beat', () => {
  it('Beardsley on the enemy side reads the same', () => {
    expect(walk('b2_beardsley', 'enemy')).toEqual(['+2/+1', '+4/+2', '+6/+3', '+8/+4']);
  });
  it('Flo Rida (same factory) climbs mid-fight on both sides', () => {
    expect(walk('b2_florida', 'player')).toEqual(['+5/+5', '+10/+10', '+15/+15', '+20/+20']);
    expect(walk('b2_florida', 'enemy')).toEqual(['+5/+5', '+10/+10', '+15/+15', '+20/+20']);
  });
  it('each counted Beast logs one improve of 1 on the watcher', () => {
    const r = fight('b2_beardsley', 'player');
    const uid = r.initial.player.find((m) => m.cardId === 'b2_beardsley')!.uid;
    const imps = r.events.filter((e) => e.type === 'improve' && e.target === uid) as Extract<CombatEvent, { type: 'improve' }>[];
    expect(imps.map((e) => e.amount)).toEqual([1, 1, 1, 1]);
  });
});

describe('Beardsley shop / board text: same chain, same shape as before', () => {
  it('prints the current grant from the per-copy count', () => {
    expect(liveCardText('b2_beardsley', { ...base, summonBonus: 0 }).text)
      .toBe('When you summon a **Beast**, give it {{+2/+1}} and improve this.');
    expect(liveCardText('b2_beardsley', { ...base, summonBonus: 3 }).text)
      .toBe('When you summon a **Beast**, give it {{+8/+4}} and improve this.');
    expect(liveCardText('b2_beardsley', { ...base, summonBonus: 3, golden: true }).goldenText)
      .toBe('When you summon a **Beast**, give it {{+16/+8}} and improve this.');
  });
  it('under Rune of the Zoo the combat text prints the NEXT summon ordinal-scaled grant', () => {
    // 2 summons so far, 2 Beasts counted: (2 + 2x2) x 3 Attack, (1 + 1x2) x 3 Health.
    expect(liveCardText('b2_beardsley', { ...base, summonBonus: 2, zooSummons: 2 }).text).toContain('{{+18/+9}}');
  });
});
