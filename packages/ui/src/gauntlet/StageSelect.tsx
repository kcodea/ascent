/**
 * GAUNTLET STAGE SELECT — the ten stage slots behind the mode picker's Gauntlet card (Title `titleView === 'gauntlet'`).
 *
 * Each slot reads its `stageSlotState`: `available` / `cleared` start that stage's hero picker (`startGauntlet`);
 * `locked` names the stage to clear first; `soon` (no playable data — stages 6–10, and every draft in a player
 * build) hides the stage's name and tribe; `draft` (DEV only) is a playable authoring stage, tagged so. Progress is
 * read once per mount — the screen is torn down whenever a run starts, so it can never show a stale clear.
 */
import { useMemo } from 'react';
import type { Tribe } from '@game/core';
import { gauntletStage } from '@game/content';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { clearedStages, stageSlotState, type StageSlotState } from './gauntletProgress';

/** Stage slots on the screen: the Gauntlet is ten stages long, whether or not each has a file yet. */
const SLOT_COUNT = 10;

/** Each tribe's glyph — the same symbols the card footer and quest badges use (`Card.tsx` `TRIBE_ICON`). */
const TRIBE_ICON: Record<Tribe, string> = {
  beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star', kobold: 'crown', dwarf: 'anvil',
  celestial: 'clock', spirit: 'clock',
};

const TAG: Record<StageSlotState, string> = {
  available: 'Play', cleared: '✓ Cleared', locked: 'Locked', soon: 'Coming soon', draft: 'Draft',
};

export function StageSelect() {
  const startGauntlet = useGame((s) => s.startGauntlet);
  const slots = useMemo(() => {
    const cleared = clearedStages();
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const n = i + 1;
      return { n, stage: gauntletStage(n), state: stageSlotState(n, { dev: import.meta.env.DEV, cleared }) };
    });
  }, []);

  return (
    <div className="gstages">
      {slots.map(({ n, stage, state }) => {
        const playable = state === 'available' || state === 'cleared' || state === 'draft';
        const hidden = state === 'soon';
        const tip = state === 'locked' ? `Clear Stage ${n - 1} to unlock` : undefined;
        return (
          <button
            key={n}
            type="button"
            className={tip ? 'gslot gtip' : 'gslot'}
            data-stage={n}
            data-state={state}
            data-tip={tip}
            disabled={!playable}
            aria-disabled={!playable || undefined}
            aria-label={`Stage ${n}: ${hidden || !stage ? 'coming soon' : `${stage.name}, ${TAG[state].replace('✓ ', '').toLowerCase()}`}`}
            onClick={playable ? () => { sfx.pulse(); startGauntlet(n); } : undefined}
          >
            <span className="gslot-num">{n}</span>
            <span className="gslot-emblem-slot" aria-hidden="true">
              {state === 'locked'
                ? <span className="gslot-emblem gslot-lock"><Icon name="lock" /></span>
                : !hidden && stage?.tribe
                  ? <span className="gslot-emblem"><Icon name={TRIBE_ICON[stage.tribe]} /></span>
                  : hidden ? <span className="gslot-emblem gslot-soon"><Icon name="clock" /></span> : null}
            </span>
            <span className="gslot-name">{hidden || !stage ? '???' : stage.name}</span>
            <span className="gslot-tag">{TAG[state]}</span>
          </button>
        );
      })}
    </div>
  );
}
