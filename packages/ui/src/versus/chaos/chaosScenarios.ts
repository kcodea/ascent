/**
 * THE CHAOS SCENARIOS (scenario x mode). Each builds a `ChaosScenario` for a mode; `modes` lists where it applies.
 * Player 0 hosts. Default players: a buyer and an empty board alternating (so someone loses every round and a full
 * match ends). Policies are per seat index; the server assigns Duos teams.
 *
 * Rounds are counted from 1; chaos usually lands in round 2's shop (after one clean round).
 */
import type { ChaosClientOptions } from './chaosClient';
import { CHAOS_MODES, playersOf, type ChaosEvent, type ChaosMode, type ChaosScenario } from './chaosMatch';

export interface ScenarioDef {
  name: string;
  /** What it proves (shown nowhere; for the reader). */
  about: string;
  modes: readonly ChaosMode[];
  build(mode: ChaosMode): ChaosScenario;
}

const ALL = CHAOS_MODES;
const TEAMS: readonly ChaosMode[] = ['duos', 'ranked_duos'];

const players = (mode: ChaosMode, f: (i: number) => Partial<ChaosClientOptions>): Partial<ChaosClientOptions>[] =>
  Array.from({ length: playersOf(mode) }, (_, i) => f(i));
const at = (round: number, phase: ChaosEvent['phase'], act: ChaosEvent['act'], afterMs = 0): ChaosEvent => ({ round, phase, act, afterMs });
const seedOf = (name: string, mode: ChaosMode): number => [...`${name}/${mode}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const base = (name: string, mode: ChaosMode, extra: Partial<ChaosScenario>): ChaosScenario => ({ name, mode, seed: seedOf(name, mode), rounds: 3, ...extra });

export const SCENARIOS: ScenarioDef[] = [
  {
    name: 'baseline', about: 'a whole match, everyone ends turn early, no chaos', modes: ALL,
    build: (mode) => base('baseline', mode, { rounds: undefined }),
  },
  {
    name: 'timer', about: 'nobody presses End Turn: every round closes on the clock', modes: ALL,
    build: (mode) => base('timer', mode, { players: players(mode, (i) => ({ endTurn: 'timer', policy: i % 2 ? 'empty' : 'buyer' })) }),
  },
  {
    name: 'simultaneous', about: 'every player ends the turn at the same instant', modes: ALL,
    build: (mode) => base('simultaneous', mode, { players: players(mode, (i) => ({ thinkMs: 2000, policy: i % 2 ? 'empty' : 'buyer' })) }),
  },
  {
    name: 'dropRestore', about: 'one player loses the network for 20 s in a shop (a real absence), then returns', modes: ALL,
    build: (mode) => base('dropRestore', mode, { events: [at(2, 'shop', (h) => h.drop(1, 20_000), 500)] }),
  },
  {
    name: 'dropLong', about: 'a silent 45 s network loss in a shop: the match pauses within 20 s (latePause) and lifts on return', modes: ALL,
    build: (mode) => base('dropLong', mode, { events: [at(2, 'shop', (h) => h.drop(1, 45_000), 500)] }),
  },
  {
    name: 'dropAtZero', about: 'the other side is ready; one player loses the connection 5 s before 0:00 for 30 s (the room hears the close: Cloudflare pauses within the 3 s grace, before 0:00) and their own 0:00 lock goes out while offline: the round must not close during the pause or its 3-2-1, and the shop time comes back', modes: ['duel', 'group3', 'group4', 'duos'],
    build: (mode) => base('dropAtZero', mode, {
      players: players(mode, (i) => ({ policy: 'buyer', endTurn: i === 1 ? 'timer' : 'early' })),
      // `finOnDrop`: the Cloudflare backend's "the close reaches the room" (Supabase has no such signal: a lease).
      events: [{ round: 2, phase: 'shop', beforeDeadlineMs: 5000, act: (h) => { (h.server as { finOnDrop?: boolean }).finOnDrop = true; h.drop(1, 30_000); } }],
    }),
  },
  {
    name: 'dropShort', about: 'a 4 s network blip: no pause, nothing waits', modes: ALL,
    build: (mode) => base('dropShort', mode, { events: [at(2, 'shop', (h) => h.drop(1, 4_000), 500)] }),
  },
  {
    name: 'dropInFight', about: 'a player drops for 20 s while the fight plays', modes: ALL,
    build: (mode) => base('dropInFight', mode, { events: [at(1, 'combat', (h) => h.drop(1, 20_000), 300)] }),
  },
  {
    name: 'background15s', about: 'one tab in the background for 15 s (throttled timers): not an absence', modes: ALL,
    build: (mode) => base('background15s', mode, { events: [at(2, 'shop', (h) => h.background(1, 15_000), 500)] }),
  },
  {
    name: 'background6min', about: 'one tab in the background for 6 minutes (intensive throttling past 5)', modes: ALL,
    build: (mode) => base('background6min', mode, { rounds: 4, events: [at(2, 'shop', (h) => h.background(1, 6 * 60_000), 500)] }),
  },
  {
    name: 'hang', about: 'one client\'s requests hang for 15 s (a dead socket that recovers)', modes: ALL,
    build: (mode) => base('hang', mode, { events: [at(2, 'shop', (h) => h.hang(1, 15_000), 500)] }),
  },
  {
    name: 'realtimeDown', about: 'realtime is dead for the whole match: the heartbeat and polls carry it', modes: ALL,
    build: (mode) => base('realtimeDown', mode, { events: [at(1, 'shop', (h) => h.killRealtime(0))] }),
  },
  {
    name: 'resolverSlow', about: 'the resolver takes 10 s on round 2', modes: ALL,
    build: (mode) => base('resolverSlow', mode, { events: [at(2, 'shop', (h) => h.resolver({ delayMs: 10_000, forMs: 40_000 }))] }),
  },
  {
    name: 'resolverFail3', about: 'the resolver fails 3 times on round 2, then answers', modes: ALL,
    build: (mode) => base('resolverFail3', mode, { events: [at(2, 'shop', (h) => h.resolver({ fail: 3 }))] }),
  },
  {
    name: 'resolver409', about: 'the resolver answers 409 once on round 2', modes: ALL,
    build: (mode) => base('resolver409', mode, { events: [at(2, 'shop', (h) => h.resolver({ conflict: 1 }))] }),
  },
  {
    name: 'lockHeld', about: 'the match row lock is held for 6 s in round 2\'s shop', modes: ALL,
    build: (mode) => base('lockHeld', mode, { events: [at(2, 'shop', (h) => h.holdMatch(6_000), 1000)] }),
  },
  {
    name: 'lostCombatReady', about: 'player 0\'s End Combat ack for round 1 is lost', modes: ALL,
    build: (mode) => base('lostCombatReady', mode, { players: players(mode, (i) => ({ policy: i % 2 ? 'empty' : 'buyer', ...(i === 0 ? { dropCombatReady: [1] } : {}) })) }),
  },
  {
    name: 'eotHeavy', about: 'boards full of End of Turn effects (seconds of End of Turn animation every round)', modes: ALL,
    build: (mode) => base('eotHeavy', mode, { rounds: 5, players: players(mode, () => ({ policy: 'eotHeavy' })) }),
  },
  // EMPTY BOARDS (owner 2026-10-27: "make sure empty boards don't halt or break something").
  {
    name: 'emptyAll', about: 'every board empty, round 1 and every round after', modes: ALL,
    build: (mode) => base('emptyAll', mode, { players: players(mode, () => ({ policy: 'empty' })) }),
  },
  {
    name: 'emptyOne', about: 'one side empty every round (the others buy)', modes: ALL,
    build: (mode) => base('emptyOne', mode, { players: players(mode, (i) => ({ policy: i === 1 ? 'empty' : 'buyer' })) }),
  },
  {
    name: 'sellout', about: 'a player sells their whole board in round 3 (an empty board after a real one)', modes: ALL,
    build: (mode) => base('sellout', mode, { rounds: 4, players: players(mode, (i) => ({ policy: i === 0 ? 'sellout' : 'buyer', sellFrom: 3 })) }),
  },
  {
    name: 'duosFirstEmpty', about: 'Duos: one teammate empty (seat 0), the other buys (either fight order)', modes: TEAMS,
    build: (mode) => base('duosFirstEmpty', mode, { players: players(mode, (i) => ({ policy: i === 0 ? 'empty' : 'buyer' })) }),
  },
  {
    name: 'duosSecondEmpty', about: 'Duos: one teammate empty (seat 1), the other buys', modes: TEAMS,
    build: (mode) => base('duosSecondEmpty', mode, { players: players(mode, (i) => ({ policy: i === 1 ? 'empty' : 'buyer' })) }),
  },
  {
    name: 'mendArmor', about: 'Armor raised in the shop (Mend) is honoured by the server and shown by every client', modes: ALL,
    build: (mode) => base('mendArmor', mode, { rounds: 8, players: players(mode, (i) => ({ policy: i % 2 ? 'empty' : 'buyer', mendFrom: 2 })) }),
  },
];

