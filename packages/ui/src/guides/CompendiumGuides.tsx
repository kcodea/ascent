import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import { GUIDE_LIMITS } from '@game/guides';
import type { RunState } from '@game/sim';
import { accountsAvailable } from '../GuestSignIn';
import { LazyCell, LazyRootProvider } from '../bookLazy';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { canEditGuide, guideMissingIds, type Guide } from './guides';
import { GuideEditor } from './GuideEditor';
import { GuideEmblem, GuideText, GuideTribes, GuideUnits, guideAccent, guideCardIds, guideChips, useGuideViews } from './GuideParts';
import { builtInImportPayload, draftFromGuide, duplicateDraft, emptyDraft, sameDraft, type EditorDraft } from './guideDrafts';
import { clearLocalDraft, loadLocalDraft } from './guideDraftStore';
import { guideErrorMessage } from './guideMessages';
import { importBuiltInsRemote } from './guidesRemote';
import { loadGuides, ownsMine, setGuidesTab, takePendingEdit, useGuides } from './guidesStore';
import './lobbyGuides.css';
import './compendiumGuides.css';

const NO_GUIDES: readonly Guide[] = [];

/** A kept guide has something in it once it has a title, a tagline, a write-up, a card or a nickname row. The "by"
 *  line is filled in for the author, so it does not count; nor do tribes, "pairs with" or the art icon on their own. */
const hasContent = (d: EditorDraft): boolean =>
  d.title.trim() !== '' || d.tagline.trim() !== '' || d.body.trim() !== '' || d.core.length > 0 || d.enablers.length > 0 || d.aliases.length > 0;

/** The unsaved guide this device keeps for `userId`, as it was read, or null. One with nothing in it is not offered. */
const keptFor = (userId: string | null): EditorDraft | null => {
  const d = userId ? loadLocalDraft(userId) : null;
  return d && hasContent(d) ? d : null;
};

/** The kept guide, tied to the account (`who`) it was read for. */
interface Kept { who: string; draft: EditorDraft }
const keptAs = (who: string, userId: string | null): Kept | null => {
  const draft = keptFor(userId);
  return draft ? { who, draft } : null;
};

/** Forget a kept guide of `userId` that has nothing in it, so it never stands in the way of a new one. */
const forgetEmptyKept = (userId: string | null): void => {
  const d = userId ? loadLocalDraft(userId) : null;
  if (userId && d && !hasContent(d)) clearLocalDraft(userId);
};

/**
 * THE COMPENDIUM'S GUIDES TAB (owner asks 2026-10-09 and 2026-10-11: "a guides tab in the compendium that pulls the
 * same guides from the rail but in an expanded/full view"). The SAME guide pieces as the lobby rail (`GuideParts`),
 * laid out for a big screen: every guide is open, two cards across on a wide window and one on a narrow one, each with
 * its art icon, title, tribe line + tagline, the full write-up (card names hoverable) and bigger Core / Enablers
 * portraits. Since 2026-10-12 it is also where guides are WRITTEN: a toolbar (the Team Ascent / My guides pills, New
 * guide), Duplicate on every guide, Edit on the ones this account may change, and the editor, which takes over the tab
 * while it is open.
 *
 * Which guides show (pill, set, tribe pills, search) is decided by the caller (MinionBook). Who may do what is
 * decided by the server; this only draws the buttons (`canEditGuide`). Writing needs the guides capability to be
 * `on` and a signed-in account: a guest is asked to sign in, an offline game says so.
 *
 * WHAT THE EDITOR NEEDS FROM ITS HOST. The device keeps ONE unsaved guide per account (guideDraftStore.ts), and the
 * editor only ever undoes or clears its own write to it. So:
 *  - One unsaved guide at a time. While one is waiting for this account (the Resume bar), New guide, Edit, Duplicate
 *    and the rail's edit request open nothing: a second editor would overwrite the first. The bar asks instead.
 *  - Resume reads the device again when pressed and hands the editor the kept guide exactly as it was read (the editor
 *    compares it with the device). If the device now holds a different guide than the bar was showing, that one opens.
 *    If it holds none (a save landed late), nothing opens.
 *  - A kept guide with nothing in it is not offered, and is forgotten when the tab opens.
 *  - An editor, and the Resume bar, belong to the account they were made for. When the account changes the editor is
 *    closed at once (it keeps its unsaved text on the device under the account that typed it), and the bar is read
 *    again.
 *  - One open editor is never swapped for another: an editor only opens when none is open.
 *
 * WHOSE GUIDES. The My guides list and its count are drawn only while the store holds them for the account that is
 * signed in (`ownsMine`): guides it still holds for another account are never drawn, whatever list this is handed.
 *
 * THE CAP IS SAID BEFORE THE GUIDE IS WRITTEN. A player who already owns the most guides allowed is told so when they
 * press New guide or Duplicate, instead of after writing one that cannot be saved. Edit and Resume are never stopped
 * (Edit is how a guide is deleted to make room), and neither is a team account.
 *
 * AN ASK MUST BE SEEN. The toolbar scrolls away with the list, and a guide's buttons can be pressed far below it. So
 * when a press is answered with a question or a note in the toolbar (sign in first; resume or discard first; the cap),
 * the tab scrolls to its top and the question's main button (or the note itself) takes keyboard focus, on every such
 * press.
 *
 * PERFORMANCE. Guides mount lazily (all but the first two wait until near the viewport). Each guide card is memoized
 * and takes stable callbacks; its portraits are the memoized `Card` fed stabilized views. Off-screen cards skip
 * layout + paint (`content-visibility: auto`, compendiumGuides.css). Nothing animates, nothing here runs per frame,
 * and no layout is read.
 */
export const CompendiumGuides = memo(function CompendiumGuides({ guides, tribes, setTribes, run, setId }: {
  guides: readonly Guide[];
  /** The tribes the shown set (or run) has: a crossover chip shows only when its tribe is among them. */
  tribes: readonly Tribe[];
  /** The shown set's WHOLE roster: what the editor's tribe pills offer. */
  setTribes: readonly Tribe[];
  /** The run to print live values from, only while the Compendium shows that run's own set. */
  run: RunState | undefined;
  /** The set being shown: a guide's card that is not in it greys out. */
  setId: SetId;
}): JSX.Element {
  // Only `on` allows writing, and only a read that ANSWERED no is offline (not yet known is neither). Selected as two
  // yes/no values, so the tab is redrawn only when what it draws changes.
  const online = useGuides((s) => s.capability === 'on');
  const offline = useGuides((s) => s.capability === 'off' || s.capability === 'offline' || s.capability === 'no-backend');
  /** The first read has not answered yet: whether guides can be written is not known. */
  const unknown = useGuides((s) => s.capability === 'unknown');
  const source = useGuides((s) => s.source);
  const team = useGuides((s) => s.team);
  const tab = useGuides((s) => s.tab);
  const mineHeld = useGuides((s) => s.mine.length);
  const mineOwner = useGuides((s) => s.mineOwner);
  const pending = useGuides((s) => s.pendingEdit);
  const userId = useGame((s) => s.account.userId);
  const anonymous = useGame((s) => s.account.anonymous);
  const playerName = useGame((s) => s.playerName);

  const signedIn = !anonymous && !!userId;
  /** The store holds THIS account's own guides (not nobody's, and not ones still held for another account). */
  const mineIsMine = ownsMine({ mineOwner }, userId);
  const mineCount = mineIsMine ? mineHeld : 0;
  const shown = tab === 'mine' && !mineIsMine ? NO_GUIDES : guides;
  const byline = playerName.trim() || 'Player';
  /** Who is at the keyboard: an open editor, and the Resume bar, belong to exactly one of these. */
  const who = `${userId ?? ''}:${anonymous ? 'guest' : 'account'}`;

  /** The open editor: its guide, and who opened it. */
  const [editing, setEditing] = useState<{ draft: EditorDraft; key: number; who: string } | null>(null);
  /** The unsaved guide waiting on this device: the very object read from it, and the account it was read for. */
  const [kept, setKept] = useState<Kept | null>(() => keptAs(who, userId));
  /** A press was answered with a question in the toolbar. A new object on every such press (see the effect below). */
  const [ask, setAsk] = useState<{ kind: 'signin' | 'resume' | 'cap' } | null>(null);
  /** The Resume bar is asking whether to delete the waiting guide. */
  const [discardAsk, setDiscardAsk] = useState(false);
  const [note, setNote] = useState<{ text: string; alert: boolean } | null>(null);
  const [importing, setImporting] = useState(false);
  // Lazy (perf 2026-10-09): the first two guides mount with the tab, the rest as they near the viewport (bookLazy.tsx),
  // so opening Guides builds two guides' portraits instead of every guide's.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const rootEl = useRef<HTMLDivElement | null>(null);
  const attachRoot = useCallback((el: HTMLDivElement | null): void => { rootEl.current = el; setRoot(el); }, []);
  const createRef = useRef<HTMLButtonElement>(null);
  const signInRef = useRef<HTMLParagraphElement>(null);
  const capRef = useRef<HTMLParagraphElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  /** Keep it was pressed: focus goes back to the Discard button it came from. */
  const backToDiscard = useRef(false);

  /** The editor to draw: only for the account that opened it. */
  const open = editing && userId && editing.who === who ? editing : null;
  const editorOpen = open !== null;
  /** The guide waiting for THIS account (never another account's). */
  const resume = kept && kept.who === who ? kept.draft : null;
  const waiting = resume !== null;
  const signInAsked = ask?.kind === 'signin' && !signedIn;
  const resumeAsked = ask?.kind === 'resume';
  /** The cap note shows only while it is still true (a delete, here or elsewhere, makes room). */
  const capAsked = ask?.kind === 'cap' && !team && mineCount >= GUIDE_LIMITS.guidesPerPlayer;

  const opens = useRef(0);
  /** Open the editor. Does nothing while one is open: an open editor is never swapped for another. */
  const openEditor = useCallback((draft: EditorDraft): void => {
    opens.current += 1;
    const key = opens.current;
    setNote(null);
    setAsk(null);
    setDiscardAsk(false);
    setEditing((cur) => cur ?? { draft, key, who });
  }, [who]);
  /** Answer a press with a question in the toolbar. Every press makes a new ask, so every press brings it into view. */
  const raise = useCallback((kind: 'signin' | 'resume' | 'cap'): void => {
    sfx.tick();
    if (kind === 'resume') setDiscardAsk(false); // the bar shows Resume and Discard again
    setAsk({ kind });
  }, []);
  /**
   * Writing needs a signed-in account (a guest is asked to sign in instead), and no unsaved guide already waiting.
   * `adds`: this would be one more guide of the player's own (New guide, Duplicate; not Edit). At the cap that is
   * said here, before anything is written. The count is read when the button is pressed.
   */
  const begin = useCallback((make: () => EditorDraft, adds: boolean): void => {
    if (!online) return;
    if (!signedIn) { raise('signin'); return; }
    if (waiting) { raise('resume'); return; }
    const s = useGuides.getState();
    if (adds && !s.team && ownsMine(s, userId) && s.mine.length >= GUIDE_LIMITS.guidesPerPlayer) { raise('cap'); return; }
    sfx.pulse();
    openEditor(make());
  }, [online, signedIn, waiting, userId, raise, openEditor]);
  const onEdit = useCallback((g: Guide): void => begin(() => draftFromGuide(g), false), [begin]);
  const onDuplicate = useCallback((g: Guide): void => begin(() => duplicateDraft(g, byline), true), [begin, byline]);

  // The account. When the tab opens, a kept guide with nothing in it is forgotten. When the account changes, an open
  // editor is closed (it was drawn for the last account only, and has already kept its unsaved text on the device
  // under that account: a child's cleanup runs before this), and the Resume bar is read again for the new account.
  const seenWho = useRef(who);
  useEffect(() => {
    forgetEmptyKept(userId);
    if (seenWho.current === who) return;
    seenWho.current = who;
    setEditing(null);
    setAsk(null);
    setDiscardAsk(false);
    setNote(null);
    setKept(keptAs(who, userId));
  }, [who, userId]);

  // The rail asked for a guide to be edited: take the request once. It opens only if this account may edit that
  // guide, no editor is open, and no unsaved guide is waiting (then the Resume bar asks, as for the buttons).
  useEffect(() => {
    if (!pending) return;
    const rowId = takePendingEdit();
    if (rowId === null || editorOpen) return;
    const s = useGuides.getState();
    const g = [...s.mine, ...s.list].find((x) => x.rowId === rowId);
    if (!g || !online || !signedIn || !canEditGuide(g, userId, s.team)) return;
    if (waiting) { raise('resume'); return; }
    openEditor(draftFromGuide(g));
  }, [pending, editorOpen, online, signedIn, userId, waiting, raise, openEditor]);

  // An ask must be seen (see the header): to the top, and focus on the ask's main button. For a guest that is Create
  // account, or the sign-in line itself when accounts cannot be reached; the cap note has no button, so the note
  // itself. Runs once per press: `ask` is new each time.
  useEffect(() => {
    if (!ask) return;
    const el = rootEl.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: 0 });
    (ask.kind === 'signin' ? createRef.current ?? signInRef.current : ask.kind === 'cap' ? capRef.current : resumeRef.current)?.focus();
  }, [ask]);

  // The Resume bar's discard question does not outlive the bar: when the bar hides (the connection drops, the guide
  // is gone) the question is withdrawn, so a bar that comes back shows Resume and Discard, not a half-asked question.
  const barShown = waiting && signedIn && online;
  useEffect(() => { if (!barShown) setDiscardAsk(false); }, [barShown]);

  // The Resume bar's discard question takes focus on its safe answer; Keep it hands focus back to Discard.
  useEffect(() => {
    if (discardAsk) keepRef.current?.focus();
    else if (backToDiscard.current) discardRef.current?.focus();
    backToDiscard.current = false;
  }, [discardAsk]);

  /** The editor closed. `savedNew`: it says a NEW guide of the player's own was just saved (a new guide, or a copy):
   *  show it where it now lives. The editor's word, never the list growing, which a re-read can also cause. */
  const closeEditor = useCallback((savedNew: boolean): void => {
    setEditing(null);
    setKept(keptAs(who, userId));
    if (savedNew) {
      setGuidesTab('mine');
      setNote({ text: 'Saved to My guides.', alert: false });
    }
  }, [who, userId]);

  /** Resume: the device is read again, and what it holds NOW is what opens (the guide the bar was showing, or a
   *  different one written since). If it holds none (the guide was saved or cleared meanwhile), nothing opens. */
  const resumeKept = (): void => {
    if (!resume) return;
    const now = keptFor(userId);
    if (now) { sfx.pulse(); openEditor(now); return; }
    setKept(keptAs(who, userId));
    setAsk(null);
    setDiscardAsk(false);
    setNote({ text: 'That guide was already saved.', alert: false });
  };
  /** Discard for good: the waiting guide leaves the device (only if the device still holds that very guide). */
  const discardKept = (): void => {
    const now = userId ? loadLocalDraft(userId) : null;
    if (userId && resume && now && sameDraft(now, resume)) clearLocalDraft(userId);
    sfx.tick();
    setKept(keptAs(who, userId));
    setAsk(null);
    setDiscardAsk(false);
  };

  const runImport = async (): Promise<void> => {
    setImporting(true);
    try {
      const res = await importBuiltInsRemote(builtInImportPayload());
      if (!res.ok) { setNote({ text: guideErrorMessage(res.code, res.field, { action: 'import' }), alert: true }); return; }
      setNote({ text: `Imported ${res.value.inserted} guide${res.value.inserted === 1 ? '' : 's'}.`, alert: false });
      void loadGuides();
    } catch {
      setNote({ text: 'The import did not finish. Try again.', alert: true });
    } finally {
      setImporting(false);
    }
  };
  const createAccount = (): void => {
    sfx.pulse();
    const st = useGame.getState();
    st.closeBook();
    st.openAccountPanel();
  };

  // The editor takes over the tab, in a scroll box of its own (keyed apart from the list's, so it opens at its top
  // wherever the list was scrolled).
  if (open && userId) {
    return (
      <div className="bookguides" key="editor">
        <GuideEditor key={`${open.who}:${open.key}`} initial={open.draft} setId={setId} tribes={setTribes} run={run} userId={userId}
          canBeOfficial={team && source === 'server'} onClose={closeEditor} />
      </div>
    );
  }

  const canSignIn = accountsAvailable(userId);
  return (
    <div className="bookguides" key="list" ref={attachRoot}>
      <div className="gtool" role="group" aria-label="Guides" aria-busy={unknown ? true : undefined}>
        <div className="gtool-pills" role="group" aria-label="Which guides to show">
          <button type="button" className={`book-runetribe${tab === 'team' ? ' on' : ''}`} style={{ '--c': 'var(--ui-title)' } as CSSProperties}
            aria-pressed={tab === 'team'} onClick={() => setGuidesTab('team')}>Team Ascent</button>
          <button type="button" className={`book-runetribe${tab === 'mine' ? ' on' : ''}`} style={{ '--c': 'var(--ui-title)' } as CSSProperties}
            aria-pressed={tab === 'mine'} onClick={() => setGuidesTab('mine')}>{mineCount > 0 ? `My guides (${mineCount})` : 'My guides'}</button>
        </div>
        <div className="gtool-actions">
          {team && online && source === 'bundled' && (
            <button type="button" className="gbtn" disabled={importing} aria-description="Team only. Adds the built-in guides to the server as Team Ascent guides so they can be edited. Safe to press twice."
              onClick={() => void runImport()}>Import built-in guides</button>
          )}
          <button type="button" className="gbtn gbtn-primary" disabled={!online} onClick={() => begin(() => emptyDraft(byline), true)}>New guide</button>
        </div>
        {offline && <p className="gtool-note" role="status">Guides are offline. You can read the built-in guides; writing your own needs a connection.</p>}
        {/* One note. Keyed by its role, so an error that replaces a status (or the other way round) is a NEW element
            and a screen reader announces it. */}
        {note && <p key={note.alert ? 'alert' : 'status'} className="gtool-note" role={note.alert ? 'alert' : 'status'}>{note.text}</p>}
        {capAsked && <p className="gtool-note gtool-cap" role="status" tabIndex={-1} ref={capRef}>{guideErrorMessage('too_many_guides')}</p>}
        {signInAsked && (
          <p className="gtool-note gtool-signin" role="status" tabIndex={-1} ref={signInRef}>
            <span>{canSignIn ? 'Sign in to write your own guides. It is free and takes a minute.' : 'Sign in to write your own guides. Accounts cannot be reached right now.'}</span>
            {canSignIn && <button type="button" className="gbtn gbtn-primary" ref={createRef} onClick={createAccount}>Create account</button>}
          </p>
        )}
        {resume && barShown && (
          <p className={`gtool-note gtool-resume${resumeAsked ? ' gtool-resume-ask' : ''}`} role="status">
            {discardAsk ? (
              <>
                <span>Discard this unsaved guide? It cannot be brought back.</span>
                <button type="button" className="gbtn gbtn-danger" onClick={discardKept}>Discard for good</button>
                <button type="button" className="gbtn" ref={keepRef} onClick={() => { backToDiscard.current = true; setDiscardAsk(false); }}>Keep it</button>
              </>
            ) : (
              <>
                <span>You have an unsaved guide: {resume.title.trim() || 'untitled'}</span>
                {resumeAsked && <span>Resume or discard your unsaved guide first.</span>}
                <button type="button" className="gbtn gbtn-primary" ref={resumeRef} onClick={resumeKept}>Resume</button>
                <button type="button" className="gbtn" ref={discardRef} onClick={() => setDiscardAsk(true)}>Discard</button>
              </>
            )}
          </p>
        )}
      </div>
      {shown.length === 0 ? (
        <div className="book-empty gtool-empty">
          {tab === 'mine' && mineCount === 0 ? 'You have not written a guide yet. Press New guide, or Duplicate on any guide to start from it.' : 'No guides match these filters.'}
        </div>
      ) : (
        <LazyRootProvider root={root}>
          {shown.map((g, i) => (
            <LazyCell key={g.id} eager={i < 2} className="bookguide-slot">
              {() => (
                <CompendiumGuide guide={g} tribes={tribes} run={run} setId={setId} mineTab={tab === 'mine'} writable={online}
                  editable={online && canEditGuide(g, userId, team)} onEdit={onEdit} onDuplicate={onDuplicate} />
              )}
            </LazyCell>
          ))}
        </LazyRootProvider>
      )}
    </div>
  );
});

const CompendiumGuide = memo(function CompendiumGuide({ guide, tribes, run, setId, mineTab, writable, editable, onEdit, onDuplicate }: {
  guide: Guide; tribes: readonly Tribe[]; run: RunState | undefined; setId: SetId;
  /** Under My guides, a guide wears its state (Private, Hidden, Not in this set). */
  mineTab: boolean;
  /** Guides can be written right now (the capability is on). */
  writable: boolean;
  /** This account may edit this guide. */
  editable: boolean;
  onEdit: (g: Guide) => void; onDuplicate: (g: Guide) => void;
}): JSX.Element {
  const chips = guideChips(guide, tribes);
  const ids = useMemo(() => guideCardIds(guide), [guide]);
  const { views, refs } = useGuideViews(ids, run);
  const missing = useMemo(() => guideMissingIds(guide, setId), [guide, setId]);
  const badges: string[] = [];
  if (mineTab) {
    if (guide.hidden) badges.push('Hidden by Team Ascent');
    else if (!guide.published) badges.push('Private');
    if (!guide.sets.includes(setId)) badges.push('Not in this set');
  }
  return (
    <article className="bookguide" data-guide={guide.id} style={guideAccent(chips)} aria-label={guide.title}>
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
          {editable && <button type="button" className="gbtn" aria-label={`Edit ${guide.title}`} onClick={() => onEdit(guide)}>Edit</button>}
          <button type="button" className="gbtn" aria-label={`Duplicate ${guide.title}`} disabled={!writable} onClick={() => onDuplicate(guide)}>Duplicate</button>
        </div>
      </header>
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
