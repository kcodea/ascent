/**
 * GAUNTLET — the single-player stage mode (spec: docs/superpowers/specs/2026-09-29-gauntlet-design.md).
 *
 * A stage is 10 rounds against ONE authored opponent whose board grows round by round. It runs as a 2-seat lobby
 * (the player + one `authored` seat), so damage, Armor, the turn flow and save/restore are the lobby's own. Three
 * things make it a Gauntlet rather than a tiny lobby:
 *  - the opponent is `invulnerable`: the goal is to SURVIVE, so knocking it out must never end the stage early;
 *  - `lossCaps` replaces the normal cap table with the Gauntlet's (5/10/15, uncapped on rounds 9–10);
 *  - `maxRounds: 10`, so the lobby finishes after round 10 and a player still standing is placed 1st — a CLEAR,
 *    even if round 10 itself was lost or tied.
 */
import type { GauntletStage, SetId } from '@game/content';
import { createRun, type RunState } from '../state';
import { DEFAULT_LOBBY_RULES } from './lobby';
import type { LobbyRules } from './types';
import { resetLobbyDrivers, type LobbySeatState, type RunLobby } from './runLobby';

/** Loss caps by round (owner 2026-09-29): 1–3 → 5, 4–6 → 10, 7–8 → 15, 9–10 → uncapped. */
export const GAUNTLET_LOSS_CAPS: readonly (number | null)[] = [5, 5, 5, 10, 10, 10, 15, 15, null, null];

/** The opponent's tavern tier on a round the stage leaves blank — a steady tier-up pace (spec §2: "absent =
 *  normal tier-up pace"). Only a DEFAULT: the Stage Builder shows it, and any round can override it. */
export const GAUNTLET_DEFAULT_TIERS: readonly number[] = [1, 2, 2, 3, 3, 4, 4, 5, 5, 6];

export function createGauntletRun(seed: number, heroId: string, stage: GauntletStage, setId?: SetId): RunState {
  const run = createRun(seed, heroId, 'gauntlet', undefined, setId);
  const rules: LobbyRules = { ...DEFAULT_LOBBY_RULES, seatCount: 2, maxRounds: stage.rounds.length, lossCaps: [...GAUNTLET_LOSS_CAPS] };
  const player: LobbySeatState = {
    id: 's0', label: 'You', heroId, kind: 'player', seed, resolve: run.resolve, armor: run.armor, alive: true,
  };
  const foe: LobbySeatState = {
    id: 's1',
    label: stage.opponentName,
    // Portrait only — an authored seat never plays a run (same convention as the tutorial's seats).
    heroId: 'aster',
    kind: 'authored',
    seed: seed * 1000 + 1,
    resolve: rules.startingResolve,
    armor: rules.startingArmor,
    alive: true,
    invulnerable: true,
    authoredBoards: stage.rounds.map((r) => r.board.map((m) => ({
      cardId: m.cardId, attack: m.attack, health: m.health,
      ...(m.golden ? { golden: true } : {}),
      ...(m.addedKeywords?.length ? { addedKeywords: m.addedKeywords } : {}),
    }))),
    authoredTiers: stage.rounds.map((r, i) => r.tier ?? GAUNTLET_DEFAULT_TIERS[i] ?? 6),
    authoredRunes: [
      ...(stage.runes.round6 ? [{ fromRound: 6, runeId: stage.runes.round6 }] : []),
      ...(stage.runes.round9 ? [{ fromRound: 9, runeId: stage.runes.round9 }] : []),
    ],
  };
  resetLobbyDrivers([foe]);
  const lobby: RunLobby = { version: 1, seed, setId: run.setId, round: 1, seats: [player, foe], encounters: [], finished: false, rules };
  return { ...run, lobby, gauntletStage: stage.number };
}

/** The stage verdict once the run is over: `cleared` when the player's seat is still standing (the lobby ran its
 *  10 rounds), `defeated` when it was knocked out. Null mid-run and for any other mode. */
export function gauntletOutcome(run: Pick<RunState, 'mode' | 'phase' | 'lobby'>): 'cleared' | 'defeated' | null {
  if (run.mode !== 'gauntlet' || run.phase !== 'gameover' || !run.lobby) return null;
  return run.lobby.seats[0]!.alive ? 'cleared' : 'defeated';
}
