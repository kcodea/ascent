/**
 * DUOS REAL-TIME TEAM EFFECTS (R-DUOS-RUNES-02): the client ships a mid-fight gift when its replay reaches the gift's
 * `teamSend` beat. `teamSendsReached` is that read: only MY board's sends (my side, my team member), only up to the cursor.
 */
import { describe, expect, it } from 'vitest';
import type { CombatEvent } from '@game/core';
import { teamSendsReached } from './duosCombat';

const ev: CombatEvent[] = [
  { type: 'attack', attacker: 'a', defender: 'b', swing: 1 },
  { type: 'teamSend', side: 'player', member: 0, idx: 0 },
  { type: 'teamSend', side: 'enemy', member: 0, idx: 0 },
  { type: 'teamSend', side: 'player', member: 1, idx: 0 },
  { type: 'teamSend', side: 'player', member: 0, idx: 1 },
];

describe('teamSendsReached (R-DUOS-RUNES-02)', () => {
  it('releases only my board\'s gifts, and only those the replay has reached', () => {
    expect(teamSendsReached(ev, 0, 0)).toEqual([]);
    expect(teamSendsReached(ev, 2, 0)).toEqual([0]);
    expect(teamSendsReached(ev, ev.length, 0)).toEqual([0, 1]);
    expect(teamSendsReached(ev, ev.length, 1)).toEqual([0]); // my teammate's board fought as the reserve
    expect(teamSendsReached(ev, 99, 0)).toEqual([0, 1]); // a skip: everything
  });
});
