/**
 * TUTORIAL — the first-launch welcome (blueprint §5.1).
 *
 * The very first time a profile opens the game — before any account, name, mode, or hero choice — a focused
 * panel over the Title offers the guided course. Primary: Learn Ascent. Secondary: Play Now (records a SKIP,
 * which is not a completion, so the course still shows as unplayed in the Learn hub). Either choice retires the
 * prompt; it never nags again.
 *
 * "First launch" is simply: the core course has no status yet (`isFirstLaunch`). Self-gates on that + the Title
 * being up, so it renders nowhere else.
 */
import { useSyncExternalStore } from 'react';
import { LEARN_ASCENT } from '@game/sim';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { isFirstLaunch, skipCourse, subscribeTutorialProfile } from './tutorialProfile';
import './tutorialCoach.css';

export function FirstLaunchPanel(): JSX.Element | null {
  const showTitle = useGame((s) => s.showTitle);
  const startTutorial = useGame((s) => s.startTutorial);
  // Reactive: a skip (or starting the course) flips `isFirstLaunch` false and re-renders this away.
  const fresh = useSyncExternalStore(subscribeTutorialProfile, isFirstLaunch);

  if (!showTitle || !fresh) return null;

  return (
    <div className="tut-firstlaunch" role="dialog" aria-label="Welcome to Ascent">
      <div className="tut-fl-card">
        <div className="tut-fl-eyebrow">Welcome to Ascent</div>
        <h1 className="tut-fl-title">First time here?</h1>
        <p className="tut-fl-sub">A quick guided game teaches you everything — build a warband, use your power, and win a lobby.</p>
        <div className="tut-fl-actions">
          <button
            className="tut-fl-primary"
            onClick={() => { sfx.pulse(); startTutorial(LEARN_ASCENT); }}
          >
            <span className="tut-fl-btntitle">Learn Ascent</span>
            <span className="tut-fl-btnsub">Build a warband and win a guided lobby</span>
          </button>
          <button
            className="tut-fl-secondary"
            onClick={() => { sfx.pulse(); skipCourse(LEARN_ASCENT.id, LEARN_ASCENT.version); }}
          >
            <span className="tut-fl-btntitle">Play Now</span>
            <span className="tut-fl-btnsub">Skip for now — you can start it later from Learn</span>
          </button>
        </div>
      </div>
    </div>
  );
}
