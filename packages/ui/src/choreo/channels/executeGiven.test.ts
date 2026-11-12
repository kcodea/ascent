import { afterEach, describe, expect, it, vi } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { compileMoments, DEFAULT_RULES } from '../compile';
import { bindingFor } from '../bindings';
import { executesGivenIn, givesExecute } from './executeGiven';
import { EXECUTE_LAND_SFX, EXECUTE_LAUNCH_SFX, executeLaunchDelayMs, isTravelledExecute } from '../../fx/executeGivenLaunch';
import { readFileSync } from 'node:fs';
import { holdExecute, isExecuteHeld, EXECUTE_HOLD_MAX_MS } from '../../fx/executeHold';

/**
 * "ON EXECUTE GIVEN" (R-FX-EXECUTE-GIVEN-01, owner 2026-11-12): a minion that gives another minion Execute launches
 * its bound effect from itself, and the Execute aura on the receiver waits for it. Graded on a SIMULATED fight so the
 * event shape is the engine's.
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });
const ravenFight = (golden = false) => simulate(
  [bm('b2_raven', 4, 60, { keywords: ['RL'], golden }), bm('b2_beev', 1, 60), bm('b2_beev', 1, 60), bm('trainingdummy', 0, 60)],
  [bm('trainingdummy', 0, 60), bm('trainingdummy', 0, 60)],
  makeRng(7), CARD_INDEX, combatSide({ tier: 4 }), combatSide({ tier: 4 }));
const ids = new Map([['m0', 'b2_raven'], ['m1', 'b2_beev'], ['m2', 'b2_beev'], ['m3', 'trainingdummy'], ['m4', 'trainingdummy'], ['m5', 'trainingdummy']]);

function ravenSwing(events: CombatEvent[]) {
  const moments = compileMoments(events, DEFAULT_RULES);
  const m = moments.find((x) => x.primary.type === 'attack' && x.primary.attacker === 'm0');
  expect(m, 'Raven attacks').toBeDefined();
  return m!;
}

describe('which cards give Execute', () => {
  it('Raven and Tort do; a Ward giver and a plain minion do not', () => {
    expect(givesExecute('b2_raven')).toBe(true);
    expect(givesExecute('b2_tort')).toBe(true);
    expect(givesExecute('n2_lastlight')).toBe(false);
    expect(givesExecute('trainingdummy')).toBe(false);
    expect(givesExecute(null)).toBe(false);
  });

  it('both are bound to the owner\'s beam', () => {
    expect(bindingFor('b2_raven', 'executeGiven')?.def).toBe('execute-beam');
    expect(bindingFor('b2_tort', 'executeGiven')?.def).toBe('execute-beam');
  });
});

describe('the grants in a moment', () => {
  it('Raven\'s Rally: one grant, from Raven to another Beast, inside its own swing', () => {
    const { events } = ravenFight();
    const given = executesGivenIn(ravenSwing(events), events, ids);
    expect(given).toHaveLength(1);
    expect(given[0]!.source).toBe('m0');
    expect(given[0]!.cardId).toBe('b2_raven');
    expect(['m1', 'm2']).toContain(given[0]!.target);
    expect(isTravelledExecute(given[0]!)).toBe(true);
  });

  it('Gilded Raven: two grants, to two different Beasts', () => {
    const { events } = ravenFight(true);
    const given = executesGivenIn(ravenSwing(events), events, ids);
    expect(given.map((g) => g.target).sort()).toEqual(['m1', 'm2']);
  });

  it('a keyword that is not Execute, has no source, or was self-given is not a travel', () => {
    const events = [
      { type: 'keyword', target: 'a', keyword: 'T', source: 'g' },
      { type: 'keyword', target: 'a', keyword: 'V' },
      { type: 'keyword', target: 'g', keyword: 'V', source: 'g' },
      { type: 'keyword', target: 'a', keyword: 'V', source: 'g' },
    ] as CombatEvent[];
    const moment = { start: 0, end: events.length, primary: events[0]!, stepGroups: [[0, 1, 2, 3]], kind: 'buffWave' as const };
    expect(executesGivenIn(moment, events, new Map([['g', 'b2_tort']]))).toEqual([{ cardId: 'b2_tort', source: 'g', target: 'a' }]);
  });
});

describe('when the effect leaves', () => {
  const g = { cardId: 'b2_raven', source: 'm0', target: 'm1' };
  it('the attacker\'s own grant waits for the Rally pulse (the wind-up); any other leaves at once', () => {
    expect(executeLaunchDelayMs(g, 'm0', 260)).toBe(260);
    expect(executeLaunchDelayMs(g, 'm9', 260)).toBe(0);
    expect(executeLaunchDelayMs(g, null, 260)).toBe(0);
  });
});

describe('the sounds (owner 2026-11-12)', () => {
  const clips = (id: string): string[] => (JSON.parse(readFileSync(new URL(`../../fx/defs/${id}.json`, import.meta.url), 'utf8')) as { layers: Array<{ params?: { clip?: string } }> })
    .layers.map((l) => String(l.params?.clip));
  it('the slice plays as the effect leaves; the blood and the ding play together as it lands', () => {
    expect(clips(EXECUTE_LAUNCH_SFX)).toEqual(['fx/execute-slice']);
    expect(clips(EXECUTE_LAND_SFX).sort()).toEqual(['fx/execute-blood', 'fx/execute-ding']);
  });
  it('each rings once per giver per beat, so two beams are not two stacked copies', () => {
    const src = readFileSync(new URL('../../fx/executeGivenLaunch.ts', import.meta.url), 'utf8');
    expect(src).toContain('if (landed.has(g.source)) return;');
    expect(src).toContain('if (!sliced.has(g.source))');
  });
  it('the effect follows its receiver to the slot it settles in (owner 2026-11-12, a death collapsing the row)', () => {
    const src = readFileSync(new URL('../../fx/executeGivenLaunch.ts', import.meta.url), 'utf8');
    expect(src).toContain('const settle = trackSettledSlot(() => document.querySelector(unitSelector(g.target)));');
    expect(src).toContain('target: settle?.get, onDone: settle?.stop');
  });
});

describe('the aura hold', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('hides the aura, releases on demand, and always expires on its own', () => {
    vi.useFakeTimers();
    holdExecute('u1', 500);
    expect(isExecuteHeld('u1')).toBe(true);
    holdExecute('u1', 0);
    expect(isExecuteHeld('u1')).toBe(false);
    holdExecute('u2', 999_999);
    vi.advanceTimersByTime(EXECUTE_HOLD_MAX_MS + 1);
    expect(isExecuteHeld('u2')).toBe(false);
  });
});
