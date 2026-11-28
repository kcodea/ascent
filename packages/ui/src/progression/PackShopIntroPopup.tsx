import { useEffect, useRef, useState } from 'react';
import { PACK_LAUNCH_GRANT } from '@game/progression';
import { sfx } from '../sfx';
import { RANKED_CONFIRM_EXIT_MS } from '../rank/rankedEntry';
import { usePhLayer } from '../partyHome/shell/usePhLayer';
import { useGame } from '../store';
import { mirrorFor, packsVisible, useProgression } from './progressionStore';
import { fetchPackLaunchGiftReceived } from './progressionRemote';
import './collection.css';

/**
 * INTRODUCING THE PACK SHOP (the pack economy, 2026-12-01, spec section 12.1): the one-time announcement a player sees the
 * first time the game opens on the menus with packs on (the server's `packs_enabled`, never this client's version). The
 * window is the "Introducing Aether" announcement's (`AetherIntroPopup.tsx`: the Ranked confirmation's `.rankedconfirm*`
 * shell), and its seen flag is the same kind of local convenience (`ascent.packShopIntro.seen.<userId>`).
 *
 * THE 3,000 AETHER (owner 2026-11-27, "Launch-day accounts only"): the rollout paid it to the accounts that existed when
 * it ran, and to no account made after. So the gift line is shown only to an account whose ledger holds the gift
 * (`grant` / `pack_launch`, one owner-read row, asked only while this has not been seen); an account made after the launch
 * sees the announcement without it. Until that read answers, nothing shows (it is asked again next time). The Aether is
 * the rollout's, not this window's: dismissing it, or never seeing it, changes no balance.
 *
 * It waits while a gift notice (an item, or Aether from the team) is up.
 */

export const PACK_INTRO_TITLE = 'Introducing the Pack Shop';
export const PACK_INTRO_TEXT = 'Chests have made way for packs. Open the Shop to spend Aether on packs of five cosmetic cards, with new deals every 6 hours.';
export const PACK_INTRO_GIFT = `To celebrate the launch, you have received ${PACK_LAUNCH_GRANT.toLocaleString('en-US')} Aether. Enjoy!`;
export const PACK_INTRO_SIGN = '- The Ascent Team';
export const PACK_INTRO_OK = 'Continue';

const seenKey = (userId: string): string => `ascent.packShopIntro.seen.${userId}`;
/** Accounts that saw it this session, for when storage is blocked (it then shows once per session, not every visit). */
const seenThisSession = new Set<string>();

export function packShopIntroSeen(userId: string): boolean {
  if (seenThisSession.has(userId)) return true;
  try { return localStorage.getItem(seenKey(userId)) === '1'; } catch { return false; }
}
/** Tests: forget this session's seen accounts (storage is cleared by the test itself). */
export function resetPackShopIntroForTests(): void { seenThisSession.clear(); }
function markPackShopIntroSeen(userId: string): void {
  seenThisSession.add(userId);
  try { localStorage.setItem(seenKey(userId), '1'); } catch { /* the session set still keeps it from repeating */ }
}

/** Mounted on the menus. Self-gates: packs on, the account's profile loaded, not seen, the gift read answered. */
export function PackShopIntro(): JSX.Element | null {
  const userId = useGame((s) => s.account.userId);
  const packsOn = useProgression(packsVisible);
  const hasProfile = useProgression((s) => !!mirrorFor(userId, s.mirror));
  const giftUp = useProgression((s) => (!!s.gifts && s.gifts.userId === userId && s.gifts.ids.length > 0)
    || (!!s.aetherGifts && s.aetherGifts.userId === userId && s.aetherGifts.gifts.length > 0));
  const wanted = packsOn && !!userId && hasProfile && !packShopIntroSeen(userId);
  /** The gift read's answer for the account it was asked for. */
  const [gift, setGift] = useState<{ userId: string; received: boolean } | null>(null);
  /** The account it is up for (kept while it plays its exit, after the seen flag is set). */
  const [upFor, setUpFor] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted || !userId || gift?.userId === userId) return;
    let live = true;
    void fetchPackLaunchGiftReceived(userId).then((received) => { if (live && received !== undefined) setGift({ userId, received }); });
    return () => { live = false; };
  }, [wanted, userId, gift?.userId]);
  useEffect(() => { if (wanted && userId && gift?.userId === userId && !giftUp) setUpFor(userId); }, [wanted, userId, gift, giftUp]);
  if (!upFor || upFor !== userId) return null;
  return <PackShopIntroPopup userId={upFor} gift={gift?.userId === upFor && gift.received} onDone={() => setUpFor(null)} />;
}

export function PackShopIntroPopup({ userId, gift, onDone }: {
  /** The account it is shown for: the seen flag is theirs. */
  userId: string;
  /** The account got the launch gift: the gift line shows. */
  gift: boolean;
  /** Called once the exit has played. */
  onDone: () => void;
}): JSX.Element {
  const [closing, setClosing] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  // Showing it IS seeing it: marked on mount, so leaving mid-entrance never shows it twice.
  useEffect(() => { markPackShopIntroSeen(userId); }, [userId]);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);
  const close = (): void => {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(() => { timer.current = null; onDone(); }, RANKED_CONFIRM_EXIT_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  usePhLayer(true, () => closeRef.current());
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); sfx.tick(); closeRef.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <div className={`rankedconfirm-ov aetherintro-ov${closing ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label={PACK_INTRO_TITLE}>
      <div className="rankedconfirm-veil" onClick={close} aria-hidden="true" />
      <div className="rankedconfirm aetherintro">
        <span className="rc-crest" aria-hidden="true" />
        <span className="rc-crest rc-crest-foot" aria-hidden="true" />
        <div className="rc-title">{PACK_INTRO_TITLE}</div>
        <p className="rankedconfirm-text">{PACK_INTRO_TEXT}</p>
        {gift && <p className="rankedconfirm-text aetherintro-gift">{PACK_INTRO_GIFT}</p>}
        <p className="aetherintro-sign">{PACK_INTRO_SIGN}</p>
        <div className="rankedconfirm-actions">
          <button ref={okRef} className="rc-btn rc-btn-yes" disabled={closing} onClick={() => { sfx.pulse(); close(); }}>{PACK_INTRO_OK}</button>
        </div>
      </div>
    </div>
  );
}
