import { describe, expect, it } from 'vitest';
import { GAUNTLET_STAGES, gauntletStage, validateStage, stageDrift, type GauntletStage } from './index';
import { cardRevision } from '../revisions';
import { CARD_INDEX } from '../index';

const someCard = Object.values(CARD_INDEX).find((c) => !c.spell && c.tier === 1)!;
const minion = (over: Partial<GauntletStage['rounds'][number]['board'][number]> = {}) => ({
  cardId: someCard.id, attack: 2, health: 3, cardVersion: cardRevision(someCard), ...over,
});
const stage = (over: Partial<GauntletStage> = {}): GauntletStage => ({
  number: 1, name: 'Test', opponentName: 'Tester', status: 'ready', runes: {},
  rounds: Array.from({ length: 10 }, () => ({ board: [minion()] })), ...over,
});

describe('Gauntlet stage data', () => {
  it('every shipped stage validates', () => {
    for (const s of GAUNTLET_STAGES) expect(validateStage(s), `stage ${s.number}`).toEqual([]);
  });

  it('ships the five tribe stages in the owner order', () => {
    expect(GAUNTLET_STAGES.map((s) => [s.number, s.name])).toEqual([
      [1, 'Demons'], [2, 'Kobolds'], [3, 'Dragons'], [4, 'Dwarves'], [5, 'Beasts'],
    ]);
    expect(gauntletStage(3)?.name).toBe('Dragons');
    expect(gauntletStage(9)).toBeUndefined();
  });

  it('portraitCardId is optional, and must name a real card', () => {
    expect(validateStage(stage({ portraitCardId: 'dm_grobbus' }))).toEqual([]);
    expect(validateStage(stage({ portraitCardId: 'no_such_card' })).join()).toMatch(/portraitCardId.*no_such_card/);
    expect(gauntletStage(1)?.portraitCardId).toBe('dm_grobbus');
  });

  it('a well-formed ready stage has no issues', () => {
    expect(validateStage(stage())).toEqual([]);
  });

  it('flags an unknown card, an oversized board, a bad tier, a bad rune and a wrong round count', () => {
    const bad = stage({
      runes: { round6: 'rune_does_not_exist' },
      rounds: [
        { board: [minion({ cardId: 'no_such_card' })] },
        { board: Array.from({ length: 8 }, () => minion()) },
        { tier: 7, board: [minion()] },
      ],
    });
    const issues = validateStage(bad).join('\n');
    expect(issues).toMatch(/exactly 10 rounds/);
    expect(issues).toMatch(/no_such_card/);
    expect(issues).toMatch(/round 2.*more than 7/);
    expect(issues).toMatch(/round 3.*tier/);
    expect(issues).toMatch(/rune_does_not_exist/);
  });

  it('a ready stage may not have an empty round; a draft stage may', () => {
    const empty = { rounds: Array.from({ length: 10 }, () => ({ board: [] })) };
    expect(validateStage(stage({ ...empty, status: 'ready' })).join()).toMatch(/round 1.*empty/);
    expect(validateStage(stage({ ...empty, status: 'draft' }))).toEqual([]);
  });

  it('stageDrift reports a minion saved against an older card revision', () => {
    const s = stage({ rounds: Array.from({ length: 10 }, (_, i) => ({ board: [minion(i === 4 ? { cardVersion: 'stale' } : {})] })) });
    expect(stageDrift(s)).toEqual([{ round: 5, index: 0, cardId: someCard.id }]);
  });

  it('rejects an unknown keyword, an unknown tribe and a stray rune slot; accepts golden + a real keyword', () => {
    const withMinion = (m: object, over: Partial<GauntletStage> = {}) =>
      stage({ ...over, rounds: Array.from({ length: 10 }, () => ({ board: [minion(m)] })) });
    expect(validateStage(withMinion({ addedKeywords: ['NOPE'] })).length).toBeGreaterThan(0);
    expect(validateStage(stage({ tribe: 'gnome' } as unknown as Partial<GauntletStage>)).length).toBeGreaterThan(0);
    expect(validateStage(stage({ runes: { round3: 'rune_adventuring' } } as unknown as Partial<GauntletStage>)).length).toBeGreaterThan(0);
    expect(validateStage(withMinion({ golden: true, addedKeywords: ['T'] }, { tribe: 'demon' }))).toEqual([]);
  });
});
