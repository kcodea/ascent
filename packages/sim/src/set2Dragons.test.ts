import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, poolOf, reduce, type BoardCard, type RunState } from './index';

/**
 * Set 2's Dragon tribe — the SPELL-RECURSION line.
 *
 * Two things are worth pinning. First that the tribe is actually REACHABLE in a set-2 run (a card can be
 * authored, typecheck, and still never appear if the set manifest or the tribe roster misses it — the exact
 * failure `poolOf` scoping exists to prevent). Second the effects themselves, since most of this line reads
 * run state (`firstSpellThisTurnId` / `lastSpellCastId`) that other systems maintain, so a rename elsewhere
 * would silently turn these into no-ops rather than breaking a build.
 */
const minion = (uid: string, cardId: string, tribe: BoardCard['tribe'] = 'dragon', attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe, attack, health, keywords: [], golden: false });
const spellInHand = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

describe('set 2 — the Dragon tribe is wired into the set', () => {
  it('set 2 lists dragon as a playable tribe and its Dragons are in the pool', () => {
    const run = createRun(1);
    // The pool is set-scoped; grab set 2's roster directly rather than depending on which set is enabled.
    const set2Dragons = Object.values(CARD_INDEX).filter((c) => c.id.startsWith('d2_'));
    expect(set2Dragons.length).toBeGreaterThan(0);
    expect(set2Dragons.every((c) => c.tribe === 'dragon')).toBe(true);
    // Sanity: every authored Dragon is a real, buyable (non-token) minion.
    expect(set2Dragons.every((c) => !c.token && !c.spell)).toBe(true);
    expect(run).toBeTruthy();
  });

  it('Karwind carries into set 2 and keeps its re-spec (Tier 6, 4/12)', () => {
    const k = CARD_INDEX['karwind']!;
    expect([k.tier, k.attack, k.health]).toEqual([6, 4, 12]);
  });
});

describe('set 2 — Dragon effects', () => {
  it('Embermouth Whelp: Shout buffs ANOTHER friendly Dragon, never itself', () => {
    const other = minion('d1', 'd2_chronicler', 'dragon', 3, 5);
    const s: RunState = { ...createRun(1), phase: 'recruit', embers: 20, board: [other], hand: [minion('w1', 'd2_embermouth')] };
    const next = reduce(s, { type: 'play', uid: 'w1' });
    const buffed = next.board.find((c) => c.uid === 'd1')!;
    expect([buffed.attack - 3, buffed.health - 5]).toEqual([2, 1]);
    // the Whelp itself is untouched by its own Shout
    const self = next.board.find((c) => c.uid === 'w1')!;
    expect([self.attack, self.health]).toEqual([2, 2]);
  });

  it('Recaller: Shout copies the LAST spell cast this turn (and no-ops before any cast)', () => {
    const dry: RunState = { ...createRun(1), phase: 'recruit', embers: 20, board: [], hand: [minion('r1', 'd2_recaller', 'dragon', 5, 4)] };
    const afterDry = reduce(dry, { type: 'play', uid: 'r1' });
    expect(afterDry.hand.length).toBe(0); // nothing cast yet → no copy, no crash

    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [minion('m1', 'd2_chronicler', 'dragon', 3, 5)],
      hand: [spellInHand('sp', 'growth'), minion('r1', 'd2_recaller', 'dragon', 5, 4)],
    };
    s = reduce(s, { type: 'play', uid: 'sp' }); // cast Growth
    expect(s.lastSpellCastId).toBe('growth');
    s = reduce(s, { type: 'play', uid: 'r1' }); // Shout copies it
    expect(s.hand.filter((c) => c.cardId === 'growth').length).toBe(1);
  });

  it('Spellvault Drake: End of Turn copies the FIRST spell cast that turn', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [minion('v1', 'd2_spellvault', 'dragon', 6, 7)],
      hand: [spellInHand('s1', 'growth'), spellInHand('s2', 'emberpouch')],
    };
    s = reduce(s, { type: 'play', uid: 's1' }); // first
    s = reduce(s, { type: 'play', uid: 's2' }); // second
    expect(s.firstSpellThisTurnId).toBe('growth');
    s = reduce(s, { type: 'faceOmen' }); // End of Turn commits the beats
    expect(s.hand.filter((c) => c.cardId === 'growth').length).toBe(1); // the FIRST one, not the last
  });

  it('Hoard Chronicler: Shout adds a random Tavern spell to hand', () => {
    const s: RunState = { ...createRun(1), phase: 'recruit', embers: 20, board: [], hand: [minion('c1', 'd2_chronicler', 'dragon', 3, 5)] };
    const next = reduce(s, { type: 'play', uid: 'c1' });
    expect(next.hand.length).toBe(1);
    expect(CARD_INDEX[next.hand[0]!.cardId]!.spell).toBe(true);
  });

  it('Roaring Matriarch: a played Shout gives your Dragons +2 Attack only (no Health)', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [minion('mm', 'd2_matriarch', 'dragon', 4, 7)],
      hand: [minion('c1', 'd2_chronicler', 'dragon', 3, 5)], // a Shout minion
    };
    const next = reduce(s, { type: 'play', uid: 'c1' });
    const mm = next.board.find((c) => c.uid === 'mm')!;
    expect([mm.attack - 4, mm.health - 7]).toEqual([2, 0]);
    expect(poolOf(next)).toBeTruthy();
  });
});

describe('set 2 — Dragon spell hooks (first / second spell each turn)', () => {
  it('Ashscribe Whelp: grows on the FIRST spell each turn only — not the second', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('aw', 'd2_ashscribe', 'dragon', 1, 3)],
      hand: [spellInHand('s1', 'growth'), spellInHand('s2', 'growth')],
    };
    s = reduce(s, { type: 'play', uid: 's1' });
    let aw = s.board.find((c) => c.uid === 'aw')!;
    const afterFirst = [aw.attack, aw.health];
    s = reduce(s, { type: 'play', uid: 's2' }); // second cast must NOT grant it again
    aw = s.board.find((c) => c.uid === 'aw')!;
    // Growth buffs the whole board too, so compare the DELTA between the two casts: the second adds only
    // Growth's +1/+1, while the first added Growth's +1/+1 plus Ashscribe's own +2/+2.
    expect([aw.attack - afterFirst[0]!, aw.health - afterFirst[1]!]).toEqual([1, 1]);
    expect(afterFirst).toEqual([1 + 1 + 2, 3 + 1 + 2]);
  });

  it('Spellkeeper Drake: the SECOND spell each turn copies the FIRST (not the second)', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('sk', 'd2_spellkeeper', 'dragon', 3, 4)],
      hand: [spellInHand('s1', 'growth'), spellInHand('s2', 'emberpouch')],
    };
    s = reduce(s, { type: 'play', uid: 's1' });
    expect(s.hand.filter((c) => c.cardId === 'growth').length).toBe(0); // one cast → nothing yet
    s = reduce(s, { type: 'play', uid: 's2' });
    expect(s.hand.filter((c) => c.cardId === 'growth').length).toBe(1); // the FIRST spell, copied
    expect(s.hand.filter((c) => c.cardId === 'emberpouch').length).toBe(0);
  });

  it('Runic Archivist: End of Turn re-CASTS the first spell (a real cast, not a copy to hand)', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('ra', 'd2_archivist', 'dragon', 6, 10), minion('t1', 'd2_ashscribe', 'dragon', 1, 3)],
      hand: [spellInHand('s1', 'growth')],
    };
    s = reduce(s, { type: 'play', uid: 's1' });
    const castsAfterPlay = s.spellsCast;
    const handSize = s.hand.length;
    s = reduce(s, { type: 'faceOmen' });
    expect(s.spellsCast).toBeGreaterThan(castsAfterPlay); // it CAST again…
    expect(s.hand.length).toBe(handSize); // …rather than adding a card to hand
  });

  it('Runic Archivist: no spell cast this turn → a clean no-op', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('ra', 'd2_archivist', 'dragon', 6, 10)],
      hand: [],
    };
    const before = s.spellsCast;
    s = reduce(s, { type: 'faceOmen' });
    expect(s.spellsCast).toBe(before);
  });
});

describe('set 2 — Scalechanter improves on a Shout cadence', () => {
  it('buffs Dragons by its CURRENT magnitude, and improves every 3 Shouts triggered', () => {
    // Its own Shout counts as one of the three, so the cadence is observable from a single board.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 60,
      board: [minion('sc', 'd2_scalechanter', 'dragon', 4, 3)],
      // Three DISTINCT Shout minions on purpose: three copies of one card would TRIPLE-combine, which
      // consumes them, grants a Triple Reward and leaves the board looking untouched — a false failure.
      hand: [
        minion('a1', 'd2_chronicler', 'dragon', 3, 5),
        minion('a2', 'd2_embermouth', 'dragon', 2, 2),
        minion('a3', 'd2_skald', 'dragon', 4, 5),
      ],
    };
    const sc0 = s.board.find((c) => c.uid === 'sc')!;
    expect(sc0.summonBonus ?? 0).toBe(0);

    // three Shout minions played → three Battlecry fires → one improvement
    s = reduce(s, { type: 'play', uid: 'a1' });
    s = reduce(s, { type: 'play', uid: 'a2' });
    const mid = s.board.find((c) => c.uid === 'sc')!;
    expect(mid.summonBonus ?? 0).toBe(0); // 2 fires — not yet
    s = reduce(s, { type: 'play', uid: 'a3' });
    const after = s.board.find((c) => c.uid === 'sc')!;
    expect(after.summonBonus).toBe(1); // 3rd fire → improved by the base step
    expect(after.shoutTick).toBe(0); // the cadence rolled over, so it's every-3 and not a running total
  });

  it("the Shout's magnitude includes the improvement", () => {
    // Pre-improved instance: base 1 + summonBonus 2 → +3/+3 to each Dragon.
    const sc = { ...minion('sc', 'd2_scalechanter', 'dragon', 4, 3), summonBonus: 2 };
    const target = minion('t1', 'd2_chronicler', 'dragon', 3, 5);
    const s: RunState = { ...createRun(1), phase: 'recruit', embers: 60, board: [target], hand: [sc] };
    const next = reduce(s, { type: 'play', uid: 'sc' });
    const t = next.board.find((c) => c.uid === 't1')!;
    expect([t.attack - 3, t.health - 5]).toEqual([3, 3]);
  });
});

describe('set 2 — the cast meter is the umbrella of Rubies + Shop Spells', () => {
  it('Gemgorge Fiend counts SHOP SPELLS toward its every-3 trigger, not just Rubies', () => {
    // Owner 2026-07-24: the `rubyCast` trigger is the umbrella of both, matching the `spellsCast + rubyCasts`
    // contract documented on RunState. It used to read the Ruby counter alone, so shop spells never advanced it.
    let s: RunState = {
      ...createRun(6), tier: 6, phase: 'recruit', embers: 99,
      board: [minion('gg', 'k_gemgorge', 'kobold', 6, 6)],
      hand: [spellInHand('s1', 'growth'), spellInHand('s2', 'growth'), spellInHand('s3', 'growth')],
    };
    const shopBefore = s.shop.length;
    s = reduce(s, { type: 'play', uid: 's1' });
    s = reduce(s, { type: 'play', uid: 's2' });
    expect(s.shop.length).toBe(shopBefore); // 2 casts — not there yet
    s = reduce(s, { type: 'play', uid: 's3' }); // the 3rd cast crosses the step
    expect(s.shop.length).toBe(shopBefore - 1); // it Consumed a Shop minion
  });
});
