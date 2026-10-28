/**
 * VERSUS ON CLOUDFLARE — what a room shows on LIVE GAMES (R-VERSUS-CF-LIVE-01).
 *
 * Parity with the Supabase build, mode by mode:
 *   - RANKED DUOS: one listing row per live team (`duos:<room>` on Supabase, written by the team's first seat's client
 *     through `lobby_live_duos_heartbeat`). A Cloudflare room's row is `duos:cf:<room>` and the ROOM writes it, through
 *     the limited, key-gated `versus_cf_live` (supabase/migrations/2026-11-08-versus-cf-live-games-invites.sql). The
 *     client's Live Games already reads `duos:cf:<room>` and its Watch joins the room on the Worker.
 *   - 1v1, Group, Versus Duos: never on Live Games on either backend; they are watched from Friends ("In a game" +
 *     Watch, the client's presence carries `cf:<room>`). So the room lists nothing for them.
 *
 * Egress (the reason this module exists): the room writes only when the listing's KEY changes (it appears, a round or a
 * phase changes, it ends) plus a slow keep-alive (`LIVE_REFRESH_MS`), never per frame and never per spectator. Pure.
 */
import type { CoreState } from './roomCore';

/** One listing row as the room hands it to the writer. Name, medal and rating are looked up in SQL from the team id. */
export interface LiveListing {
  room: string;
  /** The team's first live seat (the row's owner: one live game per player, as the Supabase row). */
  p1: string;
  team: string | null;
  /** The pair's names ("A & B"): the row's name when the team has none. */
  names: string;
  hero: string;
  round: number;
  phase: 'hero' | 'shop' | 'combat';
  spectators: number;
}

/** Re-send the same row this long after the last write (the SQL keeps a Cloudflare row visible for 4 minutes). */
export const LIVE_REFRESH_MS = 120_000;

/** The listing phase of a match phase (`duosLivePhase` in the client). `complete` is no listing at all. */
export function livePhase(p: string): 'hero' | 'shop' | 'combat' | null {
  if (p === 'complete') return null;
  return p === 'hero_select' ? 'hero' : p === 'combat' ? 'combat' : 'shop';
}

/** The room's Live Games row right now, or null (not a Ranked Duos match in progress, or a friends-only party). */
export function liveListingOf(state: CoreState): LiveListing | null {
  const room = state.room;
  const g = state.group;
  if (room.closed || room.friends_only || !g?.ranked || room.current_match_id !== g.match.id) return null;
  const phase = livePhase(g.match.phase);
  if (!phase) return null;
  const p1 = g.match.seats.find((s) => s.seat === 'p1');
  const p2 = g.match.seats.find((s) => s.seat === 'p2');
  if (!p1) return null;
  return {
    room: room.id,
    p1: p1.user_id,
    team: g.ranked.ranked_team,
    names: [p1.name, p2?.name].filter(Boolean).join(' & ').slice(0, 40),
    hero: p1.hero ?? 'warden',
    round: Math.max(1, g.match.round),
    phase,
    spectators: room.members.filter((m) => m.role === 'spectator').length,
  };
}

/** What makes a write due: the row appearing / leaving, a round, a phase, the team identity. NOT the spectator count. */
export const liveKeyOf = (l: LiveListing | null): string =>
  l ? `${l.room}|${l.round}|${l.phase}|${l.team ?? ''}|${l.hero}|${l.names}` : 'none';
