import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type QuestCombatMods } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-UNDERTOW-LANDED-01 — Rune of the Undertow: "The first 4 minions summoned in combat gain Ward", in EVERY combat,
 * on both sides, counting only bodies that actually land.
 *
 * Owner bug 2026-10-08: "rune of the undertow needs to work every round, i think it's only working for 4 total uses".
 * The budget was already per fight, but a summon onto a FULL board (lost to `summonOverflow`) spent it — so a
 * 7-wide token board burned all 4 Wards on overflowed tokens and the bodies that did land arrived bare, every
 * round. Only a landed body spends the allowance now.
 */
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const wall = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const TRIBES = ['undead', 'beast', 'mech', 'demon', 'dragon'];
type Summon = Extract<CombatEvent, { type: 'summon' }>;
type Reborn = Extract<CombatEvent, { type: 'reborn' }>;
const triggers = (evs: CombatEvent[], side: 'player' | 'enemy') =>
  evs.filter((e) => e.type === 'questTrigger' && e.flag === 'runeUndertow' && e.side === side).length;
/** Every body that ENTERED play mid-fight on `side`, in order, and whether it arrived Warded. */
function entries(r: ReturnType<typeof simulate>, side: 'player' | 'enemy'): boolean[] {
  const mine = new Set(r.initial[side].map((m) => m.uid));
  const out: boolean[] = [];
  for (const e of r.events) {
    if (e.type === 'summon' && (e as Summon).side === side) { mine.add((e as Summon).minion.uid); out.push((e as Summon).minion.keywords.includes('DS')); }
    if (e.type === 'reborn' && mine.has((e as Reborn).target)) out.push((e as Reborn).keywords.includes('DS'));
  }
  return out;
}

/** Two Nanons in front of five tanky Mechs: each Nanon death lands ONE Nanobot in its freed slot, four overflow. */
const nanonBoard = (): BoardMinion[] => [
  bm('nanon', { attack: 1, health: 1 }), bm('nanon', { attack: 1, health: 1 }),
  ...Array.from({ length: 5 }, () => ({ cardId: 'drone', attack: 1, health: 500, keywords: [] } as unknown as BoardMinion)),
];
/** Five Rising Pups: five returns, so the cap of 4 is reached with one to spare. */
const pups = (): BoardMinion[] => Array.from({ length: 5 }, () => bm('u3_poochy'));

describe('R-UNDERTOW-LANDED-01: Rune of the Undertow, every combat, landed bodies only', () => {
  it('overflowed summons do not spend the allowance (the owner report)', () => {
    const r = simulate(nanonBoard(), [wall(5, 3000)], makeRng(1), CARD_INDEX,
      combatSide({ tier: 6, tribes: TRIBES, questMods: { runeUndertow: 4 } }), combatSide({ tier: 6 }));
    expect(r.events.some((e) => e.type === 'summon' && e.minion.cardId === 'nanobot'), 'a Nanobot landed').toBe(true);
    const landed = entries(r, 'player');
    expect(landed.length, 'both Nanons landed one Nanobot (the rest overflowed)').toBeGreaterThanOrEqual(2);
    expect(landed.slice(0, 4).every(Boolean), 'the first landed bodies (up to 4) are all Warded').toBe(true);
    expect(triggers(r.events, 'player'), 'one pulse per Ward actually granted').toBe(Math.min(4, landed.length));
  });

  it('a DEFERRED summon (attack-on-summon Whelp) that overflows at land time refunds its Ward', () => {
    // Golden Twilight Whelps queue two Whelps into ONE freed slot: the first lands, the second overflows. With a
    // budget of 2, the overflowed Whelp must hand its Ward back, so the next Twilight Whelp's Whelp still gets one.
    const p = [{ cardId: 'twilightwhelp', attack: 1, health: 1, golden: true }, { cardId: 'twilightwhelp', attack: 1, health: 1, golden: true },
      ...Array.from({ length: 5 }, () => ({ cardId: 'drone', attack: 1, health: 500 }))].map((m) => ({ keywords: [], ...m })) as unknown as BoardMinion[];
    const r = simulate(p, [wall(1, 5000)], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: TRIBES, questMods: { runeUndertow: 2 } }), combatSide({ tier: 6 }));
    const whelps = r.events.filter((e): e is Summon => e.type === 'summon' && e.minion.cardId === 'whelpling');
    expect(whelps.length, 'two Whelps landed (one per freed slot)').toBe(2);
    expect(whelps.every((w) => w.minion.keywords.includes('DS')), 'both landed Whelps are Warded').toBe(true);
  });

  it('a fresh 4 every combat: three fights in a row, same mods object, each wards exactly the first 4', () => {
    const mods: QuestCombatMods = { runeUndertow: 4 };
    for (let fight = 0; fight < 3; fight++) {
      const r = simulate(pups(), [wall(1, 3000)], makeRng(10 + fight), CARD_INDEX,
        combatSide({ tier: 6, tribes: TRIBES, questMods: mods }), combatSide({ tier: 6 }));
      const landed = entries(r, 'player');
      expect(landed.length, `fight ${fight}: all five pups rose`).toBe(5);
      expect(landed, `fight ${fight}: the first 4 are Warded, the 5th is not`).toEqual([true, true, true, true, false]);
      expect(triggers(r.events, 'player')).toBe(4);
    }
    expect(mods, 'the caller\'s mods are never spent').toEqual({ runeUndertow: 4 });
  });

  it('a fresh 4 every combat across the overflow board too (three fights)', () => {
    const mods: QuestCombatMods = { runeUndertow: 4 };
    for (let fight = 0; fight < 3; fight++) {
      const r = simulate(nanonBoard(), [wall(5, 3000)], makeRng(20 + fight), CARD_INDEX,
        combatSide({ tier: 6, tribes: TRIBES, questMods: mods }), combatSide({ tier: 6 }));
      const landed = entries(r, 'player');
      expect(landed.slice(0, 4).every(Boolean), `fight ${fight}`).toBe(true);
    }
  });

  it('the ENEMY side gets the same fresh allowance every fight it is served', () => {
    const enemyMods: QuestCombatMods = { runeUndertow: 4 };
    for (let fight = 0; fight < 3; fight++) {
      const r = simulate([wall(1, 3000)], pups(), makeRng(30 + fight), CARD_INDEX,
        combatSide({ tier: 6 }), combatSide({ tier: 6, tribes: TRIBES, questMods: enemyMods }));
      expect(entries(r, 'enemy'), `fight ${fight}`).toEqual([true, true, true, true, false]);
      expect(triggers(r.events, 'enemy')).toBe(4);
      expect(triggers(r.events, 'player')).toBe(0);
    }
    // Overflow on the enemy side behaves the same as the player's.
    const o = simulate([wall(5, 3000)], nanonBoard(), makeRng(4), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 6, tribes: TRIBES, questMods: { runeUndertow: 4 } }));
    const landed = entries(o, 'enemy');
    expect(landed.length).toBeGreaterThanOrEqual(2);
    expect(landed.slice(0, 4).every(Boolean)).toBe(true);
  });

  it('two copies stack their budgets (4 + 4 = 8 Wards a combat)', () => {
    const seven = Array.from({ length: 7 }, () => bm('u3_poochy'));
    const one = simulate(seven, [wall(1, 5000)], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: TRIBES, questMods: { runeUndertow: 4 } }), combatSide({ tier: 6 }));
    expect(entries(one, 'player').filter(Boolean).length).toBe(4);
    const two = simulate(seven.map((m) => ({ ...m })), [wall(1, 5000)], makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, tribes: TRIBES, questMods: { runeUndertow: 8 } }), combatSide({ tier: 6 }));
    const l2 = entries(two, 'player');
    expect(l2.length).toBe(7);
    expect(l2.every(Boolean), 'all 7 returns fit inside the doubled budget').toBe(true);
  });

  it('is deterministic: the same seed replays the same log', () => {
    const go = () => simulate(nanonBoard(), [wall(5, 3000)], makeRng(7), CARD_INDEX,
      combatSide({ tier: 6, tribes: TRIBES, questMods: { runeUndertow: 4 } }), combatSide({ tier: 6, questMods: { runeUndertow: 4 } }));
    expect(JSON.stringify(go().events)).toBe(JSON.stringify(go().events));
  });
});
