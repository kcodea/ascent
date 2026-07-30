import {
  QUESTTENDRIL_COLOR_KEYS, QUESTTENDRIL_DEFAULTS, QUESTTENDRIL_RANGES,
  getQuestTendrilConfig, resetQuestTendrilConfig, setQuestTendrilValue, type QuestTendrilConfig,
} from './questTendrilConfig';
import { testQuestTendril } from './fxTestFire';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the QUEST TENDRIL — the gold ribbon a quest or rune End-of-Turn reward throws at the unit
 * it triggers on. Applies to the NEXT proc, so Test fires one from the first quest node to the first board
 * minion rather than making you set up an Echoing Roar.
 *
 * `enabled` is stored as 0 or 1 rather than a boolean, and the old panel surfaced it as a slider labelled
 * "ENABLED (0/1)" — a checkbox wearing a slider's clothes. It is a declared toggle now, so the whole effect can
 * be switched off without dragging a two-stop slider.
 */
const COLOR_SET = new Set<string>(QUESTTENDRIL_COLOR_KEYS.map(String));

const SPECS: Record<keyof QuestTendrilConfig, [string, TunerUnit | undefined, string, string]> = {
  enabled:    ['Effect on', undefined, 'Turns the whole quest tendril off. Off means a reward simply applies with no ribbon.', 'Overall'],

  travelMs:   ['Travel time', 'ms', 'How long the ribbon takes to reach the unit.', 'Timing'],
  retractMs:  ['Retract time', 'ms', 'How long it takes to withdraw afterwards.', 'Timing'],
  staggerMs:  ['Stagger', 'ms', 'Delay between ribbons when a reward hits several units, so they read separately.', 'Timing'],

  curve:      ['Arc bulge', '×', 'How far the ribbon bows from straight, relative to its length. Negative bows the other way.', 'Ribbon'],
  wobbleAmp:  ['Wobble distance', 'px', 'How far the ribbon wavers along its length.', 'Ribbon'],
  wobbleFreq: ['Wobble waves', '×', 'How many waves that wobble makes.', 'Ribbon'],
  baseWidth:  ['Width at node', 'px', 'Ribbon width at the quest node end.', 'Ribbon'],
  tipWidth:   ['Width at unit', 'px', 'Ribbon width at the end that lands on the unit.', 'Ribbon'],
  coreAlpha:  ['Core opacity', 'opacity', 'Opacity of the bright core stroke.', 'Ribbon'],
  glowWidth:  ['Glow width', 'px', 'Thickness of the soft glow around it. 0 removes it.', 'Ribbon'],
  glowAlpha:  ['Glow opacity', 'opacity', 'Opacity of that glow.', 'Ribbon'],
  colorCore:  ['Core colour', undefined, 'Colour of the core stroke.', 'Ribbon'],
  colorGlow:  ['Glow colour', undefined, 'Colour of the glow around it.', 'Ribbon'],

  flashSize:  ['Flash size', 'px', 'Diameter of the flash where the ribbon lands. 0 removes it.', 'Landing'],
  flashMs:    ['Flash time', 'ms', 'How long that flash lasts.', 'Landing'],
  colorFlash: ['Flash colour', undefined, 'Colour of the landing flash.', 'Landing'],
  moteCount:  ['Mote count', undefined, 'How many motes burst on landing. 0 removes them.', 'Landing'],
  moteSpeed:  ['Mote speed', 'px/s', 'How fast those motes fly out.', 'Landing'],
  moteLife:   ['Mote lifetime', 'ms', 'How long one mote lasts.', 'Landing'],
  colorMote:  ['Mote colour', undefined, 'Colour of the landing motes.', 'Landing'],

  pulseSize:  ['Pulse size', 'px', 'Diameter of the pulse on the quest NODE as the ribbon leaves. 0 removes it.', 'Node pulse'],
  pulseAlpha: ['Pulse opacity', 'opacity', 'Opacity of that pulse.', 'Node pulse'],
  pulseMs:    ['Pulse time', 'ms', 'How long the node pulse lasts.', 'Node pulse'],
};

/** Declaration order IS render order; each colour sits inside its own group's run. */
const ORDER: (keyof QuestTendrilConfig)[] = [
  'enabled',
  'travelMs', 'retractMs', 'staggerMs',
  'curve', 'wobbleAmp', 'wobbleFreq', 'baseWidth', 'tipWidth', 'coreAlpha', 'glowWidth', 'glowAlpha', 'colorCore', 'colorGlow',
  'flashSize', 'flashMs', 'colorFlash', 'moteCount', 'moteSpeed', 'moteLife', 'colorMote',
  'pulseSize', 'pulseAlpha', 'pulseMs',
];

const controls: TunerControl<Extract<keyof QuestTendrilConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = QUESTTENDRIL_RANGES[key]!;
  if (key === 'enabled') {
    return { key, label, hint, group, kind: 'toggle' as const, min, max, step, onValue: 1, offValue: 0 };
  }
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<QuestTendrilConfig> = {
  id: 'questtendril',               // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Quest Tendril',
  note: 'dev · next proc · drag',
  read: getQuestTendrilConfig,
  write: (key, value) => setQuestTendrilValue(key, value),
  writeColor: (key, value) => setQuestTendrilValue(key, value),
  reset: resetQuestTendrilConfig,
  defaults: QUESTTENDRIL_DEFAULTS,
  controls,
  actions: [{
    label: '▶ Test',
    hint: 'Fires a tendril from the first quest node to your first board minion.',
    run: () => testQuestTendril(),
  }],
};

export function QuestTendrilTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
