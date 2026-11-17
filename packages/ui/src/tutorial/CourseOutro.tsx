import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import type { TutorialOutro } from '@game/sim';
import { useGame } from '../store';
import { Flourish } from '../goodLuck/GoodLuckIntro';
import { GLI_DEFAULTS } from '../goodLuck/goodLuckIntroConfig';
import { ancientsLiveForPrompt } from './ancientsLive';
import '../goodLuck/goodLuckIntro.css';
import './tutorialCoach.css';

/** How long the card holds before the menu is brought up under it (a click shortens it). */
export const COURSE_OUTRO_HOLD_MS = 2600;
/** After the menu is mounted under the card: a beat for it to lay out and paint before the card starts to lift. */
export const COURSE_OUTRO_SETTLE_MS = 320;
/** The card's fade out over the menu (the cross-fade). */
export const COURSE_OUTRO_FADE_MS = 900;

/** Leave the finished course for the main menu: the title comes up, and the course run is dropped so the menu
 *  never offers to Continue a lesson that is already over. */
export function exitCourseToMenu(): void {
  const st = useGame.getState();
  st.openTitle();
  st.clearRun();
}

// The outro outlives the tutorial run (the run is gone the moment the menu opens), so it lives in its own tiny store
// and an always-mounted host (`CourseOutroHost`, in Game) draws it.
let current: { outro: TutorialOutro; seq: number } | null = null;
let seq = 0;
const subs = new Set<() => void>();
const emit = (): void => { for (const f of subs) f(); };
export function showCourseOutro(outro: TutorialOutro): void {
  if (current) return; // already showing
  current = { outro, seq: ++seq };
  emit();
}
function clearCourseOutro(): void { current = null; emit(); }
const subscribe = (f: () => void): (() => void) => { subs.add(f); return () => subs.delete(f); };
export function useCourseOutro(): { outro: TutorialOutro; seq: number } | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

/**
 * THE COURSE OUTRO (Learn Ancients, owner ask 2026-11-16: "when the player hits end combat fade to a 'good luck!'
 * screen and bring the player back to the menu"; 2026-11-16 follow-up: "the fade back from the good luck screen can be
 * improved"). The screen fades to dark and the game's own Good Luck words (the game-start intro's type, flourishes and
 * glow) rise in. It holds; then the menu opens UNDER the opaque card, gets a beat to paint, and the card fades away over
 * it (a cross-fade, never a cut, never an empty frame). Opacity / transform only, one-shot.
 */
export function CourseOutroHost(): JSX.Element | null {
  const shown = useCourseOutro();
  return shown ? <CourseOutroCard key={shown.seq} outro={shown.outro} /> : null;
}

function CourseOutroCard({ outro }: { outro: TutorialOutro }): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  const timers = useRef<number[]>([]);
  const leave = (): void => {
    if (leaving.current) return;
    leaving.current = true;
    for (const t of timers.current) window.clearTimeout(t);
    exitCourseToMenu(); // the menu mounts under the card (which is opaque, and above it)
    timers.current = [window.setTimeout(() => {
      const el = rootRef.current;
      const done = (): void => clearCourseOutro();
      if (!el || typeof el.animate !== 'function') { done(); return; }
      const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: COURSE_OUTRO_FADE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
      a.onfinish = done;
      a.oncancel = done;
    }, COURSE_OUTRO_SETTLE_MS)];
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    timers.current.push(window.setTimeout(() => leaveRef.current(), COURSE_OUTRO_HOLD_MS));
    const ts = timers.current;
    return () => { for (const t of ts) window.clearTimeout(t); };
  }, []);
  const line = ancientsLiveForPrompt() ? outro.liveLine : undefined;
  const vars = { '--gli-size': String(GLI_DEFAULTS.textSize) } as CSSProperties;
  return (
    <div ref={rootRef} className="tut-outro" style={vars} role="dialog" aria-label={outro.title} onClick={() => leaveRef.current()}>
      <div className="tut-outro-stage">
        {line && <div className="tut-outro-line">{line}</div>}
        <div className="gli-row">
          <div className="gli-flour gli-flour-l"><div className="gli-flour-in tut-outro-flour"><Flourish /></div></div>
          <div className="gli-word"><span className="gli-text">{outro.title}</span></div>
          <div className="gli-flour gli-flour-r"><div className="gli-flour-in tut-outro-flour"><Flourish /></div></div>
        </div>
      </div>
    </div>
  );
}
