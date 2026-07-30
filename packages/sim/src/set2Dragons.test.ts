import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, poolOf, reduce, type BoardCard, type RunState } from './index';
import { consumeShopMinion } from './recruit';

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
    // Sanity: every authored Dragon is a real minion, not a spell. Tokens are allowed since 2026-07-27 —
    // Commander Warpath hands out a Brood Whelp, which is a Dragon you play but can't buy.
    expect(set2Dragons.every((c) => !c.spell)).toBe(true);
    expect(set2Dragons.filter((c) => c.token).map((c) => c.id), 'the only Dragon token').toEqual(['d2_broodwhelp']);
    expect(run).toBeTruthy();
  });

  it('Karwind carries into set 2 and keeps its re-spec (Tier 6, 4/12)', () => {
    const k = CARD_INDEX['karwind']!;
    expect([k.tier, k.attack, k.health]).toEqual([6, 4, 12]);
  });
});

describe('set 2 — Dragon effects', () => {
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

  it('Bathing Matriarch: a played Shout gives your Dragons +2 Attack only (no Health)', () => {
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

  it('Ashscribe Whelp: counts from PLACEMENT too — a spell cast before it does not eat its proc', () => {
    // Same correction the owner made for Living Grimoire / Spellkeeper (applied here for consistency): reading
    // the turn-global "spellsThisTurn === 1" left a Whelp bought and played after an earlier cast dead until
    // next turn. Untargeted spells so each really casts.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80, board: [],
      hand: [spellInHand('pre', 'emberpouch'), minion('aw', 'd2_ashscribe', 'dragon', 1, 3), spellInHand('a', 'emberpouch')],
    };
    s = reduce(s, { type: 'play', uid: 'pre' }); // a spell BEFORE the Whelp — must not consume its trigger
    s = reduce(s, { type: 'play', uid: 'aw' });
    const before = s.board.find((c) => c.uid === 'aw')!;
    expect([before.attack, before.health]).toEqual([1, 3]); // nothing yet
    s = reduce(s, { type: 'play', uid: 'a' }); // the first spell SINCE it was placed
    const after = s.board.find((c) => c.uid === 'aw')!;
    expect([after.attack, after.health]).toEqual([1 + 2, 3 + 2]); // it grew
  });

  it('Spellkeeper Drake: counts from PLACEMENT — a mid-turn play treats the next spell as its first', () => {
    // Owner 2026-07-24. Cast a spell, THEN play the Spellkeeper; the spell before it must not count, so the
    // copy only lands after two MORE spells (the first + second since it hit the board).
    // All UNTARGETED spells (emberpouch / growth) so each really casts — a targeted spell with no target would
    // fizzle and stay in hand, never counting.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [],
      hand: [
        spellInHand('pre', 'emberpouch'),
        minion('sk', 'd2_spellkeeper', 'dragon', 3, 4),
        spellInHand('a', 'growth'),
        spellInHand('b', 'emberpouch'),
      ],
    };
    s = reduce(s, { type: 'play', uid: 'pre' }); // a spell before the Spellkeeper — must be ignored
    s = reduce(s, { type: 'play', uid: 'sk' });
    s = reduce(s, { type: 'play', uid: 'a' }); // FIRST since placed
    expect(s.hand.filter((c) => c.cardId === 'growth').length).toBe(0); // nothing yet
    s = reduce(s, { type: 'play', uid: 'b' }); // SECOND since placed → copies the first ('growth')
    expect(s.hand.filter((c) => c.cardId === 'growth').length).toBe(1);
    // If the pre-placement emberpouch had counted, the "first" would be emberpouch and the copy would be one —
    // the growth copy (not emberpouch) proves counting started at PLACEMENT.
    expect(s.hand.filter((c) => c.cardId === 'emberpouch').length).toBe(0);
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

  it('Runic Archivist (owner rework 2026-07-27): every 5th minion SOLD hands you a Shop spell', () => {
    // The recast moved to Water Dragon; the Archivist now pays for selling. Sell four — nothing — then the
    // fifth pays. Asserting the four quiet sales matters: an off-by-one that paid on every sale, or on the
    // first, would still look right if we only checked "after 5 sales the hand grew".
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('ra', 'd2_archivist', 'dragon', 4, 7),
              ...['a', 'b', 'c', 'd', 'e'].map((u) => minion(u, 'sandbag', 'beast', 1, 1))],
      hand: [],
    };
    for (const u of ['a', 'b', 'c', 'd']) {
      s = reduce(s, { type: 'sell', uid: u });
      expect(s.hand.length, `paid out early, after selling ${u}`).toBe(0);
    }
    s = reduce(s, { type: 'sell', uid: 'e' });
    expect(s.hand.length, 'the 5th sale paid nothing').toBe(1);
    expect(CARD_INDEX[s.hand[0]!.cardId]!.spell, 'what it handed you was not a spell').toBe(true);
  });

  it('…and the sell tally CARRIES ROUND TO ROUND rather than resetting at end of turn', () => {
    // The owner asked for this explicitly. A per-turn counter would look correct in the test above and quietly
    // throw away partial progress the moment a turn ended — the exact case a "sell 5" meter is for.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [minion('ra', 'd2_archivist', 'dragon', 4, 7),
              ...['a', 'b', 'c', 'd', 'e'].map((u) => minion(u, 'sandbag', 'beast', 1, 1))],
      hand: [],
    };
    for (const u of ['a', 'b', 'c']) s = reduce(s, { type: 'sell', uid: u });
    const carried = s.board.find((c) => c.cardId === 'd2_archivist')!.soldProgress;
    expect(carried, 'three sales left no progress on the card').toBe(3);
    s = reduce(s, { type: 'faceOmen' }); // end the turn
    expect(s.board.find((c) => c.cardId === 'd2_archivist')!.soldProgress,
      'the tally reset over the turn boundary').toBe(3);
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

  it('fires on the first spell AFTER it is played, even mid-turn (not the turn’s first)', () => {
    // Owner 2026-07-24: "first spell cast WHILE on board". Cast a spell first, THEN play the Grimoire; the
    // very next spell should be the one that doubles.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('tgt', 'd2_chronicler', 'dragon', 3, 5)],
      hand: [spellInHand('pre', 'spiritfire'), minion('lg', 'd2_grimoire', 'dragon', 7, 9), spellInHand('post', 'spiritfire')],
    };
    s = reduce(s, { type: 'play', uid: 'pre', targetUid: 'tgt' }); // a spell BEFORE the Grimoire (single)
    const t0 = s.board.find((c) => c.uid === 'tgt')!;
    const [a0, h0] = [t0.attack, t0.health];
    s = reduce(s, { type: 'play', uid: 'lg' }); // NOW play + arm the Grimoire (it's the 2nd card action)
    expect(s.grimoireMult).toBe(2);
    s = reduce(s, { type: 'play', uid: 'post', targetUid: 'tgt' }); // the next spell doubles
    const t1 = s.board.find((c) => c.uid === 'tgt')!;
    expect([t1.attack - a0, t1.health - h0]).toEqual([4, 6]); // +2/+3 x2, despite being the turn’s 2nd spell
  });

  it('multiplies UNTARGETED spells too, not just aimed ones', () => {
    // Owner report 2026-07-24 ("supposed to cast ALL spells twice, not just targeted"). Ember Pouch is
    // untargeted and pays Gold, so the doubling is directly countable.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('lg', 'd2_grimoire', 'dragon', 7, 9)],
      hand: [spellInHand('e', 'emberpouch')],
      grimoireMult: 2,
    };
    const g0 = s.embers;
    s = reduce(s, { type: 'play', uid: 'e' });
    // Ember Pouch grants 1 Gold; cast twice = 2. (The spell itself costs nothing to PLAY from hand.)
    expect(s.embers - g0).toBe(2);
    expect(s.grimoireMult).toBe(0); // charge spent
  });

  it('RE-ARMS at the start of each turn, so "the first spell you cast each turn" is true', () => {
    // The actual cause of the report: it armed only on play and via the 3-Shout reset, so on a later turn
    // where you had not triggered 3 Shouts it silently did nothing at all.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('lg', 'd2_grimoire', 'dragon', 7, 9)],
      hand: [], grimoireMult: 0, // spent this turn
    };
    s = reduce(s, { type: 'faceOmen' });   // end the turn
    s = reduce(s, { type: 'resolveCombat' });
    s = reduce(s, { type: 'settleCombat' });
    expect(s.grimoireMult).toBe(2);        // charged again for the new turn
    expect(s.board.find((c) => c.uid === 'lg')!.shoutTick ?? 0).toBe(0); // and the Shout meter restarts
  });

  it('a GOLDEN Grimoire re-arms to 3, and two copies do not compound', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [
        { ...minion('lg1', 'd2_grimoire', 'dragon', 14, 18), golden: true },
        minion('lg2', 'd2_grimoire', 'dragon', 7, 9),
      ],
      hand: [], grimoireMult: 0,
    };
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    s = reduce(s, { type: 'settleCombat' });
    expect(s.grimoireMult).toBe(3); // the strongest on board wins; not 2x3 or 2+3
  });

  it('with no Grimoire on board nothing is armed', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('b', 'bronzewarden', 'dragon', 1, 3)], hand: [], grimoireMult: 0,
    };
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    s = reduce(s, { type: 'settleCombat' });
    expect(s.grimoireMult ?? 0).toBe(0);
  });

  it('the charge also multiplies a RUBY (a Ruby is a spell — no "shop spell" wording)', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 80,
      board: [minion('lg', 'd2_grimoire', 'dragon', 7, 9), minion('tgt', 'k_chipwick', 'kobold', 1, 2)],
      hand: [{ uid: 'rb', cardId: 'ruby', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false }],
      grimoireMult: 2, // charged
    };
    const t0 = s.board.find((c) => c.uid === 'tgt')!;
    const [a0, h0] = [t0.attack, t0.health];
    s = reduce(s, { type: 'play', uid: 'rb', targetUid: 'tgt' });
    const t1 = s.board.find((c) => c.uid === 'tgt')!;
    expect([t1.attack - a0, t1.health - h0]).toEqual([2, 2]); // a 1/1 Ruby, cast TWICE by the Grimoire
    expect(s.grimoireMult).toBe(0); // the Ruby spent the charge
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

});

describe('set 2 — Scalechanter (owner rework 2026-07-25)', () => {
  it('every Shop spell cast gives your WHOLE board +1 Attack', () => {
    // "your minions" is the whole board, not just Dragons — a Beast on the board must gain it too.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 60,
      board: [minion('sc', 'd2_scalechanter', 'dragon', 4, 3), minion('b', 'alley', 'beast', 2, 2)],
      hand: [spellInHand('sp', 'emberpouch')], // a Gold spell: no stat effect of its own to confound the +1
    };
    s = reduce(s, { type: 'play', uid: 'sp' });
    const sc = s.board.find((c) => c.uid === 'sc')!;
    const beast = s.board.find((c) => c.uid === 'b')!;
    expect(sc.attack, 'it buffs itself too').toBe(5);
    expect(beast.attack, 'and a non-Dragon friend').toBe(3);
    expect([sc.health, beast.health], 'Attack only — no Health').toEqual([3, 2]);
  });

  it('a RUBY is not a Shop spell, so it does not trigger it', () => {
    // The printed text says "Shop spell". `spellCast` never fires for Rubies (they don't route through
    // castSpell), so the exclusion is structural — this pins it rather than trusting the comment.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 60,
      board: [minion('sc', 'd2_scalechanter', 'dragon', 4, 3), minion('k', 'k_stormchaser', 'kobold', 2, 2)],
      hand: [spellInHand('r', 'ruby')],
    };
    s = reduce(s, { type: 'play', uid: 'r', targetUid: 'k' } as never);
    expect(s.board.find((c) => c.uid === 'sc')!.attack, 'a Ruby cast leaves it alone').toBe(4);
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

describe('set 2 — Ashen Broodlord (owner change 2026-07-25)', () => {
  /** Board + a shop row of DISTINCT real minions to eat. */
  const setup = (broodlordGolden = false): RunState => {
    const s: RunState = { ...createRun(4), phase: 'recruit' };
    const bl = minion('BL', 'd2_broodlord', 'dragon', 6, 8);
    bl.golden = broodlordGolden;
    s.board = [bl, minion('OTHER', 'dm_clerk', 'demon', 2, 2)];
    s.shop = [{ uid: 's0', cardId: 'dm_hungerling' }, { uid: 's1', cardId: 'stray' }];
    s.hand = [];
    s.tier = 6;
    return s;
  };

  it('consuming a Shop minion puts a Shop spell in hand', () => {
    const s = setup();
    consumeShopMinion(s, s.board[0]!, 0);
    expect(s.hand.length).toBe(1);
    const got = CARD_INDEX[s.hand[0]!.cardId]!;
    expect(got.spell, `${got.name} is a spell`).toBe(true);
    expect(got.token, 'and a Shop spell, not a Ruby — the card says "Shop spell"').toBeFalsy();
  });

  it('only fires for ITS OWN consume, not another minion eating', () => {
    const s = setup();
    // The OTHER demon eats. Broodlord is on the board watching, and must stay quiet.
    consumeShopMinion(s, s.board[1]!, 0);
    expect(s.hand.length, 'a board-mate consuming is not "when THIS Consumes"').toBe(0);
  });

  it('golden grants two', () => {
    const s = setup(true);
    consumeShopMinion(s, s.board[0]!, 0);
    expect(s.hand.length).toBe(2);
  });
});

/**
 * Chorus Drake. Had NO coverage before this — the owner's text change (2026-07-25, dropping "other") is what
 * surfaced that. Assertions read the `sc` log line, which names the minion whose Shout was re-fired, so they
 * work for any Shout rather than only ones with a combat-visible effect.
 */

describe('set 2 — tranche of owner card changes (2026-07-25)', () => {
  const bm2 = (cardId: string, uid: string, attack = 2, health = 20): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords: [] as BoardMinion['keywords'] });

  it('Traveling Skald buffs a friendly DRAGON that attacks, not a Beast', () => {
    const r = simulate(
      [bm2('d2_skald', 'S', 1, 60), bm2('d2_embermouth', 'D', 3, 60), bm2('alley', 'B', 3, 60)],
      [{ cardId: 'sandbag', attack: 0, health: 900 }], makeRng(4), CARD_INDEX,
      combatSide({ tier: 4, tribes: ['dragon', 'beast'] }), combatSide({ tier: 1 }));
    const buffsOn = (uid: string) => (r.events.filter((e) => e.type === 'buff') as { target: string; attack: number }[])
      .filter((b) => b.target === uid);
    expect(buffsOn('m1').length, 'the Dragon that attacked was buffed').toBeGreaterThan(0);
    expect(buffsOn('m1')[0]!.attack).toBe(2);
    expect(buffsOn('m2'), 'the Beast that attacked was NOT').toEqual([]);
  });

  it('Commander Warpath only offers Dragons that actually HAVE a Shout', () => {
    const s: RunState = { ...createRun(3), phase: 'recruit', tier: 6, embers: 60, board: [], hand: [minion('bk', 'd2_blazingkeeper', 'dragon', 5, 3)] };
    const after = reduce(s, { type: 'play', uid: 'bk' });
    expect(after.hand.length, 'it granted something').toBe(1);
    const got = CARD_INDEX[after.hand[0]!.cardId]!;
    expect(got.tribe === 'dragon' || got.tribe2 === 'dragon', `${got.name} is a Dragon`).toBe(true);
    expect(got.effects.some((e) => e.on === 'onPlay'), `${got.name} has a Shout`).toBe(true);
  });

  it('Commander Warpath can never roll Karwind — it watches Shouts but has none', () => {
    // The owner called this one out by name. Assert against the POOL rather than a sampled roll, so it can't
    // pass by luck of the seed.
    const eligible = poolOf({ ...createRun(3), tier: 7 } as RunState).buyable.filter(
      (c) => !c.spell && !c.ruby && (c.tribe === 'dragon' || c.tribe2 === 'dragon') && c.effects.some((e) => e.on === 'onPlay'),
    );
    expect(eligible.some((c) => c.id === 'karwind'), 'Karwind is not a Shout Dragon').toBe(false);
    expect(eligible.length, 'but there ARE Shout Dragons to draw').toBeGreaterThan(2);
  });

  it('Storm Chaser hands you a Veinstorm', () => {
    const s: RunState = { ...createRun(3), phase: 'recruit', embers: 60, board: [], hand: [minion('sc', 'k_stormchaser', 'kobold', 2, 2)] };
    const after = reduce(s, { type: 'play', uid: 'sc' });
    expect(after.hand.map((c) => c.cardId)).toContain('veinstorm');
  });

  it('Pouchpincher is a NEUTRAL minion now', () => {
    expect(CARD_INDEX['k_pouchpincher']!.tribe).toBe('neutral');
  });

  it('Faultline Scrapper raises Ruby strength on DEATH, not on damage', () => {
    const c = CARD_INDEX['k_faultline']!;
    expect(c.effects.map((e) => e.on)).toEqual(['onDeath']);
    expect(c.text).toMatch(/Echo/);
  });

  it('Lancel grants Ward with NO free opening swing', () => {
    // The fixture has to make the two behaviours DISTINGUISHABLE. With Lancel left-most it attacks first in
    // normal turn order anyway, so a free swing looks identical — the first version of this test passed
    // against the un-fixed code for exactly that reason. Here a DRAGON is left-most, so the shielded Beast
    // (m1) only swings early if the removed `attackNow` is still firing.
    const r = simulate(
      [bm2('d2_embermouth', 'D', 3, 60), bm2('alley', 'B', 3, 60), bm2('b2_lancel', 'L', 3, 60)],
      [{ cardId: 'sandbag', attack: 0, health: 900 }], makeRng(4), CARD_INDEX,
      combatSide({ tier: 3, tribes: ['beast', 'dragon'] }), combatSide({ tier: 1 }));
    expect(r.events.some((e) => e.type === 'shieldUp'), 'Ward still lands').toBe(true);
    const firstAttacker = (r.events.find((e) => e.type === 'attack') as { attacker: string } | undefined)?.attacker;
    expect(firstAttacker, 'turn order opens the fight, not a Start-of-Combat swing').toBe('m0');
  });
});

describe('set 2 — Dragon reworks (owner batch 2026-07-27)', () => {
  it('Commander Warpath hands you a Brood Whelp, and the Whelp has a Shout of its own', () => {
    const s: RunState = { ...createRun(3), phase: 'recruit', tier: 6, embers: 60, board: [],
      hand: [minion('bk', 'd2_blazingkeeper', 'dragon', 5, 3)] };
    const after = reduce(s, { type: 'play', uid: 'bk' });
    expect(after.hand.map((c) => c.cardId)).toContain('d2_broodwhelp');
    const whelp = CARD_INDEX['d2_broodwhelp']!;
    expect([whelp.tier, whelp.attack, whelp.health]).toEqual([1, 3, 1]);
    expect(whelp.effects.some((e) => e.on === 'onPlay'), 'it carries its own Shout').toBe(true);
  });

  it('Thunderous Sovereign improves per spell, and NOT retroactively', () => {
    // The accrual is per-instance, so a Sovereign bought after the casts inherits nothing — the same rule
    // Ashscribe and Spellkeeper follow.
    let s: RunState = { ...createRun(3), phase: 'recruit', tier: 6, embers: 90,
      board: [minion('ts', 'd2_sovereign', 'dragon', 8, 8)],
      hand: [spellInHand('a', 'emberpouch'), spellInHand('b', 'emberpouch')] };
    expect(s.board[0]!.summonBonus ?? 0).toBe(0);
    s = reduce(s, { type: 'play', uid: 'a' });
    s = reduce(s, { type: 'play', uid: 'b' });
    expect(s.board.find((c) => c.uid === 'ts')!.summonBonus, 'two casts, two improvements').toBe(2);
  });

  it('Embermouth Whelp grows off a Shout you trigger in the SHOP', () => {
    // Most Shouts fire in the shop, so the recruit half is the one that matters — the combat-only version
    // would have made the card look dead in the phase you actually play it.
    let s: RunState = { ...createRun(3), phase: 'recruit', tier: 6, embers: 60,
      board: [minion('e', 'd2_embermouth', 'dragon', 2, 2)],
      hand: [minion('sh', 'd2_chronicler', 'dragon', 3, 5)] };
    s = reduce(s, { type: 'play', uid: 'sh' });
    const e = s.board.find((c) => c.uid === 'e')!;
    expect([e.attack, e.health], 'a triggered Shout grew it').toEqual([3, 3]);
  });
});
