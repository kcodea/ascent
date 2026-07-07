import { describe, expect, it } from 'vitest';
import { makeRng, simulate, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { momentKind } from './kinds';

describe('momentKind', () => {
  it('classifies the primary event types we author against', () => {
    const cases: [CombatEvent, string][] = [
      [{ type: 'attack', attacker: 'a', defender: 'b', swing: 0 }, 'attackExchange'],
      [{ type: 'dmg', target: 'b', amount: 3, remainingHp: 1 }, 'impact'],
      [{ type: 'shield', target: 'b' }, 'impact'],
      [{ type: 'poison', target: 'b' }, 'impact'],
      [{ type: 'death', target: 'b', side: 'enemy' }, 'death'],
      [{ type: 'death', target: 'b', side: 'enemy', rise: true }, 'riseDeath'],
      [{ type: 'sc', source: 'a', text: 'x' }, 'scCast'],
      [{ type: 'summon', minion: { uid: 't', cardId: 'pup', name: 'Pup', tribe: 'beast', attack: 1, health: 1, keywords: [] }, side: 'player', index: 0 }, 'summon'],
      [{ type: 'buff', target: 'b', attack: 1, health: 1, source: 'x' }, 'buffWave'],
      [{ type: 'reborn', target: 'b', hp: 1, attack: 2, keywords: [] }, 'reborn'],
      [{ type: 'ascend', target: 'b', into: 'y' }, 'ascend'],
      [{ type: 'rally', source: 'a', target: 'b' }, 'rally'],
      [{ type: 'toHand', cardId: 'z', side: 'player' }, 'toHand'],
      [{ type: 'maxGold', target: 'b', side: 'player', amount: 1 }, 'maxGold'],
      [{ type: 'improve', target: 'b', amount: 1 }, 'improve'],
      [{ type: 'keyword', target: 'b', keyword: 'R' }, 'keyword'],
      [{ type: 'hpGrant', target: 'b', amount: 1 }, 'hpGrant'],
      [{ type: 'reveal', target: 'b' }, 'reveal'],
      [{ type: 'venomLost', target: 'b' }, 'impact'],
      [{ type: 'shieldUp', target: 'b' }, 'impact'],
    ];
    for (const [primary, kind] of cases) {
      expect(momentKind(primary)).toBe(kind);
    }
  });

  it('every compiled moment from a real fight has a kind', () => {
    const r = simulate(
      [{ cardId: 'stray', attack: 3, health: 10 }],
      [{ cardId: 'pack', attack: 2, health: 2 }], makeRng(3), CARD_INDEX,
    );
    const moments = compileMoments(r.events);
    for (const m of moments) expect(typeof m.kind).toBe('string');
    const kinds = new Set(moments.map((m) => m.kind));
    expect(kinds.has('attackExchange')).toBe(true);
  });
});
