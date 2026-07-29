import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type RunState } from './index';

/**
 * CHORUS ENGINE'S ATTACHMENT ENCHANT IS PERMANENT (owner 2026-07-29).
 *
 * Its Rally buffed the Attachments standing on the field and stopped there — no `permaGain`, no run-wide aura —
 * so the grant evaporated at the bell and the card read as doing nothing between fights. It now goes through the
 * same "wherever they are" contract Scrap Herald's Battlecry already had: every Magnetic on the board and in
 * hand gains it, and `magneticBuyAtk/Hp` stacks so welded hosts and future copies inherit it too.
 */
const bm = (cardId: string, uid: string, attack = 5, health = 400, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords }) as unknown as BoardMinion;

const card = (uid: string, cardId: string, tribe: string, attack: number, health: number, keywords: string[] = []) =>
  ({ uid, cardId, tribe, attack, health, keywords, golden: false }) as never;

/** A Magnetic ("Attachment") minion id from live content, so the fixture can't drift off a renamed card. */
const MAGNETIC = Object.values(CARD_INDEX).find((c) => c.keywords.includes('M') && !c.token && !c.spell)!.id;

describe('Chorus Engine — the Attachment enchant carries back', () => {
  it('the fixture is real: Chorus Engine has the Rally, and a Magnetic minion exists', () => {
    const ce = CARD_INDEX['chorusengine']!;
    expect(ce.effects.some((e) => e.do === 'rallyBuffAttachments')).toBe(true);
    expect(CARD_INDEX[MAGNETIC]!.keywords).toContain('M');
  });

  it('combat reports the permanent Attachment gain instead of dropping it at the bell', () => {
    const r = simulate(
      [bm('chorusengine', 'CE', 5, 400, ['RL']), bm(MAGNETIC, 'A', 1, 400, ['M'])],
      [{ cardId: 'sandbag', attack: 0, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(r.playerMagneticBuffGain, 'the Rally granted nothing that survives combat').toBeTruthy();
    expect(r.playerMagneticBuffGain!.attack).toBeGreaterThan(0);
    expect(r.playerMagneticBuffGain!.health).toBeGreaterThan(0);
  });

  it('…and it plays a cue rather than landing silently', () => {
    // The Imp-aura lesson (owner report 2026-07-21): a run-wide grant that never emits reads as a dead card.
    const r = simulate(
      [bm('chorusengine', 'CE', 5, 400, ['RL']), bm(MAGNETIC, 'A', 1, 400, ['M'])],
      [{ cardId: 'sandbag', attack: 0, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const wash = r.events.find((e) => e.type === 'tribeAura' && (e as { aura?: string }).aura === 'magnetic');
    expect(wash, 'no Attachment aura wash was emitted').toBeTruthy();
    expect((wash as { tribe: string }).tribe).toBe('mech');
  });

  it('the ENEMY side never carries an Attachment aura back', () => {
    // Enemies are regenerated each wave and have no run state; a carry-back from their side would be a leak.
    const r = simulate(
      [{ cardId: 'sandbag', attack: 0, health: 9999 }],
      [bm('chorusengine', 'CE', 5, 400, ['RL']), bm(MAGNETIC, 'A', 1, 400, ['M'])],
      makeRng(3), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 6 }));
    expect(r.playerMagneticBuffGain).toBeUndefined();
  });

  /** A real recruit -> combat -> settle cycle, so settlement sees a genuine CombatResult rather than a
   *  hand-faked one (the first version of this test faked `lastCombat` and only proved the fake was wrong). */
  const runThroughCombat = (): RunState => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', wave: 4, embers: 20,
      board: [card('ce', 'chorusengine', 'mech', 40, 200, ['RL']), card('b', MAGNETIC, 'mech', 1, 1, ['M'])],
      hand: [card('h', MAGNETIC, 'mech', 1, 1, ['M'])],
    };
    s = reduce(s, { type: 'faceOmen' });
    let guard = 0;
    while (s.phase !== 'recruit' && guard++ < 10) {
      const next = reduce(s, { type: s.phase === 'combat' ? 'settleCombat' : 'resolveCombat' });
      if (next === s) break;
      s = next;
    }
    return s;
  };

  it('at settle it reaches Attachments on the board, in HAND, and every future one', () => {
    // "Wherever they are" is the whole point: combat can only ever touch the UNWELDED Attachments still on the
    // field, so the held copy and the aura are what make the grant mean what the card says.
    const s = runThroughCombat();
    const gain = s.magneticBuyAtk ?? 0;
    expect(gain, 'no Attachment aura accrued — future copies inherit nothing').toBeGreaterThan(0);
    expect(s.magneticBuyHp ?? 0).toBeGreaterThan(0);
    expect(s.board.find((c) => c.uid === 'b')!.attack, 'the board Attachment kept nothing').toBeGreaterThan(1);
    expect(s.hand.find((c) => c.uid === 'h')!.attack, 'the HELD Attachment was skipped').toBeGreaterThan(1);
  });

  it('a NON-Attachment is untouched by the enchant', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', wave: 4, embers: 20,
      board: [card('ce', 'chorusengine', 'mech', 40, 200, ['RL']), card('n', 'sandbag', 'neutral', 1, 1)],
      hand: [],
    };
    s = reduce(s, { type: 'faceOmen' });
    let guard = 0;
    while (s.phase !== 'recruit' && guard++ < 10) {
      const next = reduce(s, { type: s.phase === 'combat' ? 'settleCombat' : 'resolveCombat' });
      if (next === s) break;
      s = next;
    }
    // Assert on the ENCHANT'S OWN label, not on raw stats: a wave-4 fight has other legitimate ways to grow a
    // body (the first version of this test read +1 from an unrelated combat gain and blamed this change).
    const plain = s.board.find((c) => c.uid === 'n');
    const attached = s.board.find((c) => c.uid === 'ce');
    for (const c of [plain, attached]) {
      const labels = (c?.buffs ?? []).map((b) => b.source);
      expect(labels, 'a non-Attachment received the Chorus Engine enchant').not.toContain('Chorus Engine');
    }
  });
});
