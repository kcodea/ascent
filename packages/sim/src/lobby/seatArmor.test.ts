import { afterEach, describe, expect, it } from 'vitest';
import { activeSet } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { OPPONENT_POOL, registerOpponentRuns } from '../opponents';
import { HERO_INDEX } from '../heroes';
import { createLobbyRun, createRunLobby, lobbyOpponentBoard, resetLobbyDrivers, type RunLobby } from './runLobby';
import { lobbyRailView } from './railView';
import { DEFAULT_LOBBY_RULES, seatStartingArmor } from './lobby';
import { createPracticeBotLobby } from './practiceBots';

/**
 * EVERY SEAT THAT PLAYS A HERO STARTS ON THAT HERO'S OWN ARMOR (owner 2026-10-17, R-LOBBY-SEAT-ARMOR-01: "use the
 * hero's own armor instead of 15"). A recorded / hybrid seat used to start on a flat 15 whatever its hero; a live
 * player of the hero starts on the hero's `armor`, so a recorded Brackus now starts on 11 and a recorded Disco Dan
 * on 14. Health stays the lobby's `startingResolve`. Seats that play NO hero (Practice bots, tutorial and Gauntlet
 * rivals, portrait only) keep the flat 15.
 */

const SET = activeSet().id;
const snap = (author: string, heroId: string, seed: number, wave: number): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: wave, seed, origin: 'self',
  author, ownerId: `${author}-id`, setId: SET, minions: [{ cardId: 'pack', attack: 2, health: 2, keywords: [], golden: false }],
} as unknown as BoardSnapshot);
const runOf = (author: string, heroId: string, seed: number): BoardSnapshot[] => [1, 2, 3, 4, 5, 6].map((w) => snap(author, heroId, seed, w));

let lobby: RunLobby | null = null;
afterEach(() => { OPPONENT_POOL.length = 0; if (lobby) resetLobbyDrivers(lobby.seats); lobby = null; });

describe("a recorded seat starts on its hero's own Armor", () => {
  it('a recorded Brackus starts on 11 and a recorded Disco Dan on 14; the rail and the foe panel show it', () => {
    expect(HERO_INDEX.brackus!.armor).toBe(11);
    expect(HERO_INDEX.discodan!.armor).toBe(14);
    registerOpponentRuns([runOf('Orangez', 'brackus', 1), runOf('IonLime', 'discodan', 2)]);
    lobby = createRunLobby(77, 'warden', { snapshotSeats: 2 }, SET);
    const brackus = lobby.seats.find((s) => s.kind === 'snapshot' && s.heroId === 'brackus')!;
    const disco = lobby.seats.find((s) => s.kind === 'snapshot' && s.heroId === 'discodan')!;
    expect([brackus.resolve, brackus.armor]).toEqual([30, 11]);
    expect([disco.resolve, disco.armor]).toEqual([30, 14]);
    // Every generated (hybrid) seat too: each on its own hero's Armor.
    for (const s of lobby.seats.filter((x) => x.kind === 'hybrid')) expect(s.armor, s.heroId).toBe(HERO_INDEX[s.heroId]!.armor);
    // The rail prints the seat's own pools.
    const rail = lobbyRailView(lobby);
    const row = (id: string) => rail.rows.find((r) => r.id === id)!;
    expect([row(brackus.id).resolve, row(brackus.id).armor]).toEqual([30, 11]);
    expect([row(disco.id).resolve, row(disco.id).armor]).toEqual([30, 14]);
    // The foe the player meets carries the same seat (the combat opponent panel reads seat.armor).
    const foe = lobbyOpponentBoard(lobby);
    if (foe) expect(foe.seat.armor).toBe(HERO_INDEX[foe.seat.heroId]?.armor ?? DEFAULT_LOBBY_RULES.startingArmor);
  });

  it('the player seat is its run (hero Armor), and createLobbyRun agrees with it', () => {
    const run = createLobbyRun(78, 'brackus', {}, 'lobby', undefined, SET);
    expect(run.lobby!.seats[0]!.armor).toBe(run.armor);
    expect(run.armor).toBe(11);
    resetLobbyDrivers(run.lobby!.seats);
  });
});

describe('seats that play no hero keep the flat Armor', () => {
  it('Practice bots and a pinned startingArmor keep their authored value', () => {
    const bots = createPracticeBotLobby(5, 'warden', 3);
    for (const s of bots.seats.slice(1)) expect(s.armor).toBe(DEFAULT_LOBBY_RULES.startingArmor);
    // A caller that pins startingArmor (tests, tools) gets exactly that on every seat, as before.
    lobby = createRunLobby(79, 'warden', { startingArmor: 3 }, SET);
    for (const s of lobby.seats) expect(s.armor).toBe(3);
    // A lobby saved before the ruling (no seatArmor) reads as flat everywhere, so its bars stay full-width at start.
    expect(seatStartingArmor({ kind: 'snapshot', heroId: 'brackus' }, { startingArmor: 15 })).toBe(15);
    expect(seatStartingArmor({ kind: 'snapshot', heroId: 'brackus' }, DEFAULT_LOBBY_RULES)).toBe(11);
    expect(seatStartingArmor({ kind: 'authored', heroId: 'brackus' }, DEFAULT_LOBBY_RULES)).toBe(15);
  });
});
