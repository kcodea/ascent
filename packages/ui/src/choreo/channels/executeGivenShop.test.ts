import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_INDEX } from '@game/content';
import type { ConsequenceEvent, GamePresentationEvent } from '@game/core';
import { createRun, reduceWithPresentation, type BoardCard, type RunState } from '@game/sim';
import { presentConsequence, type PresenterContext } from '../../choreographer/consequencePresenters';
import type { CompiledBeat } from '../../choreographer/timelineTypes';
import { isTravelledExecute } from '../../fx/executeGivenLaunch';

/**
 * "ON EXECUTE GIVEN" IN THE SHOP (R-FX-EXECUTE-GIVEN-01, owner 2026-11-12 "Yes, add the Shop"). A Rally forced in the
 * Shop must hand the presenter the GIVER, so the bound effect can travel from it. Graded on a real End of Turn.
 */
const bc = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false } as BoardCard;
};
const endOfTurn = (): GamePresentationEvent[] => {
  const s = {
    ...createRun(5, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 30, hand: [],
    board: [bc('r', 'b2_raven'), bc('a', 'b2_beev')],
    runeLastingCadence: true, // End of Turn: every Rally on the board triggers
  } as unknown as RunState;
  return reduceWithPresentation(s, { type: 'faceOmen' } as never, true).batch?.events ?? [];
};

describe('a Rally forced in the Shop', () => {
  it('delivers the Execute as a keyword change on RAVEN\'s own beat, aimed at the other Beast', () => {
    const events = endOfTurn();
    const grant = events.find((e) => e.type === 'keywordChanged' && e.keyword === 'V' && e.gained);
    expect(grant, 'the End of Turn emits the Execute grant').toBeDefined();
    if (grant?.type !== 'keywordChanged') throw new Error('unreachable');
    expect(grant.target.uid).toBe('a');
    const trigger = events.find((e) => e.id === grant.parentId);
    expect(trigger?.type).toBe('sourceTrigger');
    if (trigger?.type !== 'sourceTrigger') throw new Error('unreachable');
    expect(trigger.source.kind).toBe('minion');
    expect(trigger.source.uid).toBe('r');
    expect(trigger.source.id).toBe('b2_raven');
  });

  it('the presenter hands the giver and its beat to the keyword cue; a rune\'s grant names no giver', () => {
    const consequence = { type: 'keywordChanged', id: 'c1', sequence: 0, step: 0, target: { zone: 'board', uid: 'a', cardId: 'b2_beev', side: 'player' }, keyword: 'V', gained: true } as ConsequenceEvent;
    const keywordChanged = vi.fn();
    const ctx = { keywordChanged } as unknown as PresenterContext;
    presentConsequence({ consequence, beat: { id: 'beat:7', source: { kind: 'minion', id: 'b2_raven', uid: 'r' } } as CompiledBeat, ctx });
    expect(keywordChanged).toHaveBeenLastCalledWith('a', 'V', true, { uid: 'r', cardId: 'b2_raven', beatId: 'beat:7' }, 0);
    presentConsequence({ consequence, beat: { id: 'beat:8', source: { kind: 'rune', id: 'rune_x' } } as CompiledBeat, ctx });
    expect(keywordChanged).toHaveBeenLastCalledWith('a', 'V', true, undefined, 0);
  });

  it('Raven\'s grant is one its effect travels to, and the Shop cue launches it in place of the generic flash', () => {
    expect(isTravelledExecute({ cardId: 'b2_raven', source: 'r', target: 'a' })).toBe(true);
    const src = readFileSync(new URL('../../Recruit.tsx', import.meta.url), 'utf8');
    expect(src).toContain("if (keyword === 'V' && from && launchShopExecuteGiven({ cardId: from.cardId, source: from.uid, target: uid }, from.beatId, index)) return;");
  });
});
