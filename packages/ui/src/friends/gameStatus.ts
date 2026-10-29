/**
 * A FRIEND'S GAME, at a glance (owner approved 2026-10-28; R-FRIENDS-STATUS-01): the Friends row of a friend who is in a
 * game shows its mode and hero (a small portrait), the round and phase (Hero Select / Shopping / Fighting), Health and
 * Armor, the tavern tier, and the lobby place ("3rd of 5 left") or the Versus players.
 *
 * `FriendGameStatus` is the one typed shape, carried today in the presence beat (`friends_beat(..., p_game)`,
 * `player_presence.game`, capped at 1 KB in SQL) and meant to be reused unchanged by the Cloudflare presence hub that
 * will replace that transport. Builders and the parsers are pure.
 *
 * THE GRANULAR ACTIVITY (owner 2026-10-29, R-FRIENDS-ACTIVITY-01): the game status gains the step ("Ending turn",
 * "Fighting Ann", "Knocked out, 3rd", "Won the game", "Finished 3rd") and the Ranked Duos teammate, all optional fields
 * an older client ignores; and an ONLINE player gets `FriendActivity` (the screen they are on), carried in the same
 * slot and told apart by `act`. A beat is owed only when the COARSE key changes (`gameCoarseKey`, `activityKey`):
 * Health, Armor, tier and place ride along on a beat that goes anyway, never send one of their own.
 *
 * LIVE GAMES READ IT TOO (owner 2026-10-29: "give live games the same granularity that friends show";
 * R-LIVE-STATUS-01): a live lobby game's listing carries the same status (`lobbyStatusNow`), and the Live Games row draws
 * it with the same words and chips (`FriendGame`). One shape, one set of formatters, for both surfaces.
 */
import { pairRunLobby, type RunLobby } from '@game/sim';

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
  // ── R-FRIENDS-ACTIVITY-01 (owner 2026-10-29), all optional and additive: an older client reads `phase` and ignores
  //    these; an older sender simply has none of them. ──
  /** The richer step, only when `phase` alone does not say it (absent = the phase's own step). */
  step?: GameStep;
  /** In a fight: who I fight (null = a recorded board with no name). Absent = an older sender (just "Fighting"). */
  foe?: string | null;
  /** Ranked Duos: my teammate. */
  mate?: string | null;
  /** Knocked out / finished: my final place. */
  final?: number | null;
}

/** What the player is doing in the game. 'out' = knocked out of a Versus match, still watching it. */
export type GameStep = 'hero' | 'shop' | 'ending' | 'fight' | 'out' | 'won' | 'done';
const STEPS: readonly GameStep[] = ['hero', 'shop', 'ending', 'fight', 'out', 'won', 'done'];
/** The step a status shows (its own, else its phase's). */
export const stepOf = (s: Pick<FriendGameStatus, 'phase' | 'step'>): GameStep => s.step ?? (s.phase === 'combat' ? 'fight' : s.phase);

/** The bytes the SQL accepts (a larger status is dropped there; the client trims `vs` first so it never gets close). */
export const GAME_STATUS_MAX_BYTES = 1024;
const VS_MAX = 120;
/** A player name inside a status (foe, teammate, whose replay). */
export const NAME_MAX = 40;

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
  const out: FriendGameStatus = {
    v: 1, mode: str(r.mode, 24) ?? '', hero: str(r.hero, 60), round: Math.max(0, round), phase,
    health: int(r.health), armor: int(r.armor), tier: int(r.tier),
    place: rank != null && left != null && rank >= 1 && left >= rank ? { rank, left } : null,
    vs: str(r.vs, VS_MAX),
  };
  if (STEPS.includes(r.step as GameStep)) out.step = r.step as GameStep;
  if ('foe' in r) out.foe = str(r.foe, NAME_MAX);
  if (typeof r.mate === 'string' && r.mate) out.mate = str(r.mate, NAME_MAX);
  const fin = int(r.final);
  if (fin != null && fin >= 1 && fin <= 99) out.final = fin;
  return out;
}

/** The key the beat compares: a status that changed this sends a beat (still never faster than the beat's own gap). */
export const gameStatusKey = (s: FriendGameStatus | null): string =>
  s ? `${s.mode}|${s.hero ?? ''}|${s.round}|${s.phase}|${s.health ?? ''}|${s.armor ?? ''}|${s.tier ?? ''}|${s.place ? `${s.place.rank}/${s.place.left}` : ''}|${s.vs ?? ''}` : '';

/**
 * THE COARSE KEY (R-FRIENDS-ACTIVITY-01): what decides that a beat is owed. Only the activity itself (mode, round,
 * step, foe, final place, teammate), never Health, Armor, tier or place: those ride along on the next beat, so a
 * tier-up or a hit never sends one of its own.
 */
export const gameCoarseKey = (s: FriendGameStatus | null): string =>
  s ? `${s.mode}|${s.hero ?? ''}|${s.round}|${coarseStep(s)}|${s.foe ?? ''}|${s.final ?? ''}|${s.mate ?? ''}` : '';
/** A LOBBY End Turn plays out in a few seconds (friends read the list once a minute): it rides along on a beat that
 *  goes anyway, never sends one of its own. A Versus lock waits on the other players, so it does. */
const coarseStep = (s: FriendGameStatus): GameStep => {
  const st = stepOf(s);
  return st === 'ending' && !s.vs ? 'shop' : st;
};

// ── builders ─────────────────────────────────────────────────────────────────────────────────────────────

interface RunSlice {
  heroId: string;
  wave: number;
  phase: string;
  resolve: number;
  armor: number;
  tier: number;
  lobby?: { seats: readonly { id: string; resolve: number; armor: number; alive: boolean; placement?: number }[] } | null;
}

/** The richer in-game detail the stores know beyond the run itself. */
export interface GameExtras {
  /** The End Turn is playing out (lobby), or my turn is locked and waits on the others (Versus). */
  ending?: boolean;
  /** In a fight: who I fight (null = a recorded board with no name). */
  foe?: string | null;
  /** Ranked Duos: my teammate. */
  mate?: string | null;
  /** Knocked out of a Versus match and watching the rest, with my place when known. */
  out?: { place: number | null } | null;
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

const cut = (n: string | null | undefined): string | null => (n ? n.slice(0, NAME_MAX) : null);

/** Fold the extras into a status: the step and its names, only where they add something (a small payload). */
function withExtras(s: FriendGameStatus, x: GameExtras | undefined): FriendGameStatus {
  if (!x) return s;
  if (x.out) {
    s.step = 'out';
    if (x.out.place) s.final = x.out.place;
  } else if (s.phase === 'combat' && x.foe !== undefined) {
    s.step = 'fight';
    s.foe = cut(x.foe);
  } else if (s.phase === 'shop' && x.ending) {
    s.step = 'ending';
  }
  if (x.mate) s.mate = cut(x.mate);
  return s;
}

/** A lobby game (ranked, casual, Practice). `heroSelect`: the player is picking a hero. A run that is over (the end
 *  screen) reads as Won or Finished Nth. */
export function lobbyGameStatus(mode: string, run: RunSlice, heroSelect = false, extras?: GameExtras): FriendGameStatus {
  const over = !heroSelect && (run.phase === 'gameover' || run.phase === 'victory');
  const base: FriendGameStatus = {
    v: 1, mode, hero: heroSelect ? null : run.heroId || null, round: heroSelect ? 0 : run.wave,
    phase: heroSelect ? 'hero' : run.phase === 'combat' ? 'combat' : 'shop',
    health: heroSelect || over ? null : run.resolve, armor: heroSelect || over ? null : run.armor, tier: heroSelect ? null : run.tier,
    place: heroSelect || over || !run.lobby ? null : lobbyPlace(run.lobby.seats ?? []), vs: null,
  };
  if (over) {
    const placement = run.lobby?.seats?.find((x) => x.id === 's0')?.placement ?? (run.phase === 'victory' ? 1 : null);
    base.step = placement === 1 || run.phase === 'victory' ? 'won' : 'done';
    if (placement) base.final = placement;
    return base;
  }
  return withExtras(base, extras);
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
export function versusGameStatus(
  mode: string, run: RunSlice | null, match: { round: number; phase: string }, seats: readonly { role: string; name: string }[], extras?: GameExtras,
): FriendGameStatus {
  const phase = match.phase === 'hero_select' ? 'hero' : match.phase === 'combat' ? 'combat' : 'shop';
  const playing = phase !== 'hero' && !!run;
  const out = !!extras?.out;
  return withExtras({
    v: 1, mode, hero: playing ? run!.heroId || null : null, round: Math.max(0, match.round), phase,
    health: playing && !out ? run!.resolve : null, armor: playing && !out ? run!.armor : null, tier: playing ? run!.tier : null,
    place: null, vs: versusLine(mode, seats),
  }, extras);
}

/** Who the player fights in a lobby round (null: a recorded board with no seat, or a bye). Cached per lobby + round. */
let foeCache: { lobby: RunLobby; round: number; name: string | null } | null = null;
export function lobbyFoeName(lobby: RunLobby): string | null {
  if (foeCache && foeCache.lobby === lobby && foeCache.round === lobby.round) return foeCache.name;
  let name: string | null = null;
  try {
    const forced = lobby.forcedOpponent;
    if (forced && forced.round === lobby.round) name = lobby.seats.find((x) => x.id === forced.seatId)?.label ?? null;
    else {
      const pair = pairRunLobby(lobby).pairs.find(([a, b]) => a.id === 's0' || b.id === 's0');
      name = pair ? (pair[0].id === 's0' ? pair[1] : pair[0]).label || null : null;
    }
  } catch { name = null; }
  foeCache = { lobby, round: lobby.round, name };
  return name;
}

/** Tests: forget the cached pairing. */
export function resetFoeCacheForTests(): void { foeCache = null; }

/** My lobby game's status right now, with its step (ending the turn, fighting whom): what the presence beat AND the
 *  Live Games listing send (R-FRIENDS-ACTIVITY-01, R-LIVE-STATUS-01). Null for a run with no lobby. */
export function lobbyStatusNow(mode: string, run: RunSlice & { lobby?: RunLobby | null }, endTurnAnimating: boolean): FriendGameStatus | null {
  if (!run.lobby) return null;
  const extras: GameExtras = { ending: run.phase === 'recruit' && endTurnAnimating };
  if (run.phase === 'combat') extras.foe = lobbyFoeName(run.lobby);
  return lobbyGameStatus(mode, run, false, extras);
}

// ── text (player-facing: short plain sentences, no em dash) ─────────────────────────────────────────────

export const ORD = (n: number): string => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
};

/** "Round 6 · Shopping" / "Hero Select" / "Round 3 · Fighting" (the phase alone; `stepText` says more). */
export function roundPhaseText(s: Pick<FriendGameStatus, 'round' | 'phase'>): string {
  if (s.phase === 'hero') return 'Hero Select';
  return `Round ${s.round} · ${s.phase === 'combat' ? 'Fighting' : 'Shopping'}`;
}

/**
 * What they are doing, in a few words (R-FRIENDS-ACTIVITY-01): "Picking a hero", "Round 6 · Shopping",
 * "Round 6 · Ending turn", "Round 6 · Fighting Ann" (or "a recorded board"), "Knocked out, 3rd. Watching the fight",
 * "Won the game", "Finished 3rd".
 */
export function stepText(s: Pick<FriendGameStatus, 'round' | 'phase' | 'step' | 'foe' | 'final'>): string {
  const r = `Round ${s.round}`;
  switch (stepOf(s)) {
    case 'hero': return 'Picking a hero';
    case 'ending': return `${r} · Ending turn`;
    case 'fight': return s.foe === undefined ? `${r} · Fighting` : `${r} · Fighting ${s.foe ?? 'a recorded board'}`;
    case 'out': return s.final ? `Knocked out, ${ORD(s.final)}. Watching the fight` : 'Knocked out. Watching the fight';
    case 'won': return 'Won the game';
    case 'done': return s.final ? `Finished ${ORD(s.final)}` : 'Finished the game';
    default: return `${r} · Shopping`;
  }
}

/** The detail chips, in order: place or players, Health + Armor, tier. */
export function gameStatusChips(s: FriendGameStatus): string[] {
  const out: string[] = [];
  if (s.place) out.push(`${ORD(s.place.rank)} of ${s.place.left} left`);
  if (s.health != null) out.push(s.armor ? `${s.health} Health + ${s.armor} Armor` : `${s.health} Health`);
  if (s.tier != null) out.push(`Tier ${s.tier}`);
  return out;
}

/** Every line the hover / tap shows: the step, place, vitals, tier, the teammate, the players. */
export function gameStatusDetail(s: FriendGameStatus, modeName: string | null): string[] {
  const out = [modeName ? `${modeName} · ${stepText(s)}` : stepText(s), ...gameStatusChips(s)];
  if (s.mate) out.push(`Teammate: ${s.mate}`);
  if (s.vs) out.push(s.vs);
  return out;
}

// ── out of a game (R-FRIENDS-ACTIVITY-01) ───────────────────────────────────────────────────────────────

/** Where a player is when not in a game. */
export type ActivityKind =
  | 'menu' | 'modes' | 'learn' | 'career' | 'leaderboard' | 'hall' | 'recent' | 'live' | 'collection' | 'compendium'
  | 'patch_notes' | 'settings' | 'friends' | 'replay' | 'spectate' | 'versus_browser' | 'duos_browser' | 'versus_room'
  | 'duo_party' | 'hero_select' | 'practice_setup';
const ACTS: readonly ActivityKind[] = [
  'menu', 'modes', 'learn', 'career', 'leaderboard', 'hall', 'recent', 'live', 'collection', 'compendium', 'patch_notes',
  'settings', 'friends', 'replay', 'spectate', 'versus_browser', 'duos_browser', 'versus_room', 'duo_party', 'hero_select',
  'practice_setup',
];

/**
 * A player's OUT-OF-GAME activity: one short line on a friend's row. The same transport as `FriendGameStatus` (the
 * beat's `p_game`, the `player_presence.game` column, ≤1 KB) and told apart from it by `act`; reused unchanged by the
 * Cloudflare presence hub. Only coarse facts, derived from screens already on this device (no extra network call).
 */
export interface FriendActivity {
  v: 1;
  act: ActivityKind;
  /** hero_select / versus_room / spectate: the presence mode ('ranked', 'practice', 'versus_group', ...). */
  mode?: string | null;
  /** replay: whose (only a friend's name, never a stranger's); spectate: whom; duo_party: the partner. */
  who?: string | null;
  /** replay: their own game. */
  own?: boolean;
  /** versus_room / duo_party: players seated, and the seats the mode has. */
  players?: number;
  max?: number;
  /** versus_room / duo_party: the match is starting (the room is sealed). */
  starting?: boolean;
}

/** A server value, cleaned; null when it is not an activity. */
export function parseActivity(raw: unknown): FriendActivity | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!ACTS.includes(r.act as ActivityKind)) return null;
  const out: FriendActivity = { v: 1, act: r.act as ActivityKind };
  const mode = str(r.mode, 24);
  if (mode) out.mode = mode;
  const who = str(r.who, NAME_MAX);
  if (who) out.who = who;
  if (r.own === true) out.own = true;
  const players = int(r.players);
  const max = int(r.max);
  if (players != null && max != null && players >= 0 && max >= 1 && max <= 8) { out.players = Math.min(players, max); out.max = max; }
  if (r.starting === true) out.starting = true;
  return out;
}

/** The coarse key of an activity (every field is coarse). */
export const activityKey = (a: FriendActivity | null | undefined): string =>
  a ? `${a.act}|${a.mode ?? ''}|${a.who ?? ''}|${a.own ? 1 : 0}|${a.players ?? ''}/${a.max ?? ''}|${a.starting ? 1 : 0}` : '';

/** The words for an activity, as [line, detail?]. `modeName` turns a presence mode into its name ("Versus Group"). */
export function activityText(a: FriendActivity, modeName: (m: string | null | undefined) => string | null): [string, string?] {
  const m = modeName(a.mode);
  const seats = a.players != null && a.max ? `${a.players} of ${a.max} players` : null;
  const room = (lead: string): [string, string?] => {
    const detail = [seats, a.starting ? 'Starting' : 'Waiting'].filter(Boolean).join(' · ');
    return [lead, detail];
  };
  switch (a.act) {
    case 'menu': return ['Main menu'];
    case 'modes': return ['Choosing a mode'];
    case 'learn': return ['Tutorial'];
    case 'career': return ['Browsing Career'];
    case 'leaderboard': return ['Browsing the Leaderboard'];
    case 'hall': return ['Browsing the Hall of Champions'];
    case 'recent': return ['Browsing Recent Games'];
    case 'live': return ['Browsing Live Games'];
    case 'collection': return ['Collection'];
    case 'compendium': return ['Compendium'];
    case 'patch_notes': return ['Patch Notes'];
    case 'settings': return ['Settings'];
    case 'friends': return ['Friends'];
    case 'replay': return [a.own ? 'Watching their own replay' : a.who ? `Watching ${a.who}'s replay` : 'Watching a replay'];
    case 'spectate': return [a.who ? `Watching ${a.who}` : 'Watching a game', m ?? undefined];
    case 'versus_browser': return ['Looking for a Versus room'];
    case 'duos_browser': return ['Looking for a Duo party'];
    case 'versus_room': return room(m ? `In a ${m} room` : 'In a Versus room');
    case 'duo_party': return room(a.who ? `In a Duo party with ${a.who}` : 'In a Duo party');
    case 'hero_select': return [m ? `Hero Select · ${m}` : 'Hero Select'];
    case 'practice_setup': return ['Setting up Practice'];
    default: return ['Online'];
  }
}
