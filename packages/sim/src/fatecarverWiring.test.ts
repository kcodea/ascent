import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, castSpell } from './recruit';

/**
 * Fatecarver's spell branch must fire for EVERY Shop-spell cast, not only ones the player casts by hand —
 * owner ruling 2026-07-30: "Fatecarver should trigger from things like Runefire's end of turn effect."
 *
 * The risk is real: a card-driven cast that bypassed `noteSpellCast` would count for nothing — not for
 * Fatecarver, not for the spell tallies, not for any `spellCast` watcher. That exact bug shipped once before,
 * with Discover spells (devlog 2026-07-27).
 *
 * Every assertion below is a DIFFERENCE against the same board without Fatecarver. The cast spell buffs things
 * itself, so an absolute number measures Growth and Fatecarver together and passes whichever one is broken.
 */
const set2 = (): RunState => ({ ...createRun(1, 'drakko'), setId: 'set2' } as RunState);
const body = (cardId: string, uid: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const beast = () => body('pack', 'beast');
/** Total Attack on the board minus Fatecarver's own, so the comparison is like-for-like across both boards. */
const payload = (s: RunState) => s.board.filter((c) => c.uid !== 'fc').reduce((n, c) => n + c.attack, 0);

/** Run `act` on a board with Fatecarver (on `option`) and on the same board without it; return both payloads. */
function withAndWithout(option: number, extra: BoardCard[], act: (s: RunState) => void) {
  const build = (carver: boolean): RunState => ({
    ...set2(),
    board: [...(carver ? [body('n2_fatecarver', 'fc', { chosenOption: option })] : []), beast(), ...extra.map((e) => ({ ...e }))],
    hand: [],
    lastSpellCastId: 'growth',
  });
  const a = build(true), b = build(false);
  act(a); act(b);
  return { withCarver: payload(a), without: payload(b), state: a };
}

describe('Fatecarver fires on card-driven spell casts', () => {
  it("triggers off Runefire's End-of-Turn recast", () => {
    // The exact case in the owner's report: Runefire re-casts the turn's last spell at End of Turn.
    const r = withAndWithout(0, [body('d2_runefire', 'rf')], (s) => applyEndOfTurn(s));
    expect(r.state.spellsCast, "Runefire's recast never counted as a cast at all").toBeGreaterThan(0);
    expect(r.withCarver, 'Fatecarver ignored a spell it did not cast itself').toBeGreaterThan(r.without);
  });

  it('triggers off a direct castSpell, the shared chokepoint', () => {
    const r = withAndWithout(0, [], (s) => castSpell(s, CARD_INDEX['growth']!, s.board.find((c) => c.uid === 'beast')));
    expect(r.withCarver).toBeGreaterThan(r.without);
  });

  it('triggers off a spell the player plays from hand', () => {
    const spell = CARD_INDEX['growth']!;
    const play = (s: RunState) => {
      const withHand: RunState = { ...s, hand: [{ uid: 'sp', cardId: spell.id, tribe: spell.tribe, attack: 0, health: 0, keywords: [], golden: false }] };
      const next = reduce(withHand, { type: 'play', uid: 'sp', targetUid: 'beast' });
      s.board = next.board;
    };
    const r = withAndWithout(0, [], play);
    expect(r.withCarver).toBeGreaterThan(r.without);
  });

  it('the ATTACK branch stays silent on spell casts', () => {
    // If the `option` gate leaked, picking branch B would silently grant branch A as well.
    const r = withAndWithout(1, [], (s) => castSpell(s, CARD_INDEX['growth']!, s.board.find((c) => c.uid === 'beast')));
    expect(r.withCarver, 'the attack branch fired on a spell cast').toBe(r.without);
  });

  it('fires once PER cast when a spell multi-casts', () => {
    // Ancient Runes doubles every spell. Fatecarver watches casts, not plays, so a doubled spell owes two
    // triggers — firing once would quietly halve the payoff on exactly the builds that want this card.
    const single = withAndWithout(0, [], (s) => castSpell(s, CARD_INDEX['growth']!, s.board.find((c) => c.uid === 'beast')));
    const gain = single.withCarver - single.without;
    const doubled = withAndWithout(0, [], (s) => {
      const armed: RunState = { ...s, spellDoubleAlways: true };
      const spell = CARD_INDEX['growth']!;
      armed.hand = [{ uid: 'sp', cardId: spell.id, tribe: spell.tribe, attack: 0, health: 0, keywords: [], golden: false }];
      const next = reduce(armed, { type: 'play', uid: 'sp', targetUid: 'beast' });
      s.board = next.board;
    });
    expect(doubled.withCarver - doubled.without, 'a doubled spell only triggered Fatecarver once').toBe(gain * 2);
  });
});
