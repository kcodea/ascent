/**
 * Runeforge batch, owner rulings 2026-09-22:
 *
 *  1. Rune of the Ornate Clock PAYS its printed 2 Gold ("fix rune of ornate clock") — on resolve, exactly once.
 *  2. Guardian + Rune of the Epic Forge book TWO Epic forges for turn 8 ("can we just book 2 runeforges here"),
 *     opened one after the other, each from its own seeded stream — and the universal turn-9 forge still comes.
 *  3. The "fits the board" rule: a TRIBE-tagged rune follows the board only at 2+ of that tribe (Basic forge) /
 *     3+ (Epic forge); an All-types body counts as one of EVERY tribe; a dual-tribe body counts for both.
 */
import { describe, expect, it } from 'vitest';
import { RUNE_INDEX, runeSynergies } from '@game/content';
import { createRun, deserialize, reduce, serialize, type RunState } from './index';
import { BASIC_FORGE_TRIBE_FIT, EPIC_FORGE_TRIBE_FIT, boardSynergyTags, boardTribeCounts, pendingEpicForges } from './reducer';

const win = { events: [], result: 'win' as const, playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } };

const body = (uid: string, cardId: string, tribe: RunState['board'][number]['tribe'], extra: Partial<RunState['board'][number]> = {}): RunState['board'][number] =>
  ({ uid, cardId, tribe, attack: 1, health: 1, keywords: [], golden: false, ...extra });
/** A vanilla Beast token: no effects, so a board of Pups carries a TRIBE tag and nothing else. */
const pup = (uid: string) => body(uid, 'pup', 'beast');

/** Buy `runeId` from an open Basic forge on turn 6 (recruit), returning the post-buy run. */
const buyAtBasicForge = (s: RunState, runeId: string): RunState =>
  reduce({ ...s, wave: 6, phase: 'recruit', hand: [], runeforgeOffer: [runeId], runeforgeNoCharge: true }, { type: 'buyRune', index: 0 });

/** Advance a recruit-phase run into the next turn (combat resolved as a win). */
const nextTurn = (s: RunState): RunState => reduce({ ...s, phase: 'combat', lastCombat: win }, { type: 'resolveCombat' });

describe('Rune of the Ornate Clock pays its printed 2 Gold (owner 2026-09-22: "fix rune of ornate clock")', () => {
  it('the printed Gold and the reward Gold agree', () => {
    const clock = RUNE_INDEX['rune_ornate_clock']!;
    expect(clock.text).toContain('Gain **2 Gold**');
    expect(clock.reward).toMatchObject({ kind: 'scheduleRuneforge', forge: 'epic', gold: 2 });
  });

  it('buying it pays +2 Gold NOW, on resolve, exactly once — and still moves the Epic forge to next turn', () => {
    const clock = RUNE_INDEX['rune_ornate_clock']!;
    const s = buyAtBasicForge({ ...createRun(7, 'warden'), embers: 10 }, 'rune_ornate_clock');
    expect(s.ownedRunes).toContain('rune_ornate_clock');
    // 10 - cost + 2: the Gold landed the moment the rune resolved (it used to never be paid at all).
    expect(s.embers).toBe(10 - clock.cost + 2);
    // Nothing is banked for a second payment later: the Epic branch pays on resolve, the Basic branch (The
    // Runeforge quest) is the one that carries Gold to the turn its forge opens.
    expect(s.pendingBasicForge).toBeUndefined();
    expect(s.bonusEmbersNextTurn ?? 0).toBe(0);
    // The forge itself: armed for next turn (deferred), and the turn-9 visit stands down.
    expect(pendingEpicForges(s)).toBe(1);
    expect(s.pendingForgeDeferred).toBe(true);
    expect(s.epicForgeClaimed).toBe(true);
    expect(s.runeforgeOffer, 'no forge opens mid-turn').toBeUndefined();
    const t7 = nextTurn(s);
    expect(t7.wave).toBe(7);
    expect(t7.runeforgeEpic, 'the moved Epic forge opens next turn').toBe(true);
    expect(pendingEpicForges(t7)).toBe(0);
  });
});

describe('Guardian + Rune of the Epic Forge: TWO Epic forges on turn 8 (owner 2026-09-22: "can we just book 2 runeforges here")', () => {
  /** A Guardian who bought Rune of the Epic Forge at the turn-6 Basic forge, standing at the start of turn 8
   *  with the first Epic forge open. */
  const guardianAtTurn8 = (seed: number): RunState => {
    const s0 = createRun(seed, 'runeguard');
    expect(s0.epicForgeWave, 'Guardian books turn 8 at creation').toBe(8);
    const bought = buyAtBasicForge({ ...s0, embers: 10 }, 'rune_epic_forge');
    expect(bought.epicForgeWave, 'the rune books BESIDE the hero forge, same turn').toBe(8);
    expect(bought.epicForgeCount, 'two forges booked for turn 8').toBe(2);
    const t7 = nextTurn(bought);
    expect(t7.wave).toBe(7);
    expect(t7.runeforgeOffer, 'turn 7: nothing opens').toBeUndefined();
    const t8 = nextTurn(t7);
    expect(t8.wave).toBe(8);
    return t8;
  };

  it('both open on turn 8, one after the other, with distinct offers, both buyable; turn 9 still comes', () => {
    const t8 = guardianAtTurn8(3);
    expect(t8.runeforgeEpic, 'the first Epic forge is open').toBe(true);
    expect(t8.epicForgeWave, 'the booking is consumed').toBeUndefined();
    expect(t8.epicForgeCount).toBeUndefined();
    expect(pendingEpicForges(t8), 'one more waits behind it').toBe(1);
    const first = [...t8.runeforgeOffer!];
    expect(first.length).toBe(4);
    // Buy from the first → the second opens at once, same turn, before anything else.
    const afterFirst = reduce({ ...t8, embers: 30 }, { type: 'buyRune', index: 0 });
    expect(afterFirst.ownedRunes).toContain(first[0]!);
    expect(afterFirst.runeforgeEpic, 'the SECOND Epic forge opened as the first closed').toBe(true);
    expect(pendingEpicForges(afterFirst)).toBe(0);
    const second = [...afterFirst.runeforgeOffer!];
    expect(second.length).toBe(4);
    expect(second.some((id) => first.includes(id)), 'the second forge shows runes the first did not').toBe(false);
    expect(second.every((id) => RUNE_INDEX[id]?.epic), 'the second forge draws from the Epic pool').toBe(true);
    // The second is buyable too.
    const afterSecond = reduce(afterFirst, { type: 'buyRune', index: 1 });
    expect(afterSecond.ownedRunes).toContain(second[1]!);
    expect(afterSecond.runeforgeOffer, 'no third forge').toBeUndefined();
    expect(pendingEpicForges(afterSecond)).toBe(0);
    // The universal turn-9 Epic forge is untouched by the two turn-8 visits.
    const t9 = nextTurn({ ...afterSecond, hand: [] });
    expect(t9.wave).toBe(9);
    expect(t9.runeforgeEpic, 'turn 9: the standing Epic forge still opens').toBe(true);
    expect(pendingEpicForges(t9)).toBe(0);
  });

  it('skipping the first still opens the second', () => {
    const t8 = guardianAtTurn8(4);
    const skipped = reduce(t8, { type: 'skipRuneforge' });
    expect(skipped.runeforgeEpic).toBe(true);
    expect(skipped.runeforgeOffer!.length).toBe(4);
    expect(pendingEpicForges(skipped)).toBe(0);
  });

  it('a NON-Guardian holding the rune gets ONE forge on turn 8', () => {
    const bought = buyAtBasicForge({ ...createRun(3, 'warden'), embers: 10 }, 'rune_epic_forge');
    expect(bought.epicForgeWave).toBe(8);
    expect(bought.epicForgeCount, 'a lone booking carries no count').toBeUndefined();
    const t8 = nextTurn(nextTurn(bought));
    expect(t8.wave).toBe(8);
    expect(t8.runeforgeEpic).toBe(true);
    expect(pendingEpicForges(t8), 'nothing waits behind it').toBe(0);
    const closed = reduce(t8, { type: 'skipRuneforge' });
    expect(closed.runeforgeOffer, 'no second forge').toBeUndefined();
  });

  it('a save taken while the first forge is open restores with the second still pending', () => {
    const t8 = guardianAtTurn8(5);
    const restored = deserialize(serialize(t8));
    expect(pendingEpicForges(restored), 'the count survives the save').toBe(1);
    expect(restored.runeforgeOffer).toEqual(t8.runeforgeOffer);
    const live = reduce({ ...t8, embers: 30 }, { type: 'buyRune', index: 0 });
    const fromSave = reduce({ ...restored, embers: 30 }, { type: 'buyRune', index: 0 });
    expect(fromSave.runeforgeEpic).toBe(true);
    expect(fromSave.runeforgeOffer, 'the second forge draws the same offer on the restored run').toEqual(live.runeforgeOffer);
  });

  it('a pre-2026-09-22 save holding the old boolean reads as one forge', () => {
    const legacy = { ...createRun(5, 'warden'), wave: 8, phase: 'recruit', pendingEpicRuneforge: true } as unknown as RunState;
    expect(pendingEpicForges(legacy)).toBe(1);
    expect(pendingEpicForges({ pendingEpicRuneforge: false as unknown as number })).toBe(0);
    expect(pendingEpicForges({ pendingEpicRuneforge: undefined })).toBe(0);
  });

  it('is deterministic: the same seed yields the same two offers', () => {
    const run = (): string[][] => {
      const t8 = guardianAtTurn8(9);
      const first = [...t8.runeforgeOffer!];
      const second = [...reduce({ ...t8, embers: 30 }, { type: 'buyRune', index: 0 }).runeforgeOffer!];
      return [first, second];
    };
    expect(run()).toEqual(run());
  });
});

describe('The board-fit rule (owner 2026-09-22: "at least 2 of a tribe type" Basic / "at least 3" Epic, All types count as 1 of everything)', () => {
  const at = (board: RunState['board']): RunState => ({ ...createRun(1, 'warden'), board, hand: [] });

  it('the thresholds are the named constants', () => {
    expect(BASIC_FORGE_TRIBE_FIT).toBe(2);
    expect(EPIC_FORGE_TRIBE_FIT).toBe(3);
  });

  it('1 Beast: a Beast rune does not fit a Basic forge', () => {
    const tags = boardSynergyTags(at([pup('a')]), false);
    expect(tags.has('beast')).toBe(false);
  });

  it('2 Beasts: fits Basic, not Epic', () => {
    const s = at([pup('a'), pup('b')]);
    expect(boardSynergyTags(s, false).has('beast')).toBe(true);
    expect(boardSynergyTags(s, true).has('beast')).toBe(false);
  });

  it('3 Beasts: fits Epic', () => {
    const s = at([pup('a'), pup('b'), pup('c')]);
    expect(boardSynergyTags(s, true).has('beast')).toBe(true);
  });

  it('an All-types minion + 1 Beast fits Basic — All counts as one of every tribe', () => {
    // Chaos Attachment is `universalTribe`; the per-instance `allTribes` flag (Anomaly Reactor's All mode) counts the same way.
    const s = at([body('all', 'symbioticattachment', 'neutral'), pup('a')]);
    const counts = boardTribeCounts(s);
    expect(counts.get('beast')).toBe(2);
    expect(counts.get('dragon'), 'the All body is one Dragon too').toBe(1);
    expect(counts.get('neutral'), 'neutral is never a tribe count').toBeUndefined();
    expect(boardSynergyTags(s, false).has('beast')).toBe(true);
    const flagged = at([body('all', 'pup', 'beast', { allTribes: true }), body('d', 'pup', 'dragon')]);
    expect(boardSynergyTags(flagged, false).has('dragon'), 'a per-instance All flag counts for every tribe').toBe(true);
  });

  it('a dual-tribe minion counts once for EACH of its tribes', () => {
    // Crypt Wolf is Undead + Beast: with one Pup it is 2 Beasts (fits Basic) and 1 Undead (does not).
    const s = at([body('cw', 'cryptwolf', 'undead'), pup('a')]);
    const counts = boardTribeCounts(s);
    expect(counts.get('beast')).toBe(2);
    expect(counts.get('undead')).toBe(1);
    const tags = boardSynergyTags(s, false);
    expect(tags.has('beast')).toBe(true);
    expect(tags.has('undead')).toBe(false);
  });

  it('the hand does not count — only the 7 board slots', () => {
    const s: RunState = { ...at([pup('a')]), hand: [pup('h1'), pup('h2')] };
    expect(boardSynergyTags(s, false).has('beast')).toBe(false);
  });

  /** Open the universal turn-6 Basic forge on a Warden (no forge discount of its own) with `board`. */
  const openBasic = (seed: number, board: RunState['board']): RunState => {
    const s: RunState = { ...createRun(seed, 'warden'), setId: 'set2', tribes: ['beast', 'demon', 'dragon', 'kobold', 'dwarf'], rift: 'runic',
      wave: 5, phase: 'combat', hand: [], board, lastCombat: win };
    return reduce(s, { type: 'resolveCombat' });
  };
  const followsBoard = (s: RunState, id: string): boolean => { const tags = boardSynergyTags(s); return runeSynergies(RUNE_INDEX[id]!).some((t) => tags.has(t)); };
  const beastOnly = (id: string): boolean => { const t = runeSynergies(RUNE_INDEX[id]!); return t.length === 1 && t[0] === 'beast'; };

  it('the guarantee swaps in a fitting rune under the new rule: 2 Pups (a tribe tag and nothing else) always see a Beast rune', () => {
    let opened = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const s = openBasic(seed, [pup('a'), pup('b')]);
      if (!s.runeforgeOffer) continue;
      opened++;
      expect(boardSynergyTags(s), 'two vanilla Beasts carry exactly the Beast tag').toEqual(new Set(['beast']));
      expect(s.runeforgeOffer.some((id) => followsBoard(s, id)), `seed ${seed}: no offered rune follows the 2-Beast board`).toBe(true);
    }
    expect(opened).toBeGreaterThan(0);
  });

  it('1 Pup: no tag, so the guarantee does not fire and a Beast rune CAN carry the pivot discount', () => {
    let discountedBeast = false;
    for (let seed = 1; seed <= 80 && !discountedBeast; seed++) {
      const s = openBasic(seed, [pup('a')]);
      if (!s.runeforgeOffer || !s.runeforgeDiscounts) continue;
      expect(boardSynergyTags(s).size, 'one vanilla Beast fits nothing').toBe(0);
      s.runeforgeOffer.forEach((id, i) => { if (beastOnly(id) && s.runeforgeDiscounts![i] !== undefined) discountedBeast = true; });
    }
    expect(discountedBeast, '80 seeds never discounted a Beast rune on a 1-Beast board').toBe(true);
  });

  it('2 Pups: a Beast rune follows the board, so it never carries the pivot discount', () => {
    let seenBeast = false;
    for (let seed = 1; seed <= 80; seed++) {
      const s = openBasic(seed, [pup('a'), pup('b')]);
      if (!s.runeforgeOffer || !s.runeforgeDiscounts) continue;
      s.runeforgeOffer.forEach((id, i) => {
        if (!beastOnly(id)) return;
        seenBeast = true;
        expect(s.runeforgeDiscounts![i], `seed ${seed}: a Beast rune that fits the 2-Beast board carried a discount`).toBeUndefined();
      });
    }
    expect(seenBeast, 'no Beast-only rune was ever offered across 80 seeds').toBe(true);
  });
});
