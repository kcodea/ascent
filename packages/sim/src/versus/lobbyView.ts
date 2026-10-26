/**
 * VERSUS — the TWO-SEAT LOBBY the match is shown through (owner 2026-10-14: "reuse the existing lobby UI 1:1").
 *
 * A Versus run is played on the ordinary lobby screens: the rail, the combat scene's opponent portrait / name / skin,
 * the FightRecap, the hero strike, scouting. Every one of those reads `run.lobby` (`playerOpponent`). So a Versus run
 * carries a SYNTHETIC lobby built here from what the match already knows: seat `s0` is the player, seat `s1` the
 * opponent, an `authored` seat whose per-round board is the board the opponent actually fielded in each committed
 * fight (read off this seat's own result, `initial.enemy`). Pure data, rebuilt by the client whenever the match moves.
 *
 * WHAT IT IS NOT. It is display state only:
 *  - HEALTH AND ARMOR (owner 2026-10-26, R-VERSUS-HEALTH-01; hearts until then) ride the seats' `resolve` / `armor`,
 *    read off the server's per-round record (each seat's pools after every committed round; before round 1, its hero's
 *    start, `versusStartingVitals`). The rules are the lobby's: the normal round cap (the rail's MAX DMG), Health 30.
 *  - The opponent seat is `invulnerable` and the lobby is never settled locally: the server match ends the game.
 *  - It is never a rated table, a snapshot, a pool board or a replay (the UI's persistence gates key on the mode).
 *
 * TIMING mirrors a lobby seat's health: YOUR pools drop when the fight settles (as your Health would), the opponent's
 * when you leave the fight (as their seat settles at `resolveCombat`), so nothing is shown before it is watched.
 */
import type { CombatResult } from '@game/core';
import type { RunCosmeticSnapshot } from '@game/progression';
import type { SetId } from '@game/content';
import type { RunLobby, LobbySeatState, VersusSeatScout } from '../lobby/runLobby';
import type { LobbyEncounter } from '../lobby/types';
import type { AuthoredOmen } from '../lobby/tutorialSeats';
import type { VersusSeat } from './constants';
import { versusStartingVitals, type VersusVitals } from './vitals';

/** One committed round, from this seat's side. */
export interface VersusLobbyRound {
  round: number;
  /** The seat that lost the fight (`null` on a draw). */
  loser: VersusSeat | null;
  /** This seat's own perspective of the round's one fight (stamped with the cap and its pools). */
  mine: CombatResult;
  /** Both seats' Health and Armor after the round, as the server recorded them. */
  vitals?: Partial<Record<VersusSeat, VersusVitals>>;
  /** The OPPONENT's public state at that round's lock (server-recorded, `versus_rounds.pN_scout`): tier, triples,
   *  quests, runes. Absent on a round recorded before scouts existed. */
  foeScout?: VersusSeatScout | null;
}

export interface VersusLobbySeatInfo {
  label: string;
  heroId: string;
  cosmetics?: RunCosmeticSnapshot;
}

export interface VersusLobbyInput {
  matchSeed: number;
  setId?: SetId;
  seat: VersusSeat;
  /** The run's wave, phase and settle flag (the pools' timing, see the header). */
  wave: number;
  inCombat: boolean;
  combatSettled: boolean;
  me: VersusLobbySeatInfo;
  foe: VersusLobbySeatInfo;
  rounds: readonly VersusLobbyRound[];
  /** The match's pinned room options (a modifier's Armor in each seat's start). */
  options?: unknown;
}

/** The opponent seat's id in the two-seat lobby. */
export const VERSUS_FOE_SEAT_ID = 's1';

/** A fielded combat body as an authored board entry (the card, its stats, golden, keywords as printed + added). */
function omenOf(m: CombatResult['initial']['enemy'][number]): AuthoredOmen {
  return {
    cardId: m.cardId,
    attack: m.attack,
    health: m.health,
    ...(m.golden ? { golden: true } : {}),
    ...(m.keywords?.length ? { addedKeywords: [...m.keywords] } : {}),
  };
}

/** A seat's pools at this point of the run: after the last round shown (`throughRound`), else its start. */
function vitalsOf(seat: VersusSeat, rounds: readonly VersusLobbyRound[], throughRound: number, start: VersusVitals): VersusVitals {
  let v = start;
  for (const r of rounds) if (r.round <= throughRound && r.vitals?.[seat]) v = r.vitals[seat]!;
  return { health: Math.max(0, v.health), armor: Math.max(0, v.armor) };
}

export function versusLobby(input: VersusLobbyInput): RunLobby {
  const other: VersusSeat = input.seat === 'p1' ? 'p2' : 'p1';
  const rounds = [...input.rounds].sort((a, b) => a.round - b.round);
  // The opponent's fielded boards, round by round (index = round - 1). A gap (never expected: rounds commit in
  // order) repeats the board before it, so the table never reads as a bye.
  const boards: AuthoredOmen[][] = [];
  const tiers: number[] = [];
  const scouts: (VersusSeatScout | null)[] = [];
  let lastTier = 1;
  for (const r of rounds) {
    while (boards.length < r.round - 1) boards.push(boards[boards.length - 1] ?? []);
    while (tiers.length < r.round - 1) tiers.push(lastTier);
    while (scouts.length < r.round - 1) scouts.push(scouts[scouts.length - 1] ?? null);
    boards[r.round - 1] = r.mine.initial.enemy.map(omenOf);
    // The opponent's tier as of that round's lock (the server reads it off their locked side). A round recorded
    // before scouts existed falls back to the tier their strike shows, else the last one known.
    lastTier = r.foeScout?.tier ?? r.mine.damageBreakdown?.oppTier ?? lastTier;
    tiers[r.round - 1] = lastTier;
    scouts[r.round - 1] = r.foeScout ?? null;
  }
  const mineThrough = input.inCombat && input.combatSettled ? input.wave : input.wave - 1;
  const foeThrough = input.wave - 1;
  const myStart = versusStartingVitals(input.me.heroId, input.options);
  const foeStart = versusStartingVitals(input.foe.heroId, input.options);
  const mine = vitalsOf(input.seat, rounds, mineThrough, myStart);
  const theirs = vitalsOf(other, rounds, foeThrough, foeStart);
  const me: LobbySeatState = {
    id: 's0', label: input.me.label, heroId: input.me.heroId, kind: 'player', seed: 0,
    resolve: mine.health, armor: mine.armor, startArmor: myStart.armor, alive: true,
    ...(input.me.cosmetics ? { cosmetics: input.me.cosmetics } : {}),
  };
  const foe: LobbySeatState = {
    id: VERSUS_FOE_SEAT_ID, label: input.foe.label, heroId: input.foe.heroId, kind: 'authored',
    // A seed no other lobby derives (the authored driver cache keys on kind + seed + hero).
    seed: (input.matchSeed ^ 0x7e55a11d) | 0,
    authoredBoards: boards, authoredTiers: tiers, invulnerable: true,
    ...(scouts.some((x) => x) ? { authoredScouts: scouts } : {}),
    resolve: theirs.health, armor: theirs.armor, startArmor: foeStart.armor, alive: true,
    ...(input.foe.cosmetics ? { cosmetics: input.foe.cosmetics } : {}),
  };
  // The fight log's damage: the stamped (capped) blow each way, off my own view of the one result.
  const encounters: LobbyEncounter[] = rounds.filter((r) => r.round <= foeThrough).map((r) => ({
    round: r.round, a: 's0', b: VERSUS_FOE_SEAT_ID, outcome: r.mine.result,
    damageToA: r.loser === input.seat ? r.mine.playerDamage : 0, damageToB: r.loser === other ? r.mine.enemyDamage ?? 0 : 0, fought: true,
  }));
  return {
    version: 1,
    seed: input.matchSeed,
    ...(input.setId ? { setId: input.setId } : {}),
    round: Math.max(1, input.wave),
    seats: [me, foe],
    encounters,
    finished: false,
    // The lobby's rules: Health from the hero, the seats' own start Armor, the normal round cap (no `lossCaps`: the
    // rail's MAX DMG reads `lossDamageCap`). Never settled locally.
    rules: { seatCount: 2, startingResolve: myStart.health, startingArmor: 0, exhaustion: 'repeatFinal', maxRounds: 1000 },
    unrated: 'all-generated',
  };
}

/** A cheap identity for the inputs that change the view, so the client rebuilds only when something moved. */
export function versusLobbyKey(input: VersusLobbyInput): string {
  const last = input.rounds.reduce((n, r) => Math.max(n, r.round), 0);
  const scouted = input.rounds.filter((r) => r.foeScout).length;
  const vit = input.rounds.filter((r) => r.vitals).length;
  return `${input.seat}|${input.wave}|${input.inCombat ? 1 : 0}${input.combatSettled ? 1 : 0}|${last}|${input.rounds.length}|${scouted}|${vit}|${input.me.heroId}|${input.foe.heroId}|${input.foe.label}`;
}
