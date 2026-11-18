import { memo } from 'react';

/**
 * THE SHOP SLICE (owner ask 2026-11-18): a Docked-rail style plate on the shop frame's top edge, between the Tavern Up
 * stone and the Freeze diamond, reading SHOP | Tier N. It replaced the floating "Tier N" pill over the stone. A flat left
 * end tucked under the stone, a clean cut on the right end leaning into the diamond (parallel to its upper-left edge),
 * the rail's navy plate and gold edge (`--pill-plate` / `--pill-edge`, uiTheme.css). Placement: styles.css `.shopslice`.
 *
 * Shop phase only: Recruit mounts it with the rest of the shop furniture (gated on the curtain's staged window, so it is
 * gone in combat and returns under the cover). On the way back from a fight it mounts TUCKED below the frame line
 * (`tucked`, the return trip's covered hold) and slides up as the vista dives onto the Shop: a one-shot transform +
 * opacity transition, nothing loops. On the first turn of a run, a resume, or any other mount it is simply there.
 * Purely a label: pointer-events off, so it never takes a click or a dropped card.
 */
export const ShopTierSlice = memo(function ShopTierSlice({ tier, tucked }: {
  /** The shop's current tier (1-based). */
  tier: number;
  /** Mounted under the return trip's cover: starts below the frame line and rises when this turns false. */
  tucked: boolean;
}) {
  return (
    <div className={`shopslice${tucked ? ' tucked' : ''}`} role="status" aria-label={`Shop tier ${tier}`}>
      <div className="shopslice-plate" aria-hidden="true">
        {/* The gold edge and the navy plate are two clipped layers (the plate inset by the rim on the left end, the top
            and the cut), so the edge stays an even width at any Length. The bottom is the frame line: no edge there. */}
        <span className="shopslice-edge" />
        <span className="shopslice-fill" />
        <span className="shopslice-text">
          <span className="shopslice-label">Shop</span>
          <span className="shopslice-div" />
          <span className="shopslice-tier">Tier {tier}</span>
        </span>
      </div>
    </div>
  );
});
