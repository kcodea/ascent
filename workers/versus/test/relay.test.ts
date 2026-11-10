/**
 * R-VERSUS-CF-RELAY-SCOPE-01 (netcode audit F6 / F17): a player's live screen (spectator frames, the cursor, keyframe
 * asks, "I am viewing you") is relayed to the stands and the teammate, never to an opponent. Spectating and the
 * teammate view keep every message they had.
 */
import { describe, expect, it } from 'vitest';
import { relayAudience, RELAY_CURSOR, RELAY_KEY, RELAY_SPECTATE, RELAY_WATCH } from '../src/relay';

const duos = [
  { userId: 'a1', role: 'p1' }, { userId: 'a2', role: 'p2' }, { userId: 'b1', role: 'p3' }, { userId: 'b2', role: 'p4' },
  { userId: 's1', role: 'spectator' }, { userId: 's2', role: 'spectator' },
];
const party = [{ userId: 'a1', role: 'p1' }, { userId: 'a2', role: 'p2' }, { userId: 's1', role: 'spectator' }];
const duel = [{ userId: 'a1', role: 'p1' }, { userId: 'b1', role: 'p2' }, { userId: 's1', role: 'spectator' }];
const group = [{ userId: 'a', role: 'p1' }, { userId: 'b', role: 'p2' }, { userId: 'c', role: 'p3' }, { userId: 'out', role: 'spectator' }];
const to = (s: Set<string> | null): string[] | null => (s ? [...s].sort() : null);

describe('relayAudience (R-VERSUS-CF-RELAY-SCOPE-01)', () => {
  it('THE LEAK: a Duos player\'s frames and cursor reach the teammate and the stands, never the other team', () => {
    for (const ev of [RELAY_SPECTATE, RELAY_CURSOR]) {
      expect(to(relayAudience('duos', duos, 'a1', ev))).toEqual(['a2', 's1', 's2']);
      expect(to(relayAudience('duos', duos, 'b2', ev))).toEqual(['b1', 's1', 's2']);
    }
  });

  it('the Ranked Duos party: the teammate and the stands', () => {
    expect(to(relayAudience('ranked_duos', party, 'a2', RELAY_SPECTATE))).toEqual(['a1', 's1']);
    expect(to(relayAudience('ranked_duos', party, 'a2', RELAY_CURSOR))).toEqual(['a1', 's1']);
  });

  it('1v1 and Group have no teammate: the stands only (a knocked-out Group player is in the stands and still watches)', () => {
    expect(to(relayAudience('duel', duel, 'a1', RELAY_SPECTATE))).toEqual(['s1']);
    expect(to(relayAudience('group', group, 'a', RELAY_CURSOR))).toEqual(['out']);
  });

  it('a keyframe ask: from the stands it reaches every seated player; from a player, the teammate only', () => {
    expect(to(relayAudience('duos', duos, 's1', RELAY_KEY))).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(to(relayAudience('duel', duel, 's1', RELAY_KEY))).toEqual(['a1', 'b1']);
    expect(to(relayAudience('duos', duos, 'a1', RELAY_KEY))).toEqual(['a2']);
    expect(to(relayAudience('duel', duel, 'a1', RELAY_KEY))).toEqual([]);
  });

  it('"I am viewing you" goes to the teammate alone (it gates their cursor stream)', () => {
    expect(to(relayAudience('duos', duos, 'b1', RELAY_WATCH))).toEqual(['b2']);
    expect(to(relayAudience('ranked_duos', party, 'a1', RELAY_WATCH))).toEqual(['a2']);
    expect(to(relayAudience('duos', duos, 's1', RELAY_WATCH))).toEqual([]);
  });

  it('never back to the sender; a stranger reaches nobody with a live-screen event', () => {
    for (const ev of [RELAY_SPECTATE, RELAY_CURSOR, RELAY_KEY, RELAY_WATCH]) {
      expect(relayAudience('duos', duos, 'a1', ev)!.has('a1')).toBe(false);
      expect(to(relayAudience('duos', duos, 'nobody', ev))).toEqual([]);
    }
  });

  it('everything else (emotes, a spectator\'s own events) is not scoped: every other member, as before', () => {
    expect(relayAudience('duos', duos, 'a1', 'versus_emote')).toBeNull();
    expect(relayAudience('duos', duos, 's1', 'spectator_emote')).toBeNull();
    expect(relayAudience('duos', duos, 'a1', 'spectate_bye')).toBeNull();
  });
});
