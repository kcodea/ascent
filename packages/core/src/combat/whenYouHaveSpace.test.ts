import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-SPACE-PENDING-01 — "WHEN YOU HAVE SPACE" IS A PENDING SUMMON (owner bug 2026-10-21):
 *   "rune of the mirror march is bugged, and probably most 'when you have space' things - mirror march only works if
 *    you have room at start of combat, but a 'when you have space' mechanic should fire whenever the player truly has
 *    a slot for the minion to summon."
 *
 * Rune of the Warden, Rune of the Mirror March and Rune of the Waking Reserve now QUEUE their summon on the shared
 * per-combat space queue (`spaceQueue` in simulate.ts, the same queue the Reclaimer and Brackus x War use). It lands at
 * Start of Combat when there is room, else at the first settle after a slot frees up. First queued, first landed.
 * Whatever is still waiting when the fight ends is dropped.
 */
type Mods = Record<string, unknown>;
const v = (attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId: 'drummer', attack, health, keywords } as unknown as BoardMinion); // Drakko: no combat effects of its own
const sim = (p: BoardMinion[], e: BoardMinion[], seed: number, pMods: Mods = {}, eMods: Mods = {}) =>
  simulate(p, e, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, questMods: pMods as never }),
    combatSide({ tier: 6, questMods: eMods as never }));
const idx = (evs: CombatEvent[], pred: (e: CombatEvent) => boolean): number => evs.findIndex(pred);
const isTrigger = (flag: string, side = 'player') => (e: CombatEvent) => e.type === 'questTrigger' && e.flag === flag && e.side === side;
const isSummon = (side = 'player') => (e: CombatEvent) => e.type === 'summon' && e.side === side;
const isDeath = (side = 'player') => (e: CombatEvent) => e.type === 'death' && e.side === side;
const fullOf = (attack: number, health: number, kws: string[] = []) => Array.from({ length: 7 }, () => v(attack, health, kws));
/** A slow killer: one 3-Attack body with plenty of Health, so the full board loses one 1/1 per enemy swing. */
const killer = () => [v(3, 1000)];

describe('R-SPACE-PENDING-01: a "when you have space" summon waits for a real slot', () => {
  it('Mirror March, full board at Start of Combat: nothing then; it lands at the settle right after the first friendly death', () => {
    const r = sim(fullOf(1, 1), killer(), 3, { runeMirrorMarch: true });
    const ev = r.events;
    const firstAttack = idx(ev, (e) => e.type === 'attack');
    expect(ev.slice(0, firstAttack).some(isSummon()), 'no room at Start of Combat → no copy yet').toBe(false);
    const death = idx(ev, isDeath());
    const trig = idx(ev, isTrigger('runeMirrorMarch'));
    const summon = idx(ev, isSummon());
    expect(death).toBeGreaterThan(0);
    expect(trig, 'the rune announces its own beat after the slot opens').toBeGreaterThan(death);
    expect(summon).toBeGreaterThan(trig);
    // It lands in the settle of the attack that freed the slot, before the next attacker swings.
    const nextAttack = ev.findIndex((e, i) => i > death && e.type === 'attack');
    expect(nextAttack === -1 || summon < nextAttack, 'lands before the next swing').toBe(true);
    expect(ev.filter(isTrigger('runeMirrorMarch')), 'once, not again on later deaths').toHaveLength(1);
    const s = ev[summon]!;
    expect(s.type === 'summon' && s.minion.cardId).toBe('drummer'); // a copy of the left-most body
  });

  it('a board that stays full all fight never fires (the pending summon expires with the combat)', () => {
    const r = sim(fullOf(1, 1000), [v(1, 3)], 3, { runeMirrorMarch: true, runeWarden: true });
    expect(r.events.some(isDeath()), 'nothing friendly dies').toBe(false);
    expect(r.events.some(isSummon())).toBe(false);
    expect(r.events.some(isTrigger('runeMirrorMarch'))).toBe(false);
    expect(r.events.some(isTrigger('runeWarden'))).toBe(false);
  });

  it('a board with room at Start of Combat still fires before the first attack (unchanged)', () => {
    const r = sim([v(1, 1), v(1, 1)], killer(), 3, { runeMirrorMarch: true });
    const firstAttack = idx(r.events, (e) => e.type === 'attack');
    expect(idx(r.events, isSummon())).toBeGreaterThan(-1);
    expect(idx(r.events, isSummon())).toBeLessThan(firstAttack);
  });

  it('two pending summons land first queued, first landed: Warden on the first free slot, Mirror March on the next', () => {
    const r = sim(fullOf(1, 1), killer(), 3, { runeWarden: true, runeMirrorMarch: true });
    const ev = r.events;
    const deaths = ev.map((e, i) => (isDeath()(e) ? i : -1)).filter((i) => i >= 0);
    const warden = idx(ev, isTrigger('runeWarden'));
    const mirror = idx(ev, isTrigger('runeMirrorMarch'));
    expect(warden).toBeGreaterThan(deaths[0]!);
    expect(mirror, 'Mirror March waits behind the Warden').toBeGreaterThan(warden);
    expect(mirror, 'and needs a SECOND free slot').toBeGreaterThan(deaths[1]!);
    const wardenSummon = ev.find((e, i) => i > warden && isSummon()(e));
    expect(wardenSummon?.type === 'summon' && wardenSummon.minion.cardId).toBe('knit');
  });

  it('two copies of Mirror March held, one slot at Start of Combat: one copy now, the other waits for the next slot', () => {
    const six = Array.from({ length: 6 }, () => v(1, 1));
    const r = sim(six, killer(), 3, { runeMirrorMarch: true, flagCopies: { runeMirrorMarch: 2 } });
    const firstAttack = idx(r.events, (e) => e.type === 'attack');
    const summons = r.events.map((e, i) => (isSummon()(e) ? i : -1)).filter((i) => i >= 0);
    expect(summons.filter((i) => i < firstAttack)).toHaveLength(1);
    expect(summons.length).toBeGreaterThanOrEqual(2);
    expect(summons[1]!).toBeGreaterThan(idx(r.events, isDeath()));
  });

  it('a Rise return holds its slot: the pending summon does NOT land until a body truly leaves', () => {
    const r = sim(fullOf(1, 1, ['R']), killer(), 3, { runeMirrorMarch: true });
    const ev = r.events;
    const summon = idx(ev, isSummon());
    expect(summon).toBeGreaterThan(0);
    // Every friendly death before the landing was answered by a Rise, except the last one (the slot that opened).
    const before = ev.slice(0, summon);
    const deaths = before.filter(isDeath()).map((e) => (e as { target: string }).target);
    const risen = new Set(before.filter((e) => e.type === 'reborn').map((e) => (e as { target: string }).target));
    expect(deaths.length).toBeGreaterThanOrEqual(2);
    expect(risen.size, 'at least one Rise happened first and did NOT trigger the summon').toBeGreaterThan(0);
    expect(ev.filter(isTrigger('runeMirrorMarch')), 'fires once, never doubled by a Rise').toHaveLength(1);
  });

  it('Waking Reserve waits for room too, and reads the hand when it lands', () => {
    const hand = [{ uid: 'h1', cardId: 'drummer', attack: 4, health: 4, keywords: [], golden: false }];
    const r = simulate(fullOf(1, 1), killer(), makeRng(3), CARD_INDEX,
      combatSide({ tier: 6, questMods: { runeWakingReserve: true } as never, handMinions: hand as never }), combatSide({ tier: 6 }));
    const firstAttack = idx(r.events, (e) => e.type === 'attack');
    const s = idx(r.events, isSummon());
    expect(s).toBeGreaterThan(firstAttack);
    expect(s).toBeGreaterThan(idx(r.events, isDeath()));
    const ev = r.events[s]!;
    expect(ev.type === 'summon' && [ev.minion.attack, ev.minion.health]).toEqual([4, 4]);
  });

  it('symmetric: an ENEMY Mirror March waits and lands exactly like the player one', () => {
    const p = sim(fullOf(1, 1), killer(), 3, { runeMirrorMarch: true });
    const e = sim(killer(), fullOf(1, 1), 3, {}, { runeMirrorMarch: true });
    expect(e.events.some(isTrigger('runeMirrorMarch', 'enemy'))).toBe(true);
    const ei = idx(e.events, isTrigger('runeMirrorMarch', 'enemy'));
    expect(ei).toBeGreaterThan(idx(e.events, isDeath('enemy')));
    expect(p.events.filter(isTrigger('runeMirrorMarch'))).toHaveLength(e.events.filter(isTrigger('runeMirrorMarch', 'enemy')).length);
  });

  it('deterministic: the same seed replays byte-identical', () => {
    const a = sim(fullOf(1, 1), killer(), 11, { runeWarden: true, runeMirrorMarch: true, flagCopies: { runeMirrorMarch: 2 } });
    const b = sim(fullOf(1, 1), killer(), 11, { runeWarden: true, runeMirrorMarch: true, flagCopies: { runeMirrorMarch: 2 } });
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
    expect(a.result).toBe(b.result);
    expect(a.playerDamage).toBe(b.playerDamage);
  });
});
