import { useGame } from './store';
import { sfx } from './sfx';
import { BOT_LEVELS, MAX_BOT_LEVEL, MIN_BOT_LEVEL, practiceTribeOptions, togglePracticeTribe, type BotLevel, type PracticeConfig, type PracticeTribe } from '@game/sim';

/**
 * PRACTICE OPTIONS (owner ask 2026-08-24) — the setup screen shown after choosing Practice and before the hero
 * picker. A dedicated menu of knobs: who fills the table, whether the player can die, the shop-timer speed, and
 * which tribes are in the game. `Start` applies them and opens the hero picker; the choices are pinned onto the run.
 *
 * Pure over the store draft (`practiceDraft`) — every control writes back through `setPracticeDraft`, which also
 * persists, so a returning player keeps their last setup.
 */

/** A labelled segmented control: one row of options, the lit ones selected. Generic over the option value.
 *  Single-select passes `value`; MULTI-select passes `isOn` (which options are lit) and does its own toggling in
 *  `onPick`, so both share one look (the `poseg` pills, the global gauntlet cursor). */
function Segmented<T extends string | number | null>(props: {
  label: string;
  hint?: string;
  value?: T;
  isOn?: (v: T) => boolean;
  options: { value: T; label: string }[];
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
  const lit = (v: T): boolean => (props.isOn ? props.isOn(v) : v === props.value);
  return (
    <div className={`porow${props.disabled ? ' podisabled' : ''}`}>
      <div className="polabel">
        {props.label}
        {props.hint && <span className="pohint">{props.hint}</span>}
      </div>
      <div className="poseg" role="group" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={String(o.value)}
            className={`poseg-btn${lit(o.value) ? ' on' : ''}`}
            aria-pressed={lit(o.value)}
            disabled={props.disabled}
            onPointerDown={() => { if (!props.disabled) { sfx.tick(); props.onPick(o.value); } }}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

const OPPONENTS: { value: PracticeConfig['opponents']; label: string }[] = [
  { value: 'players', label: 'Players' },
  { value: 'bots', label: 'Bots' },
];
/** 1–10 (owner ask 2026-09-02). 1/3/5 are the old Easy/Medium/Hard; 6+ add utility minions to the bot boards. */
const DIFFICULTY: { value: BotLevel; label: string }[] = Array.from(
  { length: MAX_BOT_LEVEL - MIN_BOT_LEVEL + 1 },
  (_, i) => ({ value: (MIN_BOT_LEVEL + i) as BotLevel, label: String(MIN_BOT_LEVEL + i) }),
);
/** The hint under the level row — names the anchors so the numbers mean something. */
function levelHint(level: BotLevel): string {
  const named = level === 1 ? 'Easy' : level === 3 ? 'Medium' : level === 5 ? 'Hard' : null;
  const utility = BOT_LEVELS[level].utilitySlots > 0 ? 'Bots field real utility minions.' : 'Stat-only bots.';
  return named ? `${named}. ${utility}` : utility;
}
const HEALTH: { value: PracticeConfig['health']; label: string }[] = [
  { value: 'unlimited', label: 'Unlimited' },
  { value: 'normal', label: 'Normal' },
];
const TIMES: { value: PracticeConfig['timeMult']; label: string }[] = [
  { value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 3, label: '3×' }, { value: 4, label: '4×' },
  // Owner 2026-09-27: "add an unlimited time option in practice". 0 = no turn clock.
  { value: 0, label: 'Unlimited' },
];
/** "Normal" (the usual random tribes) plus the tribes of the set a new run uses, in that set's order (owner
 *  2026-09-27: multi-select, "reword 'none' to 'Normal'"). Normal is `null`; the draft holds the picked list. */
const TRIBE_OPTIONS: { value: PracticeTribe | null; label: string }[] = [
  { value: null, label: 'Normal' },
  ...practiceTribeOptions().map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
];

export function PracticeOptions() {
  const open = useGame((s) => s.practiceSetupOpen);
  const cfg = useGame((s) => s.practiceDraft);
  const setDraft = useGame((s) => s.setPracticeDraft);
  const confirm = useGame((s) => s.confirmPracticeSetup);
  const cancel = useGame((s) => s.cancelPracticeSetup);
  if (!open) return null;

  return (
    <div className="modepick practiceopts" role="dialog" aria-label="Practice options">
      <button className="hsback" onPointerDown={() => { sfx.pulse(); cancel(); }}>← Back</button>
      <div className="mpbox pobox">
        <h1 className="disp mptitle">PRACTICE</h1>
        <p className="posub">A sandbox to try things out. Nothing here is rated.</p>

        <Segmented
          label="Opponents"
          hint={cfg.opponents === 'bots' ? 'Simple, effectless enemies that only grow in stats.' : "Real players' recorded warbands."}
          value={cfg.opponents}
          options={OPPONENTS}
          onPick={(v) => setDraft({ opponents: v })}
        />
        <Segmented
          label="Bot difficulty"
          hint={levelHint(cfg.botDifficulty)}
          value={cfg.botDifficulty}
          options={DIFFICULTY}
          onPick={(v) => setDraft({ botDifficulty: v })}
          disabled={cfg.opponents !== 'bots'}
        />
        <Segmented
          label="Health"
          hint={cfg.health === 'unlimited' ? "You can't be eliminated." : 'Real damage. Last one standing wins.'}
          value={cfg.health}
          options={HEALTH}
          onPick={(v) => setDraft({ health: v })}
        />
        <Segmented
          label="Time"
          hint={cfg.timeMult === 0 ? 'No shop timer. Take as long as you like.' : 'Shop-timer speed.'}
          value={cfg.timeMult}
          options={TIMES}
          onPick={(v) => setDraft({ timeMult: v })}
        />
        <Segmented
          label="Tribes"
          hint={`Select as many as you'd like. Selected tribes will be included in the game in addition to Neutrals. Normal contains all ${TRIBE_OPTIONS.length - 1}.`}
          isOn={(v) => (v === null ? cfg.tribes.length === 0 : cfg.tribes.includes(v))}
          options={TRIBE_OPTIONS}
          onPick={(v) => setDraft({ tribes: togglePracticeTribe(cfg.tribes, v) })}
        />

        <button className="postart pressable" onPointerDown={() => { sfx.pulse(); confirm(); }}>Start</button>
      </div>
    </div>
  );
}
