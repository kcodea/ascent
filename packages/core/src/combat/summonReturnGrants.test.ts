import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-SUMMON-RETURN-01 — a Rise or Rebirth return IS a combat summon for every "summoned in combat" listener.
 *
 * Owner bug 2026-10-06: "rune of the undertow didnt proc on a rising minion. it should, it should also proc on a
 * rebirth minion. please fix". The summon-entry suite already ran on a return, but the BODY GRANTS (Undertow's
 * Ward, Hatchery, Packcraft, Food Chain, Spare Chair) lived inline in `summonMinion`, which a return never
 * passes through (it re-slots the same instance). They now live in one helper both paths call.
 */
const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const fight = (mine: BoardMinion[], foes: BoardMinion[], mods: object = {}, seed = 3) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['undead', 'beast', 'spirit', 'celestial'], questMods: mods }), combatSide({ tier: 6 }));
type Reborn = Extract<CombatEvent, { type: 'reborn' }>;
const reborns = (evs: CombatEvent[]): Reborn[] => evs.filter((e): e is Reborn => e.type === 'reborn');
const triggers = (evs: CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag && e.side === 'player');

describe('R-SUMMON-RETURN-01: a Rise / Rebirth return is a combat summon for the body-grant runes', () => {
  it('Rune of the Undertow wards a RISING minion (the owner report)', () => {
    // Rising Pup (2/1 Taunt, Rise) dies to the first hit and rises: it must come back Warded.
    const r = fight([bm('u3_poochy')], [foe(1, 500)], { runeUndertow: 4 });
    const rb = reborns(r.events);
    expect(rb, 'one Rise return').toHaveLength(1);
    expect(rb[0]!.keywords, 'the risen body arrives with Ward').toContain('DS');
    expect(triggers(r.events, 'runeUndertow'), 'the rune pulses once for the return').toHaveLength(1);
    // The rune's trigger sits before the return, so the badge burst and the Ward land on the return beat.
    const ti = r.events.findIndex((e) => e.type === 'questTrigger' && e.flag === 'runeUndertow');
    expect(ti).toBeLessThan(r.events.indexOf(rb[0]!));
    // Control: without the rune the risen body has no Ward.
    const bare = reborns(fight([bm('u3_poochy')], [foe(1, 500)]).events);
    expect(bare[0]!.keywords).not.toContain('DS');
  });

  it('Rune of the Undertow wards a REBIRTHING minion (its Ward was not already restored)', () => {
    const r = fight([bm('sandbag', { attack: 1, health: 3, keywords: ['RB'] })], [foe(10, 500)], { runeUndertow: 4 });
    const rb = reborns(r.events);
    expect(rb).toHaveLength(1);
    expect(rb[0]).toMatchObject({ rebirth: true });
    expect(rb[0]!.keywords, 'the reborn body arrives with Ward').toContain('DS');
    expect(triggers(r.events, 'runeUndertow')).toHaveLength(1);
  });

  it('a Rebirth that restores its own Ward costs Undertow nothing (no double Ward, no wasted charge)', () => {
    const r = fight([bm('u3_poochy', { attack: 50, health: 50, keywords: ['RB', 'DS'] })], [foe(100, 500)], { runeUndertow: 4 });
    expect(reborns(r.events)[0]!.keywords).toContain('DS');
    expect(triggers(r.events, 'runeUndertow'), 'the body already had Ward').toHaveLength(0);
  });

  it('the 4-Ward cap counts returns and summons together, once per entry (no double-fire)', () => {
    // Four Rising Pups each die and rise once: exactly four Wards, four pulses, never more.
    const pups = [bm('u3_poochy'), bm('u3_poochy'), bm('u3_poochy'), bm('u3_poochy'), bm('u3_poochy')];
    const r = fight(pups, [foe(1, 5000)], { runeUndertow: 4 });
    const rb = reborns(r.events);
    expect(rb.length, 'all five rose').toBe(5);
    expect(rb.filter((e) => e.keywords.includes('DS')).length, 'the cap holds at 4').toBe(4);
    expect(triggers(r.events, 'runeUndertow')).toHaveLength(4);
  });

  it('Rune of the Hatchery: a risen body comes back +5/+5 with Taunt', () => {
    const r = fight([bm('sandbag', { attack: 1, health: 1, keywords: ['R'] })], [foe(1, 500)], { runeHatchery: { attack: 5, health: 5 } });
    const rb = reborns(r.events);
    expect(rb).toHaveLength(1);
    const printed = CARD_INDEX['sandbag']!;
    expect([rb[0]!.attack, rb[0]!.hp]).toEqual([printed.attack + 5, 1 + 5]);
    expect(rb[0]!.keywords).toContain('T');
    expect(triggers(r.events, 'runeHatchery')).toHaveLength(1);
  });

  it('Rune of Packcraft: a Rebirth return takes the current level and grows it (R-RUNE-06 "a Rise return counts once")', () => {
    const r = fight([bm('u3_poochy', { attack: 1, health: 2, keywords: ['RB'] })], [foe(2, 500)], { runePackcraft: true, packcraftLevel: { attack: 2, health: 1 } });
    const rb = reborns(r.events);
    expect(rb).toHaveLength(1);
    // (Rising Pup, not the sandbag: the sandbag's own on-damaged Attack gain would blur the read.)
    expect([rb[0]!.attack, rb[0]!.hp], 'the full 1/2 body, +2/+1').toEqual([3, 3]);
    expect(triggers(r.events, 'runePackcraft')).toHaveLength(1);
  });

  it('is deterministic: the same seed replays the same returns', () => {
    const a = fight([bm('u3_poochy'), bm('sandbag', { keywords: ['RB'] })], [foe(3, 500)], { runeUndertow: 4, runeHatchery: { attack: 5, health: 5 } }, 9);
    const b = fight([bm('u3_poochy'), bm('sandbag', { keywords: ['RB'] })], [foe(3, 500)], { runeUndertow: 4, runeHatchery: { attack: 5, health: 5 } }, 9);
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  });

  it('Solid Ground: a Rise return spends a charge and lands +4/+4', () => {
    const mods = { solidGroundLeft: 1, solidGroundStat: 4 };
    const r = fight([bm('sandbag', { attack: 1, health: 1, keywords: ['R'] })], [foe(1, 500)], mods);
    const rb = reborns(r.events);
    expect(rb).toHaveLength(1);
    expect([rb[0]!.attack, rb[0]!.hp]).toEqual([CARD_INDEX['sandbag']!.attack + 4, 1 + 4]);
    expect(r.events.filter((e) => e.type === 'buff' && e.source === 'Solid Ground')).toHaveLength(1);
  });

  it("Containment (the foe's spell) pins the first RETURN, like the first summon", () => {
    const r = simulate([bm('u3_poochy', { attack: 9, health: 9, keywords: ['RB'] })], [foe(9, 500)], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, tribes: ['undead'] }), combatSide({ tier: 6, questMods: { containFirstEnemySummon: true } }));
    const rb = reborns(r.events);
    expect(rb).toHaveLength(1);
    expect([rb[0]!.attack, rb[0]!.hp], 'pinned to 1/1, not the full 9/9').toEqual([1, 1]);
  });

  it('Rune of the Spare Chair: the first return on a board that began with 6 gains Ward and attacks immediately', () => {
    const six = [bm('u3_poochy'), bm('sandbag', { attack: 0, health: 99 }), bm('sandbag', { attack: 0, health: 99 }),
      bm('sandbag', { attack: 0, health: 99 }), bm('sandbag', { attack: 0, health: 99 }), bm('sandbag', { attack: 0, health: 99 })];
    const r = fight(six, [foe(1, 500)], { runeSpareChair: true });
    const pup = r.initial.player[0]!.uid;
    const rb = reborns(r.events).filter((e) => e.target === pup);
    expect(rb).toHaveLength(1);
    expect(rb[0]!.keywords, 'Ward on the returning body').toContain('DS');
    expect(triggers(r.events, 'runeSpareChair')).toHaveLength(1);
    // Its immediate strike: the next attack event after the return is the risen Pup's.
    const at = r.events.indexOf(rb[0]!);
    const next = r.events.slice(at).find((e) => e.type === 'attack') as { attacker?: string } | undefined;
    expect(next?.attacker).toBe(pup);
  });
});
