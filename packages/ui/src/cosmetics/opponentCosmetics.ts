/**
 * The "Show other players' cosmetics" switch, as a hook that ALSO re-renders on the per-category cosmetic switches
 * (`cosmeticVisibility.ts`, R-SETTINGS-COSMETICS-01). Every surface that draws another player's cosmetics already
 * reads this switch, so routing it through here is what makes a Settings flip repaint those surfaces at once. Both
 * values change only when the player flips a switch, so a shop click never re-renders through it.
 */
import { useGame } from '../store';
import { useCosmeticVisEpoch } from './cosmeticVisibility';

export function useShowOpponentCosmetics(): boolean {
  useCosmeticVisEpoch();
  return useGame((s) => s.showOpponentSkins);
}
