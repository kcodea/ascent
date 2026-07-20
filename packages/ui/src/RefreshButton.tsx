import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { pixiFx } from './pixiFx';
import { getRefreshConfig } from './refreshConfig';

/**
 * The standalone REFRESH button — the blue crystal (frames/refresh_button.webp) pinned TOP-CENTRE of the
 * board, replacing the old "Reroll" tray plaque. Same reducer wiring (`{type:'roll'}`), stage-pinned like
 * the End Turn diamond and the Tavern stone, and tuned live from the 🔄 dev tuner (`refreshConfig.ts`).
 *
 * Layers, cheapest-first (see styles.css "REFRESH CRYSTAL"):
 *   - `.rfb-art` (z1) — the crystal itself. It SPINS on press (transform only), which is the affordance:
 *     a refresh icon turning over.
 *   - `.rfb-glow` (z0, behind) — the hover halo. A stacked BOX-SHADOW on a rounded span so it paints
 *     outside the element and never clips square the way a filter drop-shadow would. Per
 *     `docs/performance.md` the breathing animates OPACITY only — the shadow itself is static.
 *   - `.rfb-sheen` (z2) — the ambient glare sweep, clipped to the crystal, transform-only.
 *   - `.rfb-flash` (z3) — the one-shot press pop; mounts → animates → unmounts.
 *   - `.rfb-cost` (z4) — the live Gold cost coin.
 *   - `.rfb-label` — the glass "Refresh" pill floating ABOVE the crystal (owner request).
 *
 * The press dust + shockwave come from the same Pixi helpers the Tavern stone uses, read from `cfg` at
 * click time (no CSS vars needed for those).
 */
export function RefreshButton({
  cost,
  disabled,
  onRefresh,
}: {
  /** Live roll cost (`refreshCostOf(run)` — free rolls make this 0), shown on the coin badge. */
  cost: number;
  disabled: boolean;
  onRefresh: () => void;
}) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const [striking, setStriking] = useState(false); // the one-shot press flash is playing
  const [spinning, setSpinning] = useState(false); // the crystal's press rotation

  const click = (): void => {
    const cfg = getRefreshConfig();
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cfg.dustCount > 0) pixiFx.impactDust(cx, cy, 1, { count: cfg.dustCount, size: cfg.dustSize, life: cfg.dustLife });
      if (cfg.rings > 0) pixiFx.impactPulse(cx, cy, 1, { radius: cfg.ringRadius, life: cfg.ringLife, rings: cfg.rings });
    }
    if (cfg.flashMs > 0) {
      setStriking(true);
      window.setTimeout(() => setStriking(false), cfg.flashMs + 60);
    }
    if (cfg.spinMs > 0) {
      setSpinning(true);
      window.setTimeout(() => setSpinning(false), cfg.spinMs + 30);
    }
    onRefresh();
  };

  return (
    <button
      ref={wrapRef}
      className={`rfbwrap${disabled ? ' off' : ''}`}
      disabled={disabled}
      onClick={click}
      aria-label={cost > 0 ? `Refresh the shop for ${cost} Gold` : 'Refresh the shop (free)'}
    >
      {/* Glass "Refresh" pill, floating above the crystal. */}
      <span className="rfb-label" aria-hidden="true">Refresh</span>
      {/* Hover halo — BEHIND the art so the crystal reads clean. */}
      <span className="rfb-glow" aria-hidden="true" />
      <span className={`rfb-artbox${spinning ? ' spin' : ''}`} aria-hidden="true">
        <img className="rfb-art" src="/frames/refresh_button.webp" alt="" draggable={false} />
        {/* Ambient SHEEN — a glare bar sweeping the crystal's face, clipped to it; transform-only loop. */}
        <span className="rfb-sheen"><span className="rfb-sheen-bar" /></span>
      </span>
      {/* The press FLASH — a one-shot pop of the crystal. Mounts, animates, unmounts. */}
      {striking && <img className="rfb-flash" src="/frames/refresh_button.webp" alt="" draggable={false} aria-hidden="true" />}
      {/* Cost coin — hidden when the roll is free, so a free reroll reads as free at a glance. */}
      {cost > 0 && (
        <span className="rfb-cost" aria-hidden="true">
          <Icon name="mana" />
          <b>{cost}</b>
        </span>
      )}
      <span className="rfb-tip">{cost > 0 ? `Refresh — ${cost} Gold` : 'Refresh — free'}</span>
    </button>
  );
}
