import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import { GUIDE_LIMITS } from '@game/guides';
import { LazyCell, LazyRootProvider } from '../bookLazy';
import { sfx } from '../sfx';
import { toGuide, type Guide } from './guides';
import { communitySearch, fetchCommunityPage, type CommunityPage, type CommunitySort } from './guidesRemote';

/** How long the search box must rest before the server is asked. */
const SEARCH_PAUSE_MS = 300;

interface Listed {
  /** The question this list answers. */
  key: string;
  guides: readonly Guide[];
  /** How many rows the server has been asked for so far (the next page starts here). */
  next: number;
  more: boolean;
  status: 'loading' | 'ready' | 'failed';
}

const NO_GUIDES: readonly Guide[] = [];
/** A question that has not been answered yet. */
const unanswered = (key: string): Listed => ({ key, guides: NO_GUIDES, next: 0, more: false, status: 'loading' });

/**
 * THE COMMUNITY LIST: published player guides for the shown set, read from the server one page at a time.
 *
 * The question is the set, the tribe rule, the search text and the sort. When any of them changes, the list starts
 * again from the first page; "Show more guides" adds the next page. Pages live here, not in the guides store: they
 * answer one question and are thrown away when it changes.
 *
 * THE SORT IS THE HOST'S. This list is taken away while the editor is open (Duplicate) and drawn anew when it closes;
 * the host stays, so it holds the order the player chose and hands it back (`sort`, `onSort`).
 *
 * ONE QUESTION, ONE REQUEST. The request is made by an effect keyed on the question, so a redraw for any other reason
 * (a bookmark, the host's toolbar) asks nothing. Until a question is answered the list says it is loading: what is
 * held for an older question is never drawn, and never read as "no guides match".
 *
 * THE SAME QUESTION AGAIN (`refreshKey`). The host bumps it when the answer may have changed (the team hid, unhid or
 * deleted a guide). The list then asks the same question once more from the first page: one request per bump, none
 * when the list is first drawn, and the sort and filters are untouched. Unlike a new question, the guides already on
 * the screen STAY until the new answer lands and replaces them: the card that was just acted on may be showing the
 * sentence about it, and taking the cards away for a moment would throw that sentence away. If the list cannot be
 * read again, Try again asks for what failed (here, the first page again), as it does for a page that failed.
 *
 * A SLOW ANSWER NEVER WINS. Each ask takes a number; an answer is used only if no newer ask has been made since. So
 * typing, switching the sort or lighting a tribe pill mid-flight can never be undone by an older answer landing late.
 * Leaving the list counts as a newer ask, so an answer that lands after it is gone sets nothing. It is a counter, not
 * a flag: in development React mounts, unmounts and mounts the list again, and the second mount simply asks again.
 *
 * SEARCH WAITS FOR A PAUSE (300 ms), so typing a word asks once.
 *
 * The host draws each card (`renderCard`): which buttons a card shows, and whether it is bookmarked, is the host's
 * knowledge. This list is the only thing in the host's scroll box that provides the lazy root while it is shown (the
 * host's own list is not drawn then), so the two never nest.
 *
 * BY KEYBOARD. "Show more guides" and "Try again" are switched off or taken away while the server is asked, and a
 * browser then drops focus to the page. When the answer lands, focus goes back to whichever of the two is there, but
 * only if focus is still on the page itself: it is never pulled back from somewhere the player has moved to.
 *
 * PERFORMANCE: cards mount through `LazyCell` (the first two at once, the rest near the viewport); nothing animates;
 * no scroll listener; no layout is read.
 */
export const CommunityGuides = memo(function CommunityGuides({ setId, queryTribes, neutral, search, sort, onSort, refreshKey, root, renderCard }: {
  setId: SetId;
  /** Guides for any of these tribes... */
  queryTribes: readonly Tribe[];
  /** ...and, when true, guides for no tribe. */
  neutral: boolean;
  /** The Compendium's search box, as typed. */
  search: string;
  /** The order the player chose, held by the host. */
  sort: CommunitySort;
  /** The player chose another order. Must be stable. */
  onSort: (sort: CommunitySort) => void;
  /** Bumped by the host after a hide or a delete: ask again from the first page. Not part of the question. */
  refreshKey: number;
  /** The scroll box the lazy cells watch. */
  root: HTMLDivElement | null;
  renderCard: (g: Guide, eager: boolean) => JSX.Element;
}): JSX.Element {
  const [text, setText] = useState(() => communitySearch(search));
  useEffect(() => {
    const cleaned = communitySearch(search);
    const t = window.setTimeout(() => setText(cleaned), SEARCH_PAUSE_MS);
    return () => window.clearTimeout(t);
  }, [search]);

  const tribesKey = queryTribes.join(',');
  const key = `${setId}|${tribesKey}|${neutral ? 1 : 0}|${text}|${sort}`;
  const [held, setHeld] = useState<Listed>(() => unanswered(key));
  /** What is drawn: the held list only while it answers THIS question. */
  const list = held.key === key ? held : unanswered(key);

  const asks = useRef(0);
  useEffect(() => () => { asks.current += 1; }, []); // gone: no answer may be used

  /** The ask made last: the one Try again makes again. */
  const lastAsk = useRef({ offset: 0, keep: false });
  /** `keep`: the same question again from the first page (see the header): what is shown stays until it is answered. */
  const load = useCallback(async (offset: number, keep = false): Promise<void> => {
    asks.current += 1;
    const mine = asks.current;
    lastAsk.current = { offset, keep };
    setHeld((cur) => ((offset === 0 && !keep) || cur.key !== key ? unanswered(key) : { ...cur, status: 'loading' }));
    let page: CommunityPage | undefined;
    try {
      page = await fetchCommunityPage({ setId, tribes: tribesKey ? tribesKey.split(',') : [], neutral, search: text, sort, offset });
    } catch {
      page = undefined;
    }
    if (mine !== asks.current) return;
    if (!page) { setHeld((cur) => ({ ...(cur.key === key ? cur : unanswered(key)), status: 'failed' })); return; }
    const fresh = page.guides.map(toGuide).filter((g): g is Guide => g !== null);
    const hasMore = page.more;
    setHeld((cur) => {
      const kept = offset === 0 || cur.key !== key ? NO_GUIDES : cur.guides;
      const have = new Set(kept.map((g) => g.rowId));
      return { key, guides: [...kept, ...fresh.filter((g) => !have.has(g.rowId))], next: offset + GUIDE_LIMITS.communityPage, more: hasMore, status: 'ready' };
    });
  }, [key, setId, tribesKey, neutral, text, sort]);

  // A new question: start again from the first page. The same question again (`refreshKey` moved and the question did
  // not): the first page again, keeping what is shown until it is answered. One effect for both, so a render in which
  // both changed still asks once. `load` is the question: it is a new function exactly when the question is new.
  const askedWith = useRef<typeof load | null>(null);
  useEffect(() => {
    const sameQuestion = askedWith.current === load;
    askedWith.current = load;
    void load(0, sameQuestion);
  }, [load, refreshKey]);

  // By keyboard (see the header): focus back on Show more, or on Try again, once the answer has landed.
  const moreRef = useRef<HTMLButtonElement>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  const giveFocusBack = useRef(false);
  const status = list.status;
  useEffect(() => {
    if (status === 'loading' || !giveFocusBack.current) return;
    giveFocusBack.current = false;
    const at = document.activeElement;
    // Without scrolling: Show more is now below the guides it added, and the player is reading from where they were.
    if (!at || at === document.body) (moreRef.current ?? againRef.current)?.focus({ preventScroll: true });
  }, [status]);
  /** Ask for more (the next page, or the ask that failed) from a button that is about to go. */
  const askFor = (offset: number, keep = false): void => {
    giveFocusBack.current = true;
    void load(offset, keep);
  };

  const pick = (s: CommunitySort): void => { if (s !== sort) { sfx.tick(); onSort(s); } };
  const pill = { '--c': 'var(--ui-title)' } as CSSProperties;
  const shown = list.guides;
  return (
    <>
      <div className="gtool-pills gcomm-sort" role="group" aria-label="Order the Community guides">
        <button type="button" className={`book-runetribe${sort === 'bookmarked' ? ' on' : ''}`} style={pill} aria-pressed={sort === 'bookmarked'} onClick={() => pick('bookmarked')}>Most bookmarked</button>
        <button type="button" className={`book-runetribe${sort === 'newest' ? ' on' : ''}`} style={pill} aria-pressed={sort === 'newest'} onClick={() => pick('newest')}>Newest</button>
      </div>
      {shown.length === 0 && status === 'loading' && <p className="gtool-note gcomm-note" role="status">Loading the Community guides.</p>}
      {shown.length === 0 && status === 'ready' && (
        <div className="book-empty gtool-empty">No Community guides match. Publish one of yours from My guides to be the first.</div>
      )}
      {shown.length > 0 && (
        <LazyRootProvider root={root}>
          {shown.map((g, i) => (
            <LazyCell key={g.id} eager={i < 2} className="bookguide-slot">{() => renderCard(g, i < 2)}</LazyCell>
          ))}
        </LazyRootProvider>
      )}
      {/* Below the guides, where Show more was pressed: a page that could not be read is said there, not far above. */}
      {status === 'failed' && (
        <p className="gtool-note gcomm-note" role="alert">
          <span>Could not load the Community guides.</span>
          <button type="button" className="gbtn" ref={againRef} onClick={() => askFor(lastAsk.current.offset, lastAsk.current.keep)}>Try again</button>
        </p>
      )}
      {shown.length > 0 && list.more && status !== 'failed' && (
        <div className="gcomm-more">
          <button type="button" className="gbtn" ref={moreRef} disabled={status === 'loading'} onClick={() => askFor(list.next)}>Show more guides</button>
        </div>
      )}
    </>
  );
});
