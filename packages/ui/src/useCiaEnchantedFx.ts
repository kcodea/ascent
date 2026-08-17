import { useEffect } from 'react';
import { ciaEnchantedFx } from './ciaEnchantedFx';

/**
 * Drives the Cia enchanted-foil controller from run state.
 *
 * Deliberately thin: the only thing React owns here is WHICH offers are enchanted. Everything time-based
 * lives in the Pixi updater, so there is no React state update per animation frame (a hard requirement in
 * the handoff's performance criteria).
 *
 * The effect keys off the joined uid list rather than the shop array so a re-render that leaves the
 * enchantment unchanged — the common case, since the shop object is rebuilt on nearly every action — does not
 * re-sync the controller.
 */
export function useCiaEnchantedFx(enchantedUids: readonly string[]): void {
  const key = enchantedUids.join(',');
  useEffect(() => {
    ciaEnchantedFx.sync(key ? key.split(',') : []);
  }, [key]);
  // Unmounting the shop (combat, title, a new run) must take the treatment with it — otherwise a stale foil
  // would hang in the overlay with no card under it.
  useEffect(() => () => ciaEnchantedFx.dispose(), []);
}
