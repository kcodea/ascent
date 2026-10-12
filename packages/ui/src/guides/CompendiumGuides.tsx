import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';
import type { RunState } from '@game/sim';
import { accountsAvailable } from '../GuestSignIn';
import { LazyCell, LazyRootProvider } from '../bookLazy';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { canEditGuide, guideMissingIds, type Guide } from './guides';
import { GuideEditor } from './GuideEditor';
import { GuideEmblem, GuideText, GuideTribes, GuideUnits, guideAccent, guideCardIds, guideChips, useGuideViews } from './GuideParts';
import { builtInImportPayload, draftFromGuide, duplicateDraft, emptyDraft, type EditorDraft } from './guideDrafts';
import { clearLocalDraft, loadLocalDraft } from './guideDraftStore';
import { guideErrorMessage } from './guideMessages';
import { importBuiltInsRemote } from './guidesRemote';
import { loadGuides, setGuidesTab, takePendingEdit, useGuides } from './guidesStore';
import './lobbyGuides.css';
import './compendiumGuides.css';

/** A kept guide has something in it once it has a title, a write-up, a card or a nickname row. The "by" line is
 *  filled in for the author, so it does not count (nor do the tagline, tribes or art icon on their own). */
const hasContent = (d: EditorDraft): boolean =>
  d.title.trim() !== '' || d.body.trim() !== '' || d.core.length > 0 || d.enablers.length > 0 || d.aliases.length > 0;

/** The unsaved guide this device keeps for `userId`, as it was read, or null. One with nothing in it is not offered. */
const keptFor = (userId: string | null): EditorDraft | null => {
  const d = userId ? loadLocalDraft(userId) : null;
  return d && hasContent(d) ? d : null;
};

/** Forget a kept guide of `userId` that has nothing in it, so it never stands in the way of a new one. */
const forgetEmptyKept = (userId: string | null): void => {
  const d = userId ? loadLocalDraft(userId) : null;
  if (d && !hasContent(d)) clearLocalDraft();
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
 * WHAT THE EDITOR NEEDS FROM ITS HOST. The device keeps ONE unsaved guide (guideDraftStore.ts), and the editor only
 * ever undoes or clears its own write to it. So:
 *  - One unsaved guide at a time. While one is waiting for this account (the Resume bar), New guide, Edit, Duplicate
 *    and the rail's edit request open nothing: a second editor would overwrite the first. The bar asks instead.
 *  - Resume hands the editor the kept guide exactly as it was read (the editor compares it with the device).
 *  - A kept guide with nothing in it is not offered, and is forgotten when the tab opens.
 *  - An editor belongs to the account that opened it. When the account changes it is closed at once (it keeps its
 *    unsaved text on the device under the account that typed it), and the Resume bar is read again.
 *  - One open editor is never swapped for another: an editor only opens when none is open.
 *
 * PERFORMANCE. Guides mount lazily (all but the first two wait until near the viewport). Each guide card is memoized
 * and takes stable callbacks; its portraits are the memoized `Card` fed stabilized views. Off-screen cards skip
 * layout + paint (`content-visibility: auto`, compendiumGuides.css). Nothing animates, and nothing here runs per frame.
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
  // Only `on` allows writing. Selected as that one yes/no, so the tab is not redrawn when a read moves between the
  // other answers (unknown, offline, off, no backend), which all draw the same.
  const online = useGuides((s) => s.capability === 'on');
  const source = useGuides((s) => s.source);
  const team = useGuides((s) => s.team);
  const tab = useGuides((s) => s.tab);
  const mineCount = useGuides((s) => s.mine.length);
  const pending = useGuides((s) => s.pendingEdit);
  const userId = useGame((s) => s.account.userId);
  const anonymous = useGame((s) => s.account.anonymous);
  const playerName = useGame((s) => s.playerName);

  const signedIn = !anonymous && !!userId;
  const byline = playerName.trim() || 'Player';
  /** Who is at the keyboard: an open editor belongs to exactly one of these. */
  const who = `${userId ?? ''}:${anonymous ? 'guest' : 'account'}`;

  const [editing, setEditing] = useState<{ draft: EditorDraft; key: number; who: string } | null>(null);
  /** The unsaved guide waiting on this device for this account: the very object read from it. */
  const [resume, setResume] = useState<EditorDraft | null>(() => keptFor(userId));
  /** A second guide was started while one is waiting: the Resume bar asks for a decision first. */
  const [resumeAsked, setResumeAsked] = useState(false);
  const [signInAsked, setSignInAsked] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  // Lazy (perf 2026-10-09): the first two guides mount with the tab, the rest as they near the viewport (bookLazy.tsx),
  // so opening Guides builds two guides' portraits instead of every guide's.
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

  /** The editor to draw: only for the account that opened it. */
  const open = editing && userId && editing.who === who ? editing : null;
  const editorOpen = open !== null;
  const waiting = resume !== null;

  const opens = useRef(0);
  /** Open the editor. Does nothing while one is open: an open editor is never swapped for another. */
  const openEditor = useCallback((draft: EditorDraft): void => {
    opens.current += 1;
    const key = opens.current;
    setNote(null);
    setResumeAsked(false);
    setEditing((cur) => cur ?? { draft, key, who });
  }, [who]);
  /** Writing needs a signed-in account (a guest is asked to sign in instead), and no unsaved guide already waiting. */
  const begin = useCallback((make: () => EditorDraft): void => {
    if (!online) return;
    if (!signedIn) { sfx.tick(); setSignInAsked(true); return; }
    if (waiting) { sfx.tick(); setResumeAsked(true); return; }
    sfx.pulse();
    openEditor(make());
  }, [online, signedIn, waiting, openEditor]);
  const onEdit = useCallback((g: Guide): void => begin(() => draftFromGuide(g)), [begin]);
  const onDuplicate = useCallback((g: Guide): void => begin(() => duplicateDraft(g, byline)), [begin, byline]);

  // The account. When the tab opens, a kept guide with nothing in it is forgotten. When the account changes, an open
  // editor is closed (it was drawn for the last account only, and has already kept its unsaved text on the device
  // under that account: a child's cleanup runs before this), and the Resume bar is read again for the new account.
  const seenWho = useRef(who);
  useEffect(() => {
    forgetEmptyKept(userId);
    if (seenWho.current === who) return;
    seenWho.current = who;
    setEditing(null);
    setResumeAsked(false);
    setSignInAsked(false);
    setNote(null);
    setResume(keptFor(userId));
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
    if (waiting) { setResumeAsked(true); return; }
    openEditor(draftFromGuide(g));
  }, [pending, editorOpen, online, signedIn, userId, waiting, openEditor]);

  const closeEditor = useCallback((): void => {
    setEditing(null);
    setResume(keptFor(userId));
  }, [userId]);

  const runImport = async (): Promise<void> => {
    setImporting(true);
    const res = await importBuiltInsRemote(builtInImportPayload());
    setImporting(false);
    if (!res.ok) { setNote(guideErrorMessage(res.code, res.field)); return; }
    setNote(`Imported ${res.value.inserted} guide${res.value.inserted === 1 ? '' : 's'}.`);
    void loadGuides();
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

  return (
    <div className="bookguides" key="list" ref={setRoot}>
      <div className="gtool" role="group" aria-label="Guides">
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
          <button type="button" className="gbtn gbtn-primary" disabled={!online} onClick={() => begin(() => emptyDraft(byline))}>New guide</button>
        </div>
        {!online && <p className="gtool-note" role="status">Guides are offline. You can read the built-in guides; writing your own needs a connection.</p>}
        {note && <p className="gtool-note" role="status">{note}</p>}
        {signInAsked && !signedIn && (
          <p className="gtool-note gtool-signin" role="status">
            <span>{accountsAvailable(userId) ? 'Sign in to write your own guides. It is free and takes a minute.' : 'Sign in to write your own guides. Accounts cannot be reached right now.'}</span>
            {accountsAvailable(userId) && <button type="button" className="gbtn gbtn-primary" onClick={createAccount}>Create account</button>}
          </p>
        )}
        {resume && signedIn && online && (
          <p className={`gtool-note gtool-resume${resumeAsked ? ' gtool-resume-ask' : ''}`} role="status">
            <span>You have an unsaved guide: {resume.title.trim() || 'untitled'}</span>
            {resumeAsked && <span>Resume or discard your unsaved guide first.</span>}
            <button type="button" className="gbtn gbtn-primary" onClick={() => openEditor(resume)}>Resume</button>
            <button type="button" className="gbtn" onClick={() => { clearLocalDraft(); setResume(null); setResumeAsked(false); }}>Discard</button>
          </p>
        )}
      </div>
      {guides.length === 0 ? (
        <div className="book-empty gtool-empty">
          {tab === 'mine' ? 'You have not written a guide yet. Press New guide, or Duplicate on any guide to start from it.' : 'No guides match these filters.'}
        </div>
      ) : (
        <LazyRootProvider root={root}>
          {guides.map((g, i) => (
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
          {editable && <button type="button" className="gbtn" onClick={() => onEdit(guide)}>Edit</button>}
          <button type="button" className="gbtn" disabled={!writable} onClick={() => onDuplicate(guide)}>Duplicate</button>
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
