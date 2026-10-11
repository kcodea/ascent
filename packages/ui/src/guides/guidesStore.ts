/**
 * GUIDES: the client slice (2026-10-12). A small store of its OWN rather than more fields on the game store
 * (`store.ts` is a hot file): the game store only calls `loadGuides` when identity lands or changes.
 *
 *   capability  `unknown` until the first read answers; then `on`, `off` (asked, the migration has not run),
 *               `offline` (could not ask) or `no-backend` (no Supabase configured).
 *   list        the Team Ascent guides every screen filters with `guidesFor`. The BUILT-IN guides until the server
 *               answers with at least one usable guide, so a screen is never empty and never waits.
 *   source      which of the two `list` currently is.
 *
 * A failed or empty read never replaces a list that is already showing: one timed-out refresh must not reshuffle
 * the guides mid-session. An unchanged reload keeps the same array, so no screen re-renders.
 *
 * THE RAIL DOES NOT SUBSCRIBE. It reads `useGuides.getState().list` when its Guides view opens (LobbyPanel), so a
 * refresh that lands while the player is reading never moves a card under them. The Compendium does subscribe.
 */
import { create } from 'zustand';
import { GUIDES, toGuide, type Guide } from './guides';
import { fetchOfficialGuides } from './guidesRemote';

export type GuidesCapability = 'unknown' | 'no-backend' | 'off' | 'offline' | 'on';

interface GuidesStore {
  capability: GuidesCapability;
  list: readonly Guide[];
  source: 'bundled' | 'server';
}

const INITIAL: GuidesStore = { capability: 'unknown', list: GUIDES, source: 'bundled' };

export const useGuides = create<GuidesStore>(() => ({ ...INITIAL }));

const sameList = (a: readonly Guide[], b: readonly Guide[]): boolean =>
  a.length === b.length && a.every((g, i) => g.rowId === b[i]!.rowId && g.revision === b[i]!.revision);

let loading: Promise<void> | null = null;

/** Read the official guides. Safe to call often: concurrent calls share one request. Never throws. */
export function loadGuides(): Promise<void> {
  if (loading) return loading;
  loading = (async (): Promise<void> => {
    const ans = await fetchOfficialGuides();
    if (ans.state !== 'on') {
      useGuides.setState({ capability: ans.state });
      return;
    }
    const server = ans.guides.map(toGuide).filter((g): g is Guide => g !== null);
    if (server.length === 0) {
      useGuides.setState({ capability: 'on' });
      return;
    }
    const cur = useGuides.getState();
    useGuides.setState({ capability: 'on', source: 'server', list: cur.source === 'server' && sameList(cur.list, server) ? cur.list : server });
  })().catch(() => { /* fetchOfficialGuides never throws; this guards the mapping */ }).finally(() => { loading = null; });
  return loading;
}

export function resetGuidesForTests(): void {
  loading = null;
  useGuides.setState({ ...INITIAL });
}
