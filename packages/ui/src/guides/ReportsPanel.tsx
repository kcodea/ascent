import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SETS, type SetId } from '@game/content';
import { GUIDE_LIMITS, type GuideRecord, type ReportReason } from '@game/guides';
import { LazyCell, LazyRootProvider } from '../bookLazy';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { SET_FACTS, toGuide, type Guide } from './guides';
import { batches, groupReports, planCarryOver, type CarryPlan, type ReportGroup } from './guideReports';
import { guideErrorMessage, isKnownRefusal } from './guideMessages';
import { rereadGuides } from './guidesStore';
import {
  dismissReportsRemote, fetchGuideTags, fetchHiddenGuides, fetchOpenReports, retagSetRemote,
  type GuideTagRow, type GuideWriteResult, type OpenReport,
} from './guidesRemote';

const REASON_LABEL: Readonly<Record<ReportReason, string>> = { offensive: 'Offensive', spam: 'Spam', impersonation: 'Impersonation', other: 'Other' };
const SET_IDS = Object.keys(SETS) as SetId[];
const nameOf = (s: SetId): string => SETS[s].name;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "3 reports: 2 Spam, 1 Offensive." */
const summaryOf = (g: ReportGroup): string =>
  `${plural(g.count, 'report', 'reports')}: ${g.reasons.map(([r, n]) => `${n} ${REASON_LABEL[r]}`).join(', ')}.`;

/** "84 guides carry over to Set 3. 31 stay behind. 12 already have it." */
const checkedLine = (plan: CarryPlan, set: SetId): string =>
  `${plural(plan.carry.length, 'guide carries', 'guides carry')} over to ${nameOf(set)}. `
  + `${plan.stay} ${plan.stay === 1 ? 'stays' : 'stay'} behind. ${plan.already} already ${plan.already === 1 ? 'has' : 'have'} it.`;

/** Who is at the keyboard right now. Read when something is asked and again when it is answered: an answer is only
 *  ever used for the account that asked. */
const asker = (): string | null => useGame.getState().account.userId;
/** Focus is on the page itself (nowhere), or still on `el`: it may be moved without taking it from the player. */
const focusIsFree = (el?: Element | null): boolean => {
  const at = document.activeElement;
  return !at || at === document.body || (el != null && at === el);
};

/** One of the two lists: what is drawn, whether it has ever been read, and whether the last read of it failed. */
interface Held<T> { items: T; loaded: boolean; failed: boolean }
interface Lists { reports: Held<readonly OpenReport[]>; hidden: Held<readonly GuideRecord[]> }
const NO_REPORTS: readonly OpenReport[] = [];
const NO_HIDDEN: readonly GuideRecord[] = [];
const NOTHING: Lists = { reports: { items: NO_REPORTS, loaded: false, failed: false }, hidden: { items: NO_HIDDEN, loaded: false, failed: false } };
/** A list after an answer: the answer, or (it could not be read) what it was showing, marked as failed. */
function answered<T>(cur: Held<T>, ans: T | undefined): Held<T> {
  return ans === undefined ? { ...cur, failed: true } : { items: ans, loaded: true, failed: false };
}

type Carry =
  | { step: 'idle' }
  | { step: 'checking' }
  | { step: 'checked'; set: SetId; plan: CarryPlan }
  | { step: 'running'; set: SetId; done: number; total: number }
  | { step: 'done'; set: SetId; tagged: number }
  | { step: 'stopped'; set: SetId; done: number; total: number; said: string }
  | { step: 'failed' };

/**
 * CARRY GUIDES OVER: add a new set to every guide whose cards and tribes are all in it.
 *
 * Check reads every guide's sets, tribes and cards and applies the same rule a save uses (`planCarryOver`); nothing is
 * written. Carry over then sends the ids it found in batches of `GUIDE_LIMITS.retagBatch`, STRICTLY ONE AFTER ANOTHER,
 * and stops at the first refusal, saying how far it got. It only ever ADDS the chosen set, and it can be run again: a
 * guide that already has the set is skipped by the check and by the server. After a run that finished or stopped,
 * Check reads everything again.
 *
 * TWO NUMBERS. While a run is going, and when it stops, the line counts the ids SENT so far ("200 of 284"): how far
 * the run has got. When it has finished, the line says the SERVER's number: the sum of what each batch answered it
 * changed. That is the only evidence the writes happened, and it can be smaller than what was sent (a guide deleted,
 * or given the set elsewhere, since the check). If the server changed none, the line says no guide needed it.
 *
 * WHEN A RUN ENDS, THE GUIDES ARE READ AGAIN (`rereadGuides`), once, if anything landed OR MAY HAVE: at least one
 * batch was answered, or the run stopped on an answer that is not a refusal the server is known to give (the answer
 * was lost, could not be read, or the call threw), which may follow a batch that was written. That holds for the very
 * first batch too, when the line still says 0. A carry-over changes guides' sets without changing their revision, and
 * this session's lists would otherwise go on showing them in their old sets only. A run stopped by a known refusal
 * before any batch landed wrote nothing, and reads nothing. The read is asked for only by the account that started
 * the run (after the same check every answer gets), and what it puts in the guides store is guides, never reports.
 *
 * ONE THING AT A TIME. While a check or a run is going, Check and the set picker are switched off, and a second press
 * (a double click lands before the screen is drawn again) starts nothing. Choosing another set withdraws the result:
 * nothing can be carried over to a set that was not checked.
 *
 * A RUN BELONGS TO THE ACCOUNT THAT STARTED IT. Before each answer is used, and so before the next batch is sent, the
 * account at the keyboard is compared with the one that pressed the button. If it changed, or the panel is gone, the
 * run ends at once and without a word: no further batch is sent, and nothing is set.
 *
 * It is its own component so that a run's progress redraws this row and not the lists of guides above it.
 */
const CarryOver = memo(function CarryOver({ setId }: { setId: SetId }): JSX.Element {
  const [target, setTarget] = useState<SetId>(setId);
  const [carry, setCarry] = useState<Carry>({ step: 'idle' });
  /** Each check and each run takes a number; leaving counts as a newer one, so nothing is used after the panel is gone. */
  const asks = useRef(0);
  /** A check or a run is going. A ref, so a second press in the same instant sees it. */
  const going = useRef(false);
  const checkRef = useRef<HTMLButtonElement>(null);
  /** Check or Carry over was pressed: focus goes back to Check when it can be pressed again. */
  const backToCheck = useRef(false);
  /** Bumped when a check or a run ends. A count, not the `working` flag: an answer that lands at once can end the work
   *  in the same draw that began it, and a flag that never changed would tell the effect below nothing. */
  const [ended, setEnded] = useState(0);
  /** A check or a run ended with this to show. */
  const end = (next: Carry): void => {
    setCarry(next);
    setEnded((n) => n + 1);
  };
  useEffect(() => () => { asks.current += 1; }, []);

  const check = async (): Promise<void> => {
    if (going.current) return;
    going.current = true;
    asks.current += 1;
    const mine = asks.current;
    const who = asker();
    const set = target;
    backToCheck.current = true;
    setCarry({ step: 'checking' });
    try {
      let rows: GuideTagRow[] | undefined;
      try { rows = await fetchGuideTags(); } catch { rows = undefined; }
      if (mine !== asks.current || asker() !== who) return;
      end(rows ? { step: 'checked', set, plan: planCarryOver(rows, set, SET_FACTS) } : { step: 'failed' });
    } finally {
      going.current = false;
    }
  };
  const run = async (set: SetId, ids: readonly string[]): Promise<void> => {
    if (going.current) return;
    going.current = true;
    asks.current += 1;
    const mine = asks.current;
    const who = asker();
    const total = ids.length;
    /** Ids sent in batches that landed, and the guides the server says those batches changed. */
    let done = 0;
    let tagged = 0;
    /** The run is over for the account that started it. If anything landed, or the answer it stopped on leaves that
     *  open (`mayHaveLanded`), this session's guides are read again. */
    const over = (next: Carry, mayHaveLanded = false): void => {
      if (done > 0 || mayHaveLanded) void rereadGuides();
      end(next);
    };
    backToCheck.current = true;
    setCarry({ step: 'running', set, done, total });
    try {
      for (const part of batches(ids, GUIDE_LIMITS.retagBatch)) {
        let res: GuideWriteResult<number>;
        try { res = await retagSetRemote(set, part); } catch { res = { ok: false, code: 'server' }; }
        // Gone, or another account is at the keyboard: the run ends here, and the next batch is never sent.
        if (mine !== asks.current || asker() !== who) return;
        if (!res.ok) {
          over({ step: 'stopped', set, done, total, said: guideErrorMessage(res.code, res.field, { action: 'moderate' }) }, !isKnownRefusal('moderate', res.code));
          return;
        }
        done += part.length;
        tagged += res.value;
        setCarry({ step: 'running', set, done, total });
      }
      sfx.pulse();
      over({ step: 'done', set, tagged });
    } finally {
      going.current = false;
    }
  };
  const choose = (next: SetId): void => {
    if (going.current) return;
    setTarget(next);
    setCarry({ step: 'idle' });
  };

  const working = carry.step === 'checking' || carry.step === 'running';
  // By keyboard: Check is switched off while it works, and the Carry over button goes when it is pressed; a browser
  // then drops focus to the page. When the work is done, focus goes back to Check, unless the player has moved on.
  useEffect(() => {
    if (!backToCheck.current) return;
    backToCheck.current = false;
    if (focusIsFree(checkRef.current)) checkRef.current?.focus();
  }, [ended]);
  // By eye: this tool is the last thing in the panel, so the line a Check or a run answers with is drawn at the
  // bottom edge of the scroll box, just out of sight (found in a real render, 2026-10-12). Bring it into view by the
  // nearest edge, at once and only when the step changes. An idle tool and a Check still reading draw no line, so
  // they move nothing.
  const lineRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { lineRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [carry.step]);

  return (
    <>
      <div className="gtool-note greports-row" role="group" aria-label="Carry guides over">
        <span>When a new set goes live, add it to every guide whose cards and tribes are all in it. Guides that do not fit are left as they are.</span>
        <label className="gedit-field gedit-field-inline">
          <span className="gedit-label">Set</span>
          <select className="gedit-input" aria-label="Set" value={target} disabled={working} onChange={(e) => choose(e.target.value as SetId)}>
            {SET_IDS.map((s) => <option key={s} value={s}>{nameOf(s)}</option>)}
          </select>
        </label>
        <button type="button" className="gbtn" ref={checkRef} disabled={working} onClick={() => void check()}>Check</button>
        {carry.step === 'checked' && carry.plan.carry.length > 0 && (
          <button type="button" className="gbtn gbtn-primary" onClick={() => void run(carry.set, carry.plan.carry)}>Carry over {plural(carry.plan.carry.length, 'guide', 'guides')}</button>
        )}
      </div>
      {carry.step === 'checked' && carry.plan.carry.length > 0 && <p ref={lineRef} className="gtool-note greports-row" role="status">{checkedLine(carry.plan, carry.set)}</p>}
      {carry.step === 'checked' && carry.plan.carry.length === 0 && <p ref={lineRef} className="gtool-note greports-row" role="status">No guide needs carrying over to {nameOf(carry.set)}.</p>}
      {carry.step === 'running' && <p ref={lineRef} className="gtool-note greports-row" role="status">Carried over {carry.done} of {carry.total}.</p>}
      {carry.step === 'done' && (
        <p ref={lineRef} className="gtool-note greports-row" role="status">
          {carry.tagged > 0 ? `Carried over ${plural(carry.tagged, 'guide', 'guides')} to ${nameOf(carry.set)}.` : `No guide needed carrying over to ${nameOf(carry.set)}.`}
        </p>
      )}
      {carry.step === 'stopped' && (
        <>
          <p className="gtool-note greports-row" role="alert">{carry.said}</p>
          <p ref={lineRef} className="gtool-note greports-row" role="status">Carried over {carry.done} of {carry.total} so far. Press Check to continue.</p>
        </>
      )}
      {carry.step === 'failed' && <p ref={lineRef} className="gtool-note greports-row" role="alert">Could not read the guides. Try again.</p>}
    </>
  );
});

/**
 * THE TEAM'S PILL: open reports, hidden guides, and Carry guides over.
 *
 * TEAM ONLY, TWICE OVER. The host draws this panel only while the guides store holds the team flag for the account
 * that is signed in, and the reports it reads are answered only for a team account (row level security on
 * `guide_reports`). The hidden guides and the tags are answered as the asking account may read them: all of them for
 * the team (the read rule on `guides`), which is the only account this panel is ever drawn for.
 *
 * REPORTS ARE PRIVATE, AND LIVE ONLY HERE. They say which guides were reported and what other players wrote about
 * them. Nothing read here goes into the guides store, onto the device, or into anything outside this component: it is
 * this component's own state, and it dies with it. (The one thing this file asks of the guides store is to read the
 * GUIDES again after a carry-over: see `CarryOver`.) Who sent a report is never read (the seam does not ask for it) and
 * never shown. The host gives the panel to one account: when the account changes it takes the panel away and draws a
 * new one, so nothing one account read is ever on the screen for the next.
 *
 * AN ANSWER IS USED ONLY FOR THE ACCOUNT THAT ASKED, AND ONLY IF IT IS STILL THE NEWEST. Before every request the
 * account at the keyboard is noted and a number is taken; when the answer lands it is used only if that account is
 * still at the keyboard and no newer request of the same kind has been made. Leaving the panel counts as a newer
 * request, so nothing is set, and nothing more is asked, once it is gone. This holds for the two lists, for a dismiss,
 * and (in `CarryOver`) for a check and for every batch of a run.
 *
 * THE TWO LISTS ARE READ TOGETHER, AND EACH STANDS ALONE. One of them failing does not hide the other: the one that
 * loaded is shown, and the one that failed says so under its own heading, with Try again (which reads both again).
 *
 * WHAT IS DRAWN STAYS UNTIL THE NEW ANSWER LANDS. The lists are read again after a dismiss, and when the host says a
 * card changed something (`refreshKey`: a hide, an unhide or a delete). Until that answer lands the groups and cards
 * already on the screen stay, so a card keeps the sentence it is showing; a list that cannot be read again keeps what
 * it was showing too. Each list says it is loading ("Loading reports.", "Loading hidden guides.") only until its first
 * answer: a list that has loaded once never says it again, and one that never has says it again after Try again.
 *
 * A DISMISS. While one is on its way no Dismiss button can be pressed, and they stay off until the lists have been
 * read again, so the same reports are never dismissed twice. "Read again" means the NEWEST read has landed: if a
 * card asked the lists again meanwhile (a hide bumps `refreshKey`), the read the dismiss made is overtaken and
 * answers nothing, so the dismiss waits for the one that overtook it. A refusal is a sentence in the group it is
 * about. A dismiss answered with anything that is not a refusal the server is known to give (the answer was lost,
 * could not be read, or the call threw) may have landed: it says to check, and reads again.
 *
 * NOTES. A group draws its five newest notes. When a guide has more, a line under them says how many more there are
 * ("and 3 more notes."), so no note is left out unheard.
 *
 * THE CARDS ARE THE HOST'S (`renderCard`), so a card here has the same buttons, the same rules and the same key as
 * anywhere else in the tab. A hidden guide's card carries Unhide and Delete for the team: this is the only place a
 * player's hidden guide can be unhidden on screen.
 *
 * BY KEYBOARD. A Dismiss button is switched off while its dismiss is on its way, and a browser then drops focus to the
 * page. When the lists have been read again, focus goes to the Dismiss button of the group now in that place (the
 * next one down, or the last one), so a long list is not scrolled back to its top; with no group left it goes to the
 * Open reports heading. After a refusal it goes back to the button that was pressed. Try again is taken away while
 * the lists are read: focus then goes back to it if it returns, or to its section's heading. Focus is never pulled
 * back from somewhere the player has moved to meanwhile. The three headings can take focus but are not tab stops.
 *
 * PERFORMANCE. The reports are grouped, and each guide is built, once per answer (`useMemo`), so a redraw for any
 * other reason hands every card the same guide and the card is skipped. Cards mount through `LazyCell` (the first two
 * at once, the rest near the viewport), as in the other lists; this panel is the only thing in the host's scroll box
 * that provides the lazy root while it is shown. Nothing animates, nothing polls, and no layout is read.
 */
export const ReportsPanel = memo(function ReportsPanel({ setId, refreshKey, renderCard, root }: {
  /** The set the Compendium is showing: the carry-over's starting choice. */
  setId: SetId;
  /** Bumped by the host after a hide, an unhide or a delete made from a card: read the lists again. */
  refreshKey: number;
  /** The host draws each card. Must be stable. */
  renderCard: (g: Guide) => JSX.Element;
  /** The tab's scroll box, which the lazy cells watch. */
  root: HTMLDivElement | null;
}): JSX.Element {
  const [lists, setLists] = useState<Lists>(NOTHING);
  /** The guide whose reports are being dismissed. */
  const [busy, setBusy] = useState<string | null>(null);
  /** A refused dismiss: the sentence, and the guide it is about. */
  const [said, setSaid] = useState<{ id: string; text: string } | null>(null);
  /** Bumped when a dismiss has ended and its buttons can be pressed again (a count, so it always changes). */
  const [settled, setSettled] = useState(0);

  /** Each read of the lists, and each dismiss, takes a number. Leaving counts as a newer one of each. */
  const reads = useRef(0);
  const dismisses = useRef(0);
  /** The lists are being read. */
  const reading = useRef(false);
  /** A dismiss is on its way. A ref, so a second press in the same instant sees it. */
  const dismissing = useRef(false);
  useEffect(() => () => { reads.current += 1; dismisses.current += 1; }, []);

  const reportsHead = useRef<HTMLHeadingElement>(null);
  const hiddenHead = useRef<HTMLHeadingElement>(null);
  const reportsAgain = useRef<HTMLButtonElement>(null);
  const hiddenAgain = useRef<HTMLButtonElement>(null);
  /** Try again was pressed in this section: where focus goes back to once the lists have been read. */
  const backTo = useRef<'reports' | 'hidden' | null>(null);
  /** The Dismiss that was pressed: its guide, and its group's place in the list. */
  const pressed = useRef<{ id: string; index: number } | null>(null);

  /** The read made last. One that is overtaken by a newer read answers nothing: this is the one to wait for. */
  const newest = useRef<Promise<void>>(Promise.resolve());
  const load = useCallback((): Promise<void> => {
    reads.current += 1;
    const mine = reads.current;
    const who = asker();
    reading.current = true;
    // What is drawn stays. Only a "could not load" line goes while the lists are asked again.
    setLists((cur) => (cur.reports.failed || cur.hidden.failed
      ? { reports: { ...cur.reports, failed: false }, hidden: { ...cur.hidden, failed: false } }
      : cur));
    const read = (async (): Promise<void> => {
      let reports: OpenReport[] | undefined;
      let hidden: GuideRecord[] | undefined;
      try { [reports, hidden] = await Promise.all([fetchOpenReports(), fetchHiddenGuides()]); } catch { /* neither could be read */ }
      if (mine !== reads.current || asker() !== who) return;
      reading.current = false;
      setLists((cur) => ({ reports: answered(cur.reports, reports), hidden: answered(cur.hidden, hidden) }));
    })();
    newest.current = read;
    return read;
  }, []);
  /** Read the lists again, and wait until the NEWEST read has landed (see A DISMISS in the header). */
  const readAgain = useCallback(async (): Promise<void> => {
    let read = load();
    await read;
    while (read !== newest.current) {
      read = newest.current;
      await read;
    }
  }, [load]);
  // When the panel is drawn, and each time the host says a card changed something.
  useEffect(() => { void load(); }, [load, refreshKey]);

  const dismiss = async (id: string, index: number): Promise<void> => {
    if (dismissing.current) return;
    dismissing.current = true;
    dismisses.current += 1;
    const mine = dismisses.current;
    const who = asker();
    const stale = (): boolean => mine !== dismisses.current || asker() !== who;
    pressed.current = { id, index };
    setBusy(id);
    setSaid(null);
    try {
      let res: GuideWriteResult<number>;
      try { res = await dismissReportsRemote(id); } catch { res = { ok: false, code: 'server' }; }
      if (stale()) return;
      if (res.ok) sfx.tick();
      else setSaid({ id, text: guideErrorMessage(res.code, res.field, { action: 'moderate' }) });
      // Dismissed, or the answer is no refusal the server is known to give (it may have landed): read the lists
      // again, and keep the buttons off until they have been.
      if (res.ok || !isKnownRefusal('moderate', res.code)) await readAgain();
      if (stale()) return;
      setBusy(null);
      setSettled((n) => n + 1);
    } finally {
      dismissing.current = false;
    }
  };

  /** One group per reported guide, with the guide its card draws. Built once per answer, so a card is handed the same
   *  guide on every redraw. */
  const groups = useMemo(() => groupReports(lists.reports.items).map((group) => ({ group, guide: toGuide(group.guide) })), [lists.reports.items]);
  const hiddenGuides = useMemo(() => lists.hidden.items.map(toGuide).filter((g): g is Guide => g !== null), [lists.hidden.items]);

  // By keyboard (see the header): after a dismiss, once its buttons can be pressed again.
  useEffect(() => {
    if (pressed.current === null) return;
    const { id, index } = pressed.current;
    pressed.current = null;
    const buttons = [...(reportsHead.current?.parentElement?.querySelectorAll<HTMLButtonElement>('button[data-dismiss]') ?? [])];
    const same = buttons.find((b) => b.dataset.dismiss === id);
    if (!focusIsFree(same)) return;
    (same ?? buttons[Math.min(index, buttons.length - 1)] ?? reportsHead.current)?.focus();
  }, [settled]);
  // ...and after Try again, once the lists have been read.
  useEffect(() => {
    if (reading.current || backTo.current === null) return;
    const which = backTo.current;
    backTo.current = null;
    if (!focusIsFree()) return;
    ((which === 'reports' ? reportsAgain.current : hiddenAgain.current) ?? (which === 'reports' ? reportsHead.current : hiddenHead.current))?.focus();
  }, [lists]);
  const tryAgain = (which: 'reports' | 'hidden'): void => {
    backTo.current = which;
    void load();
  };

  const { reports, hidden } = lists;
  return (
    <LazyRootProvider root={root}>
      <h3 className="gloss-grouphead greports-head" tabIndex={-1} ref={reportsHead}>Open reports</h3>
      {reports.failed && (
        <p className="gtool-note greports-row" role="alert">
          <span>Could not load the reports.</span>
          <button type="button" className="gbtn" ref={reportsAgain} onClick={() => tryAgain('reports')}>Try again</button>
        </p>
      )}
      {!reports.loaded && !reports.failed && <p className="gtool-note greports-row" role="status">Loading reports.</p>}
      {reports.loaded && !reports.failed && groups.length === 0 && <p className="gtool-note greports-row">No open reports.</p>}
      {groups.map(({ group, guide }, i) => (
        <div className="greports-group" key={group.guide.id}>
          <p className="gtool-note greports-sum">
            <span>{summaryOf(group)}</span>
            {group.notes.map((n, k) => <span className="greports-quote" key={k}>{`"${n}"`}</span>)}
            {/* A line of its own, like a note (it wears the note's class for that), and not in quotes: nobody wrote it. */}
            {group.moreNotes > 0 && <span className="greports-quote greports-more">{`and ${plural(group.moreNotes, 'more note', 'more notes')}.`}</span>}
            <button type="button" className="gbtn" data-dismiss={group.guide.id} aria-label={`Dismiss reports of ${group.guide.title}`}
              disabled={busy !== null} onClick={() => void dismiss(group.guide.id, i)}>Dismiss reports</button>
          </p>
          {said && said.id === group.guide.id && <p className="gtool-note" role="alert">{said.text}</p>}
          {guide && <LazyCell eager={i < 2} className="bookguide-slot">{() => renderCard(guide)}</LazyCell>}
        </div>
      ))}

      <h3 className="gloss-grouphead greports-head" tabIndex={-1} ref={hiddenHead}>Hidden guides</h3>
      {hidden.failed && (
        <p className="gtool-note greports-row" role="alert">
          <span>Could not load the hidden guides.</span>
          <button type="button" className="gbtn" ref={hiddenAgain} onClick={() => tryAgain('hidden')}>Try again</button>
        </p>
      )}
      {!hidden.loaded && !hidden.failed && <p className="gtool-note greports-row" role="status">Loading hidden guides.</p>}
      {hidden.loaded && !hidden.failed && hiddenGuides.length === 0 && <p className="gtool-note greports-row">No hidden guides.</p>}
      {hiddenGuides.map((g, i) => (
        <LazyCell key={g.id} eager={groups.length + i < 2} className="bookguide-slot">{() => renderCard(g)}</LazyCell>
      ))}

      <h3 className="gloss-grouphead greports-head" tabIndex={-1}>Carry guides over</h3>
      <CarryOver setId={setId} />
    </LazyRootProvider>
  );
});
