import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type CombatSideState } from '@game/core';
import { replayBeats, replayOrder } from './choreo/replayOrder';
import { echoWaves, unsignalledEchoLaunch } from './useCombatReplay';

/**
 * R-ECHO-LAUNCH-01 (bug d3a682a6, owner report 2026-10-12: Fel Spikes "when triggered from start of combat rune ...
 * doesn't play the animation"). Rune of the Herald fires a LIVING Fel Spikes' Echo straight from the rune: no death
 * and no rally to launch the spike volley from, so the spray landed with no animation. `unsignalledEchoLaunch` finds
 * that spray's opening wave so the replay launches the volley from the living body, and never double-launches a
 * spray a death or a rally already owns.
 */
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], ...extra });
const wall = (n: number, hp = 40): BoardMinion[] => Array.from({ length: n }, () => bm('trainingdummy', 0, hp));
const felSpikes = (golden = false, health = 40) => bm('dm_felspikes', 0, health, { keywords: ['T'], golden });

function replay(p: BoardMinion[], e: BoardMinion[], pSide: Partial<CombatSideState> = {}) {
  const r = simulate(p, e, makeRng(7), CARD_INDEX, combatSide({ tier: 6, ...pSide }), combatSide({ tier: 6 }));
  const events = replayOrder(r.events) as CombatEvent[];
  const moments = replayBeats(r.events);
  const cardIds = new Map<string, string>();
  for (const m of [...r.initial.player, ...r.initial.enemy]) cardIds.set(m.uid, m.cardId);
  // Every moment that a forced-Echo launch fires before: [index of the launching (shown) moment, launch].
  const launches = moments.flatMap((next, k) => {
    const l = k > 0 ? unsignalledEchoLaunch(moments[k - 1], next, events, cardIds) : null;
    return l ? [{ k, ...l }] : [];
  });
  return { events, moments, launches };
}
const HERALD = { questMods: { runeHerald: true } } as Partial<CombatSideState>;

describe('a Herald-forced Fel Spikes launches its volley (R-ECHO-LAUNCH-01)', () => {
  it('the spray opens right after the rune pulse and launches ONCE, from the living Fel Spikes', () => {
    const { events, moments, launches } = replay([felSpikes(), ...wall(2)], wall(3), HERALD);
    expect(launches).toHaveLength(1);
    const l = launches[0]!;
    expect(moments[l.k - 1]!.primary.type, 'launched as the Herald pulse plays').toBe('questTrigger');
    expect(l.src).toBe('m0');
    expect(l.def).toBe('fel-spike');
    const waves = echoWaves(events, l.src, moments[l.k]!.start - 1, l.endIdx);
    expect(waves).toHaveLength(1);
    expect(waves[0]!.uids.length, 'every minion but the Demon itself is struck').toBe(5);
  });

  it('a GOLDEN Fel Spikes: one launch carries both passes (the second pass is a continuation)', () => {
    const { events, moments, launches } = replay([felSpikes(true), bm('dm_radrachel', 0, 40), ...wall(2)], wall(3), HERALD);
    expect(launches).toHaveLength(1);
    const l = launches[0]!;
    expect(echoWaves(events, l.src, moments[l.k]!.start - 1, l.endIdx)).toHaveLength(2);
  });

  it('a death-fired spray is never re-launched (its death path owns the volley)', () => {
    const { events, launches } = replay([felSpikes(false, 1), ...wall(2)], [bm('trainingdummy', 5, 40), ...wall(2)]);
    expect(events.some((e) => e.type === 'death' && e.target === 'm0')).toBe(true);
    expect(events.some((e) => e.type === 'dmg' && e.source === 'm0' && e.wave !== undefined)).toBe(true);
    expect(launches).toHaveLength(0);
  });

  it('a rally-forced spray (Spots at Start of Combat) is never re-launched (the rally path owns it)', () => {
    const { events, launches } = replay([felSpikes(), bm('b2_spots', 0, 40), ...wall(1)], wall(3));
    expect(events.some((e) => e.type === 'rally' && e.target === 'm0')).toBe(true);
    expect(launches).toHaveLength(0);
  });
});
