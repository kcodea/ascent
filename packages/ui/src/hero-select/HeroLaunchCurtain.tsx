import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useGame } from '../store';
import { ceremonyTiming } from './heroCeremonyTiming';
import { registerLaunchController, type HeroLaunchRequest } from './heroLaunchController';
import { goodLuckIntro, shouldPlayGoodLuckIntro } from '../goodLuck/goodLuckIntroStore';
import { lobbyPoolGate } from '../opponentPool/lobbyPoolGate';
import { poolNeededFor } from '../opponentPool/poolGate';
import { PoolWaitPanel } from '../opponentPool/PoolWaitPanel';
import { launchVersusHero, useVersusAwaitingPick } from '../versus/versusStore';
import { PHONE_GPU } from '../phoneDiag';

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
  // PHONE (R-TOUCH-RUN-MEMORY-01): drop the finished, filling animation. The inline opacity already holds the end
  // state, and a filling opacity animation keeps the full-screen curtain its own composited layer. Desktop unchanged.
  return anim.finished.then(() => { if (PHONE_GPU) anim.cancel(); }, () => undefined);
}

/** PHONE (R-TOUCH-RUN-MEMORY-01): mark the launch curtain fully opaque, so the hero select under it stops painting
 *  (touchUi.css `[data-launch-covered]`). Cleared before every reveal. A no-op on desktop. */
export function setLaunchCovered(on: boolean, phone: boolean = PHONE_GPU): void {
  if (!phone || typeof document === 'undefined') return;
  if (on) document.documentElement.setAttribute('data-launch-covered', '');
  else document.documentElement.removeAttribute('data-launch-covered');
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
  const [versusWait, setVersusWait] = useState(false);
  const awaitingFoe = useVersusAwaitingPick();

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
      setVersusWait(false);
      setReq(null); // unmount the div — no idle fullscreen layer left behind (§18)
    };
    void (async () => {
      const el = elRef.current;
      await fade(el, 0, 1, t.launchCoverMs);
      if (dead) return;
      setLaunchCovered(true);
      // OPPONENT POOL GATE (fix 2026-09-28): a lobby that seats recorded player runs waits here, under full
      // cover, until the opponent pool has loaded. Instant when it already has (the usual case: it loads at
      // startup). Otherwise the panel shows "Finding opponents...", and an unreachable pool becomes an explicit
      // Retry / Play anyway / Back to menu choice instead of a silent all-bot table.
      const pre = useGame.getState();
      if (poolNeededFor(pre.pendingMode, pre.practiceDraft)) {
        // A Practice game draws the rank picked on its setup screen (R-PRACTICE-RANK-01), which may not be the rank
        // the pool was loaded for: wait for that rank's sample too (God Mode keeps the pool on hand, as before).
        const outcome = await lobbyPoolGate.run({ matchBand: pre.pendingMode === 'practice' && pre.practiceDraft.godMode !== true });
        if (dead) return;
        if (outcome === 'cancel') {
          useGame.getState().openTitle();
          await twoFrames();
          if (dead) return;
          setLaunchCovered(false);
          await fade(el, 1, 0, t.launchRevealMs);
          if (!dead) finish();
          return;
        }
      }
      // VERSUS (owner 2026-10-14: the game start of a lobby game, 1:1): the run is the match's, built once both
      // heroes are locked; the cover holds until it is on screen, then the Good Luck intro plays as below.
      const versusStart = useGame.getState().pendingMode === 'versus';
      if (versusStart) {
        setVersusWait(true);
        await launchVersusHero(req.heroId);
        if (dead) return;
        setVersusWait(false);
      }
      // Fully covered: NOW build the run. This is the synchronous heavy step (createRun/createLobbyRun +
      // warmLobbyDrivers + writeSave) and it also unmounts HeroSelect behind us.
      try {
        if (!versusStart) useGame.getState().pickHero(req.heroId);
        // THE "GOOD LUCK" INTRO (owner ask 2026-09-24): a real lobby / Practice start comes up on a DIMMED
        // board with the words over it, and the shop clock holds until they fade. Begun here, while the cover
        // is still opaque, so the overlay is already dimming the board by the time the reveal below lifts.
        const st = useGame.getState();
        const started = !versusStart || st.run.mode === 'versus'; // a Versus match that ended at Hero Select starts nothing
        if (started && shouldPlayGoodLuckIntro(st.run, { replaying: st.replaySession != null })) goodLuckIntro.begin();
      } catch (err) {
        // §19 "run construction throws": don't strand the player on a black screen. We log and reveal —
        // heroChoices is untouched on a throw, so the picker is still there underneath. (The blueprint's
        // Retry/Return panel is a later phase.)
        console.error('[heroLaunch] run construction failed', err);
      }
      await twoFrames();
      if (dead) return;
      setLaunchCovered(false);
      await fade(el, 1, 0, t.launchRevealMs);
      if (dead) return;
      finish();
    })();
    return () => { dead = true; setLaunchCovered(false); lobbyPoolGate.cancel(); };
  }, [req]);

  if (!req) return null;
  // The accent feeds the center glow via a CSS var; the glow itself is a static radial-gradient whose
  // opacity rides the div's fade — no paint-property animation (repo perf contract).
  return (
    <>
      <div
        ref={elRef}
        className="hsc-curtain"
        style={{ '--hsc-accent': req.accent } as CSSProperties}
        aria-hidden="true"
      />
      <PoolWaitPanel gate={lobbyPoolGate} />
      {versusWait && awaitingFoe && (
        <div className="pool-wait" role="status" aria-live="polite">
          <div className="vspanel pool-wait-delay">
            <div className="vspanel-title">Waiting for your opponent</div>
            <div className="vspanel-body">Both heroes are revealed once both players have chosen.</div>
          </div>
        </div>
      )}
    </>
  );
}
