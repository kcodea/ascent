// @vitest-environment jsdom
/**
 * PICNIC'S CAST EFFECT (owner 2026-09-24, verbatim): *"picnic should get the "shop buff shout" animation"*.
 *
 * Picnic (`sp_picnic`, "Give the right-most Shop minion +8/+8 permanently") is bound to the existing
 * `shop-buff-shout` def through its card-level `spellCast` row, and every cast source plays it with `target` ON the
 * right-most Shop minion (`spellCastShopTarget`): the player's cast from hand (the shop `spellCast` moment), a
 * rune's cast (the sim's `castFx` record, e.g. Rune of the Gilded Ledger), a minion's cast, and an End-of-Turn cast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canPlayDefs, playDef } from './playDef';
import { playRecordedCastFx, playSpellCastFx, resetSpellCastSoundGate, spellCastShopTarget } from './spellCastFx';
import { castFxReplacesTendril, spellCastFxFor } from '../choreo/bindings';
import { runRecruitMomentCues } from '../choreo/recruitCues';
import { spellCastMoment } from '../choreo/recruitMoments';

vi.mock('./playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
const mockPlayDef = vi.mocked(playDef);
const shouts = (): unknown[][] => mockPlayDef.mock.calls.filter((c) => c[0] === 'shop-buff-shout');
type Anchors = { source: { x: number; y: number }; target: { x: number; y: number } };
type Opts = { uids: { source: string | null; target: string | null } };

/** A Shop row: [uid, left, classes]. Each card is 100 px wide at y 200-300, so its centre is (left + 50, 250). */
function mountShop(cards: readonly [string, number, string?][]): void {
  document.body.innerHTML = '';
  const zone = document.createElement('div');
  zone.setAttribute('data-zone', 'tavern');
  const row = document.createElement('div');
  row.className = 'row';
  zone.appendChild(row);
  for (const [uid, left, extra] of cards) {
    const el = document.createElement('div');
    el.className = `card${extra ? ` ${extra}` : ''}`;
    el.setAttribute('data-uid', uid);
    el.getBoundingClientRect = () => ({ left, top: 200, width: 100, height: 100, right: left + 100, bottom: 300, x: left, y: 200, toJSON: () => ({}) }) as DOMRect;
    row.appendChild(el);
  }
  document.body.appendChild(zone);
}

beforeEach(() => {
  mockPlayDef.mockClear();
  vi.mocked(canPlayDefs).mockReturnValue(true);
  resetSpellCastSoundGate();
  // Three minions, then a spell and a Ruby further right: the right-most MINION is `m3`, centred at (450, 250).
  mountShop([['m1', 100], ['m2', 250], ['m3', 400], ['sp', 550, 'spellcard'], ['rb', 700, 'rubycard']]);
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('Picnic plays shop-buff-shout on the right-most Shop minion', () => {
  it('is bound to the existing shop-buff-shout def as a single cast play, replacing the generic trail', () => {
    expect(spellCastFxFor('sp_picnic')?.def).toBe('shop-buff-shout');
    expect(castFxReplacesTendril('sp_picnic')).toBe(true);
  });

  it('the target is the right-most Shop MINION (spells and Rubies skipped); other spells have none', () => {
    expect(spellCastShopTarget('sp_picnic')).toEqual({ point: { x: 450, y: 250 }, uid: 'm3' });
    expect(spellCastShopTarget('growth')).toBeNull();
    mountShop([]);
    expect(spellCastShopTarget('sp_picnic'), 'no Shop on screen (combat): the caller keeps its anchor').toBeNull();
  });

  it('PLAYER, cast from hand: one play, target on the right-most Shop minion (not the release point)', () => {
    runRecruitMomentCues(spellCastMoment('sp_picnic', { x: 120, y: 640 }), { cardIdOf: () => null, measure: () => null });
    expect(shouts()).toHaveLength(1);
    const [, anchors, opts] = shouts()[0] as [string, Anchors, Opts];
    expect(anchors.target).toEqual({ x: 450, y: 250 });
    expect(opts.uids.target).toBe('m3');
  });

  it('RUNE, in the Shop (Rune of the Gilded Ledger rolls Picnic): one play on the right-most Shop minion', () => {
    vi.useFakeTimers();
    expect(playRecordedCastFx([{ spellId: 'sp_picnic', phase: 'recruit', source: { kind: 'rune', id: 'rune_gilded_ledger' } }], 'recruit')).toBe(1);
    vi.runAllTimers(); // the rune flourish releases the spell's effect after its lead
    expect(shouts()).toHaveLength(1);
    const [, anchors, opts] = shouts()[0] as [string, Anchors, Opts];
    expect(anchors.target).toEqual({ x: 450, y: 250 });
    expect(opts.uids.target).toBe('m3');
  });

  it('MINION and End-of-Turn casts land on the same Shop minion', () => {
    expect(playRecordedCastFx([{ spellId: 'sp_picnic', phase: 'endOfTurn', source: { kind: 'minion', uid: 'p', cardId: 'b2_magepup' } } as never])).toBe(1);
    expect(playSpellCastFx('sp_picnic')).toBe(true); // the `spellResolved` presenter's hero / quest path
    expect(shouts()).toHaveLength(2);
    for (const c of shouts()) expect((c[1] as Anchors).target).toEqual({ x: 450, y: 250 });
  });

  it('two casts inside the 120 ms burst gap: both play, the second with its sound dropped', () => {
    expect(playSpellCastFx('sp_picnic')).toBe(true);
    expect(playSpellCastFx('sp_picnic')).toBe(true);
    expect(shouts()).toHaveLength(2);
    expect((shouts()[0]![2] as { muteSound?: boolean }).muteSound).toBeUndefined();
    expect((shouts()[1]![2] as { muteSound?: boolean }).muteSound).toBe(true);
  });
});
