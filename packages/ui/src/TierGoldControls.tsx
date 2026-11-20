import { memo } from 'react';
import { TavernUpButton } from './TavernUpButton';
import { GoldPill } from './GoldPill';

/**
 * The Shop tier stone + the Gold pill, mounted in BOTH phases (R-COMBAT-TIER-GOLD-01, owner ask 2026-11-20: "the
 * player's shop tier and gold buttons stay in combat"). The very same two pieces at the very same stage anchors, so
 * the shop-to-combat swap moves nothing. `combat` makes the stone an inert tier readout (disabled, cost coin hidden,
 * no hover glow, no sheen: `TavernUpButton`'s own combat state) and labels the pill's Gold as left over. The numbers
 * are the caller's: the pill's forecast already folds the fight's replayed `maxGold` events (`goldForecastOf`).
 */
export const TierGoldControls = memo(function TierGoldControls({
  tier, maxTier, upgradeCost, upgradeDisabled, combat, onUpgrade, gold, nextTurnGold, afterNextGold, wave,
}: {
  tier: number;
  maxTier: number;
  upgradeCost: number;
  /** The shop-phase gate (Gold, clock, overlays). Combat disables the stone on its own. */
  upgradeDisabled: boolean;
  combat: boolean;
  onUpgrade: () => void;
  gold: number;
  nextTurnGold: number;
  afterNextGold: number;
  wave: number;
}): JSX.Element {
  return (
    <>
      <TavernUpButton tier={tier} maxTier={maxTier} cost={upgradeCost} disabled={upgradeDisabled} combat={combat} onUpgrade={onUpgrade} />
      <GoldPill gold={gold} nextTurnGold={nextTurnGold} afterNextGold={afterNextGold} wave={wave} combat={combat} />
    </>
  );
});
