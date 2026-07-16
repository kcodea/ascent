import { useRef, useState } from 'react';
import { getTavernUpConfig } from './tavernUpConfig';
import { pixiFx } from './pixiFx';
import { Icon } from './Icon';

/**
 * The standalone TAVERN UP stone button — the carved rock medallion that replaces the plain "Upgrade
 * Tavern" plaque in the shop tray (same playbook as the End Turn diamond, handoff 2026-07-16). Stage-pinned
 * to the board's left; shop-phase only. Same reducer wiring as the old plaque (a re-skin, not a behavior
 * change): the caller passes the dispatch + the same disabled conditions + the live cost.
 *
 * Layered so every effect follows the art and stays cheap (see styles.css "TAVERN UP STONE"):
 *   - `.tvb-gembox` (z0, UNDER the base) — the blue arrow gem seated through the base's transparent hole, so
 *     the gold ring overlaps its rim (the forgiving seat — same trick as card art under the frame). Holds the
 *     lit gem, the BROKEN gem (the max-tier "complete" state; CSS flips them, both stay mounted so there's no
 *     src-swap flash), and the sheen sweep clipped to the gem's circle.
 *   - `.tvb-base` (z1) — the stone housing; `.tvb-pips` (z2) — the CURRENT tavern tier as 1–6 lit slot pips
 *     (all six variants mounted, CSS shows one; they share one centroid-aligned canvas so a single seat
 *     positions every tier).
 *   - `.tvb-glow` (z3) — the gem-silhouette hover halo (stacked drop-shadow of the gem art, source pixels
 *     masked back out so ONLY the halo paints); breathing animates opacity only.
 *   - `.tvb-flash` (z4) — the one-shot warm press pop masking the pip advance; mounts → animates → unmounts.
 *
 * Press = flash + dirt billow + shockwave ring at the button's live centre (the "heavy investment" recipe),
 * then the existing `upgrade` dispatch. All effect magnitudes come from the 🍺 tuner (`TavernUpTuner.tsx`).
 */
export function TavernUpButton({ tier, maxTier, cost, disabled, onUpgrade }: {
  /** Current tavern tier (1-based) — drives the lit slot pips + the broken "complete" gem at max. */
  tier: number;
  maxTier: number;
  /** Live upgrade cost (upgradeCostOf(run) — includes surcharges), shown on the coin badge. */
  cost: number;
  /** Everything EXCEPT the max-tier condition (the component derives that from tier itself). */
  disabled: boolean;
  onUpgrade: () => void;
}) {
  const wrapRef = useRef<HTMLButtonElement>(null);
  const [striking, setStriking] = useState(false); // the one-shot press flash is playing
  const maxed = tier >= maxTier;

  const click = (): void => {
    const cfg = getTavernUpConfig();
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
    onUpgrade();
  };

  const pipTier = Math.max(1, Math.min(maxTier, tier));
  return (
    <button
      ref={wrapRef}
      className={`tvbwrap${maxed ? ' maxed' : ''}`}
      disabled={disabled || maxed}
      onClick={click}
      aria-label={maxed ? 'Tavern at max tier' : `Upgrade Tavern to tier ${tier + 1} for ${cost} Gold`}
    >
      {/* Gem UNDER the base: the stone's transparent hole reveals it and the gold ring overlaps its rim. The
          broken gem is the max-tier "complete" state; both stay mounted (CSS flips on `.maxed`). */}
      <span className="tvb-gembox" aria-hidden="true">
        <img className="tvb-gem lit" src="/frames/tavernup_gem.webp" alt="" draggable={false} />
        <img className="tvb-gem broken" src="/frames/tavernup_gem_broken.webp" alt="" draggable={false} />
        {/* Ambient SHEEN — a glare bar sweeping the gem's face, clipped to its circle; transform-only loop. */}
        <span className="tvb-sheen"><span className="tvb-sheen-bar" /></span>
      </span>
      <img className="tvb-base" src="/frames/tavernup_base.webp" alt="" draggable={false} />
      {/* Tier pips — the current tavern tier lit into the stone's slot arc. All six stay mounted (they share
          one aligned canvas); CSS shows the active one, and the press flash masks the advance. */}
      {[1, 2, 3, 4, 5, 6].map((n) => (
        <img key={n} className={`tvb-pips${n === pipTier ? ' on' : ''}`} src={`/frames/tavernup_tier${n}.webp`} alt="" draggable={false} aria-hidden="true" />
      ))}
      {/* Hover glow — the gem-only halo (stacked drop-shadow follows the gem alpha; the mask cuts the source
          pixels back out so only the halo paints — same construction as the End Turn diamond's glow). */}
      <img className="tvb-glow" src="/frames/tavernup_gem.webp" alt="" draggable={false} aria-hidden="true" />
      {/* The press FLASH — a warm pop of the gem masking the pip advance. One-shot: mounts, animates, unmounts. */}
      {striking && <img className="tvb-flash" src="/frames/tavernup_gem.webp" alt="" draggable={false} aria-hidden="true" />}
      {/* Cost coin — the live upgrade cost (hidden at max tier; the broken gem tells that story). */}
      {!maxed && (
        <span className="tvb-cost" aria-hidden="true">
          <Icon name="mana" />
          <b>{cost}</b>
        </span>
      )}
      <span className="tvb-tip">{maxed ? 'Tavern at max tier' : `Upgrade Tavern — to tier ${tier + 1}`}</span>
    </button>
  );
}
