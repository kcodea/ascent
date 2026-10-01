/**
 * GAUNTLET STAGE SELECT — the ten stage slots behind the mode picker's Gauntlet card (Title `titleView === 'gauntlet'`).
 *
 * Each slot reads its `stageSlotState`: `available` / `cleared` start that stage's hero picker (`startGauntlet`);
 * `locked` names the stage to clear first; `soon` (no playable data — stages 6–10, and every draft in a player
 * build) hides the stage's name and tribe; `draft` (DEV only) is a playable authoring stage, tagged so. A cleared
 * slot's hover bubble says a replay grants no crate. Progress is re-read whenever it is written (a clear, an
 * account refresh landing after sign-in) and whenever the signed-in account changes.
 *
 * Signed out (a guest or no session, `gauntletAccountMode() === 'local'`) a banner above the slots says progress
 * stays on this device and clears grant no crates, with a Sign in button.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { gauntletStage } from '@game/content';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import { useGame } from '../store';
import {
  clearedStages, GAUNTLET_STAGE_COUNT, gauntletAccountMode, gauntletProgressVersion, stageSlotState, subscribeGauntletProgress,
  type StageSlotState,
} from './gauntletProgress';
import { TRIBE_ICON } from './tribeIcon';
import { foePortrait } from './foePortrait';

/** Stage slots on the screen: one per Gauntlet stage, whether or not each has a file yet. */
const SLOT_COUNT = GAUNTLET_STAGE_COUNT;

const REPLAY_NOTE = 'Already cleared. No crate for replays.';

const TAG: Record<StageSlotState, string> = {
  available: 'Play', cleared: '✓ Cleared', locked: 'Locked', soon: 'Coming soon', draft: 'Draft',
};

export function StageSelect() {
  const startGauntlet = useGame((s) => s.startGauntlet);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const version = useSyncExternalStore(subscribeGauntletProgress, gauntletProgressVersion);
  // Re-render on sign-in / sign-out; the mode itself is read from the identity, as progress is.
  const accountKey = useGame((s) => `${s.account.userId ?? ''}:${s.account.anonymous}`);
  const local = gauntletAccountMode() === 'local';
  const slots = useMemo(() => {
    const cleared = clearedStages();
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const n = i + 1;
      return { n, stage: gauntletStage(n), state: stageSlotState(n, { dev: import.meta.env.DEV, cleared }) };
    });
  }, [version, accountKey]); // not read inside: they are the re-read signals

  return (
    <>
      {local && (
        <div className="gstage-guest" role="note">
          <span>You're not signed in. Progress is saved on this device only, and clears won't grant crates.</span>
          <button type="button" className="gstage-signin crate-btn pressable" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Sign in</button>
        </div>
      )}
      <div className="gstages">
        {slots.map(({ n, stage, state }) => {
          const playable = state === 'available' || state === 'cleared' || state === 'draft';
          const hidden = state === 'soon';
          // The slot's backdrop is the stage OPPONENT's portrait art (owner ask 2026-10-01): a tier-6 unit of its tribe,
          // shown on "coming soon" stages too (dimmed, name still hidden) so the whole row reads as five tribes.
          const art = foePortrait(n).art;
          const tip = state === 'locked' ? `Clear Stage ${n - 1} to unlock` : state === 'cleared' ? REPLAY_NOTE : undefined;
          return (
            <button
              key={n}
              type="button"
              className={`gslot${tip ? ' gtip' : ''}${art ? ' hasart' : ''}`}
              data-stage={n}
              data-state={state}
              data-tip={tip}
              disabled={!playable}
              aria-disabled={!playable || undefined}
              aria-description={state === 'cleared' ? REPLAY_NOTE : undefined}
              aria-label={`Stage ${n}: ${hidden || !stage ? 'coming soon' : `${stage.name}, ${TAG[state].replace('✓ ', '').toLowerCase()}`}`}
              onClick={playable ? () => { sfx.pulse(); startGauntlet(n); } : undefined}
            >
              {art && <span className="gslot-art" aria-hidden="true"><img decoding="sync" src={art} alt="" draggable={false} /></span>}
              <span className="gslot-num">{n}</span>
              <span className="gslot-emblem-slot" aria-hidden="true">
                {state === 'locked'
                  ? <span className="gslot-emblem gslot-lock"><Icon name="lock" /></span>
                  : !hidden && !art && stage?.tribe
                    ? <span className="gslot-emblem"><Icon name={TRIBE_ICON[stage.tribe]} /></span>
                    : hidden && !art ? <span className="gslot-emblem gslot-soon"><Icon name="clock" /></span> : null}
              </span>
              <span className="gslot-name">{hidden || !stage ? '???' : stage.name}</span>
              <span className="gslot-tag">{TAG[state]}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}
