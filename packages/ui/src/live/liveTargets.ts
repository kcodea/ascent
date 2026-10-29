/**
 * EVERY GAME IS A LIVE GAME (owner 2026-10-28: "all games should show as live games, and pressing watch from friends list
 * should take the spectator into that game"; R-LIVE-ALL-GAMES-01). What a Live Games row is and where its Watch goes.
 *
 *   `<run id>`             a lobby game (ranked, casual or Practice): the live watch screen (`watchLiveGame`)
 *   `versus:<ref>`         a Versus match (1v1, Group, Versus Duos): the room's stands, in the Versus area
 *   `duos:<ref>`           a Ranked Duos team: the party's stands, in the Duos area
 * `<ref>` is a room reference: the bare id for a Supabase room, `cf:<id>` for a Cloudflare room (`versusHost.ts`), so the
 * router sends the join to the right host. Pure.
 */
import type { LiveGameRow } from './liveRemote';
import { parseGameStatus, type FriendGameStatus } from '../friends/gameStatus';

export const VERSUS_LIVE_PREFIX = 'versus:';
export const DUOS_LIVE_PREFIX = 'duos:';

export type LiveWatchTarget =
  | { kind: 'lobby'; gameId: string }
  | { kind: 'room'; ref: string; area: 'versus' | 'duos' };

export function liveWatchTargetOf(gameId: string): LiveWatchTarget {
  if (gameId.startsWith(VERSUS_LIVE_PREFIX)) return { kind: 'room', ref: gameId.slice(VERSUS_LIVE_PREFIX.length), area: 'versus' };
  if (gameId.startsWith(DUOS_LIVE_PREFIX)) return { kind: 'room', ref: gameId.slice(DUOS_LIVE_PREFIX.length), area: 'duos' };
  return { kind: 'lobby', gameId };
}

/** The row's mode, in plain words ("Versus 1v1", "Ranked Duos", "Practice"). Null for a ranked lobby game (its hero shows). */
export function liveModeLabel(r: Pick<LiveGameRow, 'game_id' | 'mode'>): string | null {
  if (r.game_id.startsWith(DUOS_LIVE_PREFIX) || r.mode === 'ranked_duos') return 'Ranked Duos';
  switch (r.mode) {
    case 'duel': return 'Versus 1v1';
    case 'group': return 'Versus Group';
    case 'duos': return 'Versus Duos';
    case 'casual': return 'Casual';
    case 'practice': return 'Practice';
    default: return r.game_id.startsWith(VERSUS_LIVE_PREFIX) ? 'Versus' : null;
  }
}

/** The name line: the players of a Versus match, else the player (or the team). */
export const liveNameOf = (r: Pick<LiveGameRow, 'display_name' | 'players' | 'game_id'>): string =>
  r.game_id.startsWith(VERSUS_LIVE_PREFIX) && r.players ? r.players : r.display_name;

/** The row's mode as a presence mode (the status's `mode`): what the friends formatters read. */
const PRESENCE_MODE: Record<string, string> = { duel: 'versus_1v1', group: 'versus_group', duos: 'versus_duos', ranked_duos: 'ranked_duos', casual: 'casual', practice: 'practice' };

/**
 * A LIVE GAME AT A GLANCE (owner 2026-10-29: "give live games the same granularity that friends show"; R-LIVE-STATUS-01):
 * the row's status in the Friends shape (`FriendGameStatus`), so Live Games draws it with the friends' own words and
 * chips. A lobby game's player sends its full status with the listing (`status`: the step and whom it fights, place,
 * Health, Armor, tier); a row without one (a Versus match or Ranked Duos team, an older client or server) gets what the
 * row itself says: the round and phase, the players, and the final place once it is over. The row's round and phase
 * always win (a status rides on the same write, but the row is the listing). Pure.
 */
export function liveGameStatusOf(r: Pick<LiveGameRow, 'game_id' | 'mode' | 'round' | 'phase' | 'placement' | 'players' | 'status'>): FriendGameStatus {
  const sent = parseGameStatus(r.status);
  const mode = PRESENCE_MODE[r.mode ?? ''] ?? (r.game_id.startsWith(DUOS_LIVE_PREFIX) ? 'ranked_duos' : r.game_id.startsWith(VERSUS_LIVE_PREFIX) ? 'versus_1v1' : 'ranked');
  if (r.phase === 'end') {
    return { v: 1, mode, hero: null, round: r.round, phase: 'shop', health: null, armor: null, tier: null, place: null, vs: null,
      step: r.placement === 1 ? 'won' : 'done', ...(r.placement ? { final: r.placement } : {}) };
  }
  const phase = r.phase;
  // A status sent for another phase (a row written between two beats) keeps only what still holds: its vitals and tier.
  if (sent && sent.round === r.round && sent.phase === phase) return { ...sent, mode, vs: sent.vs ?? r.players ?? null };
  return {
    v: 1, mode, hero: null, round: r.round, phase, health: sent?.health ?? null, armor: sent?.armor ?? null, tier: sent?.tier ?? null,
    place: sent?.place ?? null, vs: r.players ?? null, ...(sent?.mate ? { mate: sent.mate } : {}),
  };
}
