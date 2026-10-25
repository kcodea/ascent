/**
 * VERSUS ROOM OPTIONS (owner 2026-10-24, R-VERSUS-OPTIONS-01).
 *
 *   "i think it would be fun to add custom options/modes to versus lobbies as well. this can be where the 1v1 or 4
 *    player options live for now, but we can open that up to things like custom rules like time/lives etc as well as
 *    fun modifiers such as our old rift concepts"
 *   "all these options should be customizable within a lobby, so a player can host a room and change them game to
 *    game without needing to rehost a lobby"
 *   "remove time/lives from options for now"
 *
 * ONE versioned object on the ROOM (`versus_rooms.options`), set by the host while the room is Open and validated by
 * the server against the same whitelist as below (`versus__options_error` in
 * supabase/migrations/2026-10-24-versus-group.sql; `versusOptions.test.ts` pins the two). Each new MATCH snapshots the
 * room's options when it is created (`versus_matches.options` / `versus_group_matches.options`), so a game in progress
 * never changes and every client, replay and the resolver read the match's pinned copy.
 *
 * TODAY: the mode (1v1 or the 3-4 player group) and the modifiers. Hearts stay 7 and the round timer stays the
 * standard schedule (not options yet). A later field (hearts, timer) is added by accepting a new key here and in SQL,
 * with its default = today's value, so stored objects without it keep meaning what they meant; `v` is bumped only when
 * an existing field changes meaning.
 *
 * DEFAULTS = today's Versus exactly (1v1, no modifiers), so an existing room and a match row with no options behave
 * identically.
 *
 * Dependency-free (type imports only): it rides the `versus-resolve` bundle and is mirrored in SQL.
 */
import type { RiftId } from '../config';

/** The room's game mode: today's 1v1, the 3-4 player round robin ("Versus Group"), or the 2v2 tag-team ("Versus
 *  Duos", owner 2026-10-25: exactly 4 players, p1 + p2 vs p3 + p4). */
export type VersusMode = 'duel' | 'group' | 'duos';
export const VERSUS_MODES: readonly VersusMode[] = ['duel', 'group', 'duos'];

/**
 * MODIFIERS: an existing RIFT applied to one room. The rift is pinned onto every seat's run at creation
 * (`createVersusRun` sets `RunState.rift`), exactly as a Rift run pins the live rift, so a saved or replayed run keeps
 * it whatever the global `RIFTS` switches say. Only rifts listed here may be picked. Both proof modifiers are SHOP
 * rules (combat never reads `rift`), so the resolver's fight is the same with or without them; a future combat
 * modifier would be read from the match's pinned options by the resolver.
 */
export type VersusModifierId = Extract<RiftId, 'freedom' | 'summit'>;
export const VERSUS_MODIFIERS: readonly VersusModifierId[] = ['freedom', 'summit'];
/** At most this many modifiers at once (a run pins ONE rift today). */
export const VERSUS_MAX_MODIFIERS = 1;

/** The options schema version. Bump it (and the SQL) only when an existing field changes meaning. */
export const VERSUS_OPTIONS_VERSION = 1;
/** The keys a stored options object may carry. */
export const VERSUS_OPTION_KEYS = ['v', 'mode', 'modifiers'] as const;

export interface VersusRoomOptions {
  v: typeof VERSUS_OPTIONS_VERSION;
  mode: VersusMode;
  modifiers: VersusModifierId[];
}

export const DEFAULT_VERSUS_OPTIONS: Readonly<VersusRoomOptions> = Object.freeze({
  v: VERSUS_OPTIONS_VERSION,
  mode: 'duel',
  modifiers: [] as VersusModifierId[],
});

/** Player seats per mode: 1v1 seats two, a group room up to four (and starts with three or four), Duos exactly four. */
export const VERSUS_MODE_SEATS: Readonly<Record<VersusMode, { min: number; max: number }>> = {
  duel: { min: 2, max: 2 },
  group: { min: 3, max: 4 },
  duos: { min: 4, max: 4 },
};

/** Why a requested options object is refused, or null when it is valid. Mirrors `versus__options_error` in SQL. */
export function versusOptionsError(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'options_not_object';
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(VERSUS_OPTION_KEYS as readonly string[]).includes(k)) return 'unknown_option';
  if (o.v !== undefined && o.v !== VERSUS_OPTIONS_VERSION) return 'bad_version';
  if (o.mode !== undefined && !VERSUS_MODES.includes(o.mode as VersusMode)) return 'bad_mode';
  if (o.modifiers !== undefined) {
    if (!Array.isArray(o.modifiers) || o.modifiers.length > VERSUS_MAX_MODIFIERS) return 'bad_modifiers';
    if (new Set(o.modifiers).size !== o.modifiers.length) return 'bad_modifiers';
    for (const m of o.modifiers) if (!VERSUS_MODIFIERS.includes(m as VersusModifierId)) return 'bad_modifiers';
  }
  return null;
}

/**
 * The options a room or match plays under: a stored object with every missing field filled from the defaults. A
 * null/absent object (every match before 2026-10-24) is the defaults. An INVALID stored object also falls back to the
 * defaults (the server never stores one; this is the client's belt and braces).
 */
export function normalizeVersusOptions(raw: unknown): VersusRoomOptions {
  if (raw == null || versusOptionsError(raw)) return { ...DEFAULT_VERSUS_OPTIONS, modifiers: [] };
  const o = raw as Partial<VersusRoomOptions>;
  return {
    v: VERSUS_OPTIONS_VERSION,
    mode: o.mode ?? DEFAULT_VERSUS_OPTIONS.mode,
    modifiers: [...(o.modifiers ?? [])],
  };
}

/** True when nothing differs from today's 1v1 Versus (for a "custom rules" badge). */
export function isDefaultVersusOptions(o: VersusRoomOptions): boolean {
  return o.mode === 'duel' && o.modifiers.length === 0;
}

/** The rift a seat's run pins under these options (null = none). */
export function versusOptionsRift(o: VersusRoomOptions): VersusModifierId | null {
  return o.modifiers[0] ?? null;
}
