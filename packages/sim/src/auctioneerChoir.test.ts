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
import { endOfTurnRepeats, replayBattlecry } from './recruit';

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

  it('the one-per-turn CHARGES are spent by a triggered Shout too (owner 2026-10-03: "pulse or other triggering options should absolutely trigger the extra shouts")', () => {
    const s0 = auctioneer([drake(), cleric()], true, { shoutFirstDoubleEachRound: true, shoutFirstUsedThisTurn: false, runeWarDrum: 2, runeWarDrumUsedThisTurn: false });
    const after = reduce(s0, { type: 'heroPower', uid: 'c' });
    expect(fires(s0, after), '1 + Choir 1 + Warm Embers 1 + War Drum 2').toBe(5);
    expect(after.shoutFirstUsedThisTurn, 'Warm Embers spent by the Pulse').toBe(true);
    expect(after.runeWarDrumUsedThisTurn, 'War Drum spent by the Pulse').toBe(true);
    // …so the next Shout this turn gets only the standing Choir extra.
    const played = reduce({ ...after, hand: [cleric('c2')] } as RunState, { type: 'play', uid: 'c2' });
    expect((at(played, 'w').attack - at(after, 'w').attack) / 3).toBe(2);
  });

  it('GENERAL FORM: every shop re-trigger (the shared replayBattlecry) carries the Shout extras, Encore included', () => {
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

describe('R-SHOUT-TRIGGER-01 — every Shout modifier reaches combat Shouts (owner 2026-10-03: "make sure all of this logic works across the board")', () => {
  const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra } as unknown as BoardMinion);
  /** Ryme dies and re-fires the Pennycat's Shout once: ONE combat Shout trigger. */
  const ryme = (mods: QuestCombatMods) => simulate(
    [bm('alley', 'p0', 1, 30), bm('ryme', 'p1', 1, 1)], [bm('cryptwolf', 'e0', 5, 60)], makeRng(0xd0c5), CARD_INDEX,
    combatSide({ tier: 3, questMods: mods }), combatSide({ tier: 3 }));

  it('every extra fire is a Shout for the tally and every watcher (one battlecryTriggered per fire)', () => {
    expect(ryme({}).playerShoutFires).toBe(1);
    expect(ryme({ shoutExtraAlways: 1 }).playerShoutFires, 'the Choir fire counts as a Shout').toBe(2);
    expect(ryme({ encoreExtra: 1, warDrumExtra: 2 }).playerShoutFires).toBe(4);
  });

  it('each extra fire is its own counted `shout` beat', () => {
    expect(ryme({}).events.filter((e) => e.type === 'shout').length).toBe(1);
    expect(ryme({ shoutExtraAlways: 1 }).events.filter((e) => e.type === 'shout').length).toBe(2);
  });

  it('Warm Embers gives each fight its own first-Shout double (R-SHOUT-01), and the reducer threads it', () => {
    expect(ryme({ warmEmbersFirst: 1 }).playerShoutFires).toBe(2);
    const run = (patch: Partial<RunState>): RunState => ({ ...createRun(3, 'myra'), ...patch } as RunState);
    expect(questCombatMods(run({ shoutFirstDoubleEachRound: true, shoutFirstUsedThisTurn: true })).warmEmbersFirst).toBe(1);
    expect(questCombatMods(run({})).warmEmbersFirst).toBeUndefined();
  });

  it('Twin Sun Oath and Rune of the Drake Skull hear combat Shouts (cross-phase), once per fire, with a badge beat', () => {
    const r = ryme({ shoutExtraAlways: 1, shoutEdgeBuff: { attack: 1, health: 1 }, shoutEdgeTribeBuff: { tribe: 'beast', attack: 2, health: 2 } });
    const trig = (flag: string): number => r.events.filter((e) => e.type === 'questTrigger' && (e as { flag: string }).flag === flag).length;
    expect(trig('twinSunOath'), 'two fires → two Twin Sun payouts').toBe(2);
    expect(trig('runeDrakeSkull'), 'the Pennycat is a Beast: two fires → two Drake Skull payouts').toBe(2);
    expect(r.events.some((e) => e.type === 'buff' && (e as { source: string }).source === 'Rune of the Drake Skull')).toBe(true);
    const run = (patch: Partial<RunState>): RunState => ({ ...createRun(3, 'myra'), ...patch } as RunState);
    const m = questCombatMods(run({ shoutEdgeBuff: { attack: 5, health: 5 }, shoutEdgeTribeBuff: { tribe: 'dragon', attack: 6, health: 6 } }));
    expect(m.shoutEdgeBuff).toEqual({ attack: 5, health: 5 });
    expect(m.shoutEdgeTribeBuff).toEqual({ tribe: 'dragon', attack: 6, health: 6 });
  });

  it('the three forced combat Shouts (Shared Scripture, Ancestral Roar, War Chorus) are counted Shouts now', () => {
    const r = simulate([bm('emissary', 'p0', 2, 1), bm('whelpling', 'p1', 0, 400)], [bm('sandbag', 'e0', 9, 400)], makeRng(7), CARD_INDEX,
      combatSide({ tier: 6, questMods: { runeAncestralRoar: true, shoutExtraAlways: 1 } }), combatSide({ tier: 3 }));
    expect(r.playerShoutFires, 'Ancestral Roar + Choir: two counted fires').toBe(2);
  });
});

describe('Parliament of Flame × Chronos (owner 2026-10-03: "does parliament work w/ chronos? if so that\'s fine")', () => {
  it('the extra End-of-Turn triggers ADD to Chronos on the live End of Turn path', () => {
    const run = (board: BoardCard[], extra: number): RunState => ({ ...createRun(3, 'myra'), board, endOfTurnExtra: extra || undefined } as RunState);
    expect(endOfTurnRepeats(run([], 0))).toBe(1);
    expect(endOfTurnRepeats(run([card('k', 'chronos')], 0)), 'Chronos').toBe(2);
    expect(endOfTurnRepeats(run([card('k', 'chronos')], 1)), 'Chronos + Parliament').toBe(3);
  });
});
