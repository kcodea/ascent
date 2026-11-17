import { useEffect, useRef } from 'react';
import { bindingFor } from './choreo/bindings';
import { canPlayDefs } from './fx/playDef';
import { bookBurst, playRuneBurstDef } from './runeTriggerFx';

/**
 * ANCIENT TRIGGER PROCS (owner 2026-11-17, R-FX-ANCIENT-PROC-01, verbatim: "can you do a quick pass at ancients that fire
 * from events, like warden's fortune for example. this should play the same animation that runes do when they trigger in
 * combat or in recruit so that the player knows it triggered.").
 *
 * An Ancient is the hero power transformed, so it fires ON the hero-power button: the exact rune-trigger flourish (the
 * `runeTriggered` binding, `rune-burst`, the def a rune badge bursts with), anchored on the power button, once per fire.
 * Repeats on the button stagger and coalesce through the rune badges' own `bookBurst`, so two fires read as two and a
 * rapid run never stacks a particle storm.
 *
 * The signals, one per phase, each a true per-fire COUNT:
 *  · SHOP: `run.ancients.procs` (`procAncient`, stamped where the effect resolves).
 *  · COMBAT: the replayed `questTrigger`s whose flag `isAncientProcFlag` (the player's side), counted under
 *    `ANCIENT_PROC_KEY` in `combatTriggeredQuests` (`choreo/triggerCounts.ts`), beat-synced and reset at settle.
 *  · START OF TURN / END OF TURN: the Ancient's own beat (a hero source labelled with an Ancient's name) calls
 *    `playAncientProcBurst` when it activates (`Recruit.tsx`), so the burst lands on the beat, not under the curtain.
 *
 * The player's button only, like the rune bursts (the foe's rune badges bounce, they never burst).
 */

/** The player's own hero-power button (never the Duos teammate panel or the equipment slot). */
export function ancientPowerButtonEl(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>('.statusbar .heropanel:not(.heropanel2):not(.equipslot) .heropowerbtn')
    ?? document.querySelector<HTMLElement>('.statusbar .heropowerbtn');
}

function buttonCentre(): { x: number; y: number } | null {
  const r = ancientPowerButtonEl()?.getBoundingClientRect();
  if (!r || (r.width === 0 && r.height === 0)) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Per-button burst clock, shared by the counted signals and the beat calls, so they coalesce against each other. */
const nextFree = new Map<string, number>();
const BUTTON_KEY = 'ancient-power';

/** Play ONE rune-trigger burst on the hero-power button now (or queued one stagger behind a burst already playing).
 *  Returns false when it was coalesced, unbound, or there is no button on screen. */
export function playAncientProcBurst(): boolean {
  if (!canPlayDefs()) return false;
  const binding = bindingFor(null, 'runeTriggered');
  if (!binding) return false; // the rune burst is unbound: nothing to play (the same state the rune badges ship in)
  const delay = bookBurst(nextFree, BUTTON_KEY, performance.now());
  if (delay === null) return false;
  const fire = (): void => {
    const at = buttonCentre();
    if (!at) return;
    playRuneBurstDef(binding.def, at, 0); // the rune badges' own play (one `playDef` site for both)
  };
  if (delay === 0) requestAnimationFrame(fire);
  else setTimeout(fire, delay);
  return true;
}

/** Ceiling on bursts from ONE bump (the rune badges' cap): a real trigger produces a handful at most. */
const MAX_REPEAT_BURSTS = 4;

/**
 * PURE: how many bursts a count change is. Only an INCREASE is a fire (a combat count resets to 0 at settle), the first
 * sight is a state to record (a page load or a remount never fires), and the size of the increase is the fire count.
 */
export function procBursts(prev: number | undefined, now: number): number {
  if (prev === undefined || now <= prev) return 0;
  return Math.min(MAX_REPEAT_BURSTS, now - prev);
}

/** Burst the hero-power button once per Ancient fire: `shop` = `run.ancients.procs`, `combat` = the replayed count. */
export function useAncientProcFx(shop: number, combat: number): void {
  const prev = useRef<{ shop?: number; combat?: number }>({});
  useEffect(() => {
    const n = procBursts(prev.current.shop, shop) + procBursts(prev.current.combat, combat);
    prev.current = { shop, combat };
    for (let i = 0; i < n; i++) playAncientProcBurst();
  }, [shop, combat]);
}
