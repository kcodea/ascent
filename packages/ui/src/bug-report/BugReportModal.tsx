import { useEffect, useMemo, useRef, useState } from 'react';
import { HERO_INDEX } from '@game/sim';
import { useGame } from '../store';
import { validateBugReportDraft } from './bugReportValidation';
import { BUG_ISSUE_TYPE_LABELS, BUG_DESCRIPTION_MAX, type BugIssueType } from './bugReportTypes';

/**
 * BUG REPORTER (PR 1) — the centered glass modal (blueprint §1.2 / §5.4).
 *
 * Self-gates on `bugReportOpen` (and renders the §4.3 toast off `bugReportToast`), so `Game.tsx` mounts it
 * unconditionally like the other overlays. Restrained on purpose: this is an interruption-recovery tool —
 * one fade-in, no looping animation, no sfx. The recruit timer + combat playback pause through Recruit's
 * existing `overlayOpen` path the moment `bugReportOpen` flips (§4.1/§4.2); nothing here touches the clock.
 *
 * Keyboard (capture-phase window listener, so the game shell's own Esc/Tab listeners never fire underneath):
 *  Escape cancels, Ctrl+Enter submits when valid, Tab moves focus normally (but can't toggle the Minion
 *  Book), and a repeated Ctrl+B refocuses the textarea (via `bugReportFocusSeq`).
 */
export function BugReportModal() {
  const open = useGame((s) => s.bugReportOpen);
  const toast = useGame((s) => s.bugReportToast);
  return (
    <>
      {toast && <div className="bgrtoast" role="status">{toast}</div>}
      {open && <BugReportPanel />}
    </>
  );
}

const ISSUE_TYPES = Object.keys(BUG_ISSUE_TYPE_LABELS) as BugIssueType[];

function BugReportPanel() {
  const draft = useGame((s) => s.bugReportDraft);
  const focusSeq = useGame((s) => s.bugReportFocusSeq);
  const update = useGame((s) => s.updateBugReportDraft);
  const cancel = useGame((s) => s.cancelBugReport);
  const submit = useGame((s) => s.submitBugReport);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [techOpen, setTechOpen] = useState(false);

  // Focus the textarea on open AND on every repeated Ctrl+B while open (§1.2 keyboard behavior).
  useEffect(() => { textRef.current?.focus(); }, [focusSeq]);

  const valid = draft ? validateBugReportDraft(draft).ok : false;

  // Capture-phase so the shell's Esc (menu) / Tab (Minion Book) window listeners never see these keys while
  // the reporter is up. Tab keeps its DEFAULT (focus moves within the modal) — only the propagation stops.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        useGame.getState().cancelBugReport();
      } else if (e.key === 'Tab') {
        e.stopPropagation();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        const d = useGame.getState().bugReportDraft;
        if (d && validateBugReportDraft(d).ok) void useGame.getState().submitBugReport();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  // The capsule is immutable — its serialized size is computed once per open (capsule identity is stable
  // for the draft's whole lifetime; typing only replaces the draft wrapper, never the capsule).
  const capsule = draft?.capsule ?? null;
  const payloadBytes = useMemo(() => (capsule ? JSON.stringify(capsule).length : 0), [capsule]);

  if (!draft || !capsule) return null;
  const cap = capsule;
  const heroName = HERO_INDEX[cap.heroId]?.name ?? cap.heroId;
  const inCombat = cap.phase === 'combat';

  return (
    <div className="bgrov">
      {/* Backdrop clicks deliberately do NOT cancel — typed report text must never be lost to a stray click. */}
      <div className="bgrpanel" role="dialog" aria-modal="true" aria-label="Report a problem">
        <div className="bgrhead">
          <span className="bgrtitle disp">Report a problem</span>
          <span className={`bgrbadge${inCombat ? ' combat' : ''}`}>
            {inCombat ? 'COMBAT' : 'SHOP'} · Round {cap.wave}
          </span>
          {!inCombat && cap.timerSecondsRemaining != null && (
            <span className="bgrclock" title="The turn timer is paused while this report is open">
              ⏸ {cap.timerSecondsRemaining}s
            </span>
          )}
        </div>
        <div className="bgrbody">
          <p className="bgrhelper">
            Tell us what happened and what you expected instead. The current turn and combat details will be
            attached automatically.
          </p>
          <label className="bgrlabel" htmlFor="bgrtext">What happened?</label>
          <textarea
            id="bgrtext"
            ref={textRef}
            className="bgrtext"
            placeholder="Example: My left-most Echo triggered, but the summoned Beast did not attack."
            maxLength={BUG_DESCRIPTION_MAX}
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
          />
          <div className="bgrdisclose">This report includes the current run state, recent actions, and combat events.</div>
          <label className="bgrlabel" htmlFor="bgrtype">Issue type (optional)</label>
          <select
            id="bgrtype"
            className="bgrselect"
            value={draft.issueType}
            onChange={(e) => update({ issueType: e.target.value as BugIssueType })}
          >
            {ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>{BUG_ISSUE_TYPE_LABELS[t]}</option>
            ))}
          </select>
          <div className="bgrsummary">
            <span>Round {cap.wave}</span>
            <span>{inCombat ? 'Combat' : 'Shop'} phase</span>
            <span>{heroName}</span>
            <span>Set {cap.setId}</span>
            <span>v{__APP_VERSION__} {__BUILD_SHA__}</span>
            <span className="bgrattached">Current turn and latest combat log attached</span>
          </div>
          {/* Collapsible tester detail — ids + payload size only, never the raw payload (§1.2). */}
          <button className="bgrtechtoggle" aria-expanded={techOpen} onClick={() => setTechOpen((v) => !v)}>
            Technical details {techOpen ? '▾' : '▸'}
          </button>
          {techOpen && (
            <div className="bgrtech">
              <div>run {cap.runId} · seed {cap.seed} · {cap.mode} · tier {cap.shopTier}</div>
              <div>
                actions {cap.actions.length} · frames {cap.currentWaveFrames.length}+{cap.previousWaveFrames.length}
                {' '}· combat events {cap.combat ? cap.combat.result.events.length : 0}
              </div>
              <div>capsule ~{(payloadBytes / 1024).toFixed(1)} KB</div>
            </div>
          )}
        </div>
        <div className="bgrbtns">
          <button className="bgrbtn" onClick={() => cancel()}>Cancel</button>
          <button className="bgrbtn bgrsubmit" disabled={!valid} onClick={() => { void submit(); }}>
            Submit report
          </button>
        </div>
      </div>
    </div>
  );
}
