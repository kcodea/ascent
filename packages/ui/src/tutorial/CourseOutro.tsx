import { useEffect, useRef, type CSSProperties } from 'react';
import type { TutorialOutro } from '@game/sim';
import { useGame } from '../store';
import { Flourish } from '../goodLuck/GoodLuckIntro';
import { GLI_DEFAULTS } from '../goodLuck/goodLuckIntroConfig';
import { ancientsLiveForPrompt } from './ancientsLive';
import '../goodLuck/goodLuckIntro.css';
import './tutorialCoach.css';

/** How long the card holds before it returns to the menu (a click returns at once). */
export const COURSE_OUTRO_HOLD_MS = 2800;

/** Leave the finished course for the main menu: the title comes up, and the course run is dropped so the menu
 *  never offers to Continue a lesson that is already over. */
export function exitCourseToMenu(): void {
  const st = useGame.getState();
  st.openTitle();
  st.clearRun();
}

/**
 * THE COURSE OUTRO (Learn Ancients, owner ask 2026-11-16: "when the player hits end combat fade to a 'good luck!'
 * screen and bring the player back to the menu"). The screen fades to dark and the game's own Good Luck words
 * (the game-start intro's type, flourishes and glow, `goodLuck/`) rise in. While the Ancients release switch is on
 * a short line sits under them. It holds, then the menu opens. Opacity / transform one-shots only (CSS).
 */
export function CourseOutro({ outro }: { outro: TutorialOutro }): JSX.Element {
  const done = useRef(false);
  const leave = (): void => {
    if (done.current) return;
    done.current = true;
    exitCourseToMenu();
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    const t = window.setTimeout(() => leaveRef.current(), COURSE_OUTRO_HOLD_MS);
    return () => window.clearTimeout(t);
  }, []);
  const line = ancientsLiveForPrompt() ? outro.liveLine : undefined;
  const vars = { '--gli-size': String(GLI_DEFAULTS.textSize) } as CSSProperties;
  return (
    <div className="tut-outro" style={vars} role="dialog" aria-label={outro.title} onClick={() => leaveRef.current()}>
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
