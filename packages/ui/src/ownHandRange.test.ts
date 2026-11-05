/** R-DUOS-HAND-OWN-01: a Duos hand row shows only that player's own board's cards, on both sides of the fight. */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { playerGrantUidsOf } from './handSummonFx';
import { EMPTY_START_HAND, opponentHandCards } from './oppHandModel';
import { ownHandRange, WHOLE_LOG } from './ownHandRange';
import { grantsShownThrough, handBuffsShownThrough, handBuffUidsIn } from './useCombatReplay';

const grant = (cardId: string, side: 'player' | 'enemy' = 'player', uid?: string): CombatEvent => ({ type: 'toHand', cardId, side, ...(uid ? { uid } : {}) }) as CombatEvent;
const buff = (uid: string): CombatEvent => ({ type: 'handBuff', uid, cardId: 'x', side: 'player', attack: 1, health: 1 }) as CombatEvent;
const tagIn = (side: 'player' | 'enemy'): CombatEvent => ({ type: 'tagIn', side, member: 1, minions: [] }) as CombatEvent;
const log = [grant('ruby', 'player', 'g1'), buff('h1'), grant('foe1', 'enemy'), tagIn('enemy'), grant('foe2', 'enemy'), tagIn('player'), grant('staff', 'player', 'g2'), buff('h2')];
const allBeats = [{ start: 0, end: log.length }, { start: log.length, end: log.length }] as never;

describe('Duos hand rows keep each player to their own cards (R-DUOS-HAND-OWN-01)', () => {
  it('the first board sees what it earned before the hand-off, the reserve what it earned after', () => {
    expect(grantsShownThrough(log, allBeats, 1, ownHandRange(log, 0))).toEqual(['ruby']);
    expect(grantsShownThrough(log, allBeats, 1, ownHandRange(log, 1))).toEqual(['staff']);
    expect(Object.keys(handBuffsShownThrough(log, allBeats, 1, ownHandRange(log, 0)))).toEqual(['h1']);
    expect(handBuffUidsIn({ start: 0, end: log.length }, log, ownHandRange(log, 1))).toEqual(['h2']);
  });

  it('the preview uids stay in step with the row, so a lift finds the right card', () => {
    expect(playerGrantUidsOf(log, () => true, ownHandRange(log, 1))).toEqual(['g2']);
    expect(playerGrantUidsOf(log, () => true, ownHandRange(log, 0))).toEqual(['g1']);
  });

  it('a reserve whose board never stepped in gets nothing; the first board gets everything', () => {
    const solo = [grant('ruby'), grant('staff')];
    const beats = [{ start: 0, end: 2 }, { start: 2, end: 2 }] as never;
    expect(grantsShownThrough(solo, beats, 1, ownHandRange(solo, 1))).toEqual([]);
    expect(grantsShownThrough(solo, beats, 1, ownHandRange(solo, 0))).toEqual(['ruby', 'staff']);
  });

  it('in a real tag-team fight the row shows exactly what each member keeps at settle', () => {
    const bags = (n: number, attack: number, health: number, tag: string): BoardMinion[] =>
      Array.from({ length: n }, (_, i) => ({ cardId: 'sandbag', attack, health, sourceUid: `${tag}${i}` }));
    const earner = () => combatSide({ tier: 4, tribes: ['undead', 'dragon', 'celestial'], questMods: { runeLastCall: true } });
    const r = simulate(bags(5, 1, 1, 'a'), bags(7, 50, 500, 'f'), makeRng(9), CARD_INDEX, earner(), combatSide(), {
      reserve: { player: { board: bags(5, 1, 1, 'b'), state: earner() } },
    });
    const kept = r.tagTeam!.members.player!.map((m) => m.handGrants ?? []);
    expect(kept).toHaveLength(2);
    expect(kept[0]!.length).toBeGreaterThan(0);
    expect(kept[1]!.length).toBeGreaterThan(0);
    const beats = [{ start: 0, end: r.events.length }, { start: r.events.length, end: r.events.length }] as never;
    expect(grantsShownThrough(r.events, beats, 1, ownHandRange(r.events, 0))).toEqual(kept[0]);
    expect(grantsShownThrough(r.events, beats, 1, ownHandRange(r.events, 1))).toEqual(kept[1]);
  });

  it('every other mode is untouched', () => {
    expect(ownHandRange(log, undefined)).toBe(WHOLE_LOG);
    expect(grantsShownThrough(log, allBeats, 1)).toEqual(['ruby', 'staff']);
  });

  it("the foe's fan stops at the foe's own hand-off, whatever happens on my side", () => {
    expect(opponentHandCards(EMPTY_START_HAND, log, log.length, new Set())).toHaveLength(1);
  });
});
