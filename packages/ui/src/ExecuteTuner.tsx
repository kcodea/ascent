import {
  EXECUTE_DEFAULTS, EXECUTE_GROUPS, EXECUTE_RANGES, getExecuteConfig, resetExecuteConfig, setExecuteValue,
  type ExecuteConfig, type ExecuteNumKey,
} from './executeConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the EXECUTE (V) rage aura — the swirling ring of smoke, comet arcs, glints and shards
 * around an Execute card.
 *
 * The layer COUNTS are dials here, so every change rebuilds the aura's DOM: `setExecuteValue` commits a fresh
 * snapshot and each mounted card re-renders through `useSyncExternalStore`. Live either way — you will see it
 * on any Execute card on screen. There are NO CSS fallbacks to update alongside it; `executeConfig` is the
 * single source of truth for this effect.
 *
 * At 48 controls this is the largest tuner in the project, which is why it was migrated second: if the schema
 * holds here it holds anywhere. Its config already declared sections and a modified-key list before the schema
 * existed — the schema generalises what this panel had invented for itself.
 *
 * LANGUAGE. The old labels carried their units as free text and abbreviated hard: `sx` read "width × (±flips)",
 * `smokeA0`/`smokeA1` read "opacity low"/"opacity high", and five separate controls were all just "opacity".
 * Units now live in the `unit` field, and every label names the layer it belongs to.
 */

/** `[label, unit, hint]` per numeric key. Units are declared, never typed into the label. */
const NUM: Record<ExecuteNumKey, [string, TunerUnit | undefined, string]> = {
  size:        ['Aura size', '×', 'Overall size of the aura box, as a multiple of the card.'],
  y:           ['Vertical centre', '%', 'Where the aura centres down the card. 50% is the middle.'],
  sx:          ['Horizontal stretch', '×', 'Squashes or stretches the aura sideways. Negative values mirror it.'],
  sy:          ['Vertical stretch', '×', 'Squashes or stretches the aura vertically. Negative values flip it.'],
  pulse:       ['Breathe cycle', 's', 'How long one full breathe in-and-out of the whole aura takes.'],
  pulseMin:    ['Breathe depth', '×', 'How far the breathe dips at its smallest. 1 means no breathing at all.'],

  smokeCount:  ['Smoke · blob count', undefined, 'How many smoke blobs ride the ring.'],
  smokeRadius: ['Smoke · ring radius', '%', 'How far out from centre the smoke blobs orbit.'],
  smokeSize:   ['Smoke · blob size', '%', 'Size of each individual blob.'],
  smokeBlur:   ['Smoke · blur', 'px', 'Softness of the blobs. Higher reads as thicker fog.'],
  smokeA0:     ['Smoke · faintest', 'opacity', 'Opacity of the blobs at the dimmest point of their pulse.'],
  smokeA1:     ['Smoke · brightest', 'opacity', 'Opacity at the brightest point of their pulse.'],
  smokeSc0:    ['Smoke · smallest', '×', 'Blob scale at the bottom of its pulse.'],
  smokeSc1:    ['Smoke · largest', '×', 'Blob scale at the top of its pulse.'],
  smokeSpin:   ['Smoke · ring spin', 's', 'Time for the smoke ring to make one full rotation.'],
  smokePulse:  ['Smoke · blob pulse', 's', 'Time for one blob to cycle between its faintest and brightest.'],

  arcCount:    ['Arcs · ring count', undefined, 'How many concentric comet rings are drawn.'],
  arcD:        ['Arcs · diameter', '×', 'Ring diameter as a multiple of the aura box.'],
  arcSx:       ['Arcs · horizontal stretch', '×', 'Stretches the rings sideways into an ellipse.'],
  arcSy:       ['Arcs · vertical stretch', '×', 'Stretches the rings vertically into an ellipse.'],
  arcGap:      ['Arcs · ring spacing', undefined, 'Distance between one ring and the next.'],
  arcThick:    ['Arcs · band thickness', '%', 'How thick each ring band is drawn.'],
  arcBlades:   ['Arcs · comets per ring', undefined, 'How many comet streaks travel around each ring.'],
  arcTail:     ['Arcs · tail length', '°', 'How far behind itself each comet smears, in degrees of arc.'],
  arcEdge:     ['Arcs · leading edge', '°', 'How sharply the comet head begins.'],
  arcAlpha:    ['Arcs · opacity', 'opacity', 'Overall opacity of the comet rings.'],
  arcBlur:     ['Arcs · blur', 'px', 'Softness of the comet streaks.'],
  arcSpin:     ['Arcs · spin', 's', 'Time for the comets to travel once around their ring.'],

  glintCount:  ['Glints · count', undefined, 'How many sparkle spikes surround the card.'],
  glintRadius: ['Glints · ring radius', '%', 'How far out from centre the glints sit.'],
  glintLen:    ['Glints · spike length', undefined, 'Length of each sparkle spike.'],
  glintThick:  ['Glints · spike thickness', undefined, 'Thickness of each sparkle spike.'],
  glintAlpha:  ['Glints · opacity', 'opacity', 'Overall opacity of the glints.'],
  glintSpin:   ['Glints · twinkle', 's', 'Time for one glint to complete its twinkle.'],

  shardCount:  ['Shards · count', undefined, 'How many shards drift off the card.'],
  shardRadius: ['Shards · ring radius', '%', 'How far out the shards start from centre.'],
  shardSize:   ['Shards · size', 'px', 'Size of each shard.'],
  shardTail:   ['Shards · tail length', 'px', 'How long a streak each shard drags behind it.'],
  shardBlur:   ['Shards · blur', 'px', 'Softness of the shards.'],
  shardOut:    ['Shards · drift distance', 'px', 'How far a shard travels outward before fading.'],
  shardSweep:  ['Shards · sweep', '°', 'How far around the card the shards spread.'],
  shardAlpha:  ['Shards · opacity', 'opacity', 'Overall opacity of the shards.'],
  shardSpin:   ['Shards · drift time', 's', 'How long one shard takes to complete its drift.'],
};

const COLORS: [keyof ExecuteConfig, string, string][] = [
  ['smokeHot', 'Smoke · hot core', 'The bright inner colour of each smoke blob.'],
  ['smokeMid', 'Smoke · mid body', 'The outer colour each blob fades toward.'],
  ['arcColor', 'Arcs', 'Colour of the comet rings.'],
  ['glintColor', 'Glints', 'Colour of the sparkle spikes.'],
  ['shardColor', 'Shards', 'Colour of the drifting shards.'],
];

/**
 * Sections come from the CONFIG's own `EXECUTE_GROUPS`, not a copy here. `executeConfig.test.ts` already
 * asserts those groups cover every numeric key exactly once — duplicating the list in this file would let the
 * two drift with the test still passing, since it only ever checks the config's copy.
 */
const controls: TunerControl<Extract<keyof ExecuteConfig, string>>[] = [
  ...EXECUTE_GROUPS.flatMap((s) =>
    s.keys.map((key) => {
      const [label, unit, hint] = NUM[key];
      const [min, max, step] = EXECUTE_RANGES[key];
      return { key, label, unit, hint, min, max, step, group: s.title };
    }),
  ),
  ...COLORS.map(([key, label, hint]) => ({
    key: key as Extract<keyof ExecuteConfig, string>,
    label, hint, min: 0, max: 0, step: 0, group: 'Colours', kind: 'color' as const,
  })),
];

export const SPEC: TunerSpec<ExecuteConfig> = {
  id: 'execute',                    // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Execute Aura',
  note: 'dev · live · drag',
  read: getExecuteConfig,
  write: (key, value) => setExecuteValue(key, value),
  writeColor: (key, value) => setExecuteValue(key, value),
  reset: resetExecuteConfig,
  defaults: EXECUTE_DEFAULTS,
  controls,
};

export function ExecuteTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
