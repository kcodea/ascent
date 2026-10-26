import { useGame } from './store';
import { modeArt } from './art';
import { FadeImg } from './FadeImg';
import { sfx } from './sfx';
import { phoneLayoutOn } from './stage';
import { PRACTICE_RANKS, normalizePracticeRank, normalizePracticeTribes, practiceSetOf, practiceSetOptions, practiceTribeOptions, togglePracticeTribe, type PracticeConfig, type PracticeRank, type PracticeTribe } from '@game/sim';
import type { SetId } from '@game/content';

/**
 * PRACTICE OPTIONS (owner ask 2026-08-24) — the setup screen shown after choosing Practice and before the hero
 * picker. A dedicated menu of knobs: whether the player can die, the shop-timer speed, which rank's opponents
 * they face, and which tribes are in the game. `Start` applies them and opens the hero picker; the choices are pinned onto the run.
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
export function Segmented<T extends string | number | null>(props: {
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
/** OPPONENT RANK (owner 2026-10-13, R-PRACTICE-RANK-01): "add buttons that says All Ranks, Bronze, Silver, Gold,
 *  Platinum". A rank draws exactly the opponents a ranked game of that rank draws (`practiceStrengthBand`). */
const RANK_LABEL: Record<PracticeRank, string> = { all: 'All Ranks', bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };
const RANKS: { value: PracticeRank; label: string }[] = PRACTICE_RANKS.map((value) => ({ value, label: RANK_LABEL[value] }));
const rankHint = (rank: PracticeRank): string => (rank === 'all'
  ? 'Your opponents are recorded players of every rank.'
  : `Your opponents are the recorded players a ${RANK_LABEL[rank]} player meets in ranked games.`);

/** "Normal" (the usual random tribes) plus the tribes of the set the game is created on, in that set's order (owner
 *  2026-09-27: multi-select, "reword 'none' to 'Normal'"). Normal is `null`; the draft holds the picked list. The set
 *  is the live one unless the dev-only Set row picked another (`practiceSetOf`). */
const tribeOptionsFor = (setId: SetId): { value: PracticeTribe | null; label: string }[] => [
  { value: null, label: 'Normal' },
  ...practiceTribeOptions(setId).map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) })),
];

/** DEV ONLY (owner 2026-10-26): the Set row's choices, every defined set by its display name. Never built in a player
 *  build: the row below renders only under `import.meta.env.DEV`. */
const SET_OPTIONS: { value: SetId; label: string }[] = import.meta.env.DEV
  ? practiceSetOptions().map((o) => ({ value: o.id, label: o.live ? `${o.name} (live)` : o.name }))
  : [];

/** One of the Practice screen's two modes as a SELECTABLE TILE (UI refinement 2026-10-16; owner sketch 2026-10-08 for
 *  the two modes): the mode's art, its name and its one-line description, the selected one lit with a clear state.
 *  The whole tile is the button (`.pomode-select`, aria-pressed); no separate Select / Selected button. */
function ModeTile({ mode, title, text, art, on, onSelect }: {
  mode: 'god' | 'sandbox'; title: string; text: string; art: string | undefined; on: boolean; onSelect: () => void;
}) {
  return (
    <div className={`pomode${on ? ' on' : ''}`} data-mode={mode}>
      <button className={`pomode-select${on ? ' on' : ''}`} aria-pressed={on}
        onPointerDown={() => { if (!on) { sfx.tick(); onSelect(); } }} onClick={() => { if (!on) onSelect(); }}>
        {art && <span className="pomode-art"><FadeImg src={art} alt="" draggable={false} /></span>}
        <span className="pomode-body">
          <h2 className="disp pomode-title">{title}</h2>
          <span className="pomode-text">{text}</span>
        </span>
        <span className="pomode-state" aria-hidden="true">{on ? 'Selected' : 'Select'}</span>
      </button>
    </div>
  );
}

/** What God Mode gives you, shown in the options panel while it is selected (it has nothing to set up here: every
 *  God Mode control lives in the game itself). */
const GOD_FEATURES: { title: string; text: string }[] = [
  { title: '999 Gold', text: 'Buy, roll and level up as much as you like.' },
  { title: 'No timer', text: 'Every turn waits for you.' },
  { title: 'Any card', text: 'Put any minion or spell straight into your shop.' },
  { title: 'Any rune', text: 'Take any rune at any time.' },
  { title: 'Pick the opponent', text: 'Choose which round your next opponent comes from.' },
  { title: 'Nothing is saved', text: 'No rating, no history. Experiment freely.' },
];

/** The Practice setup's content (the `.mpbox` beside the sidebar). It is a VIEW of the mode screen (Title.tsx renders it
 *  in the shared host through `MenuViewSwap`, R-MENU-VIEW-SWAP-01), so it brings no host or sidebar of its own, and it is
 *  not gated on `practiceSetupOpen`: the mode screen decides when it shows (and keeps it a moment as it leaves). */
export function PracticeOptions() {
  const cfg = useGame((s) => s.practiceDraft);
  const setDraft = useGame((s) => s.setPracticeDraft);
  const confirm = useGame((s) => s.confirmPracticeSetup);
  const goTo = useGame((s) => s.goTo);
  // GOD MODE (owner sketch 2026-10-08): God Mode ignores the Sandbox options (it always plays every hero, Unlimited
  // health, every tribe, no timer), so they are greyed out and inert until Sandbox Mode is selected.
  const god = cfg.godMode === true;
  // DEV SET PICKER (owner 2026-10-26): the set this game is created on. A set other than the live one plays against
  // generated bots on that set (recorded player runs belong to their own set), so the Opponent Rank row has no say.
  // A player build never honours a pick (the store strips one too): it always reads the live set.
  const setId = practiceSetOf(import.meta.env.DEV ? cfg : undefined);
  const devSet = import.meta.env.DEV && setId !== practiceSetOptions().find((o) => o.live)?.id;
  const tribeOptions = tribeOptionsFor(setId);

  // Back to the mode picker (the crumb), the way the Learn / Gauntlet / Versus views lead back. ONE store write
  // (`goTo('modes')` closes the setup, raises the title flag and lands on the home together): two separate writes
  // could render the main menu for a frame in between.
  const back = (): void => { sfx.pulse(); goTo('modes'); };

  return (
    <div className="mpbox pobox pomodes-box">
      <div className="mphead">
        <button className="mpcrumb" onPointerDown={back}>Modes</button>
        <span className="mpsep" aria-hidden="true">/</span>
        <h1 className="disp mptitle">Practice</h1>
      </div>
      <div className="pomodes">
        <ModeTile mode="sandbox" title="Sandbox Mode" on={!god} art={modeArt('practice')} onSelect={() => setDraft({ godMode: false })}
          text="The Practice game, set up your way. Nothing here is rated." />
        <ModeTile mode="god" title="God Mode" on={god} art={modeArt('gauntlet')} onSelect={() => setDraft({ godMode: true })}
          text="999 Gold and no timer. Put any card in your shop, take any rune, and choose which round your opponent comes from. Nothing is saved." />
      </div>
      <div className="popanel">
        {god && (
          <div className="pogod" aria-label="What God Mode gives you">
            {GOD_FEATURES.map((f) => (
              <div className="pogod-item" key={f.title}><span className="pogod-t">{f.title}</span><span className="pogod-x">{f.text}</span></div>
            ))}
          </div>
        )}
        {/* GOD MODE (owner sketch 2026-10-08): it ignores the Sandbox options (it always plays every hero, Unlimited
            health, every tribe, no timer), so they are inert (and folded away) while God Mode is selected. */}
        <div className={`posandbox${god ? ' off' : ''}`} aria-disabled={god}>
          {import.meta.env.DEV && (
            <Segmented
              label="Set"
              hint={devSet ? 'Dev only. Your opponents are bots playing this set.' : 'Dev only. The set this game is played with.'}
              value={setId}
              options={SET_OPTIONS}
              onPick={(v) => setDraft({ setId: v, tribes: normalizePracticeTribes(cfg.tribes, v) })}
              disabled={god}
            />
          )}
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
            label="Opponent Rank"
            hint={devSet ? 'Not used. Bots play this set.' : rankHint(normalizePracticeRank(cfg.rank))}
            value={normalizePracticeRank(cfg.rank)}
            options={RANKS}
            onPick={(v) => setDraft({ rank: v })}
            disabled={god || devSet}
          />
          <Segmented
            label="Tribes"
            hint={`Select as many as you'd like. Selected tribes join the Neutrals. Normal contains all ${tribeOptions.length - 1}.`}
            isOn={(v) => (v === null ? cfg.tribes.length === 0 : cfg.tribes.includes(v))}
            options={tribeOptions}
            onPick={(v) => setDraft({ tribes: togglePracticeTribe(cfg.tribes, v, setId) })}
            disabled={god}
          />
        </div>
      </div>

      {/* START: the one bright gold action on this screen (the gold rule). */}
      {/* THE PHONE LAYOUT (R-PHONE-LAYOUT-01) seats Start at the page's top right, over where hero select's top-right
          tile lands: on a press the finger's lift would then tap that tile and pick a hero. There it starts on the
          release (click) instead, so the next screen mounts after the tap is over. Everywhere else: on the press. */}
      {phoneLayoutOn()
        ? <button className="postart pressable" onPointerDown={() => sfx.pulse()} onClick={() => confirm()}>Start</button>
        : <button className="postart pressable" onPointerDown={() => { sfx.pulse(); confirm(); }}>Start</button>}
    </div>
  );
}
