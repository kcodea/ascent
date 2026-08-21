import {
  HSC_DEFAULTS, HSC_RANGES, getHeroCeremonyConfig, requestCeremonyReplay, resetHeroCeremonyConfig,
  setHeroCeremonyValue,
} from './hero-select/heroCeremonyTunerConfig';
import type { HscTunerConfig } from './hero-select/heroCeremonyTunerConfig';
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
const SPECS: Record<keyof HscTunerConfig, [string, TunerUnit | undefined, string, string]> = {
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
  nameX:             ['Name horizontal', 'px', 'Nudge the hero name off center.', 'Name'],
  nameY:             ['Name vertical', 'px', 'Negative lifts the name toward the portrait.', 'Name'],
  nameSize:          ['Name size', 'px', 'The hero name’s font size.', 'Name'],
  powerX:            ['Power horizontal', 'px', 'Nudge the hero power name off center.', 'Power name'],
  powerY:            ['Power vertical', 'px', 'Negative lifts the power name toward the hero name.', 'Power name'],
  powerSize:         ['Power size', 'px', 'The hero power name’s font size.', 'Power name'],
  btnX:              ['Button horizontal', 'px', 'Nudge Start Game off center.', 'Button'],
  btnY:              ['Button vertical', 'px', 'Negative lifts the button toward the name.', 'Button'],
  btnScale:          ['Button size', '×', 'Scales the whole button — text and padding together.', 'Button'],
  songOn:            ['Song', undefined, 'asiansong.mp3 — the ceremonial sting.', 'SFX — Song'],
  songAtMs:          ['Song at', 'ms', 'When the song starts (from the hero click).', 'SFX — Song'],
  songVol:           ['Song volume', '×', 'Multiplier on the ceremony bus gain.', 'SFX — Song'],
  woosh1On:          ['Woosh 1', undefined, 'woosh1.mp3 — the unselected cards yielding.', 'SFX — Woosh 1'],
  woosh1AtMs:        ['Woosh 1 at', 'ms', 'When woosh 1 plays.', 'SFX — Woosh 1'],
  woosh1Vol:         ['Woosh 1 volume', '×', 'Multiplier on the ceremony bus gain.', 'SFX — Woosh 1'],
  woosh2On:          ['Woosh 2', undefined, 'woosh2.mp3 — the clone’s travel/settle.', 'SFX — Woosh 2'],
  woosh2AtMs:        ['Woosh 2 at', 'ms', 'When woosh 2 plays.', 'SFX — Woosh 2'],
  woosh2Vol:         ['Woosh 2 volume', '×', 'Multiplier on the ceremony bus gain.', 'SFX — Woosh 2'],
  revealOn:          ['Reveal', undefined, 'ceremonyrevealsound.mp3 — the circular-portrait flash.', 'SFX — Reveal'],
  revealAtMs:        ['Reveal at', 'ms', 'When the reveal sound plays (pair it with Flash at).', 'SFX — Reveal'],
  revealVol:         ['Reveal volume', '×', 'Multiplier on the ceremony bus gain.', 'SFX — Reveal'],
  flashAtMs:         ['Flash at', 'ms', 'When the flash fires: portrait snaps circular inside the ring.', 'Flash'],
  portraitX:         ['Art horizontal', 'px', 'Nudge the materialized hero artwork off center.', 'Hero art'],
  portraitY:         ['Art vertical', 'px', 'Negative lifts the artwork.', 'Hero art'],
  portraitScale:     ['Art size', '×', 'Scales the artwork’s final bounds around its center.', 'Hero art'],
  ringX:             ['Ring horizontal', 'px', 'Nudge the ring off the portrait center.', 'Ring'],
  ringY:             ['Ring vertical', 'px', 'Negative lifts the ring.', 'Ring'],
  ringSize:          ['Ring size', 'px', 'The ring’s diameter — the circular portrait clips just inside it.', 'Ring'],
};

/** The four per-sound gates render as switches, not sliders. */
const TOGGLES = new Set<keyof HscTunerConfig>(['songOn', 'woosh1On', 'woosh2On', 'revealOn']);

/** Declaration order IS render order; groups render together under their heading. */
const ORDER: (keyof HscTunerConfig)[] = [
  'pressMs', 'headerExitDelayMs',
  'optionExitDelayMs', 'optionExitMs', 'optionStaggerMs',
  'focusDelayMs', 'focusMs', 'settleMs', 'arrivalAtMs',
  'voiceAtMs',
  'transformAtMs', 'transformMs',
  'identityAtMs', 'readyAtMs', 'readyMs',
  'launchCoverMs', 'launchRevealMs',
  'songOn', 'songAtMs', 'songVol',
  'woosh1On', 'woosh1AtMs', 'woosh1Vol',
  'woosh2On', 'woosh2AtMs', 'woosh2Vol',
  'revealOn', 'revealAtMs', 'revealVol',
  'flashAtMs',
  'portraitX', 'portraitY', 'portraitScale',
  'ringX', 'ringY', 'ringSize',
  'nameX', 'nameY', 'nameSize',
  'powerX', 'powerY', 'powerSize',
  'btnX', 'btnY', 'btnScale',
];

const controls: TunerControl<Extract<keyof HscTunerConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = HSC_RANGES[key];
  if (TOGGLES.has(key)) return { key, label, hint, group, kind: 'toggle' as const, min, max, step, onOffLabels: ['on', 'off'] as [string, string] };
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<HscTunerConfig> = {
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
