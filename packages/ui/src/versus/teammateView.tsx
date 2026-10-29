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
 *  - THE CROSS-FADE (on the way in and out): the screen I leave fades out over the one I arrive at (about 150-200 ms;
 *    one frozen layer, opacity / transform only, one-shot Web Animations);
 *  - while watching: their hero, name and the team's Health in the hero slot (it is their screen), a calm team-colour vignette
 *    over the edges (a static layer that fades in), and my shop controls visibly inert. No plate or button up top (owner
 *    2026-10-25: the view change and colour say it already). The bottom-right portrait (mine, while watching), Esc and
 *    Tab (when held to peek) come back.
 * Watching holds until the turn is over (owner 2026-10-25: "don't force the player back from the teammate view until the
 * turn is 'over.'"): back to my board on its own only when the fight starts or the match pauses, never at a clock mark
 * (versusStore's `teammateViewReturns`). My clock still runs and still locks MY turn at 0:00 while I watch.
 */
import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { perfMonitor } from '../perfMonitor';
import { PHONE_GPU } from '../phoneDiag';
import { flushSpectateRender, leaveTeammate, leaveTeammateHero, useSpectate, watchTeammate, watchTeammateHero } from './spectate';
import { useVersus } from './versusStore';

/**
 * THE SWAP: A CROSS-FADE (owner 2026-10-25: "The teammate view swap animation is really ugly" and "The flip to teammate
 * view and back should be extremely fast and clean/smooth"; it replaced the full-screen team panel sweep).
 *
 * At the click, a frozen copy of the screen I am leaving (a clone of `#root`, a few hundred plain nodes; its canvases come
 * out blank, which a fade never shows) goes on top as the GHOST, and the real screen swaps underneath it at once. Once
 * the new screen is drawn and calm, the ghost fades out over it, so the two screens truly cross: what is in the same
 * place on both (the board frame, the rail, the buttons) stays put and only what differs dissolves. One layer, opacity
 * only, one-shot, so the compositor runs the fade. A plain fade was picked over a fade with a slight scale (pitched
 * 2026-10-25): with the scale, the two screens' text doubles up mid-fade.
 */
/** Ms of the cross-fade itself. */
export const FADE_MS = 130;
/** The longest the fade waits for the new screen to be drawn and settled (a teammate view whose frames are on their way). */
const SETTLE_CAP_MS = 160;
/** Calm frames in a row (under 8 ms) that count as "the new screen has settled". */
const CALM_FRAMES = 3;
/** The new screen's mount comes in TWO busy frames about 30-40 ms apart (the build, then its follow-up draw), so the fade
 *  never starts sooner than this after the swap, or the second one lands mid-fade (measured 2026-10-25). */
const MIN_SETTLE_MS = 70;
let turning = false;

/** The frozen copy of the screen being left, on top of the real one. */
function ghostOf(root: HTMLElement): HTMLElement {
  const g = root.cloneNode(true) as HTMLElement;
  g.removeAttribute('id');
  g.className = 'duosghost';
  g.setAttribute('aria-hidden', 'true');
  g.setAttribute('inert', '');
  // A hair short of opaque: the compositor may skip drawing what a fully opaque layer hides, and the new screen under the
  // ghost must already be drawn when the fade starts uncovering it.
  g.style.opacity = '0.999';
  for (const n of g.querySelectorAll('[id]')) n.removeAttribute('id');
  root.after(g);
  return g;
}

/** Calls `done` once the new screen is drawn and its mount work has run: `changed()` is true (the store holds the new
 *  screen), then three calm frames in a row (under 8 ms each: the commit's paint and the effects that follow it are done),
 *  capped so a slow teammate view can never hold the fade. The frozen ghost is on top the whole time, so the wait shows
 *  the screen I clicked on, standing still; the fade itself then runs over a quiet main thread. */
function whenNewScreenSettled(changed: () => boolean, done: () => void): void {
  const start = performance.now();
  let last = start;
  let calm = 0;
  const tick = (): void => {
    const now = performance.now();
    const ok = changed();
    calm = ok && now - last < 8 ? calm + 1 : 0;
    last = now;
    if ((calm >= CALM_FRAMES && now - start >= MIN_SETTLE_MS) || now - start > SETTLE_CAP_MS) done(); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** A View Transition handle (the subset used here; `document.startViewTransition`, Chrome 111+ / Safari 18+). */
interface ViewTransitionLike { finished: Promise<unknown>; ready: Promise<unknown> }
type StartViewTransition = (cb: () => void | Promise<void>) => ViewTransitionLike;

/**
 * The browser's View Transition entry point, or null where there is none (the frozen-ghost fallback then runs).
 * DESKTOP ONLY: on the phone GPU path (`PHONE_GPU`) the full-screen snapshot pair the transition keeps is a large
 * texture cost (the phone memory budget, R-TOUCH-RUN-MEMORY-01), and on the throttled phone bench it measured far worse
 * than the ghost (one 0.9-1.7 s frame per swap); phones keep the ghost. Re-measured once the swap stopped remounting the
 * board (R-DUOS-VIEW-NOREMOUNT-01, 2026-10-29, 4x-throttled phone bench): the ghost still measured best (worst swap frame
 * about 0.2 s), the View Transition still 0.8-1.3 s, and a plain swap with no fade at all was worse than both.
 */
export function viewTransitionOf(doc: Document | undefined = typeof document !== 'undefined' ? document : undefined, phone: boolean = PHONE_GPU): StartViewTransition | null {
  if (phone) return null;
  const f = (doc as unknown as { startViewTransition?: StartViewTransition } | undefined)?.startViewTransition;
  return typeof f === 'function' ? f.bind(doc) : null;
}

/**
 * THE SWAP AS A VIEW TRANSITION (owner 2026-10-29: "toggling yours and teammates screen ... can be kinda janky. It needs
 * to feel like you clicked the button and are viewing the other player's screen then clicking to get back ... [without]
 * massive hitching"; R-DUOS-VIEW-SWAP-01). The browser snapshots the screen I am leaving on the GPU (no DOM copy: the
 * frozen ghost below cost a full clone of `#root`, its style + layout + paint on the click frame and its removal later,
 * measured 15-40 ms of the 50-75 ms swap frames), the update runs once, synchronously (`flushSync`, and the watch screen
 * renders at once instead of on its next frame: no animation frame runs while the update is pending), and the cross-fade
 * itself runs on the compositor, so a busy main thread after the swap never stutters it. Durations: `duos-vt` in
 * versus.css (FADE_MS).
 */
function turnByViewTransition(start: StartViewTransition, swap: () => void): void {
  turning = true;
  perfMonitor.mark?.('duos:turn:start');
  const root = document.documentElement;
  root.classList.add('duos-vt');
  let t: ViewTransitionLike;
  try {
    t = start(() => { flushSync(swap); });
  } catch {
    root.classList.remove('duos-vt');
    turning = false;
    swap();
    return;
  }
  const end = (): void => { root.classList.remove('duos-vt'); turning = false; perfMonitor.mark?.('duos:turn:end'); };
  t.finished.then(end, end);
}

/** The swap: freeze the screen I am leaving as a ghost on top, swap under it, cross-fade once the new one is drawn. */
function turn(swap: () => void, changedSince?: () => () => boolean): void {
  const root = typeof document !== 'undefined' ? document.getElementById('root') : null;
  if (!root || turning) { swap(); return; }
  const vt = viewTransitionOf();
  if (vt) { turnByViewTransition(vt, swap); return; }
  if (!('animate' in root)) { swap(); return; }
  turning = true;
  perfMonitor.mark?.('duos:turn:start');
  const ghost = ghostOf(root);
  const before = useGame.getState().run;
  const changed = changedSince ? changedSince() : () => useGame.getState().run !== before;
  swap();
  whenNewScreenSettled(changed, () => {
    const out = ghost.animate([{ opacity: 0.999 }, { opacity: 0 }], { duration: FADE_MS, easing: 'cubic-bezier(0.33, 0, 0.2, 1)', fill: 'forwards' });
    const end = (): void => { ghost.remove(); turning = false; perfMonitor.mark?.('duos:turn:end'); };
    out.onfinish = end;
    out.oncancel = end;
  });
}

/** My own Versus Hero Select is on screen (from the offer until the launch curtain takes it; the server's phase may
 *  already be past it while the last pick's ceremony plays). */
export function ownVersusHeroSelect(): boolean {
  const g = useGame.getState();
  const m = useVersus.getState().match;
  return g.pendingMode === 'versus' && !!g.heroChoices && !!m && m.phase !== 'complete';
}
// The launch curtain took my Hero Select (or the match ended under it): my teammate's choices go with it.
useGame.subscribe((s, prev) => { if (prev.heroChoices && !s.heroChoices) leaveTeammateHero(); });

/** HERO SELECT's swap is done once the store holds the other Hero Select (or the teammate's is still on its way). */
const heroChanged = (): (() => boolean) => {
  const before = useSpectate.getState().hero ?? null;
  return () => (useSpectate.getState().hero ?? null) !== before || !useSpectate.getState().teammateHero;
};

/**
 * VERSUS DUOS AT HERO SELECT (owner 2026-10-26; R-DUOS-HEROSELECT-01): my teammate's hero choices, live, over my own
 * (the same cross-fade). Ranked Duos can open the same view from its own lobby Hero Select: it needs only a teammate seat
 * whose Hero Select frames reach `spectate.ts` (`trackDuosMatch` + `receiveSpectate`).
 */
export function enterTeammateHeroView(): void {
  const v = useVersus.getState();
  const mate = v.match?.group?.duos?.mate;
  if (!mate || !ownVersusHeroSelect() || useSpectate.getState().teammateHero) return;
  sfx.tick();
  turn(() => { watchTeammateHero(mate); flushSpectateRender(); }, heroChanged);
}
/** Back to my own hero choices. */
export function exitTeammateHeroView(): void {
  if (!useSpectate.getState().teammateHero) return;
  sfx.tick();
  turn(() => leaveTeammateHero(), heroChanged);
}

/** Open my teammate's live screen (Duos, in the shop, from my own board; on Hero Select, their hero choices). */
export function enterTeammateView(): void {
  const v = useVersus.getState();
  if (ownVersusHeroSelect()) { enterTeammateHeroView(); return; }
  const mate = v.match?.group?.duos?.mate;
  const g = useGame.getState();
  if (!mate || !v.match || v.match.phase !== 'shop' || v.match.paused_at || useSpectate.getState().teammate) return;
  if (g.run.mode !== 'versus' || g.run.phase !== 'recruit') return;
  sfx.tick();
  turn(() => {
    // The swap runs a frame after the click (the View Transition captures the screen first): the shop may have closed.
    const now = useVersus.getState().match;
    if (!now || now.phase !== 'shop' || now.paused_at || useGame.getState().run.phase !== 'recruit') return;
    watchTeammate(mate);
    flushSpectateRender();
    document.body.classList.add('duos-viewing');
  });
}

/** Back to my own board. */
export function exitTeammateView(): void {
  if (useSpectate.getState().teammateHero) { exitTeammateHeroView(); return; }
  if (!useSpectate.getState().teammate) return;
  sfx.tick();
  turn(() => {
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
      const viewing = (): boolean => !!useSpectate.getState().teammate || !!useSpectate.getState().teammateHero;
      if (e.key === 'Escape' && viewing()) { e.preventDefault(); e.stopPropagation(); exitTeammateView(); return; }
      if (e.key === 'Tab' && !e.repeat) {
        e.preventDefault();
        if (viewing()) { exitTeammateView(); return; }
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

/** While watching: the static team-colour edge vignette. No "Watching <Name>" plate and no "Back to your board" button
 *  (owner 2026-10-25: "pretty obvious from our view change/color"); the bottom-right portrait (my own, DuosMateDock),
 *  Esc and letting go of Tab are the ways back. */
export function TeammateFrame(): JSX.Element | null {
  const on = useSpectate((s) => s.teammate === true);
  if (!on) return null;
  return <div className="duosview-vignette" aria-hidden="true" />;
}
