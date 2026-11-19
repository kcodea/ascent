import { describe, it, expect } from 'vitest';
import type { RunLobby } from '@game/sim';
import { lobbySignature } from './stableLobby';

function lobby(): RunLobby {
  return {
    version: 1, seed: 7, round: 3, finished: false, rules: {} as RunLobby['rules'],
    seats: [
      { id: 'p', label: 'You', heroId: 'warden', kind: 'player', seed: 1, resolve: 30, armor: 5, alive: true },
      { id: 'b1', label: 'Bot', heroId: 'fi', kind: 'bot', seed: 2, resolve: 22, armor: 0, alive: true, intel: { tier: 3, triples: 1, round: 2 } },
    ],
    encounters: [{ round: 2, a: 'p', b: 'b1', outcome: 'win', damageToA: 0, damageToB: 8, fought: true }],
  } as RunLobby;
}

describe('lobbySignature (R-PERF-LOBBY-STABLE-01)', () => {
  it('is the same for a deep clone: a shop action clones the run and changes nothing in the table', () => {
    const a = lobby();
    expect(lobbySignature(structuredClone(a))).toBe(lobbySignature(a));
  });
  it('moves with every field the reducer writes', () => {
    const base = lobbySignature(lobby());
    const edits: Array<(l: RunLobby) => void> = [
      (l) => { l.round++; },
      (l) => { l.finished = true; },
      (l) => { l.seats[0]!.resolve -= 4; },
      (l) => { l.seats[0]!.armor = 0; },
      (l) => { l.seats[1]!.alive = false; },
      (l) => { l.seats[1]!.placement = 8; },
      (l) => { l.seats[1]!.intel = { tier: 4, triples: 1, round: 3 }; },
      (l) => { l.encounters.push({ round: 3, a: 'p', b: 'b1', outcome: 'lose', damageToA: 6, damageToB: 0, fought: false } as RunLobby['encounters'][number]); },
      (l) => { l.encounters[0]!.fought = false; },
    ];
    for (const edit of edits) {
      const l = lobby();
      edit(l);
      expect(lobbySignature(l)).not.toBe(base);
    }
  });
});
