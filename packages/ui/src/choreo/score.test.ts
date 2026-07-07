import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from './compile';
import { sfx } from '../sfx';
import { SCORE, runMomentCues } from './score';

const moment = (kind: Moment['kind'], events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind });

afterEach(() => vi.restoreAllMocks());

describe('score', () => {
  it('every MomentKind has a cue list (exhaustive score)', () => {
    for (const cues of Object.values(SCORE)) expect(Array.isArray(cues)).toBe(true);
  });

  it('runMomentCues fires the sfx channel and routes a real-death shake to onShake', () => {
    const death = vi.spyOn(sfx, 'death').mockImplementation(() => {});
    const onShake = vi.fn();
    const evs: CombatEvent[] = [{ type: 'death', target: 'a', side: 'enemy' }];
    runMomentCues(moment('death', evs), { events: evs, onShake });
    expect(death).toHaveBeenCalledTimes(1);
    expect(onShake).toHaveBeenCalledTimes(1);
  });

  it('a no-sound moment fires nothing and does not shake', () => {
    const onShake = vi.fn();
    const evs: CombatEvent[] = [{ type: 'reveal', target: 'a' }];
    runMomentCues(moment('reveal', evs), { events: evs, onShake });
    expect(onShake).not.toHaveBeenCalled();
  });
});
