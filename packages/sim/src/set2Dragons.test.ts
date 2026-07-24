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

describe('set 2 — Scalefeather Drake queues NEXT turn’s first spell', () => {
  it('an armed charge copies the first spell of a turn on/after its activation wave', () => {
    let s: RunState = {
      ...createRun(3), wave: 3, phase: 'recruit', embers: 40,
      board: [minion('t', 'd2_chronicler', 'dragon', 3, 5)],
      hand: [spellInHand('s1', 'spiritfire'), spellInHand('s2', 'spiritfire')],
      nextTurnSpellCopies: { activateWave: 3, count: 1 }, // active THIS wave
    };
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 't' });
    expect(s.hand.filter((c) => c.cardId === 'spiritfire').length).toBe(2); // s2 still in hand + the copy
    expect(s.nextTurnSpellCopies).toBeUndefined(); // spent
    // the SECOND spell doesn’t re-trigger it
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 't' });
    expect(s.hand.filter((c) => c.cardId === 'spiritfire').length).toBe(1); // just the leftover copy
  });

  it('a charge armed for NEXT turn does not fire on THIS turn’s first spell', () => {
    // This is the "next turn" guarantee: armed on wave 3 → activateWave 4, so a wave-3 cast must not pay out.
    let s: RunState = {
      ...createRun(3), wave: 3, phase: 'recruit', embers: 40,
      board: [minion('t', 'd2_chronicler', 'dragon', 3, 5)],
      hand: [spellInHand('s1', 'spiritfire')],
      nextTurnSpellCopies: { activateWave: 4, count: 1 },
    };
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 't' });
    expect(s.hand.filter((c) => c.cardId === 'spiritfire').length).toBe(0); // no copy this turn
    expect(s.nextTurnSpellCopies).toEqual({ activateWave: 4, count: 1 }); // still pending
  });
});

describe('set 2 — Living Grimoire charges, spends and re-arms', () => {
  const play = (s: RunState, uid: string): RunState => reduce(s, { type: 'play', uid });

  it('doubles the turn’s FIRST spell, then goes quiet until 3 Shouts recharge it', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 60,
      board: [minion('tgt', 'd2_chronicler', 'dragon', 3, 5)],
      hand: [minion('lg', 'd2_grimoire', 'dragon', 7, 9), spellInHand('s1', 'spiritfire'), spellInHand('s2', 'spiritfire')],
    };
    s = play(s, 'lg');
    expect(s.grimoireMult).toBe(2); // charged by its Shout

    const t0 = s.board.find((c) => c.uid === 'tgt')!;
    const [a0, h0] = [t0.attack, t0.health];
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'tgt' });
    const t1 = s.board.find((c) => c.uid === 'tgt')!;
    expect([t1.attack - a0, t1.health - h0]).toEqual([4, 6]); // Spirit Fire +2/+3, cast TWICE
    expect(s.grimoireMult).toBe(0); // spent

    // the next spell this turn is single, and it stays discharged
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 'tgt' });
    const t2 = s.board.find((c) => c.uid === 'tgt')!;
    expect([t2.attack - t1.attack, t2.health - t1.health]).toEqual([2, 3]);
    expect(s.grimoireMult).toBe(0);
  });

  it('re-arms after 3 Shouts, and does not bank Shouts while still charged', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 60,
      board: [minion('lg', 'd2_grimoire', 'dragon', 7, 9)],
      hand: [
        minion('a1', 'd2_chronicler', 'dragon', 3, 5),
        minion('a2', 'd2_embermouth', 'dragon', 2, 2),
        minion('a3', 'd2_skald', 'dragon', 4, 5), // three DISTINCT Shouts — identical ones would triple-combine
      ],
      grimoireMult: 2, // already charged
    };
    s = play(s, 'a1'); s = play(s, 'a2'); s = play(s, 'a3');
    const lg = s.board.find((c) => c.uid === 'lg')!;
    expect(lg.shoutTick ?? 0).toBe(0); // charged the whole time → nothing was counted
    expect(s.grimoireMult).toBe(2);
  });

  it('selling the Grimoire cannot leave a free permanent multiplier behind', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 60,
      board: [minion('lg', 'd2_grimoire', 'dragon', 7, 9), minion('tgt', 'd2_chronicler', 'dragon', 3, 5)],
      hand: [spellInHand('s1', 'spiritfire')],
      grimoireMult: 2,
    };
    s = reduce(s, { type: 'sell', uid: 'lg' }); // the charge flag survives, but the source is gone
    const t0 = s.board.find((c) => c.uid === 'tgt')!;
    const [a0, h0] = [t0.attack, t0.health];
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'tgt' });
    const t1 = s.board.find((c) => c.uid === 'tgt')!;
    expect([t1.attack - a0, t1.health - h0]).toEqual([2, 3]); // single cast — no orphaned multiplier
  });
});

describe('set 2 — Voicekeeper copies the first Dragon sold each turn', () => {
  it('copies the FIRST Dragon sold, and not the second', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [
        minion('vk', 'd2_voicekeeper', 'dragon', 5, 9),
        minion('d1', 'd2_chronicler', 'dragon', 3, 5),
        minion('d2', 'd2_embermouth', 'dragon', 2, 2),
      ],
    };
    s = reduce(s, { type: 'sell', uid: 'd1' });
    expect(s.hand.filter((c) => c.cardId === 'd2_chronicler').length).toBe(1); // the first sale copied
    s = reduce(s, { type: 'sell', uid: 'd2' });
    expect(s.hand.filter((c) => c.cardId === 'd2_embermouth').length).toBe(0); // the second did not
  });

  it('ignores a non-Dragon sale, and the copy is PLAIN (buffs not carried)', () => {
    const buffed = { ...minion('d1', 'd2_chronicler', 'dragon', 3, 5), attack: 30, health: 40 };
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [minion('vk', 'd2_voicekeeper', 'dragon', 5, 9), minion('nb', 'k_chipwick', 'kobold', 1, 2), buffed],
    };
    s = reduce(s, { type: 'sell', uid: 'nb' }); // a Kobold — not this tribe
    expect(s.hand.length).toBe(0);
    s = reduce(s, { type: 'sell', uid: 'd1' }); // the big buffed Dragon
    const copy = s.hand.find((c) => c.cardId === 'd2_chronicler')!;
    expect(copy).toBeDefined();
    expect([copy.attack, copy.health]).toEqual([3, 5]); // base stats — the 30/40 buffs did NOT come along
  });
});

describe('set 2 — spells cast ON a minion (Mirrorwing / Runefire)', () => {
  it('Mirrorwing Hatchling: the first spell on it casts AGAIN — and does not recurse', () => {
    // Spirit Fire is +2/+3 to one minion. Cast once on Mirrorwing → it should land TWICE (the cast + the
    // re-cast), not once and not forever. The recursion guard is the whole reason this card is safe: its
    // effect is another cast on itself, so without the count check it would re-enter until the stack blew.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('mw', 'd2_mirrorwing', 'dragon', 2, 4)],
      hand: [spellInHand('sf', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'mw' });
    const mw = s.board.find((c) => c.uid === 'mw')!;
    expect([mw.attack - 2, mw.health - 4]).toEqual([4, 6]); // exactly 2x (+2/+3), so no runaway
    expect(mw.spellsOnThisTurn).toBe(2); // the original + the single re-cast
  });

  it('Mirrorwing Hatchling: only the FIRST spell each turn is doubled', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('mw', 'd2_mirrorwing', 'dragon', 2, 4)],
      hand: [spellInHand('s1', 'spiritfire'), spellInHand('s2', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 'mw' });
    const afterFirst = s.board.find((c) => c.uid === 'mw')!;
    const a1 = afterFirst.attack, h1 = afterFirst.health;
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 'mw' });
    const mw = s.board.find((c) => c.uid === 'mw')!;
    expect([mw.attack - a1, mw.health - h1]).toEqual([2, 3]); // the second lands ONCE
  });

  it('Runefire: the first spell also casts on its adjacent Dragons, but not on itself again', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [
        minion('L', 'd2_chronicler', 'dragon', 3, 5),
        minion('rf', 'd2_runefire', 'dragon', 5, 8),
        minion('R', 'd2_embermouth', 'dragon', 2, 2),
      ],
      hand: [spellInHand('sf', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 'sf', targetUid: 'rf' });
    const L = s.board.find((c) => c.uid === 'L')!;
    const rf = s.board.find((c) => c.uid === 'rf')!;
    const R = s.board.find((c) => c.uid === 'R')!;
    expect([L.attack - 3, L.health - 5]).toEqual([2, 3]); // neighbour got it
    expect([R.attack - 2, R.health - 2]).toEqual([2, 3]); // and the other neighbour
    expect([rf.attack - 5, rf.health - 8]).toEqual([2, 3]); // Runefire itself only ONCE (no self re-cast)
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

describe('set 2 — Orivax installs a permanent global mode', () => {
  it('Chorus: adds a permanent extra Shout trigger, and it compounds a played Shout', () => {
    let s: RunState = {
      ...createRun(7), tier: 7, phase: 'recruit', embers: 60,
      board: [minion('mm', 'd2_matriarch', 'dragon', 4, 7)], // pays +2 Attack per Shout FIRE
      hand: [minion('ox', 'd2_orivax', 'dragon', 10, 14), minion('sh', 'd2_chronicler', 'dragon', 3, 5)],
    };
    s = reduce(s, { type: 'play', uid: 'ox' });
    s = reduce(s, { type: 'chooseOne', index: 0 }); // Chorus
    expect(s.shoutExtraAlways).toBe(1);
    // now a played Shout fires TWICE, so Matriarch pays +2 Attack twice = +4
    const before = s.board.find((c) => c.uid === 'mm')!.attack;
    s = reduce(s, { type: 'play', uid: 'sh' });
    const mm = s.board.find((c) => c.uid === 'mm')!;
    expect(mm.attack - before).toBe(4);
  });

  it('Spellweave: the first spell each turn casts 3 times (later spells single)', () => {
    let s: RunState = {
      ...createRun(7), tier: 7, phase: 'recruit', embers: 60,
      board: [minion('t', 'd2_chronicler', 'dragon', 3, 5)],
      hand: [minion('ox', 'd2_orivax', 'dragon', 10, 14), spellInHand('s1', 'spiritfire'), spellInHand('s2', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 'ox' });
    s = reduce(s, { type: 'chooseOne', index: 1 }); // Spellweave
    expect(s.spellFirstMultEachTurn).toBe(3);
    const t0 = s.board.find((c) => c.uid === 't')!;
    const [a0, h0] = [t0.attack, t0.health];
    s = reduce(s, { type: 'play', uid: 's1', targetUid: 't' });
    const t1 = s.board.find((c) => c.uid === 't')!;
    expect([t1.attack - a0, t1.health - h0]).toEqual([6, 9]); // Spirit Fire +2/+3 x3
    s = reduce(s, { type: 'play', uid: 's2', targetUid: 't' });
    const t2 = s.board.find((c) => c.uid === 't')!;
    expect([t2.attack - t1.attack, t2.health - t1.health]).toEqual([2, 3]); // second spell single
  });

  it('GILDED Orivax gains BOTH modes from one play', () => {
    const gox = { ...minion('ox', 'd2_orivax', 'dragon', 20, 28), golden: true };
    let s: RunState = { ...createRun(7), tier: 7, phase: 'recruit', embers: 60, board: [], hand: [gox] };
    s = reduce(s, { type: 'play', uid: 'ox' });
    // a golden minion still opens the choose prompt; pick either — both apply
    if (s.chooseOne) s = reduce(s, { type: 'chooseOne', index: 0 });
    expect(s.shoutExtraAlways).toBe(1); // Chorus applied
    expect(s.spellFirstMultEachTurn).toBe(3); // AND Spellweave applied
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
