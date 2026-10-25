/**
 * VERSUS DUOS — WATCHING YOUR TEAMMATE, FULL SCREEN, LIVE (owner 2026-10-25: "We need full screen view for teammates,
 * and there needs to be some animation/change somehow to distinguish viewing the teammates board vs yours";
 * R-DUOS-VIEW-01).
 *
 * The teammate's screen IS the Versus watch screen (spectate.ts: their shop, hand, board, Gold, tier, cursor, drags and
 * hovers, in real time, from the frames every Duos player publishes to their teammate). Entering keeps my own run aside
 * untouched; leaving puts it back exactly as it was.
 *
 * THE DISTINCTION, so it can never be mistaken for my own board:
 *  - THE SWEEP (on the way in and out): a team-colour panel crosses the screen from my teammate's side and the other
 *    screen is there behind it (about 400 ms in all; one pre-made layer, transform only, one-shot Web Animations);
 *  - while watching: their hero, name and hearts in the hero slot (it is their screen), a calm team-colour vignette
 *    over the edges (a static layer that fades in), my shop controls visibly inert, and the "Watching <Name>" plate with
 *    "Back to your board" (the room's own plate buttons). Esc, Tab (when held to peek) or the button come back.
 * Watching never holds my game up: back to my board on its own when the shop ends, the match pauses, or my clock has
 * under 5 seconds (versusStore's tick, `TEAMMATE_VIEW_RETURN_MS`).
 */
import { useEffect } from 'react';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { perfMonitor } from '../perfMonitor';
import { stageHost } from '../stage';
import { leaveTeammate, useSpectate, watchTeammate } from './spectate';
import { useVersus } from './versusStore';

/** The sweep's two halves (ms): the team panel crosses in, the screens swap under it, it crosses out. */
export const SWEEP_IN_MS = 170;
export const SWEEP_OUT_MS = 200;
let turning = false;

/**
 * THE SWAP SWEEP. One full-screen team-colour panel, made ONCE and kept off screen on its own compositor layer, so a
 * swap never creates, rasterises or re-lays-out anything big at the click: it only moves (transform), which the
 * compositor runs on its own even while the main thread is busy. (The first build turned the whole stage root in 3D;
 * that cost a 40 ms frame at each end of every turn, measured 2026-10-25.)
 */
let panel: HTMLElement | null = null;
function sweepPanel(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  if (panel?.isConnected) return panel;
  panel = document.createElement('div');
  panel.className = 'duosswap';
  panel.setAttribute('aria-hidden', 'true');
  stageHost().appendChild(panel);
  return panel;
}
/** Made at idle once a Duos match is on, so the first click pays nothing. */
export function prepareTeammateSweep(): void { sweepPanel(); }

/** Six calm frames in a row (each under 8 ms): the new screen's build and its follow-up work (art, layout reads)
 *  have finished, so the sweep out moves over a quiet main thread. Capped, so the cover can never stick. */
function whenSettled(done: () => void): void {
  let last = performance.now();
  let calm = 0;
  const start = last;
  const tick = (): void => {
    const now = performance.now();
    calm = now - last < 8 ? calm + 1 : 0;
    last = now;
    if (calm >= 6 || now - start > 700) done(); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** The swap: the team panel sweeps across from `dir` (1 = from the right, where the teammate's portrait sits), the
 *  screens swap while it covers them, it sweeps on out the other side once the new screen has settled. */
function turn(dir: 1 | -1, swap: () => void): void {
  const el = sweepPanel();
  if (!el || !('animate' in el) || turning) { swap(); return; }
  turning = true;
  perfMonitor.mark?.('duos:turn:start');
  const inn = el.animate([{ transform: `translateX(${105 * dir}%)` }, { transform: 'translateX(0)' }], { duration: SWEEP_IN_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0.25)', fill: 'forwards' });
  inn.onfinish = () => {
    swap();
    whenSettled(() => {
      const out = el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-105 * dir}%)` }], { duration: SWEEP_OUT_MS, easing: 'cubic-bezier(0.2, 0.75, 0.3, 1)', fill: 'forwards' });
      inn.cancel();
      out.onfinish = () => { turning = false; perfMonitor.mark?.('duos:turn:end'); };
      out.oncancel = () => { turning = false; };
    });
  };
  inn.oncancel = () => { turning = false; };
}

/** Open my teammate's live screen (Duos, in the shop, from my own board). */
export function enterTeammateView(): void {
  const v = useVersus.getState();
  const mate = v.match?.group?.duos?.mate;
  const g = useGame.getState();
  if (!mate || !v.match || v.match.phase !== 'shop' || v.match.paused_at || useSpectate.getState().teammate) return;
  if (g.run.mode !== 'versus' || g.run.phase !== 'recruit') return;
  sfx.tick();
  turn(1, () => {
    watchTeammate(mate);
    document.body.classList.add('duos-viewing');
  });
}

/** Back to my own board. */
export function exitTeammateView(): void {
  if (!useSpectate.getState().teammate) return;
  sfx.tick();
  turn(-1, () => {
    leaveTeammate();
    document.body.classList.remove('duos-viewing');
  });
}
// A view left by the game itself (the shop ended, a pause, my clock): the class follows the state.
useSpectate.subscribe((s, prev) => {
  if (prev.teammate && !s.teammate && typeof document !== 'undefined') document.body.classList.remove('duos-viewing');
});

/** Esc comes back; Tab held peeks (press = open, release = back). Mounted for a seated Duos player. */
export function useTeammateViewKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let peeking = false;
    const onDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || (e.target instanceof HTMLElement && e.target.closest('input, textarea'))) return;
      if (e.key === 'Escape' && useSpectate.getState().teammate) { e.preventDefault(); e.stopPropagation(); exitTeammateView(); return; }
      if (e.key === 'Tab' && !e.repeat) {
        e.preventDefault();
        if (useSpectate.getState().teammate) { exitTeammateView(); return; }
        peeking = true;
        enterTeammateView();
      }
    };
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === 'Tab' && peeking) { peeking = false; exitTeammateView(); }
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    return () => { window.removeEventListener('keydown', onDown, true); window.removeEventListener('keyup', onUp, true); };
  }, [enabled]);
}

/** The "Watching <Name>" plate and the way back (the room's plate buttons, top centre), plus the edge vignette. */
export function TeammateBar(): JSX.Element | null {
  const on = useSpectate((s) => s.teammate === true);
  const name = useVersus((s) => {
    const raw = s.match?.group?.raw;
    const mate = s.match?.group?.duos?.mate;
    return raw?.seats.find((x) => x.seat === mate)?.name ?? '';
  });
  if (!on) return null;
  return (
    <>
      <div className="duosview-vignette" aria-hidden="true" />
      <div className="duosview-bar" role="status" aria-label={`Watching ${name}`}>
        <span className="duosview-name hudpill-name">Watching {name}</span>
        <button type="button" className="vsplate vsprimary duosview-back" onClick={exitTeammateView}>Back to your board</button>
      </div>
    </>
  );
}
