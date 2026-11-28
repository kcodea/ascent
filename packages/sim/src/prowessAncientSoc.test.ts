/**
 * COMBAT PROWESS x AN ANCIENT'S START OF COMBAT (owner bug report 2026-11-27: "combat prowess didnt trigger", Gorun with the Ancient
 * of Genesis: "Start of Combat: your two left-most minions gain Ward and Flurry"). Combat Prowess replays every Start of Combat
 * effect at End of Turn with Shop semantics, so the two left-most board minions keep Ward and Flurry. R-PROWESS-ANCIENT-SOC-01.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { ANCIENT_IDS, createRun, enableAncients, reduce, type AncientId, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, socRuneReplaysOf } from './recruit';

const card = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const PLAIN = 'n2_spellsword';
const gorun = (id: AncientId, prowess: boolean): RunState => {
  let s = enableAncients({ ...createRun(7, 'gorun'), phase: 'recruit', embers: 60, hand: [] } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  if (prowess) {
    s = reduce({ ...s, embers: 60, runeforgeOffer: ['rune_combat_prowess'], runeforgeEpic: !!RUNE_INDEX.rune_combat_prowess!.epic }, { type: 'buyRune', index: 0 });
    expect(s.runeCombatProwess, 'Combat Prowess owned').toBeTruthy();
  }
  return { ...s, board: [card('a', PLAIN), card('b', PLAIN), card('c', PLAIN)] };
};

describe('Combat Prowess replays an Ancient Start of Combat (Gorun x Genesis)', () => {
  it('is on the End of Turn replay list', () => {
    expect(socRuneReplaysOf(gorun('genesis', true)).some((r) => r.label === 'Blade Mastery')).toBe(true);
    expect(socRuneReplaysOf(gorun('death', true)).some((r) => r.label === 'Blade Mastery')).toBe(false);
  });

  it('the two left-most minions gain Ward and Flurry, permanently; the third does not', () => {
    const s = gorun('genesis', true);
    socRuneReplaysOf(s).find((r) => r.label === 'Blade Mastery')!.fire(s);
    expect(s.board.map((m) => [m.keywords.includes('DS'), m.keywords.includes('W')])).toEqual([[true, true], [true, true], [false, false]]);
  });

  it('the real End of Turn grants it (and without Combat Prowess it does not)', () => {
    const s = gorun('genesis', true);
    applyEndOfTurn(s);
    expect(s.board.slice(0, 2).every((m) => m.keywords.includes('DS') && m.keywords.includes('W'))).toBe(true);
    const none = gorun('genesis', false);
    applyEndOfTurn(none);
    expect(none.board.some((m) => m.keywords.includes('W'))).toBe(false);
  });
});
