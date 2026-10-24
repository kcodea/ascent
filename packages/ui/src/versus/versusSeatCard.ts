/**
 * VERSUS PLAYER CARDS (owner 2026-10-16): "for versus - we want to make the players actually show as cards, using their
 * portrait art as the minion art, their equipped title and name in the card text, their versus wins as the attack pill,
 * their versus losses as their health pill. it should use the equipped card plate they have equipped as well".
 *
 * The DATA half (no React here except the one fetch hook): what each room seat's card says, and where the numbers come
 * from. The room renders it through the real `Card` (VersusPlayerCard.tsx).
 *
 *  - ART: the player's chosen profile picture (`profiles.avatar`, read live; else the avatar their room profile carries),
 *    falling back the way the Leaderboard does: their favourite hero in their hero skin; a player with neither (a new
 *    account) wears the default hero's portrait (`DEFAULT_HERO_ID`), never an empty art window.
 *  - NAME: their display name. TEXT: their equipped title (none = no text).
 *  - ATTACK = their total Versus WINS, HEALTH = their total Versus LOSSES, counting only matches where BOTH seats are
 *    real (non-anonymous) accounts (`versus_records`, one bounded RPC for every card in the room). Unknown = "-".
 *  - PLATE: their equipped `card_plate`, from the cosmetic snapshot their room profile carries (the one the opponent's
 *    combat skins already ride).
 *  - Another player's SKIN and PLATE show through "Show opponent cosmetics" (the owner's ask: "Respect 'Show opponent
 *    cosmetics' for the opponent's plate/skin; if it's off, show the default plate"): off = the standard plate and the
 *    favourite hero's default art. Their profile picture, name, title and record are who they are, not a skin, so they
 *    always show. Your own card always shows your own everything.
 */
import { useEffect, useState } from 'react';
import { DEFAULT_HERO_ID } from '@game/sim';
import { parseCosmeticSnapshot, titleName, type RunCosmeticSnapshot } from '@game/progression';
import type { CardView } from '../Card';
import { avatarSrc } from '../art';
import { heroPortrait } from '../skins/skinArt';
import { supabaseClient } from '../remoteBoards';
import type { VersusMember } from './versusRemote';

/** A player's lifetime Versus record. */
export interface VersusRecord { wins: number; losses: number }

/** What the server says about a seated player (all optional: any read may be missing or fail). */
export interface SeatServerData {
  record?: VersusRecord;
  /** `profiles.avatar`, the chosen profile picture (live). */
  avatar?: string;
  favoriteHero?: string;
  /** `profiles.equipped_title_id` (live). */
  titleId?: string;
}

/** Everything one seat card shows, already through the opponent-cosmetics switch. */
export interface PlayerCardSource {
  userId: string;
  name: string;
  /** The avatar id (`hero:x` / `minion:y` / `power:z`), or null. */
  avatar: string | null;
  favoriteHero: string | null;
  titleId: string | null;
  /** The cosmetic snapshot the card wears (skins + plate), null = default art and the standard plate. */
  cosmetics: RunCosmeticSnapshot | null;
  record: VersusRecord | null;
}

/** The id a player card carries. Not a card in any set, so no def, art or tuner entry is ever found for it. */
export const PLAYER_CARD_ID = 'versus-player';

/** The card's art: the profile picture, else the favourite hero in the player's skin, else the default hero. */
export function playerCardArt(src: Pick<PlayerCardSource, 'avatar' | 'favoriteHero' | 'cosmetics'>): string | undefined {
  return avatarSrc(src.avatar) ?? heroPortrait(src.favoriteHero, src.cosmetics) ?? heroPortrait(DEFAULT_HERO_ID, null);
}

/** The seat's card: name, title as the text, wins as Attack, losses as Health, the portrait as the art. */
export function playerCardView(src: PlayerCardSource): CardView {
  const art = playerCardArt(src);
  return {
    name: src.name,
    cardId: PLAYER_CARD_ID,
    tribe: 'neutral',
    attack: Math.max(0, Math.floor(src.record?.wins ?? 0)),
    health: Math.max(0, Math.floor(src.record?.losses ?? 0)),
    keywords: [],
    text: titleName(src.titleId) ?? '',
    // An explicit art url; undefined (no art bundled at all) lets the Card draw its placeholder.
    ...(art ? { artUrl: art } : {}),
  };
}

/**
 * One seat's card source. `own` = this is YOUR seat: your live avatar, title and loadout, always. Anyone else's comes
 * from the server (live avatar + title) and their room profile (avatar, title, skins, plate); their skins and plate
 * only when `showOpp`.
 */
export function seatCardSource(args: {
  member: Pick<VersusMember, 'userId' | 'displayName' | 'profile'>;
  own: boolean;
  showOpp: boolean;
  server: SeatServerData | undefined;
  /** Your live values (read only when `own`). */
  self?: { avatar: string | null; titleId: string | null; cosmetics: RunCosmeticSnapshot | null };
}): PlayerCardSource {
  const { member, own, showOpp, server, self } = args;
  const profile = member.profile ?? {};
  const roomAvatar = typeof profile.avatar === 'string' && profile.avatar ? profile.avatar : null;
  const roomCos = parseCosmeticSnapshot(profile.cosmetics) ?? null;
  const base = { userId: member.userId, name: member.displayName, favoriteHero: server?.favoriteHero ?? null, record: server?.record ?? null };
  if (own) {
    return {
      ...base,
      avatar: self?.avatar ?? server?.avatar ?? roomAvatar,
      titleId: self ? self.titleId : server?.titleId ?? roomCos?.title ?? null,
      cosmetics: self ? self.cosmetics : roomCos,
    };
  }
  return { ...base, avatar: server?.avatar ?? roomAvatar, titleId: server?.titleId ?? roomCos?.title ?? null, cosmetics: showOpp ? roomCos : null };
}

// ── the reads ────────────────────────────────────────────────────────────────────────────────────────────────────
const READ_TIMEOUT_MS = 6000;
const timeout = <T,>(ms: number, v: T): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : null);

/** Parse `versus_records`' answer (a jsonb array of `{ userId, wins, losses }`). Exported for the test. */
export function parseVersusRecords(data: unknown): Map<string, VersusRecord> {
  const out = new Map<string, VersusRecord>();
  if (!Array.isArray(data)) return out;
  for (const r of data as Array<Record<string, unknown>>) {
    const id = typeof r?.userId === 'string' ? r.userId : null;
    const wins = num(r?.wins);
    const losses = num(r?.losses);
    if (id && wins !== null && losses !== null) out.set(id, { wins, losses });
  }
  return out;
}

/** Most ids one read answers: the two seats plus up to twenty spectators (VERSUS_SPECTATOR_CAP), in ONE call. */
export const MAX_RECORD_IDS = 24;

/** Wins + losses against real players (`versus_records`). No fallback count: until the RPC is live the record is
 *  unknown and the card prints "-" (a client count cannot tell anonymous / test accounts apart). */
async function fetchRecords(ids: readonly string[]): Promise<Map<string, VersusRecord>> {
  const c = supabaseClient();
  if (!c || ids.length === 0) return new Map();
  // rows: versus_records is a scalar RPC (`returns jsonb`): an array of at most 24 objects (2026-10-24-versus-records-24.sql: four group seats + 20 spectators), one per user id.
  const rpc = await Promise.race([Promise.resolve(c.rpc('versus_records', { p_users: ids })), timeout(READ_TIMEOUT_MS, null)]);
  return rpc && !rpc.error ? parseVersusRecords(rpc.data) : new Map();
}

/** Live avatar, title and favourite hero from `profiles` (a server without a column reads without it). */
async function fetchProfiles(ids: readonly string[]): Promise<Map<string, Omit<SeatServerData, 'record'>>> {
  const out = new Map<string, Omit<SeatServerData, 'record'>>();
  const c = supabaseClient();
  if (!c || ids.length === 0) return out;
  const read = (cols: string) => Promise.race([
    Promise.resolve(c.from('profiles').select(cols).in('user_id', [...ids]).limit(MAX_RECORD_IDS)),
    timeout(READ_TIMEOUT_MS, null),
  ]);
  try {
    let res = await read('user_id, favorite_hero, equipped_title_id, avatar');
    if (!res || res.error) res = await read('user_id, favorite_hero, equipped_title_id');
    if (!res || res.error) res = await read('user_id, favorite_hero');
    if (!res || res.error || !Array.isArray(res.data)) return out;
    for (const r of res.data as unknown as Array<Record<string, unknown>>) {
      if (typeof r.user_id !== 'string') continue;
      const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
      const fav = s(r.favorite_hero), title = s(r.equipped_title_id), avatar = s(r.avatar);
      out.set(r.user_id, { ...(fav ? { favoriteHero: fav } : {}), ...(title ? { titleId: title } : {}), ...(avatar ? { avatar } : {}) });
    }
  } catch { /* default art, no title */ }
  return out;
}

const sameSeatData = (a: SeatServerData, b: SeatServerData): boolean =>
  a.avatar === b.avatar && a.favoriteHero === b.favoriteHero && a.titleId === b.titleId
  && a.record?.wins === b.record?.wins && a.record?.losses === b.record?.losses;

/** The last answer per player, so a refresh never flashes the numbers back to 0. */
const seatCache = new Map<string, SeatServerData>();

/** For tests: forget every cached seat. */
export function resetSeatCacheForTests(): void { seatCache.clear(); }

/** Read the seats (and spectators) once, in one batch. Exported for the test (`fetchRecords` / `fetchProfiles` go through `supabaseClient`). */
export async function fetchSeatData(ids: readonly string[]): Promise<Map<string, SeatServerData>> {
  const wanted = [...new Set(ids.filter((u) => typeof u === 'string' && u.length > 0))].slice(0, MAX_RECORD_IDS);
  const [records, profiles] = await Promise.all([fetchRecords(wanted).catch(() => new Map<string, VersusRecord>()), fetchProfiles(wanted)]);
  for (const id of wanted) {
    const prev = seatCache.get(id);
    const rec = records.get(id);
    const next: SeatServerData = { ...prev, ...(profiles.get(id) ?? {}), ...(rec ? { record: rec } : {}) };
    // An unchanged answer keeps its object, so a re-read after a seat move never re-renders the room's cards
    // (R-VERSUS-ROOM-MOUNTED-01: the cards are memoised on this object).
    if (!prev || !sameSeatData(prev, next)) seatCache.set(id, next);
  }
  return new Map(wanted.map((id) => [id, seatCache.get(id)!] as const));
}

/**
 * The two seats' server data, re-read whenever `refreshKey` moves. The room passes a key built from the seated ids,
 * the room status and the last finished match, so the numbers refresh the moment a match ends and the players are
 * back in the room (no reload), and never per frame.
 */
export function useSeatData(ids: readonly string[], refreshKey: string): ReadonlyMap<string, SeatServerData> {
  const [data, setData] = useState<ReadonlyMap<string, SeatServerData>>(() => new Map(ids.flatMap((id) => (seatCache.has(id) ? [[id, seatCache.get(id)!] as const] : []))));
  useEffect(() => {
    let live = true;
    if (ids.length === 0) return undefined;
    void fetchSeatData(ids).then((m) => { if (live) setData(m); });
    return () => { live = false; };
    // `refreshKey` carries the ids (see the caller); the array itself is a new object every render.
  }, [refreshKey]);
  return data;
}
