/**
 * VERSUS: what every rail shows of a seat's Health and Armor (R-VERSUS-LIVE-ARMOR-01). Owner 2026-10-27, after Group /
 * Duos with friends: "i casted mend to get armor but it didn't show to the other players"; "in some instances people
 * seemed to die when they still had hp on my screen".
 *
 *  - While a view is at round r - 1 (the shop of round r, and round r's fight until it is left), a seat shows the
 *    server's pools GOING INTO round r (`entering`): a shop Mend shows as soon as the server has it, a fight's damage
 *    never before the fight is watched.
 *  - A seat is shown out only together with the round record that put it out (the seat row and the round record are
 *    read separately), so a knockout never shows on the Health before it.
 */
import { describe, expect, it } from 'vitest';
import type { CombatResult } from '@game/core';
import { getHero } from '../heroes';
import { versusGroupPairings, type VersusGroupSeat } from './group';
import { versusGroupLobby, versusGroupLobbyKey, type VersusGroupLobbyInput, type VersusGroupLobbyRound } from './groupLobbyView';
import { versusLobby, versusLobbyKey, type VersusLobbyInput } from './lobbyView';

const minion = (cardId: string) => ({ uid: cardId, cardId, attack: 2, health: 2, keywords: [] }) as unknown as CombatResult['initial']['player'][number];
const result = (r: 'win' | 'lose' | 'draw'): CombatResult => ({ initial: { player: [minion('a')], enemy: [minion('b')] }, result: r, events: [], playerDamage: 0 }) as unknown as CombatResult;
const W = getHero('warden');

function group(me: VersusGroupSeat, wave: number, rounds: VersusGroupLobbyRound[], extra: Partial<VersusGroupLobbyInput> = {}, elim: Partial<Record<VersusGroupSeat, number>> = {}): VersusGroupLobbyInput {
  const seats = (['p1', 'p2', 'p3', 'p4'] as VersusGroupSeat[]).map((seat) => ({ seat, label: seat.toUpperCase(), heroId: 'warden', eliminatedRound: elim[seat] ?? null, placement: elim[seat] != null ? 4 : null }));
  return { matchSeed: 3, me, wave, inCombat: false, combatSettled: false, seats, rounds, pairing: versusGroupPairings(seats.map((s) => s.seat), elim, wave), ...extra };
}
const R1: VersusGroupLobbyRound = {
  round: 1,
  vitals: { p1: { health: 30, armor: 0 }, p2: { health: 22, armor: 0 }, p3: { health: 30, armor: 4 }, p4: { health: 0, armor: 0 } },
  fights: [
    { a: 'p1', b: 'p2', copy: false, loser: 'p2', damage: 8, aResult: result('win') },
    { a: 'p3', b: 'p4', copy: false, loser: 'p4', damage: 40, aResult: result('win') },
  ],
};

describe('Versus rails: the pools going into the round (R-VERSUS-LIVE-ARMOR-01)', () => {
  it('GROUP: a seat\'s shop Mend shows on everyone\'s rail during the shop and its fight; the next round\'s record takes over once left', () => {
    // Round 2's shop: p2 cast Mend (stored 22/0 -> 22/5 on the server).
    const entering = { round: 2, vitals: { p1: { health: 30, armor: 0 }, p2: { health: 22, armor: 5 }, p3: { health: 30, armor: 4 } } };
    const p2Of = (l: ReturnType<typeof versusGroupLobby>) => l.seats.find((s) => s.label === 'P2')!;
    const before = versusGroupLobby(group('p1', 2, [R1]));
    expect([p2Of(before).resolve, p2Of(before).armor]).toEqual([22, 0]);
    const shop = versusGroupLobby(group('p1', 2, [R1], { entering }));
    expect([p2Of(shop).resolve, p2Of(shop).armor]).toEqual([22, 5]);
    // The key moves with it, so the client rebuilds the rail.
    expect(versusGroupLobbyKey(group('p1', 2, [R1], { entering }))).not.toBe(versusGroupLobbyKey(group('p1', 2, [R1])));
    // Round 2 committed while I still watch my fight: the pools going in, never round 2's damage.
    const R2: VersusGroupLobbyRound = { round: 2, vitals: { p1: { health: 30, armor: 0 }, p2: { health: 19, armor: 0 }, p3: { health: 30, armor: 4 } }, fights: [] };
    const fight = versusGroupLobby(group('p1', 2, [R1, R2], { entering, inCombat: true, combatSettled: true }));
    expect([p2Of(fight).resolve, p2Of(fight).armor]).toEqual([22, 5]);
    // Left the fight (round 3's shop, nothing new stored yet): round 2's record.
    const after = versusGroupLobby(group('p1', 3, [R1, R2], { entering }));
    expect([p2Of(after).resolve, p2Of(after).armor]).toEqual([19, 0]);
  });

  it('GROUP: a knockout never shows before the round record that caused it (and shows at once when the match is over)', () => {
    // The seat row already says p4 is out in round 1, but round 1's record has not been read yet.
    const early = versusGroupLobby(group('p1', 2, [], {}, { p4: 1 }));
    const p4 = early.seats.find((s) => s.label === 'P4')!;
    expect(p4.alive).toBe(true);
    expect([p4.resolve, p4.armor]).toEqual([W.resolve, W.armor]);
    // The record arrives: out, at 0 Health, with its placement.
    const read = versusGroupLobby(group('p1', 2, [R1], {}, { p4: 1 })).seats.find((s) => s.label === 'P4')!;
    expect([read.alive, read.resolve, read.placement]).toEqual([false, 0, 4]);
    // A match that ended without the round being committed (everyone else left): the knockout shows.
    const done = versusGroupLobby(group('p1', 2, [], { complete: true }, { p4: 1 })).seats.find((s) => s.label === 'P4')!;
    expect(done.alive).toBe(false);
  });

  it('1v1: the opponent\'s shop Mend shows during the shop; after the fight is left their record does', () => {
    const base: VersusLobbyInput = {
      matchSeed: 1, seat: 'p1', wave: 2, inCombat: false, combatSettled: false,
      me: { label: 'Me', heroId: 'warden' }, foe: { label: 'Foe', heroId: 'warden' },
      rounds: [{ round: 1, loser: 'p2', mine: result('win'), vitals: { p1: { health: 30, armor: 2 }, p2: { health: 25, armor: 0 } } }],
    };
    const foe = (i: VersusLobbyInput) => versusLobby(i).seats[1]!;
    expect([foe(base).resolve, foe(base).armor]).toEqual([25, 0]);
    const entering = { round: 2, vitals: { p1: { health: 30, armor: 2 }, p2: { health: 25, armor: 5 } } };
    expect([foe({ ...base, entering }).resolve, foe({ ...base, entering }).armor]).toEqual([25, 5]);
    expect(versusLobbyKey({ ...base, entering })).not.toBe(versusLobbyKey(base));
    // A stale snapshot (for a round already left behind) is ignored.
    const later = { ...base, wave: 3, rounds: [...base.rounds, { round: 2, loser: 'p2' as const, mine: result('win'), vitals: { p1: { health: 30, armor: 2 }, p2: { health: 20, armor: 0 } } }] };
    expect([foe({ ...later, entering }).resolve, foe({ ...later, entering }).armor]).toEqual([20, 0]);
  });
});
