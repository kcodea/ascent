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
 *  - THE TURN (on the way in and out): the whole stage turns away toward the rail, where my teammate's seat is, and the
 *    other screen turns in from the other side (about 320 ms in all; transform / opacity only, one-shot, Web
 *    Animations on the stage root);
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
import { leaveTeammate, useSpectate, watchTeammate } from './spectate';
import { useVersus } from './versusStore';

/** Half a turn (ms): out, swap, in. */
export const TURN_HALF_MS = 160;
let turning = false;

function stageRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById('root');
}

/** The stage turn: out toward `dir` (1 = toward the rail on the right), `swap` at the hidden midpoint, then in. */
function turn(dir: 1 | -1, swap: () => void): void {
  const root = stageRoot();
  if (!root || !('animate' in root) || turning) { swap(); return; }
  turning = true;
  const away = `perspective(1600px) translateX(${-2.5 * dir}%) rotateY(${8 * dir}deg) scale(0.965)`;
  const from = `perspective(1600px) translateX(${2.5 * dir}%) rotateY(${-8 * dir}deg) scale(0.965)`;
  perfMonitor.mark?.('duos:turn:start');
  const out = root.animate([{ transform: 'none', opacity: 1 }, { transform: away, opacity: 0.08 }], { duration: TURN_HALF_MS, easing: 'cubic-bezier(0.5, 0, 0.75, 0.2)', fill: 'forwards' });
  out.onfinish = () => {
    swap();
    // The new screen renders under the hidden midpoint; the turn in starts on the next frame.
    requestAnimationFrame(() => {
      const inn = root.animate([{ transform: from, opacity: 0.08 }, { transform: 'none', opacity: 1 }], { duration: TURN_HALF_MS, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
      out.cancel();
      inn.onfinish = () => { turning = false; perfMonitor.mark?.('duos:turn:end'); };
      inn.oncancel = () => { turning = false; };
    });
  };
  out.oncancel = () => { turning = false; };
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
