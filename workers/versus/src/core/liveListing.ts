/**
 * VERSUS ON CLOUDFLARE — what a room shows on LIVE GAMES (R-LIVE-ALL-GAMES-01, R-VERSUS-CF-LIVE-01).
 *
 * Owner ruling 2026-10-28: "all games should show as live games". Every Cloudflare match in progress is listed, in every
 * mode, as a Supabase one is:
 *   - 1v1, Group, Versus Duos: `versus:cf:<room>` (a Supabase room is `versus:<room>`, written by a trigger), with the
 *     players' line ("Ann vs Bob", "Ann & Bob vs Cat & Dan"). A friends-only room is listed only to the host's friends
 *     (`private_host`; the SQL read policy decides who sees it), as the room list does.
 *   - Ranked Duos: `duos:cf:<room>` (Supabase: `duos:<room>`), the team's name and medal looked up in SQL; a friends-only
 *     party is not listed at all (as `lobby_live_duos_heartbeat`).
 * The ROOM writes the row through the limited, key-gated `versus_cf_live`
 * (supabase/migrations/2026-11-08-versus-cf-live-games-invites.sql); the client's Watch joins the room on the Worker.
 *
 * Egress: the room writes only when the listing's KEY changes (it appears, a round or a phase changes, it ends) plus a
 * slow keep-alive (`LIVE_REFRESH_MS`), never per frame and never per spectator. Pure.
 */
import type { CoreState } from './roomCore';

export type LiveMode = 'duel' | 'group' | 'duos' | 'ranked_duos';

/** One listing row as the room hands it to the writer. Rank, medal and rating are looked up in SQL. */
export interface LiveListing {
  room: string;
  mode: LiveMode;
  /** The first seat (the row's owner: one live game per player, as the Supabase rows). */
  p1: string;
  /** Ranked Duos: the team id (its name and medal are read in SQL). */
  team: string | null;
  /** The players' line ("Ann vs Bob"); a Ranked Duos team with no name reads as it ("Ann & Bob"). */
  players: string;
  hero: string;
  round: number;
  phase: 'hero' | 'shop' | 'combat';
  spectators: number;
  /** A friends-only Versus room's host: only the host and their friends see the row. */
  private_host: string | null;
  /** Ranked Duos: the team's name and division as the room knows them (the hub directory's fallback when its own
   *  lookup cannot be made; R-LIVE-DIR-01). Not part of the key. */
  team_name?: string | null;
  division?: number;
}

/** Re-send the same row this long after the last write (the SQL keeps a Cloudflare row visible for 4 minutes). */
export const LIVE_REFRESH_MS = 120_000;

/** The listing phase of a match phase (the client's retired Supabase publisher had the same rule). `complete` is no listing at all. */
export function livePhase(p: string): 'hero' | 'shop' | 'combat' | null {
  if (p === 'complete') return null;
  return p === 'hero_select' ? 'hero' : p === 'combat' ? 'combat' : 'shop';
}

const line = (s: string): string => s.slice(0, 160);

/** The room's Live Games row right now, or null (no match in progress, or a friends-only Ranked Duos party). */
export function liveListingOf(state: CoreState): LiveListing | null {
  const room = state.room;
  if (room.closed) return null;
  const spectators = room.members.filter((m) => m.role === 'spectator').length;
  const privateHost = room.friends_only ? room.host_user_id : null;
  // 1v1.
  const m = state.match;
  if (m && room.current_match_id === m.id) {
    const phase = livePhase(m.phase);
    if (!phase) return null;
    return {
      room: room.id, mode: 'duel', p1: m.p1_user, team: null, players: line(`${m.p1_name} vs ${m.p2_name}`),
      hero: m.p1_hero ?? 'warden', round: Math.max(1, m.round), phase, spectators, private_host: privateHost,
    };
  }
  // Group, Versus Duos, Ranked Duos.
  const g = state.group;
  if (!g || room.current_match_id !== g.match.id) return null;
  const phase = livePhase(g.match.phase);
  if (!phase) return null;
  const seats = [...g.match.seats].sort((a, b) => a.seat.localeCompare(b.seat));
  const p1 = seats[0];
  if (!p1) return null;
  const base = { room: room.id, p1: p1.user_id, hero: p1.hero ?? 'warden', round: Math.max(1, g.match.round), phase, spectators };
  if (g.ranked) {
    if (room.friends_only) return null;
    return {
      ...base, mode: 'ranked_duos', team: g.ranked.ranked_team, players: line(seats.filter((s) => s.seat === 'p1' || s.seat === 'p2').map((s) => s.name).join(' & ')),
      private_host: null, team_name: g.ranked.team_name, division: g.ranked.division,
    };
  }
  const duos = g.match.options?.mode === 'duos';
  const players = duos
    ? `${seats.filter((s) => s.team === 'a').map((s) => s.name).join(' & ')} vs ${seats.filter((s) => s.team !== 'a').map((s) => s.name).join(' & ')}`
    : seats.map((s) => s.name).join(' vs ');
  return { ...base, mode: duos ? 'duos' : 'group', team: null, players: line(players), private_host: privateHost };
}

/** What makes a write due: the row appearing / leaving, mode, round, phase, team, hero, players, privacy. NOT the
 *  spectator count. */
export const liveKeyOf = (l: LiveListing | null): string =>
  l ? `${l.room}|${l.mode}|${l.round}|${l.phase}|${l.team ?? ''}|${l.hero}|${l.players}|${l.private_host ?? ''}` : 'none';
