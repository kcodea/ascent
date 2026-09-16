import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from './state';
import { destroyMinionInShop, makeContext, applyGoldSpent, fireOnSell, castSpell } from './recruit';

/**
 * SHOP buff-others that used to land with NO cue (owner report 2026-09-16, the Dawn Sentinel pass):
 *
 *   · an Echo fired by a DESTROY: its capture is `deathrattle`-kind and now KEEPS the fallen body's uid, so the
 *     UI streams the tribe tendril from the slot it left (before this `sourceUid` was dropped → sourceless →
 *     nothing drawn);
 *   · a Gold-spent grant (Billings, Coinfire Forewoman) and a Reveler's sell — the only shop dispatch sites
 *     that ran OUTSIDE `captureBuffFx`, so their grants were never handed to the replay at all.
 *
 * Display metadata only: none of these touch RNG or stats (the golden sims are unchanged).
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (board: BoardCard[]): RunState => ({ ...createRun(7), phase: 'recruit', board });

describe('ECHO via a shop destroy — the capture keeps the fallen source', () => {
  it("Dawn Sentinel destroyed in the shop: one `deathrattle` event per recipient, sourced on the Sentinel's uid + card", () => {
    const s = run([body('ds', 'ce3_dawnsentinel'), body('star', 'ce3_wishingstar')]);
    destroyMinionInShop(makeContext(s), s.board[0]!);
    expect(s.board.map((c) => c.uid), 'the body left').toEqual(['star']);
    const fx = s.recruitBuffFx.filter((e) => e.kind === 'deathrattle');
    expect(fx.length).toBe(1);
    expect(fx[0]).toMatchObject({ sourceUid: 'ds', sourceCardId: 'ce3_dawnsentinel', sourceTribe: 'celestial', targetUid: 'star', attack: 2, health: 1 });
  });

  it('a spell capture still carries NO source (nothing to stream from)', () => {
    const s = run([body('a', 'stray'), body('b', 'stray')]);
    // Any spell-kind capture: the Growth path the existing recruitBuffFx tests use.
    castSpell(s, CARD_INDEX['growth']!);
    for (const e of s.recruitBuffFx) { expect(e.kind).toBe('spell'); expect(e.sourceUid).toBeUndefined(); }
  });
});

describe('Gold spent + on-sell — captured like every other shop grant', () => {
  it('Billings (every N Gold: a random Dwarf +A/+H): each OTHER Dwarf it pays is captured, sourced on Billings', () => {
    const s = run([body('bl', 'dw_billings'), body('d2', 'dw_foreman')]);
    applyGoldSpent(s, 10);
    const fx = s.recruitBuffFx.filter((e) => e.sourceUid === 'bl');
    expect(fx.length, 'two 5-Gold steps → two grants').toBeGreaterThan(0);
    for (const e of fx) expect(e).toMatchObject({ kind: 'minion', sourceCardId: 'dw_billings', sourceTribe: 'dwarf', targetUid: 'd2' });
  });

  it('Coinfire Forewoman (every N Gold: Dwarves +Attack): captured, sourced on the Forewoman, never on herself', () => {
    const s = run([body('cf', 'dw_coinfire'), body('d2', 'dw_foreman')]);
    applyGoldSpent(s, 10);
    const fx = s.recruitBuffFx.filter((e) => e.sourceUid === 'cf');
    expect(fx.length).toBeGreaterThan(0);
    expect(fx.every((e) => e.targetUid === 'd2' && e.attack > 0 && e.health === 0)).toBe(true);
  });

  it("Flame Reveler sold: the Spirits it pays are captured with the SOLD card as source (the UI streams from the slot it left)", () => {
    const s = run([body('fr', 'sp3_flamereveler'), body('s2', 'sp3_tidebud')]);
    const sold = s.board[0]!;
    s.board = s.board.filter((c) => c !== sold); // the reducer removes the card before `fireOnSell`
    fireOnSell(s, sold);
    const fx = s.recruitBuffFx;
    expect(fx.length).toBe(1);
    expect(fx[0]).toMatchObject({ kind: 'minion', sourceUid: 'fr', sourceCardId: 'sp3_flamereveler', sourceTribe: 'spirit', targetUid: 's2' });
  });
});
