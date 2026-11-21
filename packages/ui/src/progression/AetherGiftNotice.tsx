import { useEffect, useRef, useState } from 'react';
import { sfx } from '../sfx';
import { RANKED_CONFIRM_EXIT_MS } from '../rank/rankedEntry';
import { usePhLayer } from '../partyHome/shell/usePhLayer';
import { useGame } from '../store';
import { dismissAetherGift, useProgression } from './progressionStore';
import type { AetherGift } from './progressionRemote';
import './collection.css';

/**
 * AETHER GIFTS (owner 2026-11-20: "i would like upon them logging in, to recieve a prompt. it should say, you've been
 * gifted XXX Aether from the Ascent team for: ...", R-PROG-GIFT-02). The team pays a player through the SQL tool
 * `aether_gift` (supabase/migrations/2026-11-22-aether-gifts.sql) with a reason; the next time that player loads the
 * game, the menus show one pop-up PER gift, oldest first, naming the amount and the reason. Closing it any way marks
 * that gift seen on the account, so it never returns on this or any other device.
 *
 * The window is the "Introducing Aether" announcement's (the Ranked confirmation's `.rankedconfirm*` shell), so an
 * Aether message from the team always looks the same. It waits while the cosmetic gift notice is open.
 */

export const AETHER_GIFT_TITLE = 'A Gift of Aether';
export const aetherGiftText = (amount: number): string =>
  `You've been gifted ${amount.toLocaleString('en-US')} Aether from the Ascent team for:`;
export const AETHER_GIFT_OK = 'Continue';

export function AetherGiftNotice(): JSX.Element | null {
  const userId = useGame((s) => s.account.userId);
  const queue = useProgression((s) => s.aetherGifts);
  const cosmeticGiftOpen = useProgression((s) => !!s.gifts && s.gifts.userId === userId && s.gifts.ids.length > 0);
  const head = queue && queue.userId === userId ? queue.gifts[0] : undefined;
  if (!head || cosmeticGiftOpen) return null;
  // Keyed by the gift, so the next one in the queue pops in fresh.
  return <AetherGiftPopup key={head.id} gift={head} />;
}

function AetherGiftPopup({ gift }: { gift: AetherGift }): JSX.Element {
  const [closing, setClosing] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);
  const close = (): void => {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(() => { timer.current = null; dismissAetherGift(gift.id); }, RANKED_CONFIRM_EXIT_MS);
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
    <div className={`rankedconfirm-ov aetherintro-ov${closing ? ' closing' : ''}`} role="dialog" aria-modal="true" aria-label={AETHER_GIFT_TITLE}>
      <div className="rankedconfirm-veil" onClick={close} aria-hidden="true" />
      <div className="rankedconfirm aetherintro">
        <span className="rc-crest" aria-hidden="true" />
        <span className="rc-crest rc-crest-foot" aria-hidden="true" />
        <div className="rc-title">{AETHER_GIFT_TITLE}</div>
        <p className="rankedconfirm-text">{aetherGiftText(gift.amount)}</p>
        <p className="rankedconfirm-text aetherintro-gift">{gift.reason}</p>
        <div className="rankedconfirm-actions">
          <button ref={okRef} className="rc-btn rc-btn-yes" disabled={closing} onClick={() => { sfx.pulse(); close(); }}>{AETHER_GIFT_OK}</button>
        </div>
      </div>
    </div>
  );
}
