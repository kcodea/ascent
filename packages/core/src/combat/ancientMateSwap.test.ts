/**
 * ANCIENT OF WAR × MAGICIAN (Duos only; owner 2026-11-10, R-ANCMAGICIAN-03): "Start of Combat: A minion that both you
 * and your teammate control copies of gain each others stats." The combat half, `QuestCombatMods.ancientMateSwap`.
 *
 * A tag-team fight's OPENING only. For every card both the fighting board and its waiting reserve hold, the left-most
 * copy on each gains the other's Attack and Health (every stat read before any gain): the fighting body as a combat
 * buff, the reserve on its per-fight locked copy, so it steps in that much bigger. Whichever of the two carries the
 * mod, so both copies gain whoever fights first. Per side, never by label.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';

/** Plain minions with no effects, so nothing else moves a stat. */
const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.effects.length === 0 && c.keywords.length === 0).map((c) => c!.id);
const [SHARED, OTHER_A, OTHER_B] = PLAIN as [string, string, string];
const bm = (cardId: string, attack: number, health: number, uid: string, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [], sourceUid: uid, ...over }) as BoardMinion;

const LABEL = 'Ancient of War';
const holder = () => combatSide({ questMods: { ancientMateSwap: { label: LABEL } } });
/** The first board: the shared card (3/50) and a card the teammate does not hold. */
const first = (): BoardMinion[] => [bm(OTHER_A, 1, 60, 'a0'), bm(SHARED, 3, 50, 'a1')];
/** The teammate's board: a card I do not hold, then the shared card twice (the left-most copy is the 7/9). */
const reserve = (): BoardMinion[] => [bm(OTHER_B, 2, 2, 'm0'), bm(SHARED, 7, 9, 'm1'), bm(SHARED, 20, 20, 'm2')];
/** A foe that kills the first board, then falls to nothing in particular (the reserve only needs to step in). */
const foe = (): BoardMinion[] => [bm(OTHER_B, 200, 4000, 'f0')];

type Fight = ReturnType<typeof simulate>;
const fight = (firstState = combatSide(), reserveState = combatSide(), reserveBoard = reserve()): Fight =>
  simulate(first(), foe(), makeRng(4), CARD_INDEX, firstState, combatSide(), { reserve: { player: { board: reserveBoard, state: reserveState } } });
const tagIn = (r: Fight, side: 'player' | 'enemy' = 'player') => r.events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn' && e.side === side);
const buffs = (r: Fight) => r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === LABEL);
/** The combat uid of the first board's shared copy (its second minion). */
const sharedUid = (r: Fight, side: 'player' | 'enemy' = 'player'): string => r.initial[side][1]!.uid;

describe('Magician × War in combat (ancientMateSwap)', () => {
  it('I fight first: my copy gains my teammate\'s left-most copy\'s stats, and theirs steps in with mine', () => {
    const plain = fight();
    const war = fight(holder());
    // My fighting copy (3/50) gains the teammate's left-most copy's 7/9, once, as a labelled combat buff.
    const mine = buffs(war);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ target: sharedUid(war), attack: 7, health: 9 });
    // The teammate's left-most copy (7/9) steps in 3/50 bigger; its second copy and its other minion are unchanged.
    const base = tagIn(plain)!.minions;
    const got = tagIn(war)!.minions;
    expect(got.map((m, i) => [m.attack - base[i]!.attack, m.health - base[i]!.health])).toEqual([[0, 0], [3, 50], [0, 0]]);
  });

  it('my teammate fights first: the same exchange happens, because it is read off either board of the team', () => {
    // The Magician is the RESERVE here: the fighting board carries nothing, the waiting one carries the mod.
    const war = fight(combatSide(), holder());
    expect(buffs(war)).toHaveLength(1);
    expect(buffs(war)[0]).toMatchObject({ target: sharedUid(war), attack: 7, health: 9 });
    const base = tagIn(fight())!.minions;
    expect(tagIn(war)!.minions.map((m, i) => [m.attack - base[i]!.attack, m.health - base[i]!.health])).toEqual([[0, 0], [3, 50], [0, 0]]);
  });

  it('once per fight: both teammates carrying it, or the reserve stepping in, never fires it again', () => {
    const war = fight(holder(), holder());
    expect(buffs(war)).toHaveLength(1);
    expect(tagIn(war)).toBeTruthy(); // the reserve did step in, and nothing fired at its own Start of Combat
  });

  it('nothing shared, or no teammate board: nothing happens', () => {
    const noShare = fight(holder(), combatSide(), [bm(OTHER_B, 2, 2, 'm0')]);
    expect(buffs(noShare)).toHaveLength(0);
    // An ordinary fight (no reserve) is the fight of before, with or without the mod.
    const solo = (state = combatSide()): string => JSON.stringify(simulate(first(), foe(), makeRng(4), CARD_INDEX, state, combatSide()).events);
    expect(solo(holder())).toBe(solo());
  });

  it('without the mod a tag-team fight is unchanged (the test fails without the effect)', () => {
    expect(buffs(fight())).toHaveLength(0);
    expect(JSON.stringify(fight(holder()).events)).not.toBe(JSON.stringify(fight().events));
  });

  it('a Gilded copy pairs with a plain one (the card is what matters), at its current stats', () => {
    const war = fight(holder(), combatSide(), [bm(SHARED, 14, 18, 'm0', { golden: true })]);
    expect(buffs(war)[0]).toMatchObject({ attack: 14, health: 18 });
    expect(tagIn(war)!.minions[0]).toMatchObject({ attack: 17, health: 68, golden: true });
  });

  it('combat only: the boards passed in are never changed', () => {
    const board = reserve();
    const snap = structuredClone(board);
    fight(holder(), combatSide(), board);
    expect(board).toEqual(snap);
  });

  it('the two sides are symmetric: the enemy team gets exactly what the player team gets', () => {
    const p = fight(holder());
    const e = simulate(foe(), first(), makeRng(4), CARD_INDEX, combatSide(), holder(), { firstSide: 'enemy', reserve: { enemy: { board: reserve(), state: combatSide() } } });
    const eb = buffs(e);
    expect(eb).toHaveLength(1);
    expect(eb[0]).toMatchObject({ target: sharedUid(e, 'enemy'), attack: 7, health: 9 });
    expect(tagIn(e, 'enemy')!.minions.map((m) => [m.attack, m.health])).toEqual(tagIn(p)!.minions.map((m) => [m.attack, m.health]));
  });

  it('the same seed resolves to the same bytes', () => {
    expect(JSON.stringify(fight(holder()))).toBe(JSON.stringify(fight(holder())));
  });
});
