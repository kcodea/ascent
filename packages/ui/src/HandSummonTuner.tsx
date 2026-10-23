import {
  HAND_SUMMON_DEFAULTS, HAND_SUMMON_RANGES, getHandSummonConfig, resetHandSummonConfig, setHandSummonValue,
  type HandSummonConfig,
} from './handSummonConfig';
import { previewHandSummon } from './handSummonFx';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV 🃏 HAND SUMMON tuner (owner asks 2026-10-23: "put the hand summon options in a tuner for me", then "use the lift
 * and land animation, but smooth it out"): every timing and size of the one seamless lift-and-land a minion summoned
 * from the hand plays, and of its landing. Live: the runtime reads the config at every launch. ▶ Preview plays it on
 * the screen as it is (the first hand card to the right-most board minion); ▶ Preview ×3 checks the stagger. Copy
 * values → paste into `handSummonConfig.ts` DEFAULTS to bake.
 */
type Key = keyof HandSummonConfig;
const ROWS: [Key, string, TunerUnit | undefined, string, string, 'toggle'?][] = [
  ['pathMs', 'Copy path time', 'ms', 'How long the hand card copy takes from its hand slot until it has dissolved.', 'The card leaves'],
  ['riseHeight', 'Lift height', '×', 'How high it lifts straight up first, as a share of the card height.', 'The card leaves'],
  ['riseScale', 'Lift swell', '×', 'How much larger it swells as it lifts.', 'The card leaves'],
  ['drift', 'Travel toward slot', '×', 'How far toward the board slot it carries on before it has dissolved.', 'The card leaves'],
  ['endScale', 'Size when gone', '×', 'How small it is when it has dissolved.', 'The card leaves'],
  ['liftGlow', 'Lift glow', 'opacity', 'The soft glow behind the card as it lifts. 0 hides it.', 'The card leaves'],
  ['appearAt', 'Minion appears at', 'ms', 'When the minion starts to form in its slot, after the lift starts. The copy starts to dissolve just after.', 'The minion forms'],
  ['settleMs', 'Form time', 'ms', 'How long the minion takes to form and settle. It is solid at 40% of this.', 'The minion forms'],
  ['formFrom', 'Starts at size', '×', 'How small the minion is as it starts to form.', 'The minion forms'],
  ['overshoot', 'Overshoot', '×', 'The one slight overshoot it eases back from. 1 = none.', 'The minion forms'],
  ['pulseSize', 'Ring size', '×', 'Landing ring radius, as a share of the card width. 0 hides the ring.', 'Landing'],
  ['pulseAlpha', 'Ring opacity', 'opacity', 'Peak opacity of the landing ring.', 'Landing'],
  ['pulseMs', 'Ring time', 'ms', 'How long the landing ring and its core glow last.', 'Landing'],
  ['pulseCore', 'Core glow', '×', 'The warm glow at the centre of the landing, as a share of the card width. 0 hides it.', 'Landing'],
  ['pulseSparks', 'Sparks', undefined, 'Sparks off the landing. Always 0 on phones.', 'Landing'],
  ['dust', 'Landing dust', undefined, 'The game’s arrival dust under the minion.', 'Landing', 'toggle'],
  ['sound', 'Summon sound', undefined, 'The summon sound on the landing.', 'Landing', 'toggle'],
  ['staggerMs', 'Stagger', 'ms', 'Between several minions summoned at once. Shorter than the motion, so a chain flows.', 'Several at once'],
];

const controls: TunerControl<Key>[] = ROWS.map(([key, label, unit, hint, group, kind]): TunerControl<Key> => {
  const [min, max, step] = HAND_SUMMON_RANGES[key];
  return kind === 'toggle'
    ? { key, label, hint, group, kind, min, max, step, onValue: 1, offValue: 0, onOffLabels: ['on', 'off'] }
    : { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<HandSummonConfig> = {
  id: 'handsummon', // FROZEN
  title: 'Hand Summon',
  note: 'dev · live',
  read: getHandSummonConfig,
  write: (key, value) => setHandSummonValue(key, value),
  reset: resetHandSummonConfig,
  defaults: HAND_SUMMON_DEFAULTS,
  controls,
  buttonsOnTop: true,
  actions: [
    {
      label: '▶ Preview',
      hint: 'Plays it now: the first hand card to the right-most minion on the board (it re-forms in place). Needs a card in hand and a minion on the board.',
      run: () => { previewHandSummon(1); },
    },
    {
      label: '▶ Preview ×3',
      hint: 'Three at once, to judge the stagger: the first three hand cards to the three right-most minions.',
      run: () => { previewHandSummon(3); },
    },
  ],
};

export function HandSummonTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
