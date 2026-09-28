/**
 * SKINS v1 (owner 2026-09-28): the ONE place a hero portrait or a minion's art is swapped for a skin.
 *
 * WHOSE SKINS. Every surface belongs to somebody:
 *   - YOUR run (shop, hand, board, Discover, your combat row, your portrait, the end screen): the skins RECORDED on
 *     the run when it started (`run.cosmetics`). A replay renders the same RunState, so it shows what you wore then.
 *   - Before a run (hero select, the Minion Book from the title, Collection): your LIVE loadout.
 *   - AN OPPONENT (their combat row, their portrait on the seat list / combat / wipe / recap, the scouted board, a
 *     Career page that is not yours): the snapshot recorded for THEIR run (the lobby seat's / board's `cosmetics`),
 *     passed through `useOpponentSkins`, which blanks it when "Show opponent skins" is off. That setting never
 *     touches your own skins (owner: "this is an opponent toggle only").
 *
 * WHAT CAN RENDER. `heroSkinOf` / `minionSkinOf` (@game/progression) return a skin only when it is LIVE (known,
 * active, category enabled, not switched off by the server) and made for THAT hero / card. Anything else, an
 * unknown id from a newer client, a retired item, a missing art file, a token, is default art. Never a throw.
 *
 * PERFORMANCE (docs/performance.md). A snapshot resolves ONCE into a `cardId -> url` map, cached per snapshot
 * object and catalog epoch, and handed to every `Card` below through context. `Card` does one `Map.get`; `Unit`'s
 * memo comparator is untouched (the skin is not a prop), and the context value is referentially stable, so a
 * provider re-render never cascades into the board.
 */
import { createContext, useContext } from 'react';
import { heroSkinOf, minionSkinOf, catalogStateEpoch, type CosmeticDef, type RunCosmeticSnapshot } from '@game/progression';
import { heroArt, skinArt } from '../art';

/** A skin's art url, or undefined when its file is missing (the caller falls back to default art). */
export const skinArtOf = (def: CosmeticDef | null | undefined): string | undefined => (def ? skinArt(def.assets.art) : undefined);

/** A hero's portrait under a snapshot: the live skin's art, else the hero's own art. */
export function heroPortrait(heroId: string | null | undefined, snapshot: RunCosmeticSnapshot | null | undefined): string | undefined {
  if (!heroId) return undefined;
  return skinArtOf(heroSkinOf(snapshot, heroId)) ?? heroArt(heroId);
}

export type MinionSkinMap = ReadonlyMap<string, string>;
const EMPTY: MinionSkinMap = new Map();

/**
 * CONTENT-KEYED, not identity-keyed. The reducer `structuredClone`s the whole RunState on every dispatch, so
 * `run.cosmetics` and every seat's `cosmetics` are NEW objects after each shop click with the SAME content. Keyed
 * by identity, every click would rebuild the map, change the context value and re-render every Card on screen.
 * Keyed by content, a clone resolves to the map (and, through `internSnapshot`, the object) it already had.
 * Both caches are tiny (a handful of distinct loadouts per session) and capped anyway.
 */
const CACHE_CAP = 256;
const keyOf = (s: RunCosmeticSnapshot): string => JSON.stringify([s.heroSkinByHeroId ?? null, s.minionSkinByCardId ?? null, s.heroAttack ?? null]);
const interned = new Map<string, RunCosmeticSnapshot>();
const mapCache = new Map<string, { epoch: number; map: MinionSkinMap }>();

/** One canonical object per snapshot CONTENT: a store selector that returns it is stable across clones, so a
 *  component subscribed to `run.cosmetics` re-renders only when the skins actually change. */
export function internSnapshot(snapshot: RunCosmeticSnapshot | null | undefined): RunCosmeticSnapshot | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const k = keyOf(snapshot);
  const hit = interned.get(k);
  if (hit) return hit;
  if (interned.size >= CACHE_CAP) interned.clear();
  interned.set(k, snapshot);
  return snapshot;
}

/** The `cardId -> skin art url` map a snapshot resolves to, cached per snapshot CONTENT + catalog epoch. */
export function minionSkinMap(snapshot: RunCosmeticSnapshot | null | undefined): MinionSkinMap {
  const byCard = snapshot?.minionSkinByCardId;
  if (!snapshot || !byCard || typeof byCard !== 'object') return EMPTY;
  const epoch = catalogStateEpoch();
  const k = JSON.stringify(byCard);
  const hit = mapCache.get(k);
  if (hit && hit.epoch === epoch) return hit.map;
  const m = new Map<string, string>();
  for (const cardId of Object.keys(byCard)) {
    const url = skinArtOf(minionSkinOf(snapshot, cardId));
    if (url) m.set(cardId, url);
  }
  const map = m.size ? m : EMPTY;
  if (mapCache.size >= CACHE_CAP) mapCache.clear();
  mapCache.set(k, { epoch, map });
  return map;
}

export const MinionSkinContext = createContext<MinionSkinMap>(EMPTY);

/** What `Card` reads: the skin map of the nearest `MinionSkins` scope (empty = default art everywhere). */
export const useMinionSkinMap = (): MinionSkinMap => useContext(MinionSkinContext);

