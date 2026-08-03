import { describe, it, expect } from 'vitest';
import { CARD_INDEX, RUNE_INDEX } from '@game/content';
import { createLobbyRun, boardIntel } from './lobby/runLobby';
import { createRun, type BoardCard, type RunState } from './state';
import { reduce } from './reducer';
import type { BoardSnapshot } from './snapshot';

/**
 * Owner batch 2026-08-03c.
 */

describe("Farseer's Report scouts the board you will ACTUALLY fight", () => {
  const scroll = (uid: string): BoardCard =>
    ({ uid, cardId: 'farseersreport', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

  it('in a LOBBY run it reads the paired seat, not the course pool pin', () => {
    // The bug: the factory read `servedBoards[wave]` — the Ascent/course matchmaking pin — while a lobby run
    // fights `lobbyOpponentBoard(lobby)`, the seat the pairing gave it. Both can be real boards, so the spell
    // confidently showed minions from a board the run would never face (owner report: "wrong minions").
    const s: RunState = { ...createLobbyRun(4242, 'sellsword'), embers: 20 };
    // Plant a DECOY course pin whose bodies exist nowhere in the lobby, so a regression is unmistakable.
    const decoy: BoardSnapshot = {
      v: 1, wave: s.wave, heroId: 'sellsword', resolve: 30, tier: 6, setId: s.setId,
      minions: [
        { cardId: 'sandbag', attack: 99, health: 99 },
        { cardId: 'sandbag', attack: 98, health: 98 },
        { cardId: 'sandbag', attack: 97, health: 97 },
      ],
    } as never;
    s.servedBoards = { ...(s.servedBoards ?? {}), [s.wave]: decoy };
    s.hand = [scroll('f')];

    const after = reduce(s, { type: 'play', uid: 'f' });
    const scouted = after.scoutedNextOpponent ?? [];
    expect(scouted.length, 'the scout must produce a read').toBeGreaterThan(0);
    // None of the decoy's freakish stats may appear — those belong to the board this run never fights.
    expect(scouted.some((m) => m.attack >= 97), 'scouted the COURSE pin instead of the lobby seat').toBe(false);
  });

  it('a course (non-lobby) run still reads the pinned served board', () => {
    const s: RunState = { ...createRun(7, 'sellsword'), embers: 20 };
    const pinned: BoardSnapshot = {
      v: 1, wave: s.wave, heroId: 'sellsword', resolve: 30, tier: 3, setId: s.setId,
      minions: [{ cardId: 'sandbag', attack: 42, health: 42 }],
    } as never;
    s.servedBoards = { [s.wave]: pinned };
    s.hand = [scroll('f')];
    const after = reduce(s, { type: 'play', uid: 'f' });
    expect(after.scoutedNextOpponent).toEqual([{ cardId: 'sandbag', attack: 42, health: 42 }]);
  });
});

describe('lobby scout intel carries the seat’s quests + runes (owner ask 2026-08-03)', () => {
  it('boardIntel passes the snapshot’s quests/runes through', () => {
    const snapshot = {
      v: 1, wave: 5, heroId: 'sellsword', resolve: 30, tier: 4, setId: 'set2',
      minions: [{ cardId: 'sandbag', attack: 3, health: 3 }],
      triples: 2,
      quests: ['q_trophy_den'],
      runes: ['rune_broodpit'],
    } as unknown as BoardSnapshot;
    const intel = boardIntel({ minions: snapshot.minions, tier: 4, snapshot } as never, 5);
    expect(intel.quests).toEqual(['q_trophy_den']);
    expect(intel.runes).toEqual(['rune_broodpit']);
  });

  it('omits them entirely when the seat has none (no empty arrays to render)', () => {
    const snapshot = {
      v: 1, wave: 2, heroId: 'sellsword', resolve: 30, tier: 2, setId: 'set2',
      minions: [{ cardId: 'sandbag', attack: 3, health: 3 }],
    } as unknown as BoardSnapshot;
    const intel = boardIntel({ minions: snapshot.minions, tier: 2, snapshot } as never, 2);
    expect(intel.quests).toBeUndefined();
    expect(intel.runes).toBeUndefined();
  });
});

describe('Rune of the Broodpit is Avenge (4)', () => {
  it('the printed text matches the engine threshold', () => {
    // Text and engine had ALREADY drifted once here (the reducer comment said "Avenge 6" while the code ran
    // 3), which is exactly how a card starts lying. Pin the text; the threshold itself is the literal in
    // `simulate`'s runeAvenge(4, 'runeBroodpit', …).
    const rune = RUNE_INDEX['rune_broodpit']!;
    expect(rune, 'the rune must exist').toBeDefined();
    expect(rune.text).toContain('Avenge (4)');
    expect(rune.text, 'the old threshold must be gone').not.toContain('Avenge (3)');
    expect(CARD_INDEX['impscrap'], 'the Imp it summons must exist').toBeDefined();
  });
});
