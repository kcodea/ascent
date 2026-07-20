import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, poolOf, type RunState } from './index';
import { weldMagnetic } from './recruit';

/**
 * Tier 7 (Summit) minions. The gating contract matters as much as the effects: these must be UNREACHABLE
 * in a normal run purely because no shop gets to tier 7, with no extra flag doing the work.
 */
const mk = (uid: string, cardId: string, tribe: RunState['board'][number]['tribe'], attack = 1, health = 1, golden = false): RunState['board'][number] =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden });

describe('Tier 7 content + gating', () => {
  const T7 = ['thundeer', 'amunrab', 'attachmentconductor', 'mauron', 'anubis', 'salvatore', 'labexperiment'];

  it('all seven exist at tier 7 and are ordinary buyables (no special flag)', () => {
    for (const id of T7) {
      const c = CARD_INDEX[id];
      expect(c, id).toBeDefined();
      expect(c!.tier, id).toBe(7);
      expect(c!.token, id).toBeFalsy(); // NOT gated by the token flag — the tier alone gates them
      expect(c!.spell, id).toBeFalsy();
    }
  });

  it('a shop below tier 7 can never offer one (the only gate that exists)', () => {
    const s: RunState = { ...createRun(1, 'warden'), tier: 6 };
    const offerable = poolOf(s).buyable.filter((c) => c.tier <= s.tier);
    for (const id of T7) expect(offerable.some((c) => c.id === id), id).toBe(false);
  });

  it('Lab Experiment counts as every tribe; Mauron is immune while attacking', () => {
    expect(CARD_INDEX['labexperiment']!.universalTribe).toBe(true);
    expect(CARD_INDEX['mauron']!.attackImmuneAlways).toBe(true);
    expect(CARD_INDEX['mauron']!.keywords).toContain('C'); // Cleave
  });

  it('every Tier 7 card carries 6 pool copies, like Tier 6', () => {
    const s = createRun(1, 'warden');
    for (const id of T7) expect(s.pool[id], id).toBe(6);
  });
});

describe('Attachment Conductor — every weld lands twice (three times gilded)', () => {
  const payload = { source: 'Cling Drone', attack: 1, health: 1, keywords: [], mana: 0 };
  const weldOnto = (extra: RunState['board']): RunState => {
    const s: RunState = { ...createRun(1, 'warden'), phase: 'recruit',
      board: [mk('h', 'drone', 'mech', 2, 2), ...extra] };
    weldMagnetic(s, s.board[0]!, payload, 0, 'auto');
    return s;
  };

  it('doubles a weld with a Conductor on board, triples it gilded', () => {
    const none = weldOnto([]);
    const one = weldOnto([mk('c', 'attachmentconductor', 'mech', 7, 10)]);
    const gild = weldOnto([mk('c', 'attachmentconductor', 'mech', 14, 20, true)]);
    expect(none.board[0]!.attachments).toBe(1);
    expect(one.board[0]!.attachments).toBe(2);
    expect(gild.board[0]!.attachments).toBe(3);
    // The stat grant scales with it too (+1/+1 per landing).
    expect(one.board[0]!.attack - none.board[0]!.attack).toBe(1);
    expect(gild.board[0]!.attack - none.board[0]!.attack).toBe(2);
  });

  it('does NOT stack — two Conductors are still x2 (best copy counts, like Drakko)', () => {
    const two = weldOnto([mk('c1', 'attachmentconductor', 'mech', 7, 10), mk('c2', 'attachmentconductor', 'mech', 7, 10)]);
    expect(two.board[0]!.attachments).toBe(2);
  });

  it('multiplies the Beatbot mirror as well as the host', () => {
    const s = weldOnto([mk('bb', 'beatboxer', 'mech', 8, 8), mk('c', 'attachmentconductor', 'mech', 7, 10)]);
    expect(s.board.find((c) => c.uid === 'h')!.attachments).toBe(2);
    expect(s.board.find((c) => c.uid === 'bb')!.attachments).toBe(2);
  });
});

describe('Salvatore McKlusky — selling opens two Tier 6 Discovers', () => {
  it('sells into a Tier 6 Discover, and gilds the pick when gilded', () => {
    const sell = (golden: boolean): RunState => reduce(
      { ...createRun(1, 'warden'), phase: 'recruit', board: [mk('s', 'salvatore', 'neutral', 5, 5, golden)] },
      { type: 'sell', uid: 's' },
    );
    const plain = sell(false);
    expect(plain.discover?.length).toBeGreaterThan(0);
    for (const id of plain.discover!) expect(CARD_INDEX[id]!.tier).toBe(6);
    expect(plain.discoverQueue?.length).toBe(1); // the SECOND Discover is queued behind the first
    expect(plain.discoverGolden).toBeFalsy();
    expect(sell(true).discoverGolden).toBe(true);
  });
});
