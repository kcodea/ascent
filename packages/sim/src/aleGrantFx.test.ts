import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { ALE_IDS, applyGoldSpent, castSpell } from './recruit';

/**
 * The ale-generation FX signal (`aleGranted` / `aleGrantSeq`) — pure display metadata that tells the UI which
 * board Dwarf generated a Dwarven Ale this shop action, so it can burst `ale-bubbles` from that unit. It must
 * (a) credit the generating UNIT, (b) NOT credit a non-unit source (the Reinforcing-Ale spell routes through
 * the same factory), and (c) behave like the other transient FX channels: cleared each action, seq monotonic.
 */

const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const body = (cardId: string, uid = 'm'): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};

describe('ale-grant FX signal', () => {
  it('initialises empty on a fresh run', () => {
    const s = createRun(123);
    expect(s.aleGranted).toEqual([]);
    expect(s.aleGrantSeq).toBe(0);
  });

  it('Brunni (End of Turn) credits the generating unit and bumps the seq', () => {
    let s = set2();
    s = { ...s, board: [body('dw_brunni', 'brunni')], hand: [] };
    const seq0 = s.aleGrantSeq;
    s = reduce(s, { type: 'faceOmen' }); // end-of-turn → grantRandomAle
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'an Ale was granted').toBe(1);
    expect(s.aleGranted.map((e) => e.sourceUid)).toContain('brunni');
    expect(s.aleGrantSeq).toBe(seq0 + 1);
  });

  it('Doubletap Brewer (Shout) credits the played unit', () => {
    let s = set2();
    s = { ...s, board: [], hand: [body('dw_brewer', 'brewer')] };
    s = reduce(s, { type: 'play', uid: 'brewer' });
    expect(s.aleGranted.some((e) => e.sourceUid === 'brewer')).toBe(true);
    expect(s.aleGrantSeq).toBeGreaterThan(0);
  });

  it('Tapkeeper (Gold spent past the threshold) credits the unit', () => {
    let s = set2();
    s = { ...s, board: [body('dw_tapkeeper', 'tap')], hand: [] };
    applyGoldSpent(s, 10); // crosses the every-10 threshold
    expect(s.aleGranted.some((e) => e.sourceUid === 'tap'), 'Tapkeeper credited').toBe(true);
  });

  it('the "On the House" SPELL (a non-unit source) grants Ales but credits no unit', () => {
    // A spell that casts grantRandomAle routes through the same factory with self=undefined (untargeted),
    // so no unit is credited — bubbles are a UNIT effect.
    const s = set2();
    const onTheHouse = CARD_INDEX['onthehouse']!;
    expect(onTheHouse.effects.some((e) => e.on === 'cast' && e.do === 'grantRandomAle'), 'the spell casts grantRandomAle').toBe(true);
    castSpell(s, onTheHouse);
    expect(s.hand.filter((c) => ALE_IDS.includes(c.cardId)).length, 'the spell DID grant ales').toBeGreaterThan(0);
    expect(s.aleGranted.length, 'but no UNIT was credited').toBe(0);
  });

  it('a non-granting action clears aleGranted to [] and leaves the seq unchanged', () => {
    let s = set2();
    s = { ...s, aleGranted: [{ sourceUid: 'stale', count: 1 }], aleGrantSeq: 4, board: [], hand: [] };
    s = reduce(s, { type: 'faceOmen' }); // no Dwarf → nothing granted
    expect(s.aleGranted).toEqual([]);
    expect(s.aleGrantSeq).toBe(4);
  });
});
