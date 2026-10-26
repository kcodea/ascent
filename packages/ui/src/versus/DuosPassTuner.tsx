import {
  DUOS_PASS_COLOR_KEYS, DUOS_PASS_DEFAULTS, DUOS_PASS_RANGES, getDuosPassConfig, resetDuosPassConfig, setDuosPassValue,
  type DuosPassConfig,
} from './duosPassConfig';
import { previewArrival, previewDrop } from './passLob';
import { TunerPanel } from '../TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';

/**
 * DEV ✈ DUOS PASS tuner (owner 2026-10-26: "can you make it look more like magic/pixi stream and then a coalesce in
 * hand?"): the pass's timings, the stream's speed and colours, the coin and the portrait pop, on both screens
 * (`duosPassConfig.ts`). Live: the runtime reads the config at every pass. The stream's own shape is the FX workbench's
 * `duos-pass-send` / `duos-pass-arrive` defs; the card's dissolve and coalesce are their own tuners. ▶ Send plays the
 * send from your first hand card (a copy dissolves; nothing is passed); ▶ Arrive plays the arrival onto your first hand
 * card. Copy values, paste into `duosPassConfig.ts` DEFAULTS to bake. R-DUOS-PASS-05.
 */
type Key = keyof DuosPassConfig;
const ROWS: [Key, string, TunerUnit | undefined, string, string][] = [
  ['sendFadeMs', 'Card fade', 'ms', 'How long the card you let go of takes to fade while its plate dissolves.', 'Sending'],
  ['sendFadeScale', 'Card shrink', '×', 'How small it gets as it fades.', 'Sending'],
  ['streamDelay', 'Stream leaves at', 'ms', 'When the stream leaves the dissolving card, after you let go.', 'Sending'],
  ['streamFromY', 'Stream starts above', '×', 'How far above the card centre the stream starts, as a share of the plate height.', 'Sending'],
  ['sendSpeed', 'Stream speed', '×', "The send stream's speed (1 = the FX def as authored).", 'Sending'],
  ['coinDelay', 'Coin delay', 'ms', 'How long after you let go the coin leaves your Gold.', 'The coin'],
  ['coinMs', 'Coin flight', 'ms', "The coin's own flight time.", 'The coin'],
  ['coinArc', 'Coin arc', '×', 'Its arc height, as a share of the distance.', 'The coin'],
  ['coinEnd', 'Coin size at the end', '×', 'How small it is as it goes in.', 'The coin'],
  ['catchScale', 'Pop size', '×', 'How much the portrait swells as the stream lands in it (or leaves it).', 'The portrait'],
  ['catchMs', 'Pop time', 'ms', "How long the portrait's pop lasts.", 'The portrait'],
  ['recvSpeed', 'Stream speed', '×', "The arrival stream's speed (1 = the FX def as authored).", 'Arriving'],
  ['coalesceLead', 'Coalesce lead', 'ms', 'How long before the stream lands the card starts to coalesce in your hand.', 'Arriving'],
  ['cRim', 'Rim', undefined, "The stream's outer colour.", 'Colours'],
  ['cMid', 'Mid', undefined, "The stream's middle colour.", 'Colours'],
  ['cHot', 'Hot', undefined, "The stream's bright colour.", 'Colours'],
  ['cCore', 'Core', undefined, "The stream's core colour.", 'Colours'],
];

const COLOR_SET = new Set<string>(DUOS_PASS_COLOR_KEYS);
const controls: TunerControl<Key>[] = ROWS.map(([key, label, unit, hint, group]): TunerControl<Key> => {
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color', min: 0, max: 0, step: 0 };
  const [min, max, step] = DUOS_PASS_RANGES[key as keyof typeof DUOS_PASS_RANGES];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<DuosPassConfig> = {
  id: 'duospass', // FROZEN
  title: 'Duos Pass',
  note: 'dev · live',
  read: getDuosPassConfig,
  write: (key, value) => setDuosPassValue(key, value),
  writeColor: (key, value) => setDuosPassValue(key, value),
  reset: resetDuosPassConfig,
  defaults: DUOS_PASS_DEFAULTS,
  controls,
  buttonsOnTop: true,
  actions: [
    { label: '▶ Send', hint: "Plays the send from your first hand card into your teammate's portrait (a copy dissolves; nothing is passed). Needs a Duos match and a card in hand.", run: () => { previewDrop(); } },
    { label: '▶ Arrive', hint: "Plays the arrival from your teammate's portrait onto your first hand card.", run: () => { previewArrival(); } },
  ],
};

export function DuosPassTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
