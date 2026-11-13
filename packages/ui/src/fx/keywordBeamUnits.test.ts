import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type RunState } from '@game/sim';
import { keywordBeamUnits } from './keywordBeamUnits';
import { classifyKeywordOrigin } from './keywordOrigin';

/**
 * A KEYWORD GIVEN TO A SHOP OFFER (owner 2026-11-13: "when applying the effect to a minion in shop, it does not get
 * the workbench fx ... i can bulwark a minion in shop, it should get the same effect").
 */
describe('keyword beams reach the Shop row', () => {
  it('a REAL cast through the reducer: Bulwark on a Shop offer is a Taunt gain the board read sees', () => {
    const offer = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && c.tier === 1 && !c.keywords.includes('T'))!;
    let run = { ...createRun(5, 'warden', 'ascent'), phase: 'recruit', embers: 30, board: [], hand: [{ uid: 'sp', cardId: 'bulwark', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false }], shop: [{ uid: 'o1', cardId: offer.id }] } as unknown as RunState;
    const before = new Map(keywordBeamUnits(run.board, run.shop).map((u) => [u.uid, u.keywords.includes('T')]));
    expect(before.get('o1')).toBe(false);
    run = reduce(run, { type: 'play', uid: 'sp', targetUid: 'o1' } as never);
    if (run.pendingTarget) run = reduce(run, { type: 'battlecryTarget', targetUid: 'o1' } as never);
    const after = keywordBeamUnits(run.board, run.shop).find((u) => u.uid === 'o1');
    expect(after?.keywords.includes('T')).toBe(true);
    // ...and a targeted spell leaves the pointer.
    expect(classifyKeywordOrigin('play', true, true)).toEqual({ kind: 'pointer' });
  });
  it("an offer's own keywords count, so a card that already has Taunt is never a gain", () => {
    const taunter = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && c.keywords.includes('T'))!;
    expect(keywordBeamUnits([], [{ uid: 'o', cardId: taunter.id }])[0]!.keywords.includes('T')).toBe(true);
    expect(keywordBeamUnits([], [{ uid: 'o', cardId: taunter.id, keywords: ['R'] }])[0]!.keywords).toEqual(expect.arrayContaining(['T', 'R']));
  });
  it('the Shop reads the warband and the Shop row, and re-reads when either changes', () => {
    const recruit = readFileSync(new URL('../Recruit.tsx', import.meta.url), 'utf8');
    expect(recruit).toContain('const beamUnits = keywordBeamUnits(run.board, run.shop);');
    expect(recruit).toContain('for (const c of beamUnits) {');
    expect(recruit).toContain("prevTauntRef.current = new Map(beamUnits.map((c) => [c.uid, c.keywords.includes('T')]));");
    expect(recruit).toContain('}, [run.board, run.shop, inCombat]);');
  });
});
