import { useEffect, useRef } from 'react';
import { playDef } from './fx/playDef';

/**
 * Croupier Cia's Lucky Seat FX — a LOOPING `cia-hp` burst rides a shop card for as long as it stays
 * Enchanted (owner 2026-08-20: replaces the persistent Pixi "enchanted foil", `ciaEnchantedFx`, and the CSS
 * `.enchantwisp` swirl). Playing the def with `loop: true` runs it continuously; the `follow` callback makes
 * it TRACK the card as the shop reorders (drag-to-rearrange slides the offers), instead of sticking to the
 * spot where the card sat when it was enchanted.
 *
 * We own the loop's teardown — a looping player never retires on its own — so we stop it the instant the card
 * un-enchants (its uid leaves the list) or the shop unmounts (combat, title, a new run). Each `follow` tick
 * re-reads the card's `.card.enchanted[data-uid]` rect: bounded to the handful of Enchanted offers, it is the
 * same per-frame layout read the retired foil used. Returning `null` (card mid-drag = `.dragsrc`, or briefly
 * out of the DOM) hides the effect for that frame without ending the loop. (Follow-up, owner ask: seamless-loop
 * controls in the FX workbench.)
 */
export function useCiaEnchantedFx(enchantedUids: readonly string[]): void {
  const key = enchantedUids.join(',');
  const active = useRef<Map<string, () => void>>(new Map());
  useEffect(() => {
    const now = new Set(key ? key.split(',') : []);
    // Stop the loop on any card that is no longer Enchanted.
    for (const [uid, dispose] of active.current) {
      if (!now.has(uid)) { dispose(); active.current.delete(uid); }
    }
    // Start a looping, card-following cia-hp on any newly-Enchanted offer.
    for (const uid of now) {
      if (active.current.has(uid)) continue;
      // The live centre of THIS card's rect, or null while it is being dragged / not in the DOM.
      const at = (): { x: number; y: number } | null => {
        const el = document.querySelector<HTMLElement>(`.card.enchanted[data-uid="${uid}"]`);
        if (!el || el.classList.contains('dragsrc')) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const start = at();
      if (!start) continue; // card not mounted yet — a later enchant tick picks it up
      const dispose = playDef('cia-hp', { source: start, target: start, cursor: start }, { loop: true, follow: at });
      if (dispose) active.current.set(uid, dispose);
    }
  }, [key]);
  // Tear every live loop down when the shop unmounts (combat, title, a new run) — a looping player never
  // retires on its own, so an un-disposed loop would leak.
  useEffect(() => {
    const map = active.current;
    return () => { for (const d of map.values()) d(); map.clear(); };
  }, []);
}
