/**
 * THE ANCIENTS PROMPT (owner ask 2026-11-16): once the Ancients release switch is on, the first time a player
 * reaches the main menu they are offered the short Ancients tutorial. "Try it" starts it; "Later" retires the
 * prompt (the Learn hub's Ancients card stays, so the lesson is always one click away).
 *
 * Once per player: the seen flag is kept per account when signed in AND per device, and either one counts. Both
 * are local conveniences (`localStorage`, guarded; a blocked store falls back to once per session). It never
 * shows while the switch is off, over the new-player tutorial nudge, over another dialog, or when the player has a
 * saved game (starting a tutorial replaces the save slot, so it would cost them that game).
 *
 * The card is the title's own "Try the Tutorial" nudge (`.tutprompt-*`), reused as is.
 */
import { useEffect } from 'react';
import { sfx } from '../sfx';

export const ANCIENTS_PROMPT_EYEBROW = 'New';
export const ANCIENTS_PROMPT_TITLE = 'Ancients have awakened';
export const ANCIENTS_PROMPT_TEXT = 'Try the 2 minute tutorial?';
export const ANCIENTS_PROMPT_YES = 'Try it';
export const ANCIENTS_PROMPT_LATER = 'Later';

const DEVICE_KEY = 'ascent.ancientsPrompt.seen';
const accountKey = (userId: string): string => `${DEVICE_KEY}.${userId}`;
/** Seen this session, for when storage is blocked. */
let seenThisSession = false;

function read(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function write(key: string): void {
  try { localStorage.setItem(key, '1'); } catch { /* the session flag still stops a repeat */ }
}

export function ancientsPromptSeen(userId?: string | null): boolean {
  if (seenThisSession || read(DEVICE_KEY)) return true;
  return !!userId && read(accountKey(userId));
}

export function markAncientsPromptSeen(userId?: string | null): void {
  seenThisSession = true;
  write(DEVICE_KEY);
  if (userId) write(accountKey(userId));
}

/** Tests: forget the session flag (storage is cleared by the test itself). */
export function resetAncientsPromptForTests(): void { seenThisSession = false; }

/** Everything that decides whether the prompt may show right now. Pure, so the rule is unit-tested. */
export interface AncientsPromptGate {
  /** The Ancients release switch. */
  live: boolean;
  userId?: string | null;
  /** The title's MAIN menu is the screen (not a sub-view, a page, or a game). */
  onMainMenu: boolean;
  /** A new player who has not finished or skipped Learn Ascent (they get the tutorial nudge instead). */
  newPlayer: boolean;
  /** Another dialog is up over the menu. */
  otherDialog: boolean;
  /** The player has a saved game (a tutorial would replace it). */
  hasSavedRun: boolean;
}

export function shouldShowAncientsPrompt(g: AncientsPromptGate): boolean {
  return g.live && g.onMainMenu && !g.newPlayer && !g.otherDialog && !g.hasSavedRun && !ancientsPromptSeen(g.userId);
}

export function AncientsPrompt({ userId, onTry, onLater }: {
  userId?: string | null;
  onTry: () => void;
  onLater: () => void;
}): JSX.Element {
  // Showing it IS seeing it: marked on mount, so a reload mid-prompt never shows it twice.
  useEffect(() => { markAncientsPromptSeen(userId); }, [userId]);
  return (
    <div className="modepick tutprompt-ov" role="dialog" aria-label={ANCIENTS_PROMPT_TITLE}>
      <div className="tutprompt-card">
        <div className="eyebrow">{ANCIENTS_PROMPT_EYEBROW}</div>
        <h1 className="disp tutprompt-title">{ANCIENTS_PROMPT_TITLE}</h1>
        <p className="tutprompt-sub">{ANCIENTS_PROMPT_TEXT}</p>
        <div className="tutprompt-actions">
          <button className="endplay pressable" onClick={() => { sfx.pulse(); onTry(); }}>{ANCIENTS_PROMPT_YES}</button>
          <button className="tutprompt-skip" onClick={() => { sfx.pulse(); onLater(); }}>{ANCIENTS_PROMPT_LATER}</button>
        </div>
      </div>
    </div>
  );
}
