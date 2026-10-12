/**
 * GUIDES: the client slice (2026-10-12). A small store of its OWN rather than more fields on the game store
 * (`store.ts` is a hot file): the game store only calls `loadGuides` when identity lands or changes.
 *
 *   capability  `unknown` until the first read answers; then `on`, `off` (asked, the migration has not run),
 *               `offline` (could not ask) or `no-backend` (no Supabase configured). Only `on` enables writing.
 *   list        the Team Ascent guides every screen filters with `guidesFor`. The BUILT-IN guides until the server
 *               answers with at least one usable guide, so a screen is never empty and never waits.
 *   source      which of the two `list` currently is.
 *   team        this account is on the guides team (may edit Team Ascent guides). False for a guest.
 *   mine        this account's own guides. Empty for a guest.
 *   tab         which pill the Compendium Guides tab shows: Team Ascent, or My guides.
 *   pendingEdit a guide (by row id) the lobby rail asked the Compendium to open in the editor.
 *
 * A failed or empty read never replaces something already showing: one timed-out refresh must not reshuffle the
 * guides, and must not take a team member's Edit buttons away. An unchanged reload keeps the same arrays.
 *
 * WHO IS ASKING CAN CHANGE MID-READ. `loadGuides` is called on every identity change. A call that arrives while a
 * read for the SAME identity is in flight joins it; one for a DIFFERENT identity queues exactly one re-read, so a
 * sign-in that lands mid-read is never answered with the guest's view.
 *
 * A CHANGE OF ACCOUNT CLEARS `team`, `mine`, `pendingEdit` AND THE `tab` pill AT ONCE, before any read answers and
 * whatever it answers, so signing out or switching account (even offline) never leaves the last account's private
 * guides or Edit buttons in the store. A read also drops the team/mine it fetched if the account changed while it
 * was in flight; the queued re-read fetches the right ones.
 *
 * A READ NEVER UNDOES A LOCAL CHANGE. `guideSaved` and `guideDeleted` bump a counter; a read that was already in
 * flight when one landed applies only `capability` and asks for one fresh read, so a stale answer cannot overwrite it.
 *
 * THE RAIL DOES NOT SUBSCRIBE to `list` or `mine`. It reads them when its Guides view opens (LobbyPanel), so a
 * refresh that lands while the player is reading never moves a card under them. The Compendium does subscribe.
 */
import { create } from 'zustand';
import { currentIdentity } from '../identity';
import { GUIDES, toGuide, type Guide } from './guides';
import { fetchMyGuides, fetchOfficialGuides, fetchTeamFlag } from './guidesRemote';

export type GuidesCapability = 'unknown' | 'no-backend' | 'off' | 'offline' | 'on';
export type GuidesTab = 'team' | 'mine';

interface GuidesStore {
  capability: GuidesCapability;
  list: readonly Guide[];
  source: 'bundled' | 'server';
  team: boolean;
  mine: readonly Guide[];
  tab: GuidesTab;
  pendingEdit: string | null;
}

const NO_GUIDES: readonly Guide[] = [];
const INITIAL: GuidesStore = { capability: 'unknown', list: GUIDES, source: 'bundled', team: false, mine: NO_GUIDES, tab: 'team', pendingEdit: null };

export const useGuides = create<GuidesStore>(() => ({ ...INITIAL }));

const sameList = (a: readonly Guide[], b: readonly Guide[]): boolean =>
  a.length === b.length && a.every((g, i) => g.rowId === b[i]!.rowId && g.revision === b[i]!.revision);

/** Who a read is for: the account, and whether it is a guest. */
const identityKey = (): string => {
  const id = currentIdentity();
  return id ? `${id.userId}:${id.anonymous ? 'guest' : 'account'}` : '';
};

/** Bumped by every local save or delete, so a read that was in flight across one knows its answer is stale. */
let localChanges = 0;
/** The identity key the store's `team` and `mine` belong to. */
let ownerKey = '';

async function readGuides(): Promise<void> {
  const key = identityKey();
  const id = currentIdentity();
  const changesAtStart = localChanges;
  const ans = await fetchOfficialGuides();
  if (ans.state !== 'on') {
    useGuides.setState({ capability: ans.state });
    return;
  }
  const server = ans.guides.map(toGuide).filter((g): g is Guide => g !== null);
  let team: boolean | undefined;
  let mineRecs: Awaited<ReturnType<typeof fetchMyGuides>>;
  if (id && !id.anonymous) [team, mineRecs] = await Promise.all([fetchTeamFlag(id.userId), fetchMyGuides(id.userId)]);

  // Apply time: everything below reads the store as it is NOW, after all the awaits.
  if (localChanges !== changesAtStart) {
    useGuides.setState({ capability: 'on' });
    again = true;
    return;
  }
  const cur = useGuides.getState();
  const next: Partial<GuidesStore> = { capability: 'on' };
  if (server.length > 0) {
    next.source = 'server';
    next.list = cur.source === 'server' && sameList(cur.list, server) ? cur.list : server;
  }
  if (identityKey() === key) {
    if (id && !id.anonymous) {
      if (team !== undefined) next.team = team;
      if (mineRecs !== undefined) {
        const guides = mineRecs.map(toGuide).filter((g): g is Guide => g !== null);
        next.mine = sameList(cur.mine, guides) ? cur.mine : guides;
      }
    } else {
      next.team = false;
      next.mine = NO_GUIDES;
    }
  }
  useGuides.setState(next);
}

let loading: Promise<void> | null = null;
let loadingFor = '';
let again = false;

/** Read the guides this account can see. Safe to call often. Never throws. */
export function loadGuides(): Promise<void> {
  const key = identityKey();
  if (key !== ownerKey) {
    ownerKey = key;
    const s = useGuides.getState();
    // The last account's flag, guides, pending edit request and pill all go. Skipped when they already hold their
    // cleared values (the first identity at boot), so boot makes no store write.
    if (s.team || s.mine.length > 0 || s.pendingEdit !== null || s.tab !== 'team') {
      useGuides.setState({ team: false, mine: NO_GUIDES, pendingEdit: null, tab: 'team' });
    }
  }
  if (loading) {
    if (key !== loadingFor) again = true;
    return loading;
  }
  loadingFor = key;
  loading = readGuides()
    .catch(() => { /* the reads never throw; this guards the mapping */ })
    .finally(() => {
      loading = null;
      if (again) { again = false; void loadGuides(); }
    });
  return loading;
}

export function setGuidesTab(tab: GuidesTab): void {
  useGuides.setState({ tab });
}

/** The rail asks the Compendium to open this guide in the editor. */
export function requestGuideEdit(rowId: string): void {
  useGuides.setState({ pendingEdit: rowId });
}

/** The Compendium takes the request (once). */
export function takePendingEdit(): string | null {
  const rowId = useGuides.getState().pendingEdit;
  if (rowId !== null) useGuides.setState({ pendingEdit: null });
  return rowId;
}

const upsert = (arr: readonly Guide[], g: Guide): Guide[] =>
  (arr.some((x) => x.rowId === g.rowId) ? arr.map((x) => (x.rowId === g.rowId ? g : x)) : [...arr, g]);

/** Apply a guide the server just saved, without a re-read. */
export function guideSaved(g: Guide): void {
  localChanges++;
  const s = useGuides.getState();
  if (!g.official) {
    useGuides.setState({ mine: upsert(s.mine, g) });
    return;
  }
  // A Team Ascent guide saved while the built-in copies are showing: the server now has one, so re-read.
  if (s.source === 'server') useGuides.setState({ list: upsert(s.list, g) });
  else void loadGuides();
}

/** Apply a delete the server just confirmed. */
export function guideDeleted(rowId: string): void {
  localChanges++;
  const s = useGuides.getState();
  useGuides.setState({ list: s.list.filter((g) => g.rowId !== rowId), mine: s.mine.filter((g) => g.rowId !== rowId) });
}

export function resetGuidesForTests(): void {
  loading = null;
  loadingFor = '';
  again = false;
  localChanges = 0;
  ownerKey = '';
  useGuides.setState({ ...INITIAL });
}
