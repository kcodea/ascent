/**
 * THE DISCOVER PICK PREVIEW (owner 2026-11-16, R-DISCOVER-PREVIEW-01): "if there are other effects like this that
 * trigger for a discover etc, it should SHOW on the discovered cards". Every option of an open Discover previews the
 * card the pick will become (`discoverOfferCard`), built by the same body the pick runs (`buildDiscoverPick`). Each case
 * here proves the preview carries the grant AND equals what the pick puts in hand.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { ANCIENT_IDS, createRun, discoverOfferCard, enableAncients, reduce, type AncientId, type BoardCard, type RunState } from './index';

const minion = (pred: (d: (typeof CARD_INDEX)[string]) => boolean): string =>
  Object.values(CARD_INDEX).find((d) => !d.spell && !d.ruby && !d.token && d.tier <= 3 && pred(d))!.id;
const PLAIN = minion((d) => d.effects.length === 0 && d.keywords.length === 0);
const ECHO = minion((d) => d.effects.some((e) => e.on === 'onDeath') && !d.keywords.includes('R'));
const NO_RISE = minion((d) => d.effects.length === 0 && !d.keywords.includes('R') && !d.keywords.includes('T') && d.id !== PLAIN);

const base = (heroId: string, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, heroId), phase: 'recruit', tier: 3, embers: 20, heroReady: true, hand: [], board: [], ...over } as RunState);
const picked = (heroId: string, id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(heroId, over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
/** The card body, minus its uid (a preview has no uid of its own). */
const body = (c: BoardCard): Omit<BoardCard, 'uid'> => { const { uid: _u, ...rest } = c; return rest; };
/** Pick option `index` and return the new hand card. */
const pickInto = (s: RunState, index: number): BoardCard => {
  const after = reduce(s, { type: 'discover', index });
  return after.hand.find((c) => !s.hand.some((h) => h.uid === c.uid))!;
};
const seeAndGet = (s: RunState, index = 0): { shown: BoardCard; got: BoardCard } => {
  const shown = discoverOfferCard(s, index)!;
  expect(shown, 'the option has a preview').toBeTruthy();
  const got = pickInto(s, index);
  expect(body(got), 'what you see is what you get').toEqual(body(shown));
  return { shown, got };
};

describe('the Discover shows each option as the pick will be (R-DISCOVER-PREVIEW-01)', () => {
  it('a plain Discover previews the plain card', () => {
    const s = base('keshi', { discover: [PLAIN, NO_RISE] });
    const { shown } = seeAndGet(s, 1);
    expect(shown.keywords).toEqual(CARD_INDEX[NO_RISE]!.keywords);
    expect(shown.golden).toBe(false);
  });

  it('a GILDED Discover (golden Salvatore McKlusky) shows its options Gilded, at golden stats', () => {
    const s = base('keshi', { discover: [PLAIN], discoverGolden: true });
    const { shown } = seeAndGet(s);
    expect(shown.golden).toBe(true);
    expect(shown.attack).toBe(CARD_INDEX[PLAIN]!.attack * 2);
  });

  it('Rising Echoes / Grave Invitation: the granted keywords show on every option', () => {
    const s = base('keshi', { discover: [NO_RISE, PLAIN], discoverKeywords: ['R', 'T'] });
    const { shown } = seeAndGet(s);
    expect(shown.keywords).toEqual(expect.arrayContaining(['R', 'T']));
  });

  it('Rune of the Second Path: the option shows the stats it will be set to', () => {
    const s = base('keshi', { discover: [PLAIN], discoverSetStats: { attack: 20, health: 20 } });
    const { shown } = seeAndGet(s);
    expect([shown.attack, shown.health]).toEqual([20, 20]);
  });

  it('Quillen × Death: an Echo option of an Archive payout shows Gilded; a non-Echo option does not', () => {
    const s0 = picked('quillen', 'death');
    const s: RunState = { ...s0, discover: [ECHO, PLAIN], ancients: { ...s0.ancients!, discoverTag: 'archive' } };
    expect(discoverOfferCard(s, 1)!.golden).toBe(false);
    const { shown } = seeAndGet(s, 0);
    expect(shown.golden).toBe(true);
  });

  it('Disco Dan × Death: the option of its Discover shows the Rise the pick gains', () => {
    const s0 = picked('discodan', 'death', { wave: 2, discover: undefined, discoverQueue: [], discoverLockTier: undefined });
    const s: RunState = { ...s0, discover: [NO_RISE], ancients: { ...s0.ancients!, discoverTag: 'discoDeath' } };
    const { shown } = seeAndGet(s);
    expect(shown.keywords).toContain('R');
  });

  it('Albus × Death: an Echo option of an Empowerment Discover shows Rise, and the Shop offer it becomes has it', () => {
    const s0 = picked('albus', 'death');
    const s: RunState = { ...s0, shop: [{ uid: 'o1', cardId: PLAIN }], discover: [ECHO, PLAIN], discoverIntoShopUid: 'o1' };
    expect(discoverOfferCard(s, 0)!.keywords).toContain('R');
    expect(discoverOfferCard(s, 1)!.keywords).not.toContain('R');
    const after = reduce(s, { type: 'discover', index: 0 });
    const offer = after.shop.find((o) => o.cardId === ECHO)!;
    expect(offer.keywords ?? []).toContain('R');
  });

  it('a preview touches nothing (no uid, no RNG, no gild counted)', () => {
    const s = base('keshi', { discover: [PLAIN], discoverGolden: true });
    const snap = JSON.stringify(s);
    discoverOfferCard(s, 0);
    expect(JSON.stringify(s)).toBe(snap);
  });
});
