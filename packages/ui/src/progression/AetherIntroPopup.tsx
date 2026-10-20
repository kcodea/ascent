import { useEffect, useRef, useState } from 'react';
import { AETHER_LAUNCH_GRANT } from '@game/progression';
import { sfx } from '../sfx';
import { RANKED_CONFIRM_EXIT_MS } from '../rank/rankedEntry';
import './collection.css';

/**
 * INTRODUCING AETHER (owner 2026-10-19, R-PROG-AETHER-05): the announcement a player sees the FIRST time they land on
 * the Collection once Aether is live. It is the Ranked confirmation's window, exactly (owner: "the exact pop in effect
 * and style as the play confirmation screen"): the same `.rankedconfirm*` classes, so the same Compendium frame, crests,
 * title over the painted divider, Gem-plate button, darkened + blurred veil and the `rc-pop` bounce in / `rc-out` exit.
 * `.aetherintro-ov` only lifts it over the Collection page and widens the text a little for the longer copy.
 *
 * Once per account per device: the seen flag is a local convenience (`ascent.aetherIntro.seen.<userId>`), never
 * state anything else reads. The server pays the 1,000 (2026-10-19-aether-launch-grant.sql) to every profile, so the
 * caller shows this only for an account whose profile has loaded.
 */

/** The copy, the owner's words (2026-10-19); "an currency" read as "a currency". The amount is the server's grant. */
export const AETHER_INTRO_TITLE = 'Introducing Aether';
export const AETHER_INTRO_TEXT = 'Aether is a currency that you earn by playing Ascent. Earn even more by placing higher in ranked matches. Aether is used to unlock chests of various rarities that contain hundreds of different cosmetic items.';
export const AETHER_INTRO_GIFT = `Enjoy the first ${AETHER_LAUNCH_GRANT.toLocaleString('en-US')} Aether on us!`;
export const AETHER_INTRO_SIGN = '- The Ascent Team';
/** The one answer. The wording is Claude's pick, not the owner's. */
export const AETHER_INTRO_OK = 'Continue';

const seenKey = (userId: string): string => `ascent.aetherIntro.seen.${userId}`;
/** Accounts that saw it this session, for when storage is blocked (it then shows once per session, not every visit). */
const seenThisSession = new Set<string>();

export function aetherIntroSeen(userId: string): boolean {
  if (seenThisSession.has(userId)) return true;
  try { return localStorage.getItem(seenKey(userId)) === '1'; } catch { return false; }
}
/** Tests: forget this session's seen accounts (storage is cleared by the test itself). */
export function resetAetherIntroForTests(): void { seenThisSession.clear(); }
function markAetherIntroSeen(userId: string): void {
  seenThisSession.add(userId);
  try { localStorage.setItem(seenKey(userId), '1'); } catch { /* the session set still keeps it from repeating */ }
}

export function AetherIntroPopup({ userId, onDone }: {
  /** The account it is shown for: the seen flag is theirs. */
  userId: string;
  /** Called once the exit has played (the caller unmounts it and lets the next popup in). */
  onDone: () => void;
}): JSX.Element {
  const [closing, setClosing] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  // Showing it IS seeing it: marked on mount, so leaving the Collection mid-entrance never shows it twice.
  useEffect(() => { markAetherIntroSeen(userId); }, [userId]);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);
  const close = (): void => {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(() => { timer.current = null; onDone(); }, RANKED_CONFIRM_EXIT_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sfx.tick(); closeRef.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className={`rankedconfirm-ov aetherintro-ov${closing ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label={AETHER_INTRO_TITLE}>
      <div className="rankedconfirm-veil" onClick={close} aria-hidden="true" />
      <div className="rankedconfirm aetherintro">
        <span className="rc-crest" aria-hidden="true" />
        <span className="rc-crest rc-crest-foot" aria-hidden="true" />
        <div className="rc-title">{AETHER_INTRO_TITLE}</div>
        <p className="rankedconfirm-text">{AETHER_INTRO_TEXT}</p>
        <p className="rankedconfirm-text aetherintro-gift">{AETHER_INTRO_GIFT}</p>
        <p className="aetherintro-sign">{AETHER_INTRO_SIGN}</p>
        <div className="rankedconfirm-actions">
          <button ref={okRef} className="rc-btn rc-btn-yes" disabled={closing} onClick={() => { sfx.pulse(); close(); }}>{AETHER_INTRO_OK}</button>
        </div>
      </div>
    </div>
  );
}
