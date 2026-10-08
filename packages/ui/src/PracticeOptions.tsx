import { useGame } from './store';
import { sfx } from './sfx';
import { practiceTribeOptions, togglePracticeTribe, type PracticeConfig, type PracticeTribe } from '@game/sim';

/**
 * PRACTICE OPTIONS (owner ask 2026-08-24) — the setup screen shown after choosing Practice and before the hero
 * picker. A dedicated menu of knobs: whether the player can die, the shop-timer speed, and
 * which tribes are in the game. `Start` applies them and opens the hero picker; the choices are pinned onto the run.
 *
 * SANDBOX MODE | GOD MODE (owner sketch 2026-10-08, revised the same day): two modes in even halves. Sandbox Mode
 * (left, selected every time the screen opens) is the practice game above; God Mode (right) plays its own fixed
 * setup (`godPracticeConfig`), and while it is selected the Sandbox option rows are greyed and inert.
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

/** Practice hero offer (owner 2026-09-27): the three starters, or every hero. */
const HERO_MODES: { value: 'beginner' | 'all'; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'all', label: 'All' },
];
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

/** One of the Practice screen's two modes (owner sketch 2026-10-08): heading, Select button, description. */
function ModeColumn({ mode, title, text, on, onSelect }: {
  mode: 'god' | 'sandbox'; title: string; text: string; on: boolean; onSelect: () => void;
}) {
  return (
    <div className={`pomode${on ? ' on' : ''}`} data-mode={mode}>
      <h2 className="disp pomode-title">{title}</h2>
      <button className={`pomode-select pressable${on ? ' on' : ''}`} aria-pressed={on}
        onPointerDown={() => { if (!on) { sfx.tick(); onSelect(); } }}>{on ? 'Selected' : 'Select'}</button>
      <p className="pomode-text">{text}</p>
    </div>
  );
}

export function PracticeOptions() {
  const open = useGame((s) => s.practiceSetupOpen);
  const cfg = useGame((s) => s.practiceDraft);
  const setDraft = useGame((s) => s.setPracticeDraft);
  const confirm = useGame((s) => s.confirmPracticeSetup);
  const cancel = useGame((s) => s.cancelPracticeSetup);
  if (!open) return null;
  // GOD MODE (owner sketch 2026-10-08): God Mode ignores the Sandbox options (it always plays every hero, Unlimited
  // health, every tribe, no timer), so they are greyed out and inert until Sandbox Mode is selected.
  const god = cfg.godMode === true;

  return (
    <div className="modepick practiceopts" role="dialog" aria-label="Practice options">
      <button className="hsback" onPointerDown={() => { sfx.pulse(); cancel(); }}>← Back</button>
      <div className="mpbox pobox pomodes-box">
        <h1 className="disp mptitle">PRACTICE</h1>
        <div className="pomodes">
          <div className="pomode-col">
            <ModeColumn mode="sandbox" title="Sandbox Mode" on={!god} onSelect={() => setDraft({ godMode: false })}
              text="The Practice game, set up your way. Nothing here is rated." />
            <div className={`posandbox${god ? ' off' : ''}`} aria-disabled={god}>
              <Segmented
                label="Heroes"
                hint={(cfg.heroes ?? 'beginner') === 'beginner' ? 'Pick from three starter heroes: Indy, Warden and Keshi.' : 'Pick from every hero.'}
                value={cfg.heroes ?? 'beginner'}
                options={HERO_MODES}
                onPick={(v) => setDraft({ heroes: v })}
                disabled={god}
              />
              <Segmented
                label="Health"
                hint={cfg.health === 'unlimited' ? "You can't be eliminated." : 'Real damage. Last one standing wins.'}
                value={cfg.health}
                options={HEALTH}
                onPick={(v) => setDraft({ health: v })}
                disabled={god}
              />
              <Segmented
                label="Time"
                hint={cfg.timeMult === 0 ? 'No shop timer. Take as long as you like.' : 'Shop-timer length. It starts once you spend 10 Gold in a turn.'}
                value={cfg.timeMult}
                options={TIMES}
                onPick={(v) => setDraft({ timeMult: v })}
                disabled={god}
              />
              <Segmented
                label="Tribes"
                hint={`Select as many as you'd like. Selected tribes will be included in the game in addition to Neutrals. Normal contains all ${TRIBE_OPTIONS.length - 1}.`}
                isOn={(v) => (v === null ? cfg.tribes.length === 0 : cfg.tribes.includes(v))}
                options={TRIBE_OPTIONS}
                onPick={(v) => setDraft({ tribes: togglePracticeTribe(cfg.tribes, v) })}
                disabled={god}
              />
            </div>
          </div>
          <ModeColumn mode="god" title="God Mode" on={god} onSelect={() => setDraft({ godMode: true })}
            text="999 Gold and no timer. Put any card in your shop, take any rune, and choose which round your opponent comes from. Nothing is saved." />
        </div>

        <button className="postart pressable" onPointerDown={() => { sfx.pulse(); confirm(); }}>Start</button>
      </div>
    </div>
  );
}
