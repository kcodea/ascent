/**
 * WHO IS WATCHING ME (owner 2026-10-15: "can we add something in the ui for a player in the top left if a spectator
 * joins? it can show their portrait and name and say spectating?"; R-SPECTATE-WATCHERS-01).
 *
 * The PLAYER's list of the people spectating their game, for the top-left indicator (`WatchersBadge`). Fed from the
 * watcher rows only, never from anything a spectator broadcasts: Versus from the room's `versus_members` (role
 * 'spectator'), a live ranked lobby game from `lobby_live_watchers` (its display name and profile, via the
 * `lobby_live_watchers` RPC). Set only when the list CHANGES (join / leave), so the indicator re-renders on that alone.
 */
import { create } from 'zustand';
import { currentRunCosmetics, useGame } from '../store';

export interface Watcher {
  id: string;
  /** Their display name ('' when they have none: the indicator says "Spectator"). */
  name: string;
  /** Their profile (`avatar`, `cosmetics`), as a Versus room member's. */
  profile: Record<string, unknown> | null;
}

export const useWatchers = create<{ list: Watcher[] }>(() => ({ list: [] }));

const keyOf = (list: readonly Watcher[]): string => list.map((w) => `${w.id}\u0001${w.name}\u0001${JSON.stringify(w.profile ?? null)}`).join('\u0002');

/** `next` in a STABLE order: people already shown keep their place, newcomers join at the end (a read that comes back
 *  in another order never reshuffles the plates). Pure. */
export function stableOrder(prev: readonly Watcher[], next: readonly Watcher[]): Watcher[] {
  const at = new Map(prev.map((w, i) => [w.id, i]));
  return next.map((w, i) => ({ w, k: at.has(w.id) ? at.get(w.id)! : prev.length + i })).sort((a, b) => a.k - b.k).map((x) => x.w);
}

/** Replace the list (a no-op when nothing about it changed: no re-render). */
export function setWatchers(list: readonly Watcher[]): void {
  const cur = useWatchers.getState().list;
  const next = stableOrder(cur, list);
  if (keyOf(next) === keyOf(cur)) return;
  useWatchers.setState({ list: next });
}

/** The name the indicator shows for a watcher. */
export const watcherName = (w: Pick<Watcher, 'name'>): string => w.name.trim() || 'Spectator';

/** `n` watchers whose rows carry no identity (an older server): a plain "Spectator" each, never a guess. */
export const anonymousWatchers = (n: number): Watcher[] => Array.from({ length: Math.max(0, n) }, (_, i) => ({ id: `anon:${i}`, name: '', profile: null }));

/**
 * The watcher's own identity, sent when they start watching a live game: their name (or '' with none) and the profile
 * a Versus room member carries (avatar, equipped cosmetics for the frame), capped like the room profile (4 KB): the
 * per-minion skins go first, then the whole snapshot.
 */
export function myWatcherIdentity(): { name: string; profile: Record<string, unknown> } {
  const g = useGame.getState();
  const profile: Record<string, unknown> = g.playerAvatar ? { avatar: g.playerAvatar } : {};
  const cos = currentRunCosmetics();
  if (cos) {
    const fits = (c: unknown): boolean => JSON.stringify({ ...profile, cosmetics: c }).length <= 3800;
    const lean = { ...cos, minionSkinByCardId: undefined };
    if (fits(cos)) profile.cosmetics = cos;
    else if (fits(lean)) profile.cosmetics = lean;
  }
  return { name: (g.playerName ?? '').trim(), profile };
}
