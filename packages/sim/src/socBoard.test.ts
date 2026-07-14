import { describe, it, expect } from 'vitest';
import type { BoardMinion } from '@game/core';
import { simulate, makeRng } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { socBoard } from './snapshot';

const ALL = ['beast', 'undead', 'mech', 'dragon', 'demon'];

describe('socBoard — the board WITH Start-of-Combat buffs (Hall of Champions)', () => {
  it('folds Pack Leader\'s SoC Beast buff into the captured board', () => {
    // Pack Leader (Start of Combat: give your Beasts +2/+2, improving per Beast played). With 0 Beasts played this
    // turn it's the flat +2/+2 — both the Pack Leader (a Beast) and the Alleycat should read buffed.
    const player: BoardMinion[] = [
      { cardId: 'packleader', attack: 2, health: 4, keywords: [] },
      { cardId: 'alley', attack: 1, health: 1, keywords: [] },
    ];
    const enemy: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 500 }];
    const r = simulate(player, enemy, makeRng(1), CARD_INDEX, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, ALL);
    // Base capture (pre-SoC) is the run stats; socBoard should show the +2/+2 SoC buff on top.
    const soc = socBoard(r);
    const pl = soc.find((m) => m.cardId === 'packleader')!;
    const alley = soc.find((m) => m.cardId === 'alley')!;
    expect([pl.attack, pl.health]).toEqual([4, 6]); // 2/4 + SoC +2/+2
    expect([alley.attack, alley.health]).toEqual([3, 3]); // 1/1 + SoC +2/+2
    // Sanity: the raw initial (pre-SoC) board is NOT buffed.
    expect([r.initial.player[1]!.attack, r.initial.player[1]!.health]).toEqual([1, 1]);
  });
});
