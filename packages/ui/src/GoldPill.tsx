import { memo } from 'react';
import { Icon } from './Icon';

/**
 * Standalone GOLD pill (owner ask 2026-08-11) — the Gold readout moved off the top stat strip to its own
 * glass button pinned BOTTOM-RIGHT of the board: a yellow glass plaque with the live Gold total over it. The
 * top strip now carries only the turn timer. Stage-pinned like the other board furniture (see `.goldpill` in
 * styles.css). Keeps the old strip's hover: this turn's Gold + the projected START of the next two waves.
 *
 * `combat` (R-COMBAT-TIER-GOLD-01, owner ask 2026-11-20): the pill stays through the fight, showing the Gold left
 * over from the turn that just ended; the forecast rows are the caller's live numbers (they tick as the replay
 * plays a max-Gold gain).
 */
export const GoldPill = memo(function GoldPill({ gold, nextTurnGold, afterNextGold, wave, combat = false }: {
  gold: number;
  nextTurnGold: number;
  afterNextGold: number;
  wave: number;
  combat?: boolean;
}): JSX.Element {
  return (
    <div className={`goldpill${combat ? ' combat' : ''}`} role="status" aria-label={combat ? `Gold left over: ${gold}` : `Gold: ${gold}`}>
      {/* A CIRCLE seated in the board's bottom-right notch — the yellow plate reads as the coin, so the main
          face shows just the number (the coin glyph stays in the hover breakdown below). */}
      <span className="goldpill-v">{gold}</span>
      {/* Hover: this turn's Gold + the projected START of the next two waves (cascading up, cap-aware). */}
      <div className="sbtip goldtip" role="tooltip">
        <div className="gt-now">{combat ? <>Gold · <b>{gold}</b> left over</> : <>Gold · <b>{gold}</b> this turn</>}</div>
        <div className="gt-row"><span>Next turn</span><b><Icon name="mana" />{nextTurnGold}</b></div>
        <div className="gt-row"><span>Wave {wave + 2}</span><b><Icon name="mana" />{afterNextGold}</b></div>
      </div>
    </div>
  );
});
