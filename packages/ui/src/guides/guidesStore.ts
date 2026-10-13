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
 *   mineOwner   the user id `mine` and `team` belong to; null when they belong to nobody. Set wherever they are
 *               set, cleared wherever they are cleared.
 *   bookmarked  the published guides this account has bookmarked, newest first. Personal like `mine`: it belongs to
 *               `mineOwner`, is cleared with it, and is drawn only for that account.
 *   tab         which pill the Compendium Guides tab shows: Team Ascent, My guides, Bookmarked, Community or (the
 *               team only) Reports. Only the pill is held here: nothing about reports is ever in this store. The
 *               Compendium shows that pill only to a team account, and an account change resets it like any pill.
 *   pendingEdit a guide (by row id) the lobby rail asked the Compendium to open in the editor.
 *
 * A failed or empty read never replaces something already showing: one timed-out refresh must not reshuffle the
 * guides, and must not take a team member's Edit buttons away. An unchanged reload keeps the same arrays.
 *
 * WHO IS ASKING CAN CHANGE MID-READ. `loadGuides` is called on every identity change. A call that arrives while a
 * read for the SAME identity is in flight joins it; one for a DIFFERENT identity queues exactly one re-read, so a
 * sign-in that lands mid-read is never answered with the guest's view.
 *
 * A CHANGE OF ACCOUNT CLEARS `team`, `mine`, `bookmarked`, `pendingEdit` AND THE `tab` pill AT ONCE, before any read answers and
 * whatever it answers, so signing out or switching account (even offline) never leaves the last account's private
 * guides or Edit buttons in the store. A read also drops the team/mine it fetched if the account changed while it
 * was in flight; the queued re-read fetches the right ones.
 *
 * `mine` IS ONLY EVER SHOWN TO ITS OWNER. The clearing above depends on `loadGuides` being called when the account
 * changes. So that a missed call can never show one account's private guides to another, the rail's snapshot and the
 * Compendium's My guides draw `mine` only while `mineOwner` is the signed-in account's user id, and `guideSaved`
 * keeps a player's guide only when its author is the account at the keyboard (a save can land after its author left).
 * `team` and `bookmarked` belong to `mineOwner` in the same way, so nothing may make an account the owner while they
 * still hold the last account's: when `guideSaved` or `guideBookmarked` files something for an account that did not
 * already hold the lists, the guides, the bookmarks and the team flag held for the last account all go. A screen that
 * draws team-only buttons reads `team` only while `mineOwner` is the signed-in account, as it reads `mine`.
 *
 * A READ NEVER UNDOES A LOCAL CHANGE. `guideSaved`, `guideBookmarked` and `guideDeleted` bump a counter; a read that was already in
 * flight when one landed applies only `capability` and asks for one fresh read, so a stale answer cannot overwrite it.
 * `rereadGuides` bumps the same counter for a change the store was not told the result of (the team hid a guide), so
 * the read it asks for never settles for one that began before the change.
 *
 * THE RAIL DOES NOT SUBSCRIBE to `list` or `mine`. It reads them when its Guides view opens (LobbyPanel), so a
 * refresh that lands while the player is reading never moves a card under them. The Compendium does subscribe.
 *
 * WHAT COUNTS AS "THE SAME GUIDE". Publishing, hiding and bookmark counts change a row without bumping its revision.
 * So an unchanged list is one whose guides match on row id, revision, published, hidden AND bookmark count; anything
 * else replaces the array, and the open Compendium redraws.
 *
 * BACK ONLINE. A game that loaded with no connection hears the browser's `online` event and reads again.
 */
import { create } from 'zustand';
import { currentIdentity } from '../identity';
import { GUIDES, toGuide, type Guide } from './guides';
import { fetchBookmarkedGuides, fetchMyGuides, fetchOfficialGuides, fetchTeamFlag } from './guidesRemote';

export type GuidesCapability = 'unknown' | 'no-backend' | 'off' | 'offline' | 'on';
export type GuidesTab = 'team' | 'mine' | 'bookmarked' | 'community' | 'reports';

interface GuidesStore {
  capability: GuidesCapability;
  list: readonly Guide[];
  source: 'bundled' | 'server';
  team: boolean;
  mine: readonly Guide[];
  bookmarked: readonly Guide[];
  mineOwner: string | null;
  tab: GuidesTab;
  pendingEdit: string | null;
}

const NO_GUIDES: readonly Guide[] = [];
const INITIAL: GuidesStore = { capability: 'unknown', list: GUIDES, source: 'bundled', team: false, mine: NO_GUIDES, bookmarked: NO_GUIDES, mineOwner: null, tab: 'team', pendingEdit: null };

export const useGuides = create<GuidesStore>(() => ({ ...INITIAL }));

const sameList = (a: readonly Guide[], b: readonly Guide[]): boolean =>
  a.length === b.length && a.every((g, i) => {
    const o = b[i]!;
    return g.rowId === o.rowId && g.revision === o.revision && g.published === o.published && g.hidden === o.hidden && g.bookmarkCount === o.bookmarkCount;
  });

/** Who a read is for: the account, and whether it is a guest. */
const identityKey = (): string => {
  const id = currentIdentity();
  return id ? `${id.userId}:${id.anonymous ? 'guest' : 'account'}` : '';
};

/** Bumped by every local save, bookmark or delete, so a read that was in flight across one knows its answer is stale. */
let localChanges = 0;
/** The identity key the store's `team`, `mine` and `bookmarked` belong to. */
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
  let bookmarkedRecs: Awaited<ReturnType<typeof fetchBookmarkedGuides>>;
  if (id && !id.anonymous) {
    [team, mineRecs, bookmarkedRecs] = await Promise.all([fetchTeamFlag(id.userId), fetchMyGuides(id.userId), fetchBookmarkedGuides(id.userId)]);
  }

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
      // What the store holds now is this account's or empty (an account change cleared it before this read began).
      next.mineOwner = id.userId;
      if (team !== undefined) next.team = team;
      if (mineRecs !== undefined) {
        const guides = mineRecs.map(toGuide).filter((g): g is Guide => g !== null);
        next.mine = sameList(cur.mine, guides) ? cur.mine : guides;
      }
      if (bookmarkedRecs !== undefined) {
        const guides = bookmarkedRecs.map(toGuide).filter((g): g is Guide => g !== null);
        next.bookmarked = sameList(cur.bookmarked, guides) ? cur.bookmarked : guides;
      }
    } else {
      next.team = false;
      next.mine = NO_GUIDES;
      next.bookmarked = NO_GUIDES;
      next.mineOwner = null;
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
    if (s.team || s.mine.length > 0 || s.bookmarked.length > 0 || s.mineOwner !== null || s.pendingEdit !== null || s.tab !== 'team') {
      useGuides.setState({ team: false, mine: NO_GUIDES, bookmarked: NO_GUIDES, mineOwner: null, pendingEdit: null, tab: 'team' });
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

/**
 * Read again after this account changed guides on the server in a way the store was not told (the team hid, unhid or
 * deleted one, or the answer to such a change was lost). A read that is already in flight began BEFORE the change, so
 * its answer may be the old state: it is marked stale, as a local save marks it, and one fresh read follows it. With
 * no read in flight this is one ordinary read.
 */
export function rereadGuides(): Promise<void> {
  localChanges++;
  return loadGuides();
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

/**
 * Apply a guide the server just saved, without a re-read.
 *
 * A player's guide is private to its author, and a save can land after the author has left (Save on a slow connection,
 * then a sign-out or another account signing in). So a player's guide is kept only when its author is the account at
 * the keyboard right now: never for another account, a guest, or nobody. It also never joins guides the store still
 * holds for a different account.
 */
export function guideSaved(g: Guide): void {
  if (!g.official) {
    const id = currentIdentity();
    if (!id || id.anonymous || g.authorId !== id.userId) return;
    localChanges++;
    const s = useGuides.getState();
    // The lists were not this account's (a missed read after an account change): nothing personal that was held for
    // the last account is handed over with `mineOwner`. Its guides, its bookmarks and its team flag all go.
    if (s.mineOwner !== id.userId) useGuides.setState({ mine: [g], bookmarked: NO_GUIDES, team: false, mineOwner: id.userId });
    else useGuides.setState({ mine: upsert(s.mine, g) });
    return;
  }
  localChanges++;
  const s = useGuides.getState();
  // A Team Ascent guide saved while the built-in copies are showing: the server now has one, so re-read.
  if (s.source === 'server') useGuides.setState({ list: upsert(s.list, g) });
  else void loadGuides();
}

/**
 * Apply a bookmark the server just confirmed, without a re-read: the guide goes first in the list with its new count,
 * or leaves it.
 *
 * A bookmark belongs to the account that PRESSED it, and the caller says who that was (`forUserId`, read before the
 * request went out). The answer can land after that account left (a slow connection, then a sign-out and another
 * account signing in), and the guide is someone else's, so unlike `guideSaved` the store cannot tell from the guide.
 * So it is applied only while that same signed-in account is still at the keyboard; otherwise it is dropped. Nothing is
 * lost: the server did record it, and the next read for the right account brings it back. It also never joins a list
 * the store still holds for another account.
 */
export function guideBookmarked(g: Guide, on: boolean, count: number, forUserId: string | null): void {
  const id = currentIdentity();
  if (!id || id.anonymous || id.userId !== forUserId) return;
  localChanges++;
  const s = useGuides.getState();
  const mineIsTheirs = s.mineOwner === id.userId;
  const rest = (mineIsTheirs ? s.bookmarked : NO_GUIDES).filter((x) => x.rowId !== g.rowId);
  useGuides.setState({
    bookmarked: on ? [{ ...g, bookmarkCount: count }, ...rest] : rest,
    mine: mineIsTheirs ? s.mine : NO_GUIDES,
    // The team flag belongs to `mineOwner` too: it is never handed to an account it was not read for.
    team: mineIsTheirs ? s.team : false,
    mineOwner: id.userId,
  });
}

/** Does the store hold `userId`'s own guides? False for nobody, and for guides read for any other account. */
export const ownsMine = (s: { mineOwner: string | null }, userId: string | null): boolean => userId !== null && s.mineOwner === userId;

/** Apply a delete the server just confirmed. */
export function guideDeleted(rowId: string): void {
  localChanges++;
  const s = useGuides.getState();
  useGuides.setState({ list: s.list.filter((g) => g.rowId !== rowId), mine: s.mine.filter((g) => g.rowId !== rowId), bookmarked: s.bookmarked.filter((g) => g.rowId !== rowId) });
}

export function resetGuidesForTests(): void {
  loading = null;
  loadingFor = '';
  again = false;
  localChanges = 0;
  ownerKey = '';
  useGuides.setState({ ...INITIAL });
}

// Back online: a game that loaded with no connection learns it now, without the Guides tab being reopened.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('online', () => { if (useGuides.getState().capability !== 'on') void loadGuides(); });
}
