import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useGame } from '../store';
import { ceremonyTiming } from './heroCeremonyTiming';
import { registerLaunchController, type HeroLaunchRequest } from './heroLaunchController';

/**
 * HERO SELECT CEREMONY — the launch curtain (hero-select-ceremony-blueprint.md §7).
 *
 * Mounted in Game, ABOVE HeroSelect, precisely because `pickHero()` clears `heroChoices` and unmounts the
 * whole picker (ceremony included) in the same state update that builds the run. The curtain is the only
 * ceremony piece that must outlive that unmount, so it owns the ordering:
 *
 *   cover (launchCoverMs) → pickHero() under full opacity → two rAF ticks so the freshly mounted Recruit
 *   screen completes its first layout → reveal (launchRevealMs) → unmount the div.
 *
 * Run construction (lobby warming + save write) is synchronous and heavy — doing it only once the cover is
 * opaque means it can never stutter a visible animation (§18).
 */

/** Fade helper: WAAPI when available, else snap to the final state (§19 — jsdom/legacy lacks el.animate;
 *  the launch must complete regardless). The final opacity is set inline up front so a cancelled or
 *  missing animation still leaves the element in the correct end state. */
function fade(el: HTMLElement | null, from: number, to: number, ms: number): Promise<void> {
  if (!el) return Promise.resolve();
  el.style.opacity = String(to);
  if (typeof el.animate !== 'function') return Promise.resolve();
  const anim = el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: 'ease', fill: 'forwards' });
  // Swallow the AbortError a cancel() raises — cleanup must never surface as an unhandled rejection.
  return anim.finished.then(() => undefined, () => undefined);
}

/** Two animation frames = "Recruit has painted at least once" (§7 step 7). setTimeout fallback for
 *  environments without rAF. */
function twoFrames(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((r) => setTimeout(r, 0));
  }
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
}

export function HeroLaunchCurtain() {
  const [req, setReq] = useState<HeroLaunchRequest | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const resolveRef = useRef<(() => void) | null>(null);

  // Register with the module seam for our whole lifetime. The ceremony reaches us only through
  // requestLaunch() — no prop drilling across the Game tree.
  useEffect(() => {
    registerLaunchController((r) => new Promise<void>((resolve) => {
      resolveRef.current = resolve;
      setReq(r); // mounts the div; the effect below runs the sequence once it exists
    }));
    return () => registerLaunchController(null);
  }, []);

  useEffect(() => {
    if (!req) return;
    let dead = false; // Game itself unmounted mid-launch (dev hot reload) — stop touching the DOM
    const t = ceremonyTiming();
    const finish = () => {
      resolveRef.current?.();
      resolveRef.current = null;
      setReq(null); // unmount the div — no idle fullscreen layer left behind (§18)
    };
    void (async () => {
      const el = elRef.current;
      await fade(el, 0, 1, t.launchCoverMs);
      if (dead) return;
      // Fully covered: NOW build the run. This is the synchronous heavy step (createRun/createLobbyRun +
      // warmLobbyDrivers + writeSave) and it also unmounts HeroSelect behind us.
      try {
        useGame.getState().pickHero(req.heroId);
      } catch (err) {
        // §19 "run construction throws": don't strand the player on a black screen. We log and reveal —
        // heroChoices is untouched on a throw, so the picker is still there underneath. (The blueprint's
        // Retry/Return panel is a later phase.)
        console.error('[heroLaunch] run construction failed', err);
      }
      await twoFrames();
      if (dead) return;
      await fade(el, 1, 0, t.launchRevealMs);
      if (dead) return;
      finish();
    })();
    return () => { dead = true; };
  }, [req]);

  if (!req) return null;
  // The accent feeds the center glow via a CSS var; the glow itself is a static radial-gradient whose
  // opacity rides the div's fade — no paint-property animation (repo perf contract).
  return (
    <div
      ref={elRef}
      className="hsc-curtain"
      style={{ '--hsc-accent': req.accent } as CSSProperties}
      aria-hidden="true"
    />
  );
}
