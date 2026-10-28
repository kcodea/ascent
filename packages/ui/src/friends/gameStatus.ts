/**
 * A FRIEND'S GAME, at a glance (owner approved 2026-10-28; R-FRIENDS-STATUS-01): the Friends row of a friend who is in a
 * game shows its mode and hero (a small portrait), the round and phase (Hero Select / Shopping / Fighting), Health and
 * Armor, the tavern tier, and the lobby place ("3rd of 5 left") or the Versus players.
 *
 * `FriendGameStatus` is the one typed shape, carried today in the presence beat (`friends_beat(..., p_game)`,
 * `player_presence.game`, capped at 1 KB in SQL) and meant to be reused unchanged by the Cloudflare presence hub that
 * will replace that transport. It changes only on a change of phase, round, place, tier or vitals (the beat's key), so it
 * is sent by the same event-driven beat, never per tick. Builders and the parser are pure.
 */

export interface FriendGameStatus {
  v: 1;
  /** The presence mode ('ranked', 'casual', 'practice', 'versus_1v1', 'versus_group', 'versus_duos', 'ranked_duos'). */
  mode: string;
  hero: string | null;
  round: number;
  phase: 'hero' | 'shop' | 'combat';
  health: number | null;
  armor: number | null;
  tier: number | null;
  /** A lobby game: my place among the players still in. */
  place: { rank: number; left: number } | null;
  /** A Versus match: the players ("Ann vs Bob", "Ann & Bob vs Cat & Dan"). */
  vs: string | null;
}

/** The bytes the SQL accepts (a larger status is dropped there; the client trims `vs` first so it never gets close). */
export const GAME_STATUS_MAX_BYTES = 1024;
const VS_MAX = 120;

const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null);

/** A server value, cleaned (unknown fields dropped, wrong types null); null when it is not a status at all. */
export function parseGameStatus(raw: unknown): FriendGameStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const phase = r.phase === 'hero' || r.phase === 'combat' ? r.phase : r.phase === 'shop' ? 'shop' : null;
  const round = int(r.round);
  if (!phase || round == null) return null;
  const p = r.place as Record<string, unknown> | null | undefined;
  const rank = int(p?.rank);
  const left = int(p?.left);
  return {
    v: 1, mode: str(r.mode, 24) ?? '', hero: str(r.hero, 60), round: Math.max(0, round), phase,
    health: int(r.health), armor: int(r.armor), tier: int(r.tier),
    place: rank != null && left != null && rank >= 1 && left >= rank ? { rank, left } : null,
    vs: str(r.vs, VS_MAX),
  };
}

/** The key the beat compares: a status that changed this sends a beat (still never faster than the beat's own gap). */
export const gameStatusKey = (s: FriendGameStatus | null): string =>
  s ? `${s.mode}|${s.hero ?? ''}|${s.round}|${s.phase}|${s.health ?? ''}|${s.armor ?? ''}|${s.tier ?? ''}|${s.place ? `${s.place.rank}/${s.place.left}` : ''}|${s.vs ?? ''}` : '';

// ── builders ─────────────────────────────────────────────────────────────────────────────────────────────

interface RunSlice {
  heroId: string;
  wave: number;
  phase: string;
  resolve: number;
  armor: number;
  tier: number;
  lobby?: { seats: readonly { id: string; resolve: number; armor: number; alive: boolean }[] } | null;
}

/** My place among the seats still in: 1 + the live seats ahead of me on Health + Armor (ties share the place). */
export function lobbyPlace(seats: readonly { id: string; resolve: number; armor: number; alive: boolean }[], me = 's0'): { rank: number; left: number } | null {
  if (!Array.isArray(seats)) return null;
  const mine = seats.find((s) => s.id === me);
  if (!mine || !mine.alive) return null;
  const alive = seats.filter((s) => s.alive);
  const total = (s: { resolve: number; armor: number }): number => s.resolve + s.armor;
  return { rank: 1 + alive.filter((s) => s.id !== me && total(s) > total(mine)).length, left: alive.length };
}

/** A lobby game (ranked, casual, Practice). `heroSelect`: the player is picking a hero. */
export function lobbyGameStatus(mode: string, run: RunSlice, heroSelect = false): FriendGameStatus {
  return {
    v: 1, mode, hero: heroSelect ? null : run.heroId || null, round: heroSelect ? 0 : run.wave,
    phase: heroSelect ? 'hero' : run.phase === 'combat' ? 'combat' : 'shop',
    health: heroSelect ? null : run.resolve, armor: heroSelect ? null : run.armor, tier: heroSelect ? null : run.tier,
    place: heroSelect || !run.lobby ? null : lobbyPlace(run.lobby.seats ?? []), vs: null,
  };
}

/** The Versus players' line from the room's seats ({role, name}): 1v1 / Group "A vs B (vs C)", Duos "A & B vs C & D",
 *  a Ranked Duos pair "A & B". */
export function versusLine(mode: string, seats: readonly { role: string; name: string }[]): string | null {
  const by = (r: string): string | undefined => seats.find((s) => s.role === r)?.name;
  const named = ['p1', 'p2', 'p3', 'p4'].map(by).filter((n): n is string => !!n);
  if (!named.length) return null;
  let out: string;
  if (mode === 'versus_duos') out = `${[by('p1'), by('p2')].filter(Boolean).join(' & ')} vs ${[by('p3'), by('p4')].filter(Boolean).join(' & ')}`;
  else if (mode === 'ranked_duos') out = named.slice(0, 2).join(' & ');
  else out = named.join(' vs ');
  return out.slice(0, VS_MAX);
}

/** A Versus match: my own run's vitals and tier, the match's round and phase, the room's players. */
export function versusGameStatus(mode: string, run: RunSlice | null, match: { round: number; phase: string }, seats: readonly { role: string; name: string }[]): FriendGameStatus {
  const phase = match.phase === 'hero_select' ? 'hero' : match.phase === 'combat' ? 'combat' : 'shop';
  const playing = phase !== 'hero' && !!run;
  return {
    v: 1, mode, hero: playing ? run!.heroId || null : null, round: Math.max(0, match.round), phase,
    health: playing ? run!.resolve : null, armor: playing ? run!.armor : null, tier: playing ? run!.tier : null,
    place: null, vs: versusLine(mode, seats),
  };
}

// ── text (player-facing: short plain sentences, no em dash) ─────────────────────────────────────────────

const ORD = (n: number): string => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** "Round 6 · Shopping" / "Hero Select" / "Round 3 · Fighting". */
export function roundPhaseText(s: Pick<FriendGameStatus, 'round' | 'phase'>): string {
  if (s.phase === 'hero') return 'Hero Select';
  return `Round ${s.round} · ${s.phase === 'combat' ? 'Fighting' : 'Shopping'}`;
}

/** The detail chips, in order: place or players, Health + Armor, tier. */
export function gameStatusChips(s: FriendGameStatus): string[] {
  const out: string[] = [];
  if (s.place) out.push(`${ORD(s.place.rank)} of ${s.place.left} left`);
  if (s.health != null) out.push(s.armor ? `${s.health} Health + ${s.armor} Armor` : `${s.health} Health`);
  if (s.tier != null) out.push(`Tier ${s.tier}`);
  return out;
}
