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
