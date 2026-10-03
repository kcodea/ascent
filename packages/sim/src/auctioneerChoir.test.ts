/**
 * R-SHOUT-TRIGGER-01: a TRIGGERED Shout is a Shout, for every listener (owner report 2026-10-03: "auctioneer w/
 * rune of the choir does not work and it should").
 *
 * Rune of the Choir: "Your **Shouts** trigger an **additional time**." The Auctioneer's Pulse: "Trigger a friendly
 * minion's **Shout**." The Choir's extra lived ONLY in `playedShoutRepeats` (the counter for a Shout PLAYED from
 * hand), while the Pulse re-fires through `replayBattlecry`, which folded Drakko but not the Choir. So a Pulse
 * fired once, the Choir never heard it, and the same hole swallowed every other re-trigger (Echoing Roar,
 * Resonance, Ryme in the shop, Rune of the Last Word) and every Shout triggered in COMBAT (the extras were never
 * threaded into `questCombatMods` at all, even though Blasting Voices says "in combat").
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';
import { replayBattlecry } from './recruit';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** A plain Dragon — Cleric's Shout ("give your other Dragons +3/+3") lands on it, so its Attack counts fires. */
const drake = (uid = 'w'): BoardCard => card(uid, 'whelpling', { attack: 1, health: 50 });
const cleric = (uid = 'c'): BoardCard => card(uid, 'cleric', { attack: 1, health: 50 });
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
/** Shout fires = the Dragon's Attack gain / 3. */
const fires = (before: RunState, after: RunState, uid = 'w'): number => (at(after, uid).attack - at(before, uid).attack) / 3;

/** An Auctioneer run; with `choir`, Rune of the Choir is bought through the real Runeforge action. */
function auctioneer(board: BoardCard[], choir: boolean, over: Partial<RunState> = {}): RunState {
  let s = { ...createRun(11, 'myra'), wave: 7, phase: 'recruit', embers: 60, hand: [], board, ...over } as RunState;
  if (choir) {
    s = reduce({ ...s, runeforgeOffer: ['rune_choir'] } as RunState, { type: 'buyRune', index: 0 });
    expect(s.ownedRunes, 'the Choir was bought').toContain('rune_choir');
    expect(s.shoutExtraAlways).toBe(1);
    s = { ...s, hand: [] }; // drop the Choir's granted Shout minion: this test is about the multiplier
  }
  return s;
}

describe('R-SHOUT-TRIGGER-01 — the Auctioneer\'s Pulse × Rune of the Choir (shop)', () => {
  it('control: without the Choir, Pulse fires the Shout once', () => {
    const s = auctioneer([drake(), cleric()], false);
    expect(fires(s, reduce(s, { type: 'heroPower', uid: 'c' }))).toBe(1);
  });

  it('THE REPORT: with the Choir, Pulse fires the Shout twice (the Choir hears a triggered Shout)', () => {
    const s = auctioneer([drake(), cleric()], true);
    const after = reduce(s, { type: 'heroPower', uid: 'c' });
    expect(fires(s, after)).toBe(2);
    expect(after.heroReady, 'the Pulse charge is spent').toBe(false);
  });

  it('the Choir\'s badge pulses on the Pulse (the visible beat: runeProcs.rune_choir moves)', () => {
    const s = auctioneer([drake(), cleric()], true);
    const after = reduce(s, { type: 'heroPower', uid: 'c' });
    expect((after.runeProcs?.rune_choir ?? 0)).toBeGreaterThan(s.runeProcs?.rune_choir ?? 0);
  });

  it('stacks ADDITIVELY with Drakko (1 + Drakko 1 + Choir 1 = 3), never multiplicatively', () => {
    const s = auctioneer([drake(), cleric(), card('m', 'drummer')], true);
    expect(fires(s, reduce(s, { type: 'heroPower', uid: 'c' }))).toBe(3);
  });

  it('stacks per copy: Blasting Voices (+2) plus the Choir (+1) = 4 fires', () => {
    let s = auctioneer([drake(), cleric()], true);
    s = reduce({ ...s, runeforgeOffer: ['rune_blasting_voices'] } as RunState, { type: 'buyRune', index: 0 });
    s = { ...s, hand: [] };
    expect(s.shoutExtraAlways).toBe(3);
    expect(fires(s, reduce(s, { type: 'heroPower', uid: 'c' }))).toBe(4);
  });

  it('no double count on a PLAYED Shout: playing Cleric with the Choir still fires exactly twice', () => {
    const s = auctioneer([drake()], true);
    const withHand = { ...s, hand: [cleric('c')] } as RunState;
    const after = reduce(withHand, { type: 'play', uid: 'c' });
    expect(fires(withHand, after)).toBe(2);
  });

  it('the one-per-turn CHARGES stay play-only: a Pulse never spends Warm Embers\' freebie', () => {
    const s = auctioneer([drake(), cleric()], true, { shoutFirstDoubleEachRound: true, shoutFirstUsedThisTurn: false });
    const after = reduce(s, { type: 'heroPower', uid: 'c' });
    expect(fires(s, after), 'Choir only: 2, not 3').toBe(2);
    expect(after.shoutFirstUsedThisTurn ?? false, 'the freebie is still waiting for a played Shout').toBe(false);
  });

  it('GENERAL FORM: every shop re-trigger (the shared replayBattlecry) carries the standing extras, Encore included', () => {
    const s = auctioneer([drake(), cleric()], false, { shoutExtraAlways: 1, shoutExtraTurn: 1 });
    const before = at(s, 'w').attack;
    replayBattlecry(s, at(s, 'c'));
    expect((at(s, 'w').attack - before) / 3, '1 + Choir 1 + Encore 1').toBe(3);
  });
});

describe('R-SHOUT-TRIGGER-01 — the standing extras reach COMBAT-triggered Shouts too (cross-phase by default)', () => {
  const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])] } as unknown as BoardMinion);
  /** Ryme dies to the first enemy swing and re-fires both Pennycats' Shouts (summon a Stray) — two combat Shouts. */
  const fight = (mods: QuestCombatMods) => simulate(
    [bm('alley', 'p0', 1, 30), bm('ryme', 'p1', 1, 1), bm('alley', 'p2', 1, 30)],
    [bm('cryptwolf', 'e0', 5, 60)], makeRng(0xd0c5), CARD_INDEX,
    combatSide({ tier: 3, questMods: mods }), combatSide({ tier: 3 }));
  const strays = (mods: QuestCombatMods): number => fight(mods).events.filter((e) => {
    const ev = e as { type?: string; minion?: { cardId?: string } };
    return ev.type === 'summon' && ev.minion?.cardId === 'stray';
  }).length;

  it('every combat-triggered Shout fires one extra time per Choir stack, and the Choir badge triggers', () => {
    const base = strays({});
    expect(base).toBe(2);
    expect(strays({ shoutExtraAlways: 1 })).toBe(base + 2);
    const triggers = fight({ shoutExtraAlways: 1 }).events.filter((e) => e.type === 'questTrigger' && (e as { flag: string }).flag === 'runeChoir');
    expect(triggers.length, 'one rune beat per boosted Shout').toBe(2);
  });

  it('the reducer threads the permanent extras into combat (questCombatMods.shoutExtraAlways)', () => {
    const run = (patch: Partial<RunState>): RunState => ({ ...createRun(3, 'myra'), ...patch } as RunState);
    expect(questCombatMods(run({ shoutExtraAlways: 2 })).shoutExtraAlways).toBe(2);
    expect(questCombatMods(run({})).shoutExtraAlways).toBeUndefined();
  });
});
