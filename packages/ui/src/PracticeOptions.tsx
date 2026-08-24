import { useGame } from './store';
import { sfx } from './sfx';
import type { PracticeConfig, SurgeTribe } from '@game/sim';

/**
 * PRACTICE OPTIONS (owner ask 2026-08-24) — the setup screen shown after choosing Practice and before the hero
 * picker. A dedicated menu of knobs: who fills the table, whether the player can die, the shop-timer speed, and
 * an optional tribe surge. `Start` applies them and opens the hero picker; the choices are pinned onto the run.
 *
 * Pure over the store draft (`practiceDraft`) — every control writes back through `setPracticeDraft`, which also
 * persists, so a returning player keeps their last setup.
 */

/** A labelled segmented control: one row of options, the selected one lit. Generic over the option value. */
function Segmented<T extends string | number | null>(props: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  onPick: (v: T) => void;
  disabled?: boolean;
}) {
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
            className={`poseg-btn${o.value === props.value ? ' on' : ''}`}
            aria-pressed={o.value === props.value}
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
const DIFFICULTY: { value: PracticeConfig['botDifficulty']; label: string }[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];
const HEALTH: { value: PracticeConfig['health']; label: string }[] = [
  { value: 'unlimited', label: 'Unlimited' },
  { value: 'normal', label: 'Normal' },
];
const TIMES: { value: PracticeConfig['timeMult']; label: string }[] = [
  { value: 1, label: '1×' }, { value: 2, label: '2×' }, { value: 3, label: '3×' }, { value: 4, label: '4×' },
];
const SURGES: { value: SurgeTribe | null; label: string }[] = [
  { value: null, label: 'None' },
  { value: 'beast', label: 'Beast' },
  { value: 'dragon', label: 'Dragon' },
  { value: 'kobold', label: 'Kobold' },
  { value: 'demon', label: 'Demon' },
  { value: 'dwarf', label: 'Dwarf' },
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
        <p className="posub">A sandbox to try things out — nothing here is rated.</p>

        <Segmented
          label="Opponents"
          hint={cfg.opponents === 'bots' ? 'Simple, effectless enemies that only grow in stats.' : "Real players' recorded warbands."}
          value={cfg.opponents}
          options={OPPONENTS}
          onPick={(v) => setDraft({ opponents: v })}
        />
        <Segmented
          label="Bot difficulty"
          value={cfg.botDifficulty}
          options={DIFFICULTY}
          onPick={(v) => setDraft({ botDifficulty: v })}
          disabled={cfg.opponents !== 'bots'}
        />
        <Segmented
          label="Health"
          hint={cfg.health === 'unlimited' ? "You can't be eliminated." : 'Real damage — last one standing wins.'}
          value={cfg.health}
          options={HEALTH}
          onPick={(v) => setDraft({ health: v })}
        />
        <Segmented
          label="Time"
          hint="Shop-timer speed."
          value={cfg.timeMult}
          options={TIMES}
          onPick={(v) => setDraft({ timeMult: v })}
        />
        <Segmented
          label="Tribe surge"
          hint="Doubles how often the chosen tribe's cards appear in the shop."
          value={cfg.tribeSurge}
          options={SURGES}
          onPick={(v) => setDraft({ tribeSurge: v })}
        />

        <button className="postart pressable" onPointerDown={() => { sfx.pulse(); confirm(); }}>Start</button>
      </div>
    </div>
  );
}
