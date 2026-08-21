import {
  HSC_DEFAULTS, HSC_RANGES, getHeroCeremonyConfig, requestCeremonyReplay, resetHeroCeremonyConfig,
  setHeroCeremonyValue,
} from './hero-select/heroCeremonyTunerConfig';
import type { HeroCeremonyTiming } from './hero-select/heroCeremonyTiming';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the HERO SELECT CEREMONY timeline (hero-select-ceremony-blueprint.md §4). Every value is
 * a delay or duration in the one typed timing object; sliders apply to the NEXT ceremony run, and the Replay
 * action re-runs the current one so a change can be judged immediately. Shipping a feel = pasting the JSON
 * into `HERO_CEREMONY_TIMING` — the tuner never publishes.
 *
 * `…AtMs` values are absolute marks from the initial hero click; `…Ms` values are durations. The launch pair
 * runs from the Start Game press instead.
 */
const SPECS: Record<keyof HeroCeremonyTiming, [string, TunerUnit | undefined, string, string]> = {
  pressMs:           ['Press', 'ms', 'The selected card’s press-in acknowledgment.', 'Commit'],
  headerExitDelayMs: ['Header exit at', 'ms', 'When the title / Oath / Back begin fading.', 'Commit'],
  optionExitDelayMs: ['Exits start at', 'ms', 'When the unselected cards begin leaving.', 'Dismiss'],
  optionExitMs:      ['Exit duration', 'ms', 'One unselected card’s exit.', 'Dismiss'],
  optionStaggerMs:   ['Exit stagger', 'ms', 'Per-card stagger between exits (total capped at 180ms).', 'Dismiss'],
  focusDelayMs:      ['Travel starts at', 'ms', 'When the selected clone starts moving to center.', 'Focus'],
  focusMs:           ['Travel duration', 'ms', 'Clone travel to the overshoot.', 'Focus'],
  settleMs:          ['Settle', 'ms', 'Overshoot → final position.', 'Focus'],
  arrivalAtMs:       ['Arrival burst at', 'ms', 'When the Pixi arrival burst fires.', 'Focus'],
  voiceAtMs:         ['Voiceline at', 'ms', 'When sfx.heroSelect plays (silent until hero audio exists).', 'Voice'],
  transformAtMs:     ['Transform at', 'ms', 'When card chrome starts dissolving into the portrait.', 'Transform'],
  transformMs:       ['Transform duration', 'ms', 'Dissolve + portrait materialization.', 'Transform'],
  identityAtMs:      ['Name at', 'ms', 'When the hero name begins appearing.', 'Ready'],
  readyAtMs:         ['Button at', 'ms', 'When Start Game begins appearing.', 'Ready'],
  readyMs:           ['Button entrance', 'ms', 'Start Game entrance — interactive only after this.', 'Ready'],
  launchCoverMs:     ['Cover', 'ms', 'Curtain fade-to-opaque after Start Game (run creation waits for it).', 'Launch'],
  launchRevealMs:    ['Reveal', 'ms', 'Curtain fade-out over the mounted Recruit screen.', 'Launch'],
};

/** Declaration order IS render order; groups render together under their heading. */
const ORDER: (keyof HeroCeremonyTiming)[] = [
  'pressMs', 'headerExitDelayMs',
  'optionExitDelayMs', 'optionExitMs', 'optionStaggerMs',
  'focusDelayMs', 'focusMs', 'settleMs', 'arrivalAtMs',
  'voiceAtMs',
  'transformAtMs', 'transformMs',
  'identityAtMs', 'readyAtMs', 'readyMs',
  'launchCoverMs', 'launchRevealMs',
];

const controls: TunerControl<Extract<keyof HeroCeremonyTiming, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = HSC_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<HeroCeremonyTiming> = {
  id: 'heroceremony',               // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hero Ceremony',
  note: 'dev · next run · drag',
  read: getHeroCeremonyConfig,
  write: setHeroCeremonyValue,
  reset: resetHeroCeremonyConfig,
  defaults: HSC_DEFAULTS,
  controls,
  actions: [
    {
      label: 'Replay',
      hint: 'Re-run the ceremony on the current hero select with the values above (needs a committed selection on screen).',
      run: () => requestCeremonyReplay(),
    },
  ],
};

export function HeroCeremonyTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
