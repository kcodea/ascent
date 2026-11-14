/**
 * CINDY × THE ANCIENTS, the combat halves (Duos only; owner pairings 2026-11-14, R-ANCCINDY-01 / 03 / 06).
 *
 *  - DEATH (`ancientMateGiftAvenge`): "Avenge (15): give your teammate a Goldcrafter." The running count is carried in;
 *    each fire sends the gift to the TEAMMATE at once (`sendTeam`: a `teamSend` event, the carry's `mate` half).
 *  - WAR (`ancientSocGildLeftmost`): "Start of Combat: your left-most minion is Gilded." For the fight; an Engraved one
 *    keeps the Gilded status (`ancientGildKept`).
 *  - BONDS (`duosLinks`): a stat gain on a Linked body reaches its twin while the twin is the waiting reserve,
 *    combat-only, one hop; every Linked body shows "Linked" (`MinionSnapshot.linked`).
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';

/** Plain minions with no effects, so nothing else moves a stat. */
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.effects.length === 0 && c.keywords.length === 0 && c.attack > 0 && c.health > 0).map((c) => c!.id);
const [A, B, C] = PLAIN as [string, string, string];
const bm = (cardId: string, attack: number, health: number, uid: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], sourceUid: uid, ...over }) as BoardMinion;
type Fight = ReturnType<typeof simulate>;

describe('Cindy × War: Start of Combat, the left-most minion is Gilded', () => {
  const WAR = 'Ancient of War';
  const fight = (mods = {}, first: BoardMinion[] = [bm(A, 2, 30, 'c0'), bm(B, 2, 30, 'c1')]): Fight =>
    simulate(first, [bm(C, 1, 1, 'f0')], makeRng(3), CARD_INDEX, combatSide({ questMods: mods }), combatSide());

  it('the left-most living minion turns Gilded at the opening, with its printed stats again', () => {
    const r = fight({ ancientSocGildLeftmost: { label: WAR } });
    const head = r.initial.player[0]!;
    const asc = r.events.find((e): e is Extract<CombatEvent, { type: 'ascend' }> => e.type === 'ascend' && e.target === head.uid);
    expect(asc).toMatchObject({ gild: true });
    const gain = r.events.find((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === WAR);
    expect(gain).toMatchObject({ target: head.uid, attack: CARD_INDEX[A]!.attack, health: CARD_INDEX[A]!.health });
    // Only the left-most: the second minion is never gilded.
    expect(r.events.some((e) => e.type === 'ascend' && e.target === r.initial.player[1]!.uid)).toBe(false);
    // Not Engraved: the gild is for this fight only.
    expect(r.playerAncientGildKept).toBeUndefined();
  });

  it('an Engraved left-most minion keeps the Gilded status (its run uid comes home)', () => {
    const r = fight({ ancientSocGildLeftmost: { label: WAR } }, [bm(A, 2, 30, 'c0', { keywords: ['EG'] }), bm(B, 2, 30, 'c1')]);
    expect(r.playerAncientGildKept).toEqual(['c0']);
  });

  it('an already Gilded left-most minion is left alone; without the mod nothing is gilded (fails without the effect)', () => {
    const golden = fight({ ancientSocGildLeftmost: { label: WAR } }, [bm(A, 4, 30, 'c0', { golden: true, keywords: ['EG'] })]);
    expect(golden.events.some((e) => e.type === 'ascend')).toBe(false);
    expect(golden.playerAncientGildKept).toBeUndefined();
    expect(fight().events.some((e) => e.type === 'ascend')).toBe(false);
  });

  it('is symmetric: the enemy side carrying it gilds its own left-most', () => {
    const r = simulate([bm(C, 1, 1, 'p0')], [bm(A, 2, 30, 'e0', { keywords: ['EG'] })], makeRng(3), CARD_INDEX, combatSide(), combatSide({ questMods: { ancientSocGildLeftmost: { label: WAR } } }));
    expect(r.events.some((e) => e.type === 'ascend' && e.target === r.initial.enemy[0]!.uid)).toBe(true);
    expect(r.enemyCarry?.ancientGildKept).toEqual(['e0']);
  });
});

describe('Cindy × Death: every 15th friendly death gives the teammate a Goldcrafter, live', () => {
  const DEATH = 'Ancient of Death';
  const gift = { kind: 'gift' as const, cardId: 'goldcrafter' };
  /** Three of my minions that die to one big foe. */
  const fight = (mods = {}): Fight =>
    simulate([bm(A, 1, 1, 'c0'), bm(B, 1, 1, 'c1'), bm(C, 1, 1, 'c2')], [bm(A, 50, 500, 'f0')], makeRng(5), CARD_INDEX, combatSide({ questMods: mods }), combatSide());
  const mateGifts = (r: Fight) => (r.playerShoutCarry?.teamEffects ?? []).filter((t) => t.mate && t.effect.kind === 'gift');

  it('the carried count reaching 15 mid-fight sends the gift to the teammate (a teamSend, the mate half)', () => {
    const r = fight({ ancientMateGiftAvenge: { every: 15, tick: 13, gift, label: DEATH } });
    expect(mateGifts(r)).toHaveLength(1);
    expect(mateGifts(r)[0]!.effect).toEqual(gift);
    expect(mateGifts(r)[0]!.self).toBe(false);
    expect(r.events.filter((e) => e.type === 'teamSend' && e.side === 'player')).toHaveLength(1);
    expect(r.playerDeaths).toBe(3);
  });

  it('short of 15 nothing is sent, and without the mod nothing is sent (fails without the effect)', () => {
    expect(mateGifts(fight({ ancientMateGiftAvenge: { every: 15, tick: 0, gift, label: DEATH } }))).toHaveLength(0);
    expect(mateGifts(fight())).toHaveLength(0);
  });

  it('Rune of Fury fires it again, like every hero Avenge', () => {
    const r = fight({ ancientMateGiftAvenge: { every: 15, tick: 13, gift, label: DEATH }, runeFury: true });
    expect(mateGifts(r)).toHaveLength(2);
  });
});

describe('Cindy × Bonds in a tag-team fight: a Linked gain reaches the waiting twin', () => {
  const SOC = { attack: 2, health: 3, label: 'Test' };
  const first = (): BoardMinion[] => [bm(A, 1, 40, 'c0'), bm(B, 1, 40, 'c1')];
  const reserve = (): BoardMinion[] => [bm(C, 2, 2, 'm0'), bm(A, 4, 4, 'm1')];
  const foe = (): BoardMinion[] => [bm(C, 300, 5000, 'f0')];
  const fight = (firstMods = {}, reserveMods = {}): Fight =>
    simulate(first(), foe(), makeRng(4), CARD_INDEX, combatSide({ questMods: firstMods }), combatSide(),
      { reserve: { player: { board: reserve(), state: combatSide({ questMods: reserveMods }) } } });
  const tagIn = (r: Fight) => r.events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn' && e.side === 'player')!;

  it('my linked body gains at Start of Combat: the twin steps in that much bigger (combat-only), nothing else moves', () => {
    const plain = tagIn(fight({ ancientSocBuffAll: SOC }));
    const linked = tagIn(fight({ ancientSocBuffAll: SOC, duosLinks: [{ id: 'L1', uid: 'c1' }] }, { duosLinks: [{ id: 'L1', uid: 'm1' }] }));
    expect(linked.minions.map((m, i) => [m.attack - plain.minions[i]!.attack, m.health - plain.minions[i]!.health])).toEqual([[0, 0], [2, 3]]);
  });

  it('a different link id, or no twin on the reserve, mirrors nothing (fails without the effect)', () => {
    const plain = tagIn(fight({ ancientSocBuffAll: SOC }));
    const other = tagIn(fight({ ancientSocBuffAll: SOC, duosLinks: [{ id: 'L1', uid: 'c1' }] }, { duosLinks: [{ id: 'L2', uid: 'm1' }] }));
    expect(other.minions.map((m) => [m.attack, m.health])).toEqual(plain.minions.map((m) => [m.attack, m.health]));
  });

  it('every Linked body is marked "linked" on its snapshot, and nothing else is', () => {
    const r = fight({ duosLinks: [{ id: 'L1', uid: 'c1' }] }, { duosLinks: [{ id: 'L1', uid: 'm1' }] });
    expect(r.initial.player.map((m) => !!m.linked)).toEqual([false, true]);
    expect(tagIn(r).minions.map((m) => !!m.linked)).toEqual([false, true]);
    expect(fight().initial.player.some((m) => m.linked)).toBe(false);
  });

  it('a fight without a reserve is byte-identical with or without links', () => {
    const solo = (mods = {}): string => JSON.stringify(simulate(first(), foe(), makeRng(4), CARD_INDEX, combatSide({ questMods: { ancientSocBuffAll: SOC, ...mods } }), combatSide()).events.filter((e) => e.type !== 'summon'));
    expect(solo({ duosLinks: [{ id: 'L1', uid: 'c9' }] })).toBe(solo());
  });
});
