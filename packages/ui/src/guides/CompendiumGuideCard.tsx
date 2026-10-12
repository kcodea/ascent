import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import type { RunState } from '@game/sim';
import { guideMissingIds, type Guide } from './guides';
import { GuideEmblem, GuideText, GuideTribes, GuideUnits, guideAccent, guideCardIds, guideChips, useGuideViews } from './GuideParts';

/**
 * ONE GUIDE IN THE COMPENDIUM: the big card every list of the Guides tab draws (Team Ascent, My guides, Bookmarked,
 * Community), with the buttons this account is offered on it.
 *
 * WHO IS OFFERED WHAT is decided by the host and handed in as flags; the server is what refuses a write.
 *  - `editable`: Edit.            - `own`: Publish or Unpublish, and Delete (the player's own guide).
 *  - `canBookmark`: Bookmark.     - Duplicate is on every card.
 *
 * AN ACTION ANSWERS A SENTENCE OR NOTHING. `onPublish`, `onDelete` and `onBookmark` resolve to null when they worked,
 * or to the sentence the player reads, which is shown on this card. The card keeps only its own small state: which
 * question it is asking, whether it is waiting, and that sentence. While it is waiting none of its buttons can be
 * pressed, so nothing is sent twice.
 *
 * Publishing makes a guide public, and deleting cannot be undone, so both ask first, on the card. Unpublish and
 * Bookmark do not.
 *
 * A QUESTION, BY KEYBOARD. When a question appears, focus goes to its safe answer (Cancel, Keep it). When it is
 * answered, focus goes back to the button it came from: at once for the safe answer, and when the server has answered
 * for the other one (the card's buttons cannot take focus while it waits). The Publish button and the Unpublish button
 * are one button, so after a publish focus is on Unpublish. Focus is never pulled back from somewhere else the player
 * has moved to meanwhile.
 *
 * PERFORMANCE: memoized, with stable callbacks from the host; portraits are the memoized `Card` fed stabilized views.
 * Nothing animates and no layout is read.
 */
export const CompendiumGuideCard = memo(function CompendiumGuideCard({
  guide, tribes, run, setId, mineTab, writable, editable, own, canBookmark, bookmarked, onEdit, onDuplicate, onPublish, onDelete, onBookmark,
}: {
  guide: Guide; tribes: readonly Tribe[]; run: RunState | undefined; setId: SetId;
  /** Under My guides, a guide wears its state (Private, Published, Hidden, Not in this set). */
  mineTab: boolean;
  /** Guides can be written right now (the capability is on). */
  writable: boolean;
  /** This account may edit this guide. */
  editable: boolean;
  /** This account wrote this guide (never true for a Team Ascent guide). */
  own: boolean;
  /** This account could bookmark this guide: someone else's published guide. A guest is offered it and asked to sign in. */
  canBookmark: boolean;
  bookmarked: boolean;
  onEdit: (g: Guide) => void;
  onDuplicate: (g: Guide) => void;
  onPublish: (g: Guide, on: boolean) => Promise<string | null>;
  onDelete: (g: Guide) => Promise<string | null>;
  onBookmark: (g: Guide, on: boolean) => Promise<string | null>;
}): JSX.Element {
  const chips = guideChips(guide, tribes);
  const ids = useMemo(() => guideCardIds(guide), [guide]);
  const { views, refs } = useGuideViews(ids, run);
  const missing = useMemo(() => guideMissingIds(guide, setId), [guide, setId]);
  const [ask, setAsk] = useState<'publish' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLElement>(null);
  /** The Publish button, which is the Unpublish button once the guide is published. */
  const publishRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  /** The safe answer of the question being asked (Cancel, Keep it). */
  const safeRef = useRef<HTMLButtonElement>(null);
  /** The button the last question came from: where focus goes back to once that question is answered. */
  const opener = useRef<'publish' | 'delete' | null>(null);
  // Set on mount as well as cleared on unmount: in development React mounts, unmounts and mounts a card again, and a
  // flag that is only ever cleared would leave the card waiting for good.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  /** A question is only drawn on a guide this account still owns (it goes when the account does). */
  const asking = own ? ask : null;

  // A question, by keyboard (see the header).
  useEffect(() => {
    if (asking) { safeRef.current?.focus(); return; }
    if (busy || !opener.current) return;
    const back = opener.current === 'publish' ? publishRef.current : deleteRef.current;
    opener.current = null;
    const at = document.activeElement;
    if (!at || at === document.body || cardRef.current?.contains(at)) back?.focus();
  }, [asking, busy]);

  /** Ask before publishing or deleting. */
  const question = (kind: 'publish' | 'delete'): void => {
    opener.current = kind;
    setError(null);
    setAsk(kind);
  };
  /** Run one action: wait, then show its sentence if it has one. Nothing is set once the card is gone. */
  const perform = async (action: () => Promise<string | null>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setAsk(null);
    let said: string | null;
    try { said = await action(); } catch { said = 'Something went wrong. Nothing was changed.'; }
    if (!alive.current) return;
    setBusy(false);
    setError(said);
  };

  const badges: string[] = [];
  if (mineTab) {
    if (guide.hidden) badges.push('Hidden by Team Ascent');
    else badges.push(guide.published ? 'Published' : 'Private');
    if (!guide.sets.includes(setId)) badges.push('Not in this set');
  }
  if (!guide.official && guide.published && guide.bookmarkCount > 0) badges.push(`${guide.bookmarkCount} bookmark${guide.bookmarkCount === 1 ? '' : 's'}`);

  return (
    <article className="bookguide" data-guide={guide.id} style={guideAccent(chips)} aria-label={guide.title} aria-busy={busy ? true : undefined} ref={cardRef}>
      <header className="bookguide-head">
        <GuideEmblem guide={guide} chips={chips} />
        <div className="bookguide-headtext">
          <h3 className="bookguide-title">{guide.title}</h3>
          <div className="bookguide-tribes"><GuideTribes chips={chips} /></div>
          <div className="bookguide-tagline">{guide.tagline}</div>
          <div className="bookguide-by">
            <span>by {guide.byline}</span>
            {guide.forkedTitle && <span className="bookguide-fork">Based on {guide.forkedTitle}{guide.forkedByline ? ` by ${guide.forkedByline}` : ''}</span>}
            {badges.map((b) => <span className="bookguide-badge" key={b}>{b}</span>)}
          </div>
        </div>
        <div className="bookguide-actions">
          {canBookmark && (
            <button type="button" className={`gbtn${bookmarked ? ' on' : ''}`} aria-pressed={bookmarked} disabled={!writable || busy}
              aria-label={bookmarked ? `Remove the bookmark on ${guide.title}` : `Bookmark ${guide.title}`}
              onClick={() => void perform(() => onBookmark(guide, !bookmarked))}>{bookmarked ? 'Bookmarked' : 'Bookmark'}</button>
          )}
          {editable && <button type="button" className="gbtn" aria-label={`Edit ${guide.title}`} disabled={busy} onClick={() => onEdit(guide)}>Edit</button>}
          <button type="button" className="gbtn" aria-label={`Duplicate ${guide.title}`} disabled={!writable || busy} onClick={() => onDuplicate(guide)}>Duplicate</button>
          {/* One button in one place, whichever word it wears: focus stays on it across a publish. */}
          {own && (guide.published
            ? <button type="button" className="gbtn" ref={publishRef} aria-label={`Unpublish ${guide.title}`} disabled={!writable || busy} onClick={() => void perform(() => onPublish(guide, false))}>Unpublish</button>
            : <button type="button" className="gbtn" ref={publishRef} aria-label={`Publish ${guide.title}`} disabled={!writable || busy || guide.hidden}
                aria-description={guide.hidden ? 'Team Ascent has hidden this guide. It cannot be published.' : undefined}
                onClick={() => question('publish')}>Publish</button>)}
          {own && <button type="button" className="gbtn" ref={deleteRef} aria-label={`Delete ${guide.title}`} disabled={!writable || busy} onClick={() => question('delete')}>Delete</button>}
        </div>
      </header>
      {asking === 'publish' && (
        <p className="gtool-note bookguide-ask" role="group" aria-label="Publish this guide">
          <span>Publish this guide? Everyone will be able to read it.</span>
          <button type="button" className="gbtn gbtn-primary" onClick={() => void perform(() => onPublish(guide, true))}>Publish</button>
          <button type="button" className="gbtn" ref={safeRef} onClick={() => setAsk(null)}>Cancel</button>
        </p>
      )}
      {asking === 'delete' && (
        <p className="gtool-note bookguide-ask" role="group" aria-label="Delete this guide">
          <span>Delete this guide? It cannot be brought back.</span>
          <button type="button" className="gbtn gbtn-danger" onClick={() => void perform(() => onDelete(guide))}>Delete for good</button>
          <button type="button" className="gbtn" ref={safeRef} onClick={() => setAsk(null)}>Keep it</button>
        </p>
      )}
      {error && <p className="gtool-note bookguide-ask" role="alert">{error}</p>}
      <div className="bookguide-body">
        <GuideText guide={guide} ids={ids} views={views} refs={refs} missing={missing} />
        {/* Core, then Enablers on its own line below (owner 2026-10-09: "always have core + enablers on different
            lines"). */}
        <GuideUnits label="Core" ids={guide.core} views={views} refs={refs} missing={missing} />
        {guide.enablers.length > 0 && <GuideUnits label="Enablers" ids={guide.enablers} views={views} refs={refs} missing={missing} />}
      </div>
    </article>
  );
});
