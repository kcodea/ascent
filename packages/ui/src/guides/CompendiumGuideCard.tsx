import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject, type RefObject } from 'react';
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import { GUIDE_LIMITS, REPORT_REASONS, type ReportReason } from '@game/guides';
import type { RunState } from '@game/sim';
import { guideMissingIds, type Guide } from './guides';
import { guideErrorMessage } from './guideMessages';
import { GuideEmblem, GuideText, GuideTribes, GuideUnits, guideAccent, guideCardIds, guideChips, useGuideViews } from './GuideParts';

/** A question a card asks on itself. */
type Ask = 'publish' | 'delete' | 'report' | 'hide';
/** A button of the card that focus can go back to. */
type Opener = Ask | 'bookmark';

const REASON_LABEL: Readonly<Record<ReportReason, string>> = { offensive: 'Offensive', spam: 'Spam', impersonation: 'Impersonation', other: 'Other' };
/** What the server says when this account has already reported the guide: the card then reads Reported. */
const ALREADY = guideErrorMessage('already_reported', undefined, { action: 'report' });
/** The reason pills wear the Compendium's pill in the title colour, like the host's own pills. */
const PILL = { '--c': 'var(--ui-title)' } as CSSProperties;

/** A report as far as it has been written: its reason (needed to send) and its note. */
interface ReportDraft { reason: ReportReason | null; note: string }
const noReport = (): ReportDraft => ({ reason: null, note: '' });

/**
 * THE REPORT FORM of one card: the four reasons, the note, Send report and Cancel.
 *
 * It is its own component so that choosing a reason or typing in the note redraws these few controls and not the
 * whole card (the write-up and the portraits). It owns what is on the screen; the card owns what is KEPT (`kept`, a
 * ref): the form starts from it when it is drawn and writes every change to it, which redraws nothing. That is how
 * the reason and the note survive the form being taken away while a send is on its way and come back with it when
 * the send is refused. The card empties `kept` when the report is cancelled, sent, or was already sent.
 *
 * The row wraps (`.gtool-note`). The text box is the editor's (`.gedit-input`, guideEditor.css, which the host loads
 * with the editor, as it does `.gbtn`): full width, so it takes a row of its own inside the card.
 */
function ReportForm({ kept, writable, firstRef, sendRef, onSend, onCancel }: {
  kept: MutableRefObject<ReportDraft>;
  /** Guides can be written right now: without it nothing can be sent. */
  writable: boolean;
  firstRef: RefObject<HTMLButtonElement>;
  sendRef: RefObject<HTMLButtonElement>;
  onSend: (reason: ReportReason, note: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [draft, setDraft] = useState<ReportDraft>(() => kept.current);
  const change = (next: ReportDraft): void => { kept.current = next; setDraft(next); };
  const { reason, note } = draft;
  return (
    <div className="gtool-note bookguide-ask" role="group" aria-label="Report this guide">
      <span>Why are you reporting this guide?</span>
      {REPORT_REASONS.map((r, i) => (
        <button type="button" key={r} ref={i === 0 ? firstRef : undefined} className={`book-runetribe${reason === r ? ' on' : ''}`} style={PILL}
          aria-pressed={reason === r} onClick={() => change({ reason: r, note })}>{REASON_LABEL[r]}</button>
      ))}
      <input className="gedit-input" value={note} maxLength={GUIDE_LIMITS.reportNote} placeholder="Anything the team should know (optional)"
        aria-label="A note for the team (optional)" onChange={(e) => change({ reason, note: e.target.value })} />
      <button type="button" className="gbtn gbtn-primary" ref={sendRef} disabled={reason === null || !writable}
        onClick={() => { if (reason) onSend(reason, note); }}>Send report</button>
      <button type="button" className="gbtn" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/**
 * ONE GUIDE IN THE COMPENDIUM: the big card every list of the Guides tab draws (Team Ascent, My guides, Bookmarked,
 * Community), with the buttons this account is offered on it.
 *
 * WHO IS OFFERED WHAT is decided by the host and handed in as flags; the server is what refuses a write.
 *  - `editable`: Edit.            - `own`: Publish or Unpublish, and Delete (the player's own guide).
 *  - `canBookmark`: Bookmark.     - Duplicate is on every card.
 *  - `canReport`: Report.         - `moderate`: Hide or Unhide, and Delete (the team, on a player's guide).
 *
 * AN ACTION ANSWERS A SENTENCE OR NOTHING. `onPublish`, `onDelete`, `onBookmark`, `onReport` and `onHide` resolve to
 * null when they worked, or to the sentence the player reads, which is shown on this card. The card keeps only its own
 * small state: which question it is asking, whether it is waiting, that sentence, and the report being written. While
 * it is waiting none of its buttons can be pressed, so nothing is sent twice.
 *
 * Publishing makes a guide public, deleting cannot be undone, and hiding takes a guide away from everyone but its
 * author and the team, so all three ask first, on the card. Unpublish, Unhide and Bookmark do not.
 *
 * A REPORT IS A SMALL FORM ON THE CARD: one of four reasons (needed) and a note (optional, limited). A guest is asked
 * to sign in BEFORE the form opens (`signedIn`, `onNeedSignIn`). Once a report has been sent, or the server says this
 * account had already sent one, the button reads Reported and cannot be pressed again. That is this card's own
 * knowledge (the server is what refuses a second report), and the host draws a new card when the account changes, so
 * it is never shown to another account. Send report cannot be pressed while guides cannot be written: the card says
 * thank you only for a report that was sent.
 *
 * A REFUSED REPORT KEEPS WHAT WAS TYPED. The form is taken away while a send is on its way, like every question. If
 * the send is refused (no connection, too many reports today, anything but "already reported"), the form comes back
 * with the reason and the note as they were, and the sentence about the refusal under it: trying again is one press.
 * What was typed is forgotten when the report is cancelled, when it is sent, and when the server says it was already
 * sent, so a form opened after any of those starts empty. The form is `ReportForm`, above.
 *
 * A QUESTION GOES WHEN ITS OFFER DOES, FOR GOOD. A question is drawn only while this account is still offered the
 * thing it asks about (the guide is still its own, it is still on the team, guides can still be written). When the
 * offer goes the question is forgotten, so it does not come back by itself, and take focus, when the offer does.
 *
 * THE BOOKMARK BUTTON SAYS ITS STATE ONCE. Its name is the same whether or not the guide is bookmarked; that it is
 * bookmarked is said by `aria-pressed` alone (a name that also changed would be read as "remove the bookmark, pressed").
 *
 * A QUESTION, BY KEYBOARD. When a question appears, focus goes to its safe answer (Cancel, Keep it). When it is
 * answered, focus goes back to the button it came from: at once for the safe answer, and when the server has answered
 * for the other one (the card's buttons cannot take focus while it waits). The Publish button and the Unpublish button
 * are one button, so after a publish focus is on Unpublish. Unpublish and Bookmark ask nothing, but their button is
 * switched off while the card waits, and a browser takes focus off a button that is switched off: so they too get
 * focus back when the server has answered. Focus is never pulled back from somewhere else the player has moved to
 * meanwhile. The report form takes focus on its first reason (a reason is what it needs first, and no answer in it
 * does harm by being pressed early: Send report is off until one is chosen); Cancel hands focus back to Report. Hide
 * and Unhide are one button, like Publish. After a report is sent the Report button is switched off for good and
 * cannot take focus, so focus goes to the sentence the card now shows ("Reported. Thank you.", or that it was already
 * reported) instead of being lost to the page. When the form comes back after a refused send, focus goes back to the
 * button that was pressed (Send report), under the same rule: not if the player has moved on.
 *
 * PERFORMANCE: memoized, with stable callbacks from the host; portraits are the memoized `Card` fed stabilized views.
 * Nothing animates and no layout is read. Typing a report redraws the form only, never the card.
 */
export const CompendiumGuideCard = memo(function CompendiumGuideCard({
  guide, tribes, run, setId, mineTab, writable, editable, own, canBookmark, bookmarked, canReport, moderate, signedIn,
  onEdit, onDuplicate, onPublish, onDelete, onBookmark, onReport, onHide, onNeedSignIn,
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
  /** This account could report this guide: someone else's published guide. A guest is offered it and asked to sign in. */
  canReport: boolean;
  /** This account is on the team and this is a player's guide with a server row: Hide or Unhide, and Delete. */
  moderate: boolean;
  /** A signed-in account is at the keyboard. Only Report reads it: a guest is asked to sign in before its form opens. */
  signedIn: boolean;
  onEdit: (g: Guide) => void;
  onDuplicate: (g: Guide) => void;
  onPublish: (g: Guide, on: boolean) => Promise<string | null>;
  onDelete: (g: Guide) => Promise<string | null>;
  onBookmark: (g: Guide, on: boolean) => Promise<string | null>;
  onReport: (g: Guide, reason: ReportReason, note: string) => Promise<string | null>;
  onHide: (g: Guide, hidden: boolean) => Promise<string | null>;
  /** A guest pressed Report: the host asks them to sign in. */
  onNeedSignIn: () => void;
}): JSX.Element {
  const chips = guideChips(guide, tribes);
  const ids = useMemo(() => guideCardIds(guide), [guide]);
  const { views, refs } = useGuideViews(ids, run);
  const missing = useMemo(() => guideMissingIds(guide, setId), [guide, setId]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The report as far as it has been written. A ref, not state: the form draws it, the card only keeps it (so typing
   *  never redraws the card), and it outlives the form across a refused send (see the header). */
  const report = useRef<ReportDraft>(noReport());
  /** The report form is coming back after a refused send: focus goes to Send report, not to the first reason. */
  const comeback = useRef(false);
  /** This guide was reported from this card, or the server said this account had already reported it. */
  const [reported, setReported] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  /** The Publish button, which is the Unpublish button once the guide is published. */
  const publishRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  /** The Bookmark button, which is the Bookmarked button once the guide is bookmarked. */
  const bookmarkRef = useRef<HTMLButtonElement>(null);
  /** The Report button, which reads Reported (and is switched off) once the guide is reported. */
  const reportRef = useRef<HTMLButtonElement>(null);
  /** The Hide button, which is the Unhide button once the guide is hidden. */
  const hideRef = useRef<HTMLButtonElement>(null);
  /** The safe answer of the question being asked (Cancel, Keep it). */
  const safeRef = useRef<HTMLButtonElement>(null);
  /** The first reason of the report form, and its Send report button. */
  const firstRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  /** The sentence the card shows about a report (thank you, or already reported). */
  const saidRef = useRef<HTMLParagraphElement>(null);
  /** The button the last question or action came from: where focus goes back to once it is answered. */
  const opener = useRef<Opener | null>(null);
  // Set on mount as well as cleared on unmount: in development React mounts, unmounts and mounts a card again, and a
  // flag that is only ever cleared would leave the card waiting for good.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  /** A question is only drawn while this account is still offered what it asks about (it goes when the account, or
   *  the offer, does: see the header). */
  const offered = ask === 'publish' ? own
    : ask === 'delete' ? own || moderate
    : ask === 'hide' ? moderate && !guide.hidden
    : ask === 'report' ? canReport && signedIn && !reported
    : false;
  const asking = offered ? ask : null;
  // ...and it goes for good: a question whose offer went is forgotten, with a report it was holding, so it does not
  // come back by itself (and take focus) when the offer does.
  useEffect(() => {
    if (ask === null || offered) return;
    if (ask === 'report') report.current = noReport();
    setAsk(null);
  }, [ask, offered]);

  // A question, by keyboard (see the header).
  useEffect(() => {
    if (asking) {
      const at = document.activeElement;
      if (asking !== 'report') safeRef.current?.focus();
      else if (!comeback.current) firstRef.current?.focus();
      // Back after a refused send: to the button that was pressed, unless the player has moved on meanwhile.
      else if (!at || at === document.body || cardRef.current?.contains(at)) sendRef.current?.focus();
      comeback.current = false;
      return;
    }
    if (busy || !opener.current) return;
    const from = opener.current;
    const back = from === 'publish' ? publishRef.current : from === 'delete' ? deleteRef.current : from === 'report' ? reportRef.current
      : from === 'hide' ? hideRef.current : bookmarkRef.current;
    opener.current = null;
    const at = document.activeElement;
    if (!at || at === document.body || cardRef.current?.contains(at)) {
      // Report is switched off for good once the guide is reported: the sentence about it takes focus instead.
      if (from === 'report' && (!back || back.disabled)) saidRef.current?.focus();
      else back?.focus();
    }
  }, [asking, busy]);

  /** Ask before publishing, deleting or hiding, or open the report form. */
  const question = (kind: Ask): void => {
    opener.current = kind;
    setError(null);
    setAsk(kind);
  };
  /** Report was pressed. A guest is asked to sign in and no form opens. */
  const openReport = (): void => {
    if (!signedIn) { onNeedSignIn(); return; }
    comeback.current = false;
    question('report');
  };
  /** Cancel in the report form: what was typed is forgotten, so the form opens empty next time. */
  const cancelReport = (): void => {
    report.current = noReport();
    setAsk(null);
  };
  /** Run one action: wait, then show its sentence if it has one. Nothing is set once the card is gone. `from`: the
   *  button that was pressed, when the action asked nothing first (it gets focus back: see the header). `then`: what
   *  the card itself notes once the answer is in, told the sentence; it too is skipped once the card is gone. */
  const perform = async (action: () => Promise<string | null>, from?: 'publish' | 'bookmark' | 'hide', then?: (said: string | null) => void): Promise<void> => {
    if (busy) return;
    if (from) opener.current = from;
    setBusy(true);
    setError(null);
    setAsk(null);
    let said: string | null;
    try { said = await action(); } catch { said = 'Something went wrong. Nothing was changed.'; }
    if (!alive.current) return;
    setBusy(false);
    setError(said);
    then?.(said);
  };
  /** Send the report. One that went through, and one the server says was already sent, both leave the card reading
   *  Reported (the second keeps its sentence on the card) and forget what was typed. Any other answer is a refusal:
   *  the form comes back with what was typed, and the sentence shows under it. */
  const sendReport = (reason: ReportReason, note: string): void => {
    void perform(() => onReport(guide, reason, note), undefined, (said) => {
      if (said === null || said === ALREADY) { report.current = noReport(); setReported(true); return; }
      comeback.current = true;
      setAsk('report');
    });
  };

  const badges: string[] = [];
  if (mineTab) {
    if (guide.hidden) badges.push('Hidden by Team Ascent');
    else badges.push(guide.published ? 'Published' : 'Private');
    if (!guide.sets.includes(setId)) badges.push('Not in this set');
  } else if (moderate && guide.hidden) {
    // The team is told a guide is hidden under every pill, not only its author under My guides.
    badges.push('Hidden by Team Ascent');
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
            <button type="button" className={`gbtn${bookmarked ? ' on' : ''}`} ref={bookmarkRef} aria-pressed={bookmarked} disabled={!writable || busy}
              aria-label={`Bookmark ${guide.title}`}
              onClick={() => void perform(() => onBookmark(guide, !bookmarked), 'bookmark')}>{bookmarked ? 'Bookmarked' : 'Bookmark'}</button>
          )}
          {/* One button in one place: Report, then Reported and switched off for good. */}
          {canReport && (reported
            ? <button type="button" className="gbtn" ref={reportRef} disabled>Reported</button>
            : <button type="button" className="gbtn" ref={reportRef} aria-label={`Report ${guide.title}`} disabled={!writable || busy} onClick={openReport}>Report</button>)}
          {editable && <button type="button" className="gbtn" aria-label={`Edit ${guide.title}`} disabled={busy} onClick={() => onEdit(guide)}>Edit</button>}
          <button type="button" className="gbtn" aria-label={`Duplicate ${guide.title}`} disabled={!writable || busy} onClick={() => onDuplicate(guide)}>Duplicate</button>
          {/* One button in one place, whichever word it wears: focus stays on it across a publish. */}
          {own && (guide.published
            ? <button type="button" className="gbtn" ref={publishRef} aria-label={`Unpublish ${guide.title}`} disabled={!writable || busy} onClick={() => void perform(() => onPublish(guide, false), 'publish')}>Unpublish</button>
            : <button type="button" className="gbtn" ref={publishRef} aria-label={`Publish ${guide.title}`} disabled={!writable || busy || guide.hidden}
                aria-description={guide.hidden ? 'Team Ascent has hidden this guide. It cannot be published.' : undefined}
                onClick={() => question('publish')}>Publish</button>)}
          {/* One button in one place, as Publish is. Unhide asks nothing; Hide asks first. */}
          {moderate && (guide.hidden
            ? <button type="button" className="gbtn" ref={hideRef} aria-label={`Unhide ${guide.title}`} disabled={!writable || busy} onClick={() => void perform(() => onHide(guide, false), 'hide')}>Unhide</button>
            : <button type="button" className="gbtn" ref={hideRef} aria-label={`Hide ${guide.title}`} disabled={!writable || busy} onClick={() => question('hide')}>Hide</button>)}
          {(own || moderate) && <button type="button" className="gbtn" ref={deleteRef} aria-label={`Delete ${guide.title}`} disabled={!writable || busy} onClick={() => question('delete')}>Delete</button>}
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
      {asking === 'report' && <ReportForm kept={report} writable={writable} firstRef={firstRef} sendRef={sendRef} onSend={sendReport} onCancel={cancelReport} />}
      {asking === 'hide' && (
        <p className="gtool-note bookguide-ask" role="group" aria-label="Hide this guide">
          <span>Hide this guide? Only its author and Team Ascent will be able to see it.</span>
          <button type="button" className="gbtn gbtn-danger" onClick={() => void perform(() => onHide(guide, true))}>Hide</button>
          <button type="button" className="gbtn" ref={safeRef} onClick={() => setAsk(null)}>Cancel</button>
        </p>
      )}
      {reported && !error && <p className="gtool-note bookguide-ask" role="status" tabIndex={-1} ref={saidRef}>Reported. Thank you.</p>}
      {/* Focus can be put on this sentence only when it is the one about a report already sent (see the header). */}
      {error && <p className="gtool-note bookguide-ask" role="alert" tabIndex={reported ? -1 : undefined} ref={saidRef}>{error}</p>}
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
