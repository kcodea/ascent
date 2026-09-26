import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';

/**
 * "ATTACKS IMMEDIATELY" CUTS THE LINE (owner bug 2026-09-26, oracle rule R-COMBAT-ATTACKNOW-01).
 *
 *   *"when the sunmane is summoned, it is supposed to attack immediately after being summoned, cutting in front
 *   of the order. a 'attacks immediately' mechanic cuts the line. this doesn't interrupt a flurry attack, but it
 *   does interrupt other attack orderings if something is summoned to attack immediately."*
 *
 * The bug: Rune of Living Echoes summons in `fillFreeSlots`, which ran AFTER the between-attacks flush of the
 * immediate-attack queue. The deferred Sunmane then sat queued until the NEXT attacker's wind-up flush — after
 * that attacker's `attack` event — so the next minion lunged, the Sunmane landed and swung, and only then did
 * the lunge's hit land. Fixed in `simulate` (`settleBetweenAttacks`), not in the presentation.
 */

const ALL = ['beast', 'dragon', 'undead', 'mech', 'demon', 'kobold', 'dwarf'];
type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;
const bag = (attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId: 'sandbag', attack, health, keywords } as unknown as BoardMinion);
const fight = (mine: BoardMinion[], foes: BoardMinion[], mods: object = {}, seed = 5) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL, questMods: mods as never }), combatSide());
const summonsOf = (events: readonly CombatEvent[], cardId: string) =>
  events.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'summon' && e.minion.cardId === cardId)
    .map(({ e, i }) => ({ i, uid: (e as Ev<'summon'>).minion.uid }));
const nextAttackAfter = (events: readonly CombatEvent[], i: number) => {
  const j = events.findIndex((e, k) => k > i && e.type === 'attack');
  return { j, ev: events[j] as Ev<'attack'> | undefined };
};

describe('Rune of Living Echoes — the Sunmane attacks the moment it lands', () => {
  // A FULL player board, so nothing fills at Start of Combat: the slot opens mid-fight, when the 1/1 dies.
  const mine = [bag(1, 1), ...Array.from({ length: 6 }, () => bag(1, 300))];
  const foes = [bag(5, 300), bag(5, 300)];

  it('no other attack starts between the freeing death and the Sunmane\'s summon + strike', () => {
    const r = fight(mine, foes, { runeLivingEchoes: 1 });
    const [s] = summonsOf(r.events, 'b2_sunmane');
    expect(s, 'no Sunmane was summoned').toBeDefined();
    const freed = r.events.findIndex((e) => e.type === 'death' && e.side === 'player');
    expect(freed).toBeGreaterThanOrEqual(0);
    expect(freed).toBeLessThan(s!.i);
    // The regression: the enemy's next attacker used to lunge HERE, before the Sunmane even landed.
    const between = r.events.slice(freed, s!.i).filter((e) => e.type === 'attack');
    expect(between, 'an attack cut in front of the Sunmane').toEqual([]);
    const { ev } = nextAttackAfter(r.events, s!.i);
    expect(ev?.attacker, 'the first attack after the summon must be the Sunmane').toBe(s!.uid);
  });

  it('the Sunmane\'s strike fully resolves before the next normal attacker swings, and normal order resumes', () => {
    const r = fight(mine, foes, { runeLivingEchoes: 1 });
    const [s] = summonsOf(r.events, 'b2_sunmane');
    const { j: strike } = nextAttackAfter(r.events, s!.i);
    // Its clash damage lands before any other attack event.
    const { j: after, ev: resumed } = nextAttackAfter(r.events, strike);
    const sunmaneHit = r.events.findIndex((e, k) => k > strike && e.type === 'dmg' && e.source === s!.uid);
    expect(sunmaneHit).toBeGreaterThan(strike);
    expect(sunmaneHit).toBeLessThan(after);
    // Normal order resumes where it was: the player's 1/1 (index 0) attacked first and died to retaliation, so it
    // is the ENEMY's turn — its first attacker (index 0) — and the Sunmane's strike did not consume that turn.
    expect(resumed?.attacker).toBe(r.initial.enemy[0]!.uid);
    const { ev: playerNext } = nextAttackAfter(r.events, after);
    expect(playerNext?.attacker, 'the player rotation resumes after the dead 1/1').toBe(r.initial.player[1]!.uid);
  });

  it('it then joins the normal rotation (appended at the right) and takes its regular turn too', () => {
    const r = fight(mine, foes, { runeLivingEchoes: 1 });
    const [s] = summonsOf(r.events, 'b2_sunmane');
    const sunmaneAttacks = r.events.filter((e) => e.type === 'attack' && e.attacker === s!.uid);
    // It dies to the retaliation on its immediate strike here, so exactly one. With a survivable foe it swings
    // again on its rotation turn, after the six bodies to its left (below).
    expect(sunmaneAttacks.length).toBe(1);
    // Plain 1-Attack foes (a vanilla Beetle — a Target Dummy grows Attack as it is hit) so the Sunmane survives.
    const beetle = { cardId: 'beetle', attack: 1, health: 300, keywords: [] } as unknown as BoardMinion;
    const soft = fight(mine, [beetle, { ...beetle }], { runeLivingEchoes: 1 });
    const [s2] = summonsOf(soft.events, 'b2_sunmane');
    const swings = soft.events.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'attack' && e.attacker === s2!.uid);
    expect(swings.length).toBeGreaterThanOrEqual(2);
    // Between its immediate strike and its first rotation turn, every other living player minion attacks once.
    const playerAttackersBetween = new Set(soft.events.slice(swings[0]!.i + 1, swings[1]!.i)
      .filter((e): e is Ev<'attack'> => e.type === 'attack')
      .map((e) => e.attacker)
      .filter((u) => soft.initial.player.some((m) => m.uid === u)));
    expect(playerAttackersBetween.size).toBe(6);
  });

  it('several Sunmanes summoned together each summon + strike in summon order, before the next normal attack', () => {
    // An enemy Cleaver swings into the Taunted middle 1/1 and kills three at once → three Sunmanes queue together.
    const three = [bag(1, 300), bag(1, 1), bag(1, 1, ['T']), bag(1, 1), bag(1, 300), bag(1, 300), bag(1, 300)];
    const r = fight(three, [bag(1, 900, ['C'])], { runeLivingEchoes: 3 });
    const ss = summonsOf(r.events, 'b2_sunmane');
    expect(ss.length).toBe(3);
    // summon A · A attacks · summon B · B attacks · summon C · C attacks
    const seq = r.events.slice(ss[0]!.i).filter((e) => e.type === 'summon' || e.type === 'attack').slice(0, 7)
      .map((e) => e.type === 'summon' ? `summon:${e.minion.uid}` : `attack:${(e as Ev<'attack'>).attacker}`);
    expect(seq).toEqual([
      `summon:${ss[0]!.uid}`, `attack:${ss[0]!.uid}`,
      `summon:${ss[1]!.uid}`, `attack:${ss[1]!.uid}`,
      `summon:${ss[2]!.uid}`, `attack:${ss[2]!.uid}`,
      // …then normal order resumes: the player's next rotation body (index 4, past the three dead 1/1s).
      `attack:${r.initial.player[4]!.uid}`,
    ]);
  });
});

describe('Flurry is NOT interrupted by an immediate attacker', () => {
  it('a Whelp spawned by swing 1 of a Flurry waits for swing 2 to resolve, then strikes before anyone else', () => {
    // The player's Flurry attacker opens (7 v 2), kills the Taunted Violet Whelp on swing 1; its Deathrattle
    // queues an enemy 3/2 Whelp that attacks immediately. Swing 2 must land in full first.
    const mine = [bag(1, 300, ['W']), ...Array.from({ length: 6 }, () => bag(1, 300))];
    const foes: BoardMinion[] = [
      { cardId: 'twilightwhelp', attack: 1, health: 1, keywords: ['T'] } as unknown as BoardMinion,
      bag(1, 900),
    ];
    const r = fight(mine, foes);
    const flurry = r.initial.player[0]!.uid;
    const swing2 = r.events.findIndex((e) => e.type === 'attack' && e.attacker === flurry && e.swing === 1);
    expect(swing2, 'the Flurry never took its second swing').toBeGreaterThanOrEqual(0);
    const swing2Hit = r.events.findIndex((e, k) => k > swing2 && e.type === 'dmg' && e.source === flurry);
    const [w] = summonsOf(r.events, 'whelpling');
    expect(w, 'no Whelp was summoned').toBeDefined();
    // The regression this pins: the Whelp used to land in swing 2's wind-up, between its lunge and its hit.
    expect(w!.i, 'the Whelp cut into the Flurry').toBeGreaterThan(swing2Hit);
    // …and it still cuts the line: the next attack after it lands is its own, not the enemy's normal turn.
    expect(nextAttackAfter(r.events, w!.i).ev?.attacker).toBe(w!.uid);
  });
});

describe('every other "attacks immediately" source still strikes the moment it lands', () => {
  it('Violet Whelp\'s Deathrattle Whelp', () => {
    const r = fight([bag(3, 300)], [{ cardId: 'twilightwhelp', attack: 1, health: 1, keywords: [] } as unknown as BoardMinion, bag(1, 900)], {}, 1);
    const [w] = summonsOf(r.events, 'whelpling');
    expect(w).toBeDefined();
    expect(nextAttackAfter(r.events, w!.i).ev?.attacker).toBe(w!.uid);
  });

  it('Kurse\'s Gemheart Golem', () => {
    const SET3 = poolFor('set3').all.map((c) => c.id);
    const bm = (cardId: string, attack: number, health: number): BoardMinion =>
      ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])] } as unknown as BoardMinion);
    const r = simulate([bm('k3_kurse', 10, 100), bm('sandbag', 1, 1), bm('sandbag', 1, 1), bm('sandbag', 1, 1)], [bag(1, 400)],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6, poolIds: SET3, tribes: ['kobold', 'celestial', 'dwarf'] } as never), combatSide({ tier: 1 }));
    const [g] = summonsOf(r.events, 'gemheart-shard');
    expect(g, 'a Golem was summoned').toBeDefined();
    expect(nextAttackAfter(r.events, g!.i).ev?.attacker).toBe(g!.uid);
  });
});
