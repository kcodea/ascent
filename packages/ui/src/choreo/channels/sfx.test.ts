import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { sfx } from '../../sfx';
import { playMomentSfx } from './sfx';

const moment = (events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[]], kind: 'damage' });

afterEach(() => vi.restoreAllMocks());

describe('playMomentSfx', () => {
  it('fires one sound per notable event type, deduped', () => {
    const buff = vi.spyOn(sfx, 'buff').mockImplementation(() => {});
    const shield = vi.spyOn(sfx, 'shield').mockImplementation(() => {});
    const evs: CombatEvent[] = [
      { type: 'buff', target: 'a', attack: 1, health: 1, source: 'x' },
      { type: 'buff', target: 'b', attack: 1, health: 1, source: 'x' },
      { type: 'shieldUp', target: 'c' },
    ];
    const r = playMomentSfx(moment(evs), evs);
    expect(buff).toHaveBeenCalledTimes(1);
    expect(shield).toHaveBeenCalledTimes(1);
    expect(r.shake).toBe(false);
  });

  it('a real death fires the death sound and signals shake; a Rise death does not', () => {
    const death = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const kill: CombatEvent[] = [{ type: 'death', target: 'a', side: 'enemy' }];
    expect(playMomentSfx(moment(kill), kill)).toEqual({ shake: true });
    expect(death).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
    const shatter = vi.spyOn(sfx, 'rebornShatter').mockImplementation(() => {});
    const deathSpy = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const rise: CombatEvent[] = [{ type: 'death', target: 'a', side: 'enemy', rise: true }];
    expect(playMomentSfx(moment(rise), rise)).toEqual({ shake: false });
    expect(shatter).toHaveBeenCalledTimes(1);
    expect(deathSpy).not.toHaveBeenCalled();
  });

  it('plays a dying unit\'s own death voiceline via cardIds, deduped per cardId, never for a Rise', () => {
    vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const cardDeath = vi.spyOn(sfx, 'cardDeath').mockImplementation(() => {});
    const cardIds = new Map([['u1', 'alley'], ['u2', 'alley'], ['u3', 'pack'], ['r1', 'reef']]);
    const evs: CombatEvent[] = [
      { type: 'death', target: 'u1', side: 'player' }, // alley
      { type: 'death', target: 'u2', side: 'player' }, // alley again → deduped
      { type: 'death', target: 'u3', side: 'enemy' },  // pack
      { type: 'death', target: 'r1', side: 'enemy', rise: true }, // Rise → no death voiceline
    ];
    playMomentSfx(moment(evs), evs, cardIds);
    expect(cardDeath.mock.calls.map((c) => c[0]).sort()).toEqual(['alley', 'pack']);
  });

  it('without a cardIds map, no per-card death voiceline fires (back-compat)', () => {
    vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const cardDeath = vi.spyOn(sfx, 'cardDeath').mockImplementation(() => {});
    const evs: CombatEvent[] = [{ type: 'death', target: 'u1', side: 'player' }];
    playMomentSfx(moment(evs), evs);
    expect(cardDeath).not.toHaveBeenCalled();
  });

  it('summon passes the token cardId to sfx.summon', () => {
    const summon = vi.spyOn(sfx, 'summon').mockImplementation(() => {});
    const evs: CombatEvent[] = [{ type: 'summon', minion: { uid: 't', cardId: 'pup', name: 'Pup', tribe: 'beast', attack: 1, health: 1, keywords: [] }, side: 'player', index: 0 }];
    playMomentSfx(moment(evs), evs);
    expect(summon).toHaveBeenCalledWith('pup');
  });

  it('only a genuine SC cast (cast:true) plays the cast sound', () => {
    const cast = vi.spyOn(sfx, 'cast').mockImplementation(() => {});
    const narration: CombatEvent[] = [{ type: 'sc', source: 'a', text: 'spell power' }];
    playMomentSfx(moment(narration), narration);
    expect(cast).not.toHaveBeenCalled();
    const real: CombatEvent[] = [{ type: 'sc', source: 'a', text: 'scorch', cast: true }];
    playMomentSfx(moment(real), real);
    expect(cast).toHaveBeenCalledTimes(1);
  });
});
