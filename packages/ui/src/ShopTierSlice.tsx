import { memo } from 'react';

/**
 * THE SHOP SLICE (owner ask 2026-11-18): a freestanding Docked-rail style plate floating above the shop frame, just right
 * of the Tavern Up stone (clear of it and of the frame), reading SHOP | TIER N. It replaced the floating "Tier N" pill over
 * the stone. Sized to its text, a clean diagonal cut on its right end, the rail's navy plate, gold rim and type
 * (`--pill-plate` / `--pill-edge`, uiTheme.css). Placement and look: styles.css `.shopslice`.
 *
 * Shop phase only: Recruit mounts it with the rest of the shop furniture (gated on the curtain's staged window, so it is
 * gone in combat and returns under the cover). On the way back from a fight it mounts TUCKED below the frame line
 * (`tucked`: a little below its seat, transparent) and rises into place as the vista dives onto the Shop: a one-shot transform +
 * opacity transition, nothing loops. On the first turn of a run, a resume, or any other mount it is simply there.
 * Purely a label: pointer-events off, so it never takes a click or a dropped card.
 */
export const ShopTierSlice = memo(function ShopTierSlice({ tier, tucked }: {
  /** The shop's current tier (1-based). */
  tier: number;
  /** Mounted under the return trip's cover: starts a little below its seat and rises when this turns false. */
  tucked: boolean;
}) {
  return (
    <div className={`shopslice${tucked ? ' tucked' : ''}`} role="status" aria-label={`Shop tier ${tier}`}>
      <div className="shopslice-plate" aria-hidden="true">
        {/* The gold rim and the navy plate are two clipped layers (the plate inset by the rim all round), so the cut keeps
            an even rim at any text width. */}
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
