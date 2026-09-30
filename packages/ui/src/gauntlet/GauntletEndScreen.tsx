/**
 * GAUNTLET END SCREEN — a stage verdict, not a placement (spec §1). Defeated: "Stage S · Round R" with Retry (hero
 * select for the same stage) and Home. Cleared: "Stage cleared!" with the stage's name, the unlock line and Next
 * stage when the following stage is playable and unlocked, and Home. No rating, no replay button.
 *
 * The verdict comes from the store's `gauntletResult` (set on the run-end transition). That slice is not
 * persisted, so a reload onto a finished run re-derives it from the run itself: `gauntletOutcome`, the run's
 * stage, and the round the player's seat fell on (a clear always reads the final round, `GAUNTLET_ROUNDS`).
 */
import type { ReactNode } from 'react';
import { GAUNTLET_ROUNDS, gauntletStage } from '@game/content';
import { gauntletOutcome, type RunState } from '@game/sim';
import { Card } from '../Card';
import { liveBoardView } from '../instView';
import { useGame } from '../store';
import { GAUNTLET_STAGE_COUNT, isStagePlayable, isStageUnlocked } from './gauntletProgress';

type StoredResult = ReturnType<typeof useGame.getState>['gauntletResult'];
type GauntletResult = NonNullable<StoredResult>;

/** The stored verdict when it belongs to this run's stage, else one re-derived from the run. Null mid-run. */
export function resolveGauntletResult(run: RunState, stored: StoredResult): GauntletResult | null {
  if (stored && stored.stage === run.gauntletStage) return stored;
  const outcome = gauntletOutcome(run);
  if (!outcome || run.gauntletStage == null) return null;
  const me = run.lobby?.seats[0];
  const round = outcome === 'cleared' ? GAUNTLET_ROUNDS : me?.eliminatedRound ?? Math.max(1, (run.lobby?.round ?? 2) - 1);
  // Unknown after a reload; the unlock line below keys on the next stage being open, not on this flag.
  return { stage: run.gauntletStage, outcome, round, firstClear: false };
}

export function GauntletEndScreen({ run, reward }: {
  run: RunState;
  /** PR 4's crate reveal renders here on a clear. Nothing is drawn in its place until then. */
  reward?: ReactNode;
}): JSX.Element | null {
  const stored = useGame((s) => s.gauntletResult);
  const startGauntlet = useGame((s) => s.startGauntlet);
  const openTitle = useGame((s) => s.openTitle);
  const result = resolveGauntletResult(run, stored);
  if (!result) return null;
  const { stage, outcome, round } = result;
  const cleared = outcome === 'cleared';
  const next = stage + 1;
  // Next stage is offered only when it can actually start: it exists, is playable (a DEV draft counts, as on the
  // stage select) and is unlocked. The unlock line rides the same test so it never announces a "Coming soon" slot.
  const showNext = cleared && next <= GAUNTLET_STAGE_COUNT && isStagePlayable(next, import.meta.env.DEV) && isStageUnlocked(next);
  const name = gauntletStage(stage)?.name;

  return (
    <div className={`heroselect endscreen gauntletend${cleared ? ' won' : ''}`}>
      <div className="hsbox endbox">
        <div className="eyebrow">{cleared ? `Stage ${stage}` : 'Gauntlet'}</div>
        <h1 className="disp hstitle">{cleared ? 'Stage cleared!' : 'Defeated'}</h1>
        <div className="endsub">{cleared ? name ?? `Stage ${stage}` : `Stage ${stage} · Round ${round}`}</div>
        {showNext && <div className="gauntletend-unlock">Stage {next} unlocked</div>}
        {cleared && reward != null && <div className="gauntletend-reward">{reward}</div>}
        <div className="endboardlabel">Final warband</div>
        <div className="endboard">
          {run.board.length === 0
            ? <span className="endempty">empty</span>
            : run.board.map((m) => <Card key={m.uid} card={liveBoardView(m, run)} suppressPop />)}
        </div>
        <div className="gauntletend-actions">
          {cleared
            ? showNext && <button type="button" className="endplay pressable" onClick={() => startGauntlet(next)}>Next stage</button>
            : <button type="button" className="endplay pressable" onClick={() => startGauntlet(stage)}>Retry</button>}
          <button type="button" className="endplay pressable gauntletend-home" onClick={openTitle}>Home</button>
        </div>
      </div>
    </div>
  );
}
