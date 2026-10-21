import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { playerBoardMinions } from './reducer';
import { mirrorForEnemySeat } from './versus/mirror';

/**
 * ENGRAVED KEEPS COMBAT KEYWORDS, the Shop half (owner 2026-10-21, R-ENGRAVE-03): "if a minion is engraved and gains
 * ward, they gain that ward permanently, so they would carry it back from combat." Owner confirmations the same day:
 * "1. Yes carries back 2. Correct 3. Yes 4. Yes" (3 = the Shop card shows it, 4 = a Gild keeps it).
 * The combat half (what the fight reports) is pinned in packages/core/src/combat/engravedKeepsKeywords.test.ts.
 */
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 30, tier: 6, tribes: ['kobold', 'dwarf', 'undead', 'spirit', 'celestial'],
    pool: Object.fromEntries(poolFor('set3').buyable.map((c) => [c.id, 5])), recruitBuffFx: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);

/** Fight, then stamp the carry-back the fight would report onto the shared result, then settle. */
const settleWith = (s: RunState, keywords: BoardCard['keywords'], uid = 'eg'): RunState => {
  let t = act(s, { type: 'faceOmen' });
  expect(t.phase).toBe('combat');
  t.lastCombat!.playerPermaKeywords = [{ sourceUid: uid, keywords }];
  t = act(t, { type: 'settleCombat' });
  return act(t, { type: 'resolveCombat' });
};

describe('the Shop card keeps the keywords its Engraved body gained in combat', () => {
  it('owner ruling 3: the carried Ward is on the Shop card (its keyword pill), for good', () => {
    const s = settleWith(run({ board: [body('eg', 'taragosaheir')] }), ['DS', 'CR']);
    const card = s.board.find((c) => c.uid === 'eg')!;
    expect(card.keywords).toEqual(expect.arrayContaining(['EG', 'DS', 'CR']));
    expect(card.tempShield, 'a permanent Ward, not the one-combat kind').toBeFalsy();
  });

  it('a keyword the card already holds is not added twice', () => {
    const s = settleWith(run({ board: [body('eg', 'taragosaheir', { keywords: ['EG', 'DS'] })] }), ['DS']);
    expect(s.board.find((c) => c.uid === 'eg')!.keywords.filter((k) => k === 'DS')).toHaveLength(1);
  });

  it('a Resilient Ward brings its Ward with it', () => {
    const s = settleWith(run({ board: [body('eg', 'taragosaheir')] }), ['RW']);
    expect(s.board.find((c) => c.uid === 'eg')!.keywords).toEqual(expect.arrayContaining(['RW', 'DS']));
  });

  it('owner ruling 4: a Gild keeps the carried keyword', () => {
    const copy = (uid: string, keywords: BoardCard['keywords']): BoardCard =>
      ({ uid, cardId: 'drummer', tribe: 'neutral', attack: 1, health: 1, keywords, golden: false });
    let s: RunState = { ...createRun(1), phase: 'recruit', embers: 0, shop: [], board: [copy('a', ['DS']), copy('b', [])], hand: [copy('c', [])] };
    s = reduce(s, { type: 'play', uid: 'c' });
    const golden = [...s.board, ...s.hand].find((c) => c.cardId === 'drummer' && c.golden);
    expect(golden, 'the triple combined').toBeTruthy();
    expect(golden!.keywords).toContain('DS');
  });
});

describe('Versus: the other seat settles its own Engraved keywords', () => {
  it('the enemy side\'s carry-back becomes the mirrored seat\'s playerPermaKeywords', () => {
    const bag = (sourceUid: string | undefined, attack: number, health: number, keywords: BoardMinion['keywords'] = []): BoardMinion =>
      ({ cardId: 'sandbag', attack, health, keywords, ...(sourceUid ? { sourceUid } : {}) });
    const r = simulate([bag(undefined, 1, 30)], [bag('E', 1, 60, ['EG'])], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 6, questMods: { runeVanguard: true } as QuestCombatMods }));
    const mirrored = mirrorForEnemySeat(r);
    expect([...(mirrored.playerPermaKeywords?.[0]?.keywords ?? [])].sort()).toEqual(['CR', 'DS']);
    expect(mirrored.playerPermaKeywords?.[0]?.sourceUid).toBe('E');
  });
});

describe('a REGAINED temporary keyword becomes permanent on the Shop card (owner 2026-10-21)', () => {
  it('the combat side marks the one-fight keywords (Maw Ward, Lord of the Risen Rise, a Whisper keyword)', () => {
    const [m] = playerBoardMinions([body('eg', 'taragosaheir', { keywords: ['EG', 'DS', 'R', 'T'], tempShield: true, tempReborn: true, whisperKeywords: ['T'] })]);
    expect(m!.tempKeywords).toEqual(['DS', 'R', 'T']);
    const [plain] = playerBoardMinions([body('p', 'taragosaheir', { keywords: ['EG', 'DS'] })]);
    expect(plain!.tempKeywords).toBeUndefined();
  });

  it("a carried Ward on a card whose Ward was Maw's one-fight Ward is no longer stripped after the fight", () => {
    const s = settleWith(run({ board: [body('eg', 'taragosaheir', { keywords: ['EG', 'DS'], tempShield: true })] }), ['DS']);
    const card = s.board.find((c) => c.uid === 'eg')!;
    expect(card.keywords).toContain('DS');
    expect(card.tempShield).toBeFalsy();
  });

  it('without the carry, the one-fight Ward is stripped as before (the contrast)', () => {
    let t = act(run({ board: [body('eg', 'taragosaheir', { keywords: ['EG', 'DS'], tempShield: true })] }), { type: 'faceOmen' });
    t.lastCombat!.playerPermaKeywords = undefined;
    t = act(act(t, { type: 'settleCombat' }), { type: 'resolveCombat' });
    expect(t.board.find((c) => c.uid === 'eg')!.keywords).not.toContain('DS');
  });

  it('a carried Rise on a one-fight Rise card, and a carried Whisper keyword, lose their temporary marks', () => {
    const s = settleWith(run({ board: [body('eg', 'taragosaheir', { keywords: ['EG', 'R', 'T'], tempReborn: true, whisperKeywords: ['T'] })] }), ['R', 'T']);
    const card = s.board.find((c) => c.uid === 'eg')!;
    expect(card.keywords).toEqual(expect.arrayContaining(['R', 'T']));
    expect(card.tempReborn).toBeFalsy();
    expect(card.whisperKeywords).toBeUndefined();
  });
});
