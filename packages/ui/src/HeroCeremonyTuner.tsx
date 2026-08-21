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
  ring1On:           ['Ring burst 1', undefined, 'Arrival: bloom + one expanding ring + the small edge flash.', 'FX — Ring burst 1'],
  ring1AtMs:         ['Burst 1 at', 'ms', 'When ring burst 1 fires.', 'FX — Ring burst 1'],
  ring1Ms:           ['Burst 1 duration', 'ms', 'The expanding ring’s full run (bloom and flash scale with it).', 'FX — Ring burst 1'],
  sparksOn:          ['Sparks', undefined, 'Accent sparks + rune fragments off the card perimeter.', 'FX — Sparks'],
  sparksAtMs:        ['Sparks at', 'ms', 'When the sparks burst fires.', 'FX — Sparks'],
  sparksMs:          ['Sparks duration', 'ms', 'How long the sparks and fragments live.', 'FX — Sparks'],
  motesOn:           ['Motes', undefined, 'The ambient hold: slow motes, wisps, the behind-portrait pulse.', 'FX — Motes'],
  motesAtMs:         ['Motes from', 'ms', 'When the ambient hold begins (it runs until launch).', 'FX — Motes'],
  sweepOn:           ['Line sweep', undefined, 'The light sweep gliding lower-left → upper-right across the art.', 'FX — Line sweep'],
  sweepAtMs:         ['Sweep at', 'ms', 'When the sweep starts.', 'FX — Line sweep'],
  sweepMs:           ['Sweep duration', 'ms', 'The sweep’s glide time across the artwork.', 'FX — Line sweep'],
  dustOn:            ['Dust', undefined, 'Frame-boundary dissipation dust + fragments + inward wisps.', 'FX — Dust'],
  dustAtMs:          ['Dust at', 'ms', 'When the dissipation dust bursts.', 'FX — Dust'],
  dustMs:            ['Dust duration', 'ms', 'How long the dust cloud lives.', 'FX — Dust'],
  ring2On:           ['Ring burst 2', undefined, 'The finish: a thin ring contracting onto the hero.', 'FX — Ring burst 2'],
  ring2AtMs:         ['Burst 2 at', 'ms', 'When ring burst 2 fires (pairs well with Flash at).', 'FX — Ring burst 2'],
  ring2Ms:           ['Burst 2 duration', 'ms', 'The contracting ring’s full run.', 'FX — Ring burst 2'],
  portraitX:         ['Art horizontal', 'px', 'Nudge the materialized hero artwork off center.', 'Hero art'],
  portraitY:         ['Art vertical', 'px', 'Negative lifts the artwork.', 'Hero art'],
  portraitScale:     ['Art size', '×', 'Scales the artwork’s final bounds around its center.', 'Hero art'],
  ringX:             ['Ring horizontal', 'px', 'Nudge the ring off the portrait center.', 'Ring'],
  ringY:             ['Ring vertical', 'px', 'Negative lifts the ring.', 'Ring'],
  ringSize:          ['Ring size', 'px', 'The ring’s diameter — the circular portrait clips just inside it.', 'Ring'],
};

/** The four per-sound gates render as switches, not sliders. */
const TOGGLES = new Set<keyof HscTunerConfig>(['songOn', 'woosh1On', 'woosh2On', 'revealOn', 'ring1On', 'sparksOn', 'motesOn', 'sweepOn', 'dustOn', 'ring2On']);

/** Declaration order IS render order; groups render together under their heading. */
const ORDER: (keyof HscTunerConfig)[] = [
  'pressMs', 'headerExitDelayMs',
  'optionExitDelayMs', 'optionExitMs', 'optionStaggerMs',
  'focusDelayMs', 'focusMs', 'settleMs',
  'voiceAtMs',
  'transformAtMs', 'transformMs',
  'identityAtMs', 'readyAtMs', 'readyMs',
  'launchCoverMs', 'launchRevealMs',
  'songOn', 'songAtMs', 'songVol',
  'woosh1On', 'woosh1AtMs', 'woosh1Vol',
  'woosh2On', 'woosh2AtMs', 'woosh2Vol',
  'revealOn', 'revealAtMs', 'revealVol',
  'flashAtMs',
  'ring1On', 'ring1AtMs', 'ring1Ms',
  'sparksOn', 'sparksAtMs', 'sparksMs',
  'motesOn', 'motesAtMs',
  'sweepOn', 'sweepAtMs', 'sweepMs',
  'dustOn', 'dustAtMs', 'dustMs',
  'ring2On', 'ring2AtMs', 'ring2Ms',
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
