import { useEffect, useRef } from 'react';
import { RuneCard, runeRewardViews } from './RuneCard';
import { Card } from './Card';
import { upgradeImages } from './fullResArt';
import { closeRuneInspect, useRuneInspect } from './runeInspectStore';
import { useGame } from './store';
import './discoverEntrance/discoverEntrance.css'; // the gold action pill the Pick button reuses

const NOOP = (): void => {};

/**
 * TAP TO INSPECT A RUNEFORGE OFFER (owner 2026-10-25, R-TOUCH-TAPINSPECT-01). Touch only: a tap on a forge rune opens this
 * view (the rune tablet enlarged, the cards its reward grants beside it) over the same dimmed backdrop as the card
 * Inspect, with a Pick button that buys it exactly as the tap used to. Tap the backdrop (or Escape) to close. It closes
 * itself when the forge closes (the offer it shows is gone).
 */
export function RuneInspect() {
  const view = useRuneInspect((s) => s.view);
  const forgeOpen = useGame((s) => !!s.run?.runeforgeOffer);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (view && !forgeOpen) closeRuneInspect(); }, [view, forgeOpen]);
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeRuneInspect(); };
    window.addEventListener('keydown', onKey);
    const restore = upgradeImages(ref.current);
    return () => { window.removeEventListener('keydown', onKey); restore(); };
  }, [view]);
  if (!view) return null;
  const rewards = runeRewardViews(view.rune);
  return (
    <div className="inspect-ov rune-inspect-ov" onClick={closeRuneInspect} onContextMenu={(e) => { e.preventDefault(); closeRuneInspect(); }} role="dialog" aria-label={`${view.rune.name}. Close to dismiss.`}>
      <div className="inspect-card rune-inspect" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="rune-inspect-tablet">
          <RuneCard rune={view.rune} cost={view.cost} duplicating={view.duplicating} affordable={view.affordable} onBuy={NOOP} />
        </div>
        {rewards.length > 0 && (
          <div className="rune-inspect-rewards">
            {rewards.map((rv, i) => <Card key={`${rv.cardId ?? i}-${i}`} card={rv} forceFull suppressPop plated />)}
          </div>
        )}
      </div>
      {view.affordable && (
        <button
          type="button"
          className="disc-toggle disc-peek inspect-act"
          onClick={(e) => { e.stopPropagation(); const pick = view.pick; closeRuneInspect(); pick(); }}
          aria-label={`Pick ${view.rune.name}`}
        >
          <span className="disc-peek-glow" aria-hidden="true" />
          <span className="disc-peek-label">Pick</span>
        </button>
      )}
    </div>
  );
}
