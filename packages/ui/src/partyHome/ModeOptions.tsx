/**
 * THE PARTY HOME's IN-PLACE MODE OPTIONS (prototype, owner 2026-11-02: "build this screen into the new ui flow as well, it
 * all needs to flow beautifully and seamlessly"). A mode with options shows them in ONE panel beside the party's cards,
 * never on a separate page; START reads them. Every option and rule of the old screens is kept:
 *  - PRACTICE (PracticeOptions.tsx): Sandbox | God Mode, then Set (DEV), Heroes, Health, Time (the hint reads the run's
 *    real Gold Fuse threshold, `fuseGoldOf`), Opponent Rank (greyed, with the reason, for a dev set), Tribes. God Mode
 *    greys the Sandbox rows and lists what it gives you. Writes the same store draft (`setPracticeDraft`, persisted).
 *  - GAUNTLET (gauntlet/StageSelect.tsx): the ten stages with their state; pick one, START opens its hero picker.
 *  - VERSUS 1v1 / GROUP / DUOS: `RoomRulesPanel` in versusRoomHome.tsx.
 * Built from the shell kit only. Static paint.
 */
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { gauntletStage, type SetId } from '@game/content';
import {
  normalizePracticeRank, normalizePracticeTribes, PRACTICE_RANKS, practiceSetOf, practiceSetOptions, practiceTribeOptions,
  togglePracticeTribe, type PracticeConfig, type PracticeRank, type PracticeTribe,
} from '@game/sim';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { fuseGoldOf } from '../goldClock';
import { foePortrait } from '../gauntlet/foePortrait';
import { clearedStages, GAUNTLET_STAGE_COUNT, gauntletAccountMode, gauntletProgressVersion, stageSlotState, subscribeGauntletProgress, type StageSlotState } from '../gauntlet/gauntletProgress';
import { PhChip, PhRow, PhSegmented, phNum } from './kit';

// ── PRACTICE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const HERO_MODES = [{ value: 'beginner' as const, label: 'Beginner' }, { value: 'all' as const, label: 'All' }];
const HEALTH: { value: PracticeConfig['health']; label: string }[] = [{ value: 'unlimited', label: 'Unlimited' }, { value: 'normal', label: 'Normal' }];
const TIMES: { value: PracticeConfig['timeMult']; label: ReactNode }[] = [
  { value: 1, label: phNum('1x') }, { value: 2, label: phNum('2x') }, { value: 3, label: phNum('3x') }, { value: 4, label: phNum('4x') }, { value: 0, label: 'Unlimited' },
];
const RANK_LABEL: Record<PracticeRank, string> = { all: 'All Ranks', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };
const RANKS = PRACTICE_RANKS.map((value) => ({ value, label: RANK_LABEL[value] }));
const GOD_FEATURES: [string, string][] = [
  ['999 Gold', 'Buy, roll and level up as much as you like.'],
  ['No timer', 'Every turn waits for you.'],
  ['Any card', 'Put any minion or spell straight into your shop.'],
  ['Any rune', 'Take any rune at any time.'],
  ['Pick the opponent', 'Choose which round your next opponent comes from.'],
  ['Nothing is saved', 'No rating, no history. Experiment freely.'],
];
/** Practice's fuse: Practice is never pinned to a medal, so this is the plain threshold (R-TIMER-FUSE-02). */
const PRACTICE_FUSE = fuseGoldOf({ mode: 'practice', medalAtStart: undefined });

export function PracticePanel() {
  const cfg = useGame((s) => s.practiceDraft);
  const setDraft = useGame((s) => s.setPracticeDraft);
  const god = cfg.godMode === true;
  const setId = practiceSetOf(import.meta.env.DEV ? cfg : undefined);
  const devSet = import.meta.env.DEV && setId !== practiceSetOptions().find((o) => o.live)?.id;
  const setOptions = useMemo(() => (import.meta.env.DEV ? practiceSetOptions().map((o) => ({ value: o.id as SetId, label: phNum(o.live ? `${o.name} (live)` : o.name) })) : []), []);
  const tribes: { value: PracticeTribe | null; label: string }[] = [
    { value: null, label: 'Normal' },
    ...practiceTribeOptions(setId).map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
  ];
  const rank = normalizePracticeRank(cfg.rank);
  const pick = <K extends keyof PracticeConfig>(k: K) => (v: PracticeConfig[K]): void => { sfx.tick(); setDraft({ [k]: v } as Partial<PracticeConfig>); };
  return (
    <>
      <PhSegmented size="l" value={god ? 'god' : 'sandbox'} onPick={(v) => { sfx.tick(); setDraft({ godMode: v === 'god' }); }}
        options={[{ value: 'sandbox', label: 'Sandbox' }, { value: 'god', label: 'God Mode' }]}
        hint={god ? 'A fixed setup with every tool unlocked.' : 'Set the game up your way.'} />
      {god ? (
        <div className="pho-god" aria-label="What God Mode gives you">
          {GOD_FEATURES.map(([t, x]) => <div key={t} className="pho-godrow"><span>{t}</span><span>{x}</span></div>)}
        </div>
      ) : (
        <div className="pho-rows">
          {import.meta.env.DEV && (
            <PhSegmented label="Set" value={setId} options={setOptions}
              hint={devSet ? 'Dev builds only. Your opponents are bots playing this set.' : 'Dev builds only. The set this game is played with.'}
              onPick={(v) => { sfx.tick(); setDraft({ setId: v, tribes: normalizePracticeTribes(cfg.tribes, v) }); }} />
          )}
          <PhSegmented label="Heroes" value={cfg.heroes ?? 'beginner'} options={HERO_MODES} onPick={pick('heroes')}
            hint={(cfg.heroes ?? 'beginner') === 'beginner' ? 'Pick from three starter heroes: Indy, Warden and Keshi.' : 'Pick from every hero.'} />
          <PhSegmented label="Health" value={cfg.health} options={HEALTH} onPick={pick('health')}
            hint={cfg.health === 'unlimited' ? "You can't be eliminated." : 'Real damage. Last one standing wins.'} />
          <PhSegmented label="Time" value={cfg.timeMult} options={TIMES} onPick={pick('timeMult')}
            hint={cfg.timeMult === 0 ? 'No shop timer. Take as long as you like.' : `Shop timer length. It starts once you spend ${PRACTICE_FUSE} Gold in a turn.`} />
          <PhSegmented label="Opponent rank" value={rank} options={RANKS} onPick={pick('rank')} disabled={devSet}
            hint={devSet ? 'Not used. Bots play this set.' : rank === 'all' ? 'Recorded players of every rank.' : `The recorded players a ${RANK_LABEL[rank]} player meets in ranked games.`} />
          <PhSegmented label="Tribes" isOn={(v) => (v === null ? cfg.tribes.length === 0 : cfg.tribes.includes(v))} options={tribes}
            onPick={(v) => { sfx.tick(); setDraft({ tribes: togglePracticeTribe(cfg.tribes, v, setId) }); }}
            hint={`Pick as many as you like. They join the Neutrals. Normal has all ${tribes.length - 1}.`} />
        </div>
      )}
    </>
  );
}

// ── GAUNTLET ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const STAGE_TAG: Record<StageSlotState, string | null> = { available: null, cleared: 'Cleared', locked: 'Locked', soon: 'Coming soon', draft: 'Draft' };
export const stagePlayable = (s: StageSlotState): boolean => s === 'available' || s === 'cleared' || s === 'draft';

export function useGauntletStages() {
  const version = useSyncExternalStore(subscribeGauntletProgress, gauntletProgressVersion);
  const accountKey = useGame((s) => `${s.account.userId ?? ''}:${s.account.anonymous}`);
  return useMemo(() => {
    const cleared = clearedStages();
    return Array.from({ length: GAUNTLET_STAGE_COUNT }, (_, i) => {
      const n = i + 1;
      return { n, stage: gauntletStage(n), state: stageSlotState(n, { dev: import.meta.env.DEV, cleared }) };
    });
  }, [version, accountKey]); // not read inside: they are the re-read signals
}

export function GauntletPanel({ selected, onSelect }: { selected: number | null; onSelect: (n: number) => void }) {
  const stages = useGauntletStages();
  const soon = stages.filter((x) => x.state === 'soon');
  const shown = stages.filter((x) => x.state !== 'soon');
  return (
    <>
      {gauntletAccountMode() === 'local' && (
        <div className="pho-note">
          <span>Not signed in. Progress stays on this device and clears grant no chests.</span>
        </div>
      )}
      <div className="pho-stages" role="list">
        {shown.map(({ n, stage, state }) => {
          const playable = stagePlayable(state);
          return (
            <PhRow key={n} className={`pho-stage${playable ? '' : ' off'}`} selected={selected === n}
              lead={<span className="pho-stagelead"><span className="pho-stagenum">{n}</span><span className="ph-fportrait">{foePortrait(n).art && <img src={foePortrait(n).art} alt="" draggable={false} decoding="sync" />}</span></span>}
              title={stage?.name ?? `Stage ${n}`}
              sub={state === 'locked' ? `Clear Stage ${n - 1} to unlock` : state === 'cleared' ? 'Already cleared. No chest for replays.' : undefined}
              right={STAGE_TAG[state] ? <PhChip tone={state === 'cleared' ? 'teal' : 'neutral'}>{STAGE_TAG[state]}</PhChip> : undefined}
              onClick={playable ? () => { sfx.tick(); onSelect(n); } : undefined} label={`Stage ${n}${stage ? `, ${stage.name}` : ''}`} />
          );
        })}
      </div>
      {soon.length > 0 && <span className="pho-hint">{soon.length === 1 ? `Stage ${soon[0]!.n} is coming soon.` : `Stages ${soon[0]!.n} to ${soon[soon.length - 1]!.n} are coming soon.`}</span>}
    </>
  );
}
