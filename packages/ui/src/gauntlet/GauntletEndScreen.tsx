/**
 * GAUNTLET END SCREEN — a stage verdict, not a placement (spec §1). Defeated: "Stage S · Round R" with Retry (hero
 * select for the same stage) and Home. Cleared: "Stage cleared!" with the stage's name, the unlock line and Next
 * stage when the following stage is playable and unlocked, and Home. No rating, no replay button.
 *
 * The verdict comes from the store's `gauntletResult` (set on the run-end transition). That slice is not
 * persisted, so a reload onto a finished run re-derives it from the run itself: `gauntletOutcome`, the run's
 * stage, and the round the player's seat fell on (a clear always reads the final round, `GAUNTLET_ROUNDS`).
 *
 * A clear's reward line (`GauntletClearReward`, the default `reward`) never promises a crate the server has not
 * granted: signed in, it shows the crate once `gauntletReward` names THIS stage (that slice is not run-scoped), else
 * "Saving your clear…" while `gauntletSaving` is this stage, else nothing (a replay). Signed out it invites a sign-in.
 */
import type { ReactNode } from 'react';
import { GAUNTLET_ROUNDS, gauntletStage } from '@game/content';
import { gauntletOutcome, type RunState } from '@game/sim';
import { Card } from '../Card';
import { liveBoardView } from '../instView';
import '../progression/collection.css';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { GAUNTLET_STAGE_COUNT, gauntletAccountMode, isStagePlayable, isStageUnlocked } from './gauntletProgress';

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

/** The reward line on a clear of `stage`: the granted crate, the pending save, or the sign-in invite. */
export function GauntletClearReward({ stage }: { stage: number }): JSX.Element | null {
  const reward = useGame((s) => s.gauntletReward);
  const saving = useGame((s) => s.gauntletSaving);
  const openCollection = useGame((s) => s.openCollection);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  useGame((s) => `${s.account.userId ?? ''}:${s.account.anonymous}`); // re-render on sign-in / sign-out
  if (gauntletAccountMode() === 'local') {
    return (
      <div className="gauntletend-reward gauntletend-crate signin">
        <span className="gauntletend-crate-note">Sign in to earn crates from Gauntlet clears.</span>
        <button type="button" className="gauntletend-crate-btn crate-btn pressable" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Sign in</button>
      </div>
    );
  }
  if (reward?.stage === stage) {
    return (
      <div className="gauntletend-reward gauntletend-crate earned">
        <span className="colls-crate" aria-hidden />
        <div className="gauntletend-crate-body">
          <span className="gauntletend-crate-head">You earned a Crate!</span>
          <button type="button" className="gauntletend-crate-btn crate-btn pressable" onClick={() => { sfx.pulse(); openCollection(); }}>Open in Collection</button>
        </div>
      </div>
    );
  }
  if (saving === stage) return <div className="gauntletend-reward gauntletend-crate-note" role="status">Saving your clear…</div>;
  return null;
}

export function GauntletEndScreen({ run, reward }: {
  run: RunState;
  /** Drawn under the verdict on a clear. Defaults to `GauntletClearReward` (the crate / saving / sign-in line). */
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
        {cleared && (reward === undefined
          ? <GauntletClearReward stage={stage} />
          : reward != null && <div className="gauntletend-reward">{reward}</div>)}
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
