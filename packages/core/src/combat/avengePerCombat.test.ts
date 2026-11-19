/**
 * AN AVENGE (N) IS PER COMBAT (owner 2026-11-18, R-AVENGE-PER-COMBAT-01): "avenge (x): do not carry over combat to
 * combat. if it were 'when x minions die' that carries over, but avenge means it needs to happen in combat."
 *
 * The engine half: every hero-level Ancient Avenge fires on the fight's OWN friendly-death count (0 at the start of
 * every fight). A `tick` a side still carries (an older snapshot, a Shop-phase count) is ignored, for both sides. The
 * "When N friendly minions die" counters (Rune of Body Counting, Braum x Death) are not Avenges and keep their tick.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods, type Side } from '../index';

const PLAIN = Object.values(CARD_INDEX).filter((c) => c && !c.spell && !c.token && !c.duos && !c.ruby && c.effects.length === 0 && c.keywords.length === 0 && c.attack > 0 && c.health > 0).map((c) => c!.id);
const A = PLAIN[0]!;
const bm = (cardId: string, attack: number, health: number, uid: string): BoardMinion => ({ cardId, attack, health, keywords: [], sourceUid: uid }) as BoardMinion;
type Fight = ReturnType<typeof simulate>;
const FLAG = 'ancientDiceLock';
const DEATH = 'Ancient of Death';
const weak = (n: number, p: string): BoardMinion[] => Array.from({ length: n }, (_, i) => bm(A, 1, 1, `${p}${i}`));
const wall = (p: string): BoardMinion[] => [bm(A, 50, 5000, `${p}w`)];
/** `n` of my 1/1s die to one big foe. */
const fight = (n: number, mods: Partial<QuestCombatMods> = {}, seed = 5): Fight =>
  simulate(weak(n, 'c'), wall('f'), makeRng(seed), CARD_INDEX, combatSide({ questMods: mods }), combatSide());
/** The mirror: `n` ENEMY 1/1s die to my one big body; the enemy side carries the mods. */
const fightEnemy = (n: number, mods: Partial<QuestCombatMods> = {}, seed = 5): Fight =>
  simulate(wall('c'), weak(n, 'f'), makeRng(seed), CARD_INDEX, combatSide(), combatSide({ questMods: mods }));
const pulses = (r: Fight, side: Side, flag = FLAG): number => r.events.filter((e) => e.type === 'questTrigger' && e.side === side && e.flag === flag).length;
const pulse = (tick: number, every = 4): Partial<QuestCombatMods> => ({ ancientAvengePulse: { every, tick, flag: FLAG, label: DEATH } });

describe('An Avenge (N) counts this fight only (R-AVENGE-PER-COMBAT-01)', () => {
  it('3 deaths never fire an Avenge (4), whatever count the side carried in (fails before the fix: tick 3 + 1 death fired)', () => {
    for (const tick of [0, 1, 2, 3]) {
      const r = fight(3, pulse(tick));
      expect(r.playerDeaths).toBe(3);
      expect(pulses(r, 'player'), `carried ${tick}`).toBe(0);
    }
    // One death with 3 carried: the old running count fired here.
    expect(pulses(fight(1, pulse(3)), 'player')).toBe(0);
  });

  it('4 deaths in one fight fire once; 7 still once; an Avenge (2) over 4 deaths fires twice, over 6 three times', () => {
    expect(pulses(fight(4, pulse(0)), 'player')).toBe(1);
    expect(pulses(fight(4, pulse(3)), 'player'), 'a carried 3 does not make the 1st death fire or add a fire').toBe(1);
    expect(pulses(fight(7, pulse(2)), 'player')).toBe(1);
    expect(pulses(fight(4, pulse(1, 2)), 'player')).toBe(2);
    expect(pulses(fight(6, pulse(1, 2)), 'player')).toBe(3);
  });

  it('the fire lands ON the death that completes the count (the 4th), not earlier', () => {
    const r = fight(5, pulse(3));
    const at = r.events.findIndex((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === FLAG);
    const deathsBefore = r.events.slice(0, at).filter((e) => e.type === 'death' && e.side === 'player').length;
    // The avenge bus runs as the 4th body dies; its `death` event is logged around the same moment.
    expect(deathsBefore).toBeGreaterThanOrEqual(3);
    expect(deathsBefore).toBeLessThanOrEqual(4);
  });

  it('is symmetric: the enemy side follows the same rule', () => {
    expect(pulses(fightEnemy(3, pulse(3)), 'enemy')).toBe(0);
    expect(pulses(fightEnemy(1, pulse(3)), 'enemy')).toBe(0);
    expect(pulses(fightEnemy(4, pulse(3)), 'enemy')).toBe(1);
    expect(pulses(fightEnemy(4, pulse(1, 2)), 'enemy')).toBe(2);
    expect(pulses(fightEnemy(4, pulse(0)), 'player'), 'never the other side').toBe(0);
  });

  it('every hero Avenge shares the rule: a carried tick fires none of them early', () => {
    const gift = { kind: 'gift' as const, cardId: 'goldcrafter' };
    const carried: Partial<QuestCombatMods>[] = [
      { ancientMaxGoldAvenge: { every: 4, tick: 3, gold: 1, flag: 'f1', label: DEATH } },
      { ancientRefreshAvenge: { every: 4, tick: 3, flag: 'f2', label: DEATH } },
      { ancientBrackusAvenge: { every: 4, tick: 3, attack: 1, health: 1, flag: 'f3', label: DEATH } },
      { ancientSproutAvenge: { every: 4, tick: 3, cardId: A, size: 1, flag: 'f4', label: DEATH } },
    ];
    carried.forEach((mods, i) => {
      expect(pulses(fight(3, mods), 'player', `f${i + 1}`), `mod ${i} at 3 deaths`).toBe(0);
      expect(pulses(fight(4, mods), 'player', `f${i + 1}`), `mod ${i} at 4 deaths`).toBe(1);
    });
    const xerox = fight(3, { ancientXeroxAvenge: { every: 4, tick: 3, label: DEATH } });
    expect(xerox.events.some((e) => e.type === 'sc' && e.side === 'player' && e.heroPower)).toBe(false);
    const gorr = fight(3, { ancientGorrAvenge: { every: 4, tick: 3, ids: [A], label: DEATH } });
    expect(gorr.events.some((e) => e.type === 'toHand' && e.side === 'player')).toBe(false);
    const mate = fight(3, { ancientMateGiftAvenge: { every: 4, tick: 3, gift, label: DEATH } });
    expect(mate.events.some((e) => e.type === 'teamSend')).toBe(false);
    const hunch = fight(3, { ancientAvengeSpells: { every: 4, attack: 1, health: 1, label: DEATH, tick: 3 } });
    expect(hunch.playerAncientSpellImproved ?? { attack: 0, health: 0 }).toMatchObject({ attack: 0, health: 0 });
    expect(fight(4, { ancientAvengeSpells: { every: 4, attack: 1, health: 1, label: DEATH, tick: 3 } }).playerAncientSpellImproved).toMatchObject({ attack: 1, health: 1 });
  });

  it('a "When N friendly minions die" counter is NOT an Avenge: Braum x Death still pays from its carried count', () => {
    const paid = fight(1, { ancientBramDeaths: { every: 16, tick: 15, label: DEATH } });
    expect(paid.events.some((e) => e.type === 'toHand' && e.side === 'player')).toBe(true);
    const short = fight(1, { ancientBramDeaths: { every: 16, tick: 13, label: DEATH } });
    expect(short.events.some((e) => e.type === 'toHand' && e.side === 'player')).toBe(false);
  });

  it('determinism: the same seed gives the same log, and a carried tick changes nothing at all', () => {
    const a = fight(6, pulse(0, 2), 11), b = fight(6, pulse(0, 2), 11), c = fight(6, pulse(1, 2), 11);
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(JSON.stringify(c.events)).toBe(JSON.stringify(a.events));
  });
});

describe('The carry-over kind (R-ANCIENT-CARRYOVER-01): Gildmaster x Death and Cindy x Death read "When N friendly minions die"', () => {
  const gift = { kind: 'gift' as const, cardId: 'goldcrafter' };
  const crafter = (tick: number, extra: Partial<QuestCombatMods> = {}): Partial<QuestCombatMods> =>
    ({ ancientGorrAvenge: { every: 17, tick, ids: ['goldcrafter'], label: DEATH, carry: true }, ...extra });
  const mateGift = (tick: number, extra: Partial<QuestCombatMods> = {}): Partial<QuestCombatMods> =>
    ({ ancientMateGiftAvenge: { every: 15, tick, gift, label: DEATH, carry: true }, ...extra });
  const toHand = (r: Fight, side: Side) => r.events.filter((e) => e.type === 'toHand' && e.side === side).length;
  const sends = (r: Fight, side: Side) => r.events.filter((e) => e.type === 'teamSend' && e.side === side).length;

  it('the carried tick counts: 16 carried pays on the first death, 15 carried on the second, 14 carried never in 2 deaths', () => {
    expect(toHand(fight(1, crafter(16)), 'player')).toBe(1);
    expect(toHand(fight(2, crafter(15)), 'player')).toBe(1);
    expect(toHand(fight(1, crafter(15)), 'player')).toBe(0);
    expect(toHand(fight(2, crafter(14)), 'player')).toBe(0);
    expect(sends(fight(1, mateGift(14)), 'player')).toBe(1);
    expect(sends(fight(3, mateGift(11)), 'player')).toBe(0);
    // Without `carry` the same tick is ignored (the Avenge rule, unchanged for every other hero).
    expect(toHand(fight(1, { ancientGorrAvenge: { every: 17, tick: 16, ids: ['goldcrafter'], label: DEATH } }), 'player')).toBe(0);
  });

  it('repeats every N on the running count: 16 carried + 18 deaths pays twice (deaths 1 and 18)', () => {
    const r = fight(18, crafter(16));
    expect(r.playerDeaths).toBe(18);
    expect(toHand(r, 'player')).toBe(2);
    expect(sends(fight(16, mateGift(14)), 'player')).toBe(2);
  });

  it('is not an Avenge, so Rune of Fury does not repeat it (Braum x Death\'s rule)', () => {
    expect(toHand(fight(1, crafter(16, { runeFury: true })), 'player')).toBe(1);
    expect(sends(fight(1, mateGift(14, { runeFury: true })), 'player')).toBe(1);
  });

  it('is symmetric: the enemy side carries its tick the same way', () => {
    expect(toHand(fightEnemy(1, crafter(16)), 'enemy')).toBe(1);
    expect(toHand(fightEnemy(2, crafter(14)), 'enemy')).toBe(0);
    expect(sends(fightEnemy(1, mateGift(14)), 'enemy')).toBe(1);
    expect(toHand(fightEnemy(1, crafter(16)), 'player'), 'never the other side').toBe(0);
  });
});
