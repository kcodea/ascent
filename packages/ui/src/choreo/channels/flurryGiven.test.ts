import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from '@game/sim';
import { bindingFor } from '../bindings';
import { givesFlurry, playedFlurryGrants } from './flurryGiven';
import { KEYWORD_BEAMS } from '../../fx/keywordBeam';
import { getDef } from '../../fx/fxDefs';
import { holdFlurry, isFlurryHeld } from '../../fx/flurryHold';

/**
 * "ON FLURRY GIVEN" (R-FX-FLURRY-GIVEN-01, owner 2026-11-13): Runic Beetle sends its bound beam to the Beast it gives
 * Flurry, and Flurry from a spell, a hero power or a rune travels like Rise, Execute and Ward do.
 */
describe('which cards give Flurry', () => {
  it('Runic Beetle (its Choose One option) does; a Rise-only giver and a plain minion do not', () => {
    expect(givesFlurry('beetle')).toBe(true);
    expect(givesFlurry('mumi')).toBe(false);
    expect(givesFlurry('trainingdummy')).toBe(false);
    expect(givesFlurry(null)).toBe(false);
  });
  it('Beetle is bound to the beam, and the beam and its sounds are in the library', () => {
    expect(bindingFor('beetle', 'flurryGiven')?.def).toBe('flurry-beam');
    expect(KEYWORD_BEAMS.W).toEqual({ def: 'flurry-beam', launchSfx: 'sfx-flurry-whoosh', landSfx: 'sfx-flurry-swings' });
    for (const id of ['flurry-beam', 'sfx-flurry-whoosh', 'sfx-flurry-swings']) expect(getDef(id), id).toBeDefined();
  });
});

describe('a Flurry given by a minion PLAYED mid-turn', () => {
  const bc = (uid: string, cardId: string): BoardCard => {
    const d = CARD_INDEX[cardId]!;
    return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false } as BoardCard;
  };
  it('a REAL play through the plain reducer: play Beetle, pick Flurry, target a Beast', () => {
    // Not Beetles on the board: three would merge into a triple.
    let run = { ...createRun(5, 'warden', 'ascent'), phase: 'recruit', embers: 30, hand: [bc('p', 'beetle')], board: [bc('t', 'b2_beev'), bc('t2', 'b2_beev')] } as unknown as RunState;
    for (const action of [{ type: 'play', uid: 'p' }, { type: 'chooseOne', index: 1 }]) run = reduce(run, action as never);
    const before = new Map(run.board.map((c) => [c.uid, c.keywords.includes('W')]));
    run = reduce(run, { type: 'battlecryTarget', targetUid: 't' } as never);
    expect(playedFlurryGrants(before, run.board)).toEqual([{ cardId: 'beetle', source: 'p', target: 't' }]);
  });
  it('the Rise option, or no fresh giver, is not a Flurry grant', () => {
    const card = (uid: string, cardId: string, keywords: string[] = []) => ({ uid, cardId, keywords });
    const prev = new Map([['t', false]]);
    expect(playedFlurryGrants(prev, [card('t', 'b2_beev', ['R']), card('p', 'beetle')])).toEqual([]);
    expect(playedFlurryGrants(prev, [card('t', 'b2_beev', ['W'])])).toEqual([]);
  });
});

describe('the call sites', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
  it('the Shop launches the bound beam from the played minion and claims its buff tendril', () => {
    const recruit = read('../../Recruit.tsx');
    expect(recruit).toContain("if (b && launchKeywordBeam('W', giver, g.target, { def: b.def, gain: b.gain })) { claimedW.add(g.target); pairs.push(`${g.source}|${g.target}`); }");
    expect(recruit).toContain("if (prevW!.get(c.uid) === false && c.keywords.includes('W') && !claimedW.has(c.uid)) gains.push('W');");
    expect(recruit).toContain("keyword === 'R' || keyword === 'V' || keyword === 'DS' || keyword === 'W'");
  });
  it('the card hides a held Flurry, and the hold releases', () => {
    expect(read('../../Card.tsx')).toContain("card.keywords.includes('W') && !flurryHeld && (");
    holdFlurry('f1', 500);
    expect(isFlurryHeld('f1')).toBe(true);
    holdFlurry('f1', 0);
    expect(isFlurryHeld('f1')).toBe(false);
  });
});
