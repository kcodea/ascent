import { describe, it, expect } from 'vitest';
import { CARD_INDEX, QUEST_INDEX, validateQuests } from '@game/content';
import { createRun, type RunState } from './state';
import { reduce } from './reducer';
import { questBucketFor } from './quests';
import { applyEndOfTurn } from './recruit';

/** Build a board minion from its real card def (tribe/stats/keywords), so tests exercise the true cards. */
const mk = (uid: string, cardId: string, over: Partial<RunState['board'][number]> = {}): RunState['board'][number] => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const base = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1, 'warden'), wave: 3, phase: 'recruit', ...over });

describe('Turn-11 capstone quests (owner batch 2026-07-13)', () => {
  it('all five new quests validate + land in the turn-11 bucket', () => {
    validateQuests();
    const ids = ['q_passing_spears', 'q_forsaken_speed', 'q_cratering_missive', 'q_banes_existence', 'q_clinging_on'];
    for (const id of ids) {
      const q = QUEST_INDEX[id];
      expect(q, id).toBeDefined();
      expect(questBucketFor(q!)).toBe(11);
    }
  });

  it('Passing Spears: End of Turn — each Spear Warden gives ANOTHER minion +2/+2', () => {
    const s = base({ questRecurringEndOfTurn: ['spearWardenEcho'], board: [mk('w', 'knit'), mk('a', 'alley')] });
    applyEndOfTurn(s);
    const ally = s.board.find((c) => c.uid === 'a')!;
    expect([ally.attack, ally.health]).toEqual([1 + 2, 1 + 2]); // the non-Warden ally got +2/+2
    const warden = s.board.find((c) => c.uid === 'w')!;
    expect([warden.attack, warden.health]).toEqual([CARD_INDEX['knit']!.attack, CARD_INDEX['knit']!.health]); // Warden buffed no one else → itself unchanged
  });

  it('Forsaken Speed: End of Turn — your Undead gain +3 Attack per card played this turn (Attack only)', () => {
    const s = base({ questRecurringEndOfTurn: ['undeadPlayedAtk'], playedThisTurn: ['x', 'y'], board: [mk('u', 'knit'), mk('b', 'alley')] });
    const undeadHp = s.board[0]!.health;
    applyEndOfTurn(s);
    const undead = s.board.find((c) => c.uid === 'u')!;
    expect(undead.attack).toBe(CARD_INDEX['knit']!.attack + 3 * 2); // +3 Atk × 2 cards played
    expect(undead.health).toBe(undeadHp); // Attack only — no health
    expect(s.board.find((c) => c.uid === 'b')!.attack).toBe(1); // the Beast (non-Undead) is untouched
  });

  it('Cratering Missive: End of Turn — whole board +1/+1 per Cratering Hulk', () => {
    const s = base({ questRecurringEndOfTurn: ['crateringMissive'], board: [mk('h1', 'thunderingabomination'), mk('h2', 'thunderingabomination'), mk('a', 'alley')] });
    applyEndOfTurn(s);
    const ally = s.board.find((c) => c.uid === 'a')!;
    expect([ally.attack, ally.health]).toEqual([1 + 2, 1 + 2]); // 2 Hulks → +2/+2 to everyone
  });

  it('Clinging On: End of Turn — welds a Cling Drone onto up to 3 of your Mechs', () => {
    const s = base({ questRecurringEndOfTurn: ['attachClingDrones'], board: [mk('m', 'drone'), mk('n', 'alley')] });
    const mechAtk = s.board[0]!.attack;
    applyEndOfTurn(s);
    const mech = s.board.find((c) => c.uid === 'm')!;
    expect(mech.attachments ?? 0).toBe(1); // one Cling Drone welded on
    expect(mech.attack).toBeGreaterThan(mechAtk); // its stats grew by the Drone's
    expect(s.board.find((c) => c.uid === 'n')!.attachments ?? 0).toBe(0); // the non-Mech got nothing
  });

  it("Bane's Existence: with the widen armed, a triggered Battlecry also buffs your Demons", () => {
    // Bane reacts to any Battlecry you trigger. Play Soulfeeder (a Battlecry) → Bane fires → the widen buffs
    // every Demon (here the control Demon 'swordbored') +2/+2 on top of the usual Fodder/Imp enchant.
    const s = base({
      baneBuffsDemons: { attack: 2, health: 2 }, embers: 0, shop: [], pendingTavern: [],
      board: [mk('b', 'bane'), mk('d', 'swordbored')],
      hand: [mk('sf', 'feed')],
    });
    const before = s.board.find((c) => c.uid === 'd')!;
    const [a0, h0] = [before.attack, before.health];
    const out = reduce(s, { type: 'play', uid: 'sf' });
    const demon = out.board.find((c) => c.uid === 'd')!;
    expect([demon.attack, demon.health]).toEqual([a0 + 2, h0 + 2]); // the widen fired

    // Without the flag, the same Battlecry leaves the control Demon alone.
    const noFlag = reduce({ ...s, baneBuffsDemons: undefined }, { type: 'play', uid: 'sf' });
    const demon2 = noFlag.board.find((c) => c.uid === 'd')!;
    expect([demon2.attack, demon2.health]).toEqual([a0, h0]);
  });
});
