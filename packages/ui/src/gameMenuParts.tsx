/**
 * THE IN-GAME MENU's own pieces (owner 2026-10-29, R-ESC-SIDEBAR-01: "when pressing escape, have the left side bar come
 * up with the play/etc buttons. allow players to view this information in game"). The menu IS the main menu's sidebar
 * (`MenuSidebar`), slid in over the dimmed game; in a game it swaps three things in:
 *
 *   - RESUME, the gold plaque where Play sits on the menus: closes the menu, back to the game;
 *   - THE LEAVE BUTTON right under Resume, in red (owner 2026-10-29, R-ESC-SIDEBAR-01: "put "Leave" or "Quit" under
 *     resume instead, and make the button red"): Save & Quit in a solo or lobby game, Concede in Versus / Duos / Ranked Duos,
 *     Abandon from a ranked hero select, Leave replay, Stop watching. Every one asks twice (a confirm step);
 *   - THE SHOP CLOCK under those, so a player reading a page never times out (the game keeps running underneath).
 *
 * A page action that would take the player OUT of the game (watch a replay, watch a live game) is refused while the
 * menu is open, with a short note on the sidebar instead (`refuseInGame`).
 */
import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { useGame } from './store';
import { sfx } from './sfx';
import { Icon } from './Icon';
import { Crest } from './menuIcons';
import { useTurnClockRunning, useTurnSeconds } from './turnClock';
import { goldClockWaiting } from './goldClock';
import { endReplay } from './replay/replayPlayer';
import { forfeitMatch } from './versus/versusStore';
import { leaveSpectating, useSpectate } from './versus/spectate';
import { isWatchingLive, leaveLiveGame } from './live/liveWatch';

/** What the foot of the in-game sidebar leaves. */
export type LeaveKind = 'watch' | 'replay' | 'abandon' | 'concede' | 'run';

/** Which leave applies (the same reading the old Esc modal made): a spectator leaves the watched game, a replay ends,
 *  Versus (every Versus area, Duos and Ranked Duos included) concedes, a ranked hero select abandons, a run saves. */
export function leaveKindOf(
  s: Pick<ReturnType<typeof useGame.getState>, 'replaying' | 'showTitle' | 'run' | 'heroChoices' | 'pendingMode' | 'rankedEntry'>,
  watching: boolean,
): LeaveKind {
  if (watching) return 'watch';
  if (s.replaying) return 'replay';
  if (s.run.mode === 'versus' || (s.heroChoices !== null && s.pendingMode === 'versus')) return 'concede';
  if (s.heroChoices !== null && s.pendingMode === 'lobby' && s.rankedEntry !== null) return 'abandon';
  return 'run';
}

interface LeaveText { label: string; confirm: string; note: string }
/** The button's words: its label, the armed label (tap again), and the note shown while armed and on hover. */
export function leaveText(kind: LeaveKind, godMode: boolean, live: boolean): LeaveText {
  switch (kind) {
    case 'watch': return live
      ? { label: 'Stop watching', confirm: 'Tap again to leave', note: 'Back to the live games. The game goes on.' }
      : { label: 'Leave match', confirm: 'Tap again to leave', note: 'Back to the room. The match goes on.' };
    case 'replay': return { label: 'Leave replay', confirm: 'Tap again to leave', note: 'Back to the main menu. The replay closes.' };
    case 'abandon': return { label: 'Abandon match', confirm: 'Tap again to abandon', note: 'This is a ranked lobby. Leaving now counts as an 8th place finish and costs MMR.' };
    case 'concede': return { label: 'Concede', confirm: 'Tap again to concede', note: 'Your opponent wins this match. You go back to the room.' };
    case 'run': return godMode
      ? { label: 'Leave God Mode', confirm: 'Tap again to leave', note: 'Returns to the menu. Nothing from this game is saved.' }
      : { label: 'Save & Quit', confirm: 'Tap again to quit', note: 'Saves this exact moment and returns to the menu. Continue picks up right here.' };
  }
}

/** How long an armed leave waits for its second tap before it disarms. */
const ARM_MS = 4000;

/** THE LEAVE BUTTON, red, right under Resume on the in-game sidebar (R-ESC-SIDEBAR-01). First tap arms it (its label asks for a second tap and its note
 *  shows); the second tap leaves. It disarms on its own after a few seconds. */
export function LeaveButton() {
  const watching = useSpectate((s) => s.active);
  const kind = useGame((s) => leaveKindOf(s, watching));
  const godMode = useGame((s) => s.run.godMode === true);
  const [armed, setArmed] = useState(false);
  const noteId = useId();
  useEffect(() => {
    if (!armed) return undefined;
    const t = window.setTimeout(() => setArmed(false), ARM_MS);
    return () => window.clearTimeout(t);
  }, [armed]);
  const text = leaveText(kind, godMode, kind === 'watch' && isWatchingLive());
  const leave = (): void => {
    const st = useGame.getState();
    switch (kind) {
      case 'watch': st.closeGameMenu(); if (isWatchingLive()) leaveLiveGame(true); else leaveSpectating(); break;
      case 'replay': endReplay(); useGame.getState().openTitle(); break;
      case 'abandon': st.closeGameMenu(); st.abandonRankedEntry(); break;
      case 'concede': st.closeGameMenu(); void forfeitMatch(); break;
      case 'run': st.openTitle(); break;
    }
  };
  return (
    <div className="msb-item msb-leavewrap" data-tip={armed ? undefined : text.note}>
      <button
        className={`sbbtn msb-leave${armed ? ' armed' : ''}`}
        aria-describedby={armed ? noteId : undefined}
        onClick={() => { sfx.pulse(); if (!armed) { setArmed(true); return; } setArmed(false); leave(); }}
      >
        <span className="mbicon"><Icon name="house" /></span>
        <span className="mblabel">{armed ? text.confirm : text.label}</span>
      </button>
      {armed && <div className="msb-leavenote" id={noteId}>{text.note}</div>}
    </div>
  );
}

/** RESUME: the gold plaque where Play sits on the menus. Back to the game. */
export function ResumeButton() {
  const close = useGame((s) => s.closeGameMenu);
  return (
    <button className="sbbtn sb-play msb-resume" onClick={() => { sfx.pulse(); close(); }}>
      <span className="mbicon"><Crest /></span>
      <span className="mblabel">Resume</span>
    </button>
  );
}

/** Should the sidebar show the Shop clock? A live Shop turn of the player's own game (not a replay, not a watched game,
 *  not Practice on unlimited time, not a dev sandbox with no clock). */
export function shopClockShown(
  s: Pick<ReturnType<typeof useGame.getState>, 'replaying' | 'run' | 'practiceTimer'>,
  watching: boolean,
): boolean {
  if (watching || s.replaying || s.run.phase !== 'recruit') return false;
  if (s.run.mode === 'practice' && !s.run.sandbox && s.practiceTimer === 0) return false;
  return !(s.run.sandbox && s.run.godMode === true);
}

/** THE SHOP CLOCK on the sidebar: the time left this turn, read off the same clock the Shop shows (it subscribes to the
 *  clock alone, so only this line re-renders per second). Red in the last 10 seconds; says when the clock is waiting
 *  for Gold (a Gold Fuse turn) or held. */
export function SidebarShopClock() {
  const watching = useSpectate((s) => s.active);
  const shown = useGame((s) => shopClockShown(s, watching));
  if (!shown) return null;
  return <ClockLine />;
}

function ClockLine() {
  const s = Math.max(0, useTurnSeconds());
  const running = useTurnClockRunning();
  const waiting = goldClockWaiting(s);
  // A Gold Fuse turn's clock has not started (it waits for the turn's first Gold to be spent): one plain line, no number.
  const face = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const state = waiting ? 'Shop clock starts when you spend Gold' : s <= 0 ? 'Time is up' : running ? 'Shop time left' : 'Shop clock paused';
  return (
    <div className={`msb-clock${!waiting && s <= 10 ? ' low' : ''}`} role="timer" aria-label={waiting ? state : `${state}. ${face}`}>
      <span className="msb-clock-ic"><Icon name="clock" /></span>
      <span className="msb-clock-l">{state}</span>
      {!waiting && <span className="msb-clock-v">{face}</span>}
    </div>
  );
}

// ── A refused page action (watching a replay or a live game while in a game) ──────────────────────────────────────────
let note: { text: string; at: number } | null = null;
const noteListeners = new Set<() => void>();
const NOTE_MS = 3000;
let noteTimer = 0;

/** A page action that would leave the game asks for this first: while the in-game menu is open it is refused, with a
 *  note on the sidebar. Returns true when the action must not run. */
export function refuseInGame(what = 'watch'): boolean {
  if (!useGame.getState().gameMenuOpen) return false;
  note = { text: `Leave this game first to ${what}.`, at: Date.now() };
  noteListeners.forEach((l) => l());
  if (typeof window !== 'undefined') {
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => { note = null; noteListeners.forEach((l) => l()); }, NOTE_MS);
  }
  return true;
}
const subscribeNote = (l: () => void): (() => void) => { noteListeners.add(l); return () => { noteListeners.delete(l); }; };
const readNote = (): { text: string; at: number } | null => note;

/** The refused-action note, on the sidebar while it lasts. */
export function InGameNote() {
  const n = useSyncExternalStore(subscribeNote, readNote, readNote);
  if (!n) return null;
  return <div className="msb-ingamenote" role="status" key={n.at}>{n.text}</div>;
}
