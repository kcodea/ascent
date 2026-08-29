import {
  RSH_BLENDS, RSH_DEFAULTS, RSH_RANGES,
  getRuneSheenConfig, resetRuneSheenConfig, setRuneSheenValue,
  type RuneSheenConfig, type RshNumKey,
} from './runeSheenConfig';
import { LAYOUT_VARS, getLayout, setLayoutValue, type LayoutVarDef } from './layoutConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the RUNE NODES — the round quest/rune buttons in the badge row above the hero panel, plus
 * the glossy "sheen" discs laid over them. Two stores back this one panel:
 *  - the NODES' own geometry (row scale / X / Y / separation + per-node X/Y) lives in Layout Lab's config
 *    (`layoutConfig.ts`, the `Quest nodes` group), and
 *  - the SHEEN discs (three overlays + the locked-slot chains) live in `runeSheenConfig.ts`.
 * The spec below bridges both: `read` merges them, and `write` routes each key to its owning store. The same
 * node knobs still appear in Layout Lab (both write the identical `--qb-*` state), so the two stay in lock-step.
 *
 * `id` stays `runesheen` (FROZEN — it indexes this panel's dragged position in localStorage); only the visible
 * title changed to "Rune Nodes".
 */

/** The Layout-Lab keys for the node row + per-node nudges (the `Quest nodes` group), surfaced here too. */
const QB_KEYS = ['qbS', 'qbX', 'qbY', 'qbGap', 'qb1X', 'qb1Y', 'qb2X', 'qb2Y', 'qb3X', 'qb3Y'] as const;
type QbKey = (typeof QB_KEYS)[number];

/** The merged shape this panel reads/writes: the sheen config plus the node-geometry numbers. */
interface RuneNodesConfig extends RuneSheenConfig {
  qbS: number; qbX: number; qbY: number; qbGap: number;
  qb1X: number; qb1Y: number; qb2X: number; qb2Y: number; qb3X: number; qb3Y: number;
}
type Key = Extract<keyof RuneNodesConfig, string>;

const LV: Map<string, LayoutVarDef> = new Map(LAYOUT_VARS.map((v) => [v.key, v]));
const qbDef = (k: QbKey): number => LV.get(k)?.def ?? 0;
const isQb = (k: string): k is QbKey => (QB_KEYS as readonly string[]).includes(k);

/** Node-geometry controls, built from the Layout-Lab defs so ranges/labels/defaults stay in sync. Split into a
 *  row group (whole-row size + placement) and a per-node group (individual nudges). */
function qbControls(keys: readonly QbKey[], group: string, hint: (label: string) => string): TunerControl<Key>[] {
  return keys.map((key) => {
    const v = LV.get(key)!;
    const unit: TunerUnit = v.fmt === 'px' ? 'px' : '×';
    return { key, label: v.label, unit, hint: hint(v.label), group, min: v.min, max: v.max, step: v.step };
  });
}

const rowControls = qbControls(['qbS', 'qbX', 'qbY', 'qbGap'], 'Node row', (l) =>
  l === 'Separation' ? 'Gap between the nodes in the row.' : `Whole node row — ${l.toLowerCase()}.`);
const perNodeControls = qbControls(['qb1X', 'qb1Y', 'qb2X', 'qb2Y', 'qb3X', 'qb3Y'], 'Per-node offset',
  (l) => `Nudge ${l.replace(' · ', ' ')} off its row slot.`);

/** Label + unit for the four numeric fields each sheen disc shares. */
const FIELD: Record<'x' | 'y' | 'w' | 'o', [string, TunerUnit | undefined, string]> = {
  x: ['Horizontal offset', 'px', 'Slide this disc over its rune node.'],
  y: ['Vertical offset', 'px', 'Raise / lower this disc.'],
  w: ['Size', 'px', 'Disc width; height follows the art aspect.'],
  o: ['Opacity', 'opacity', 'How strong this disc reads. 0 hides it.'],
};

// Three sheen groups (Circle 1/2/3), each: x, y, size, opacity, then a blend SELECT (writes a string).
const sheenControls: TunerControl<Key>[] = [1, 2, 3].flatMap((n) => {
  const group = `Sheen ${n}`;
  const nums: TunerControl<Key>[] = (['x', 'y', 'w', 'o'] as const).map((f) => {
    const key = `c${n}${f}` as RshNumKey;
    const [label, unit, hint] = FIELD[f];
    const [min, max, step] = RSH_RANGES[key];
    return { key, label, unit, hint, group, min, max, step };
  });
  const blend: TunerControl<Key> = {
    key: `c${n}blend` as Key, label: 'Blend mode', hint: 'How this disc blends with the rune node beneath it.',
    group, kind: 'select', options: RSH_BLENDS, min: 0, max: 0, step: 0,
  };
  return [...nums, blend];
});

// The chains over the LOCKED third rune slot — placement only (whether it shows is game logic; see QuestBadges).
const chainsControls: TunerControl<Key>[] = (['x', 'y', 'w'] as const).map((f) => {
  const key = `ch${f}` as RshNumKey;
  const [label, unit] = FIELD[f];
  const [min, max, step] = RSH_RANGES[key];
  return { key, label, unit, hint: 'Position / size of the chains on the locked 3rd rune slot.', group: 'Chains (3rd slot)', min, max, step };
});

// Node geometry FIRST (the primary thing you reach for), then the sheen overlays.
const controls: TunerControl<Key>[] = [...rowControls, ...perNodeControls, ...sheenControls, ...chainsControls];

/** Merged defaults, so the panel can mark which controls you have moved. */
const DEFAULTS: RuneNodesConfig = {
  ...RSH_DEFAULTS,
  qbS: qbDef('qbS'), qbX: qbDef('qbX'), qbY: qbDef('qbY'), qbGap: qbDef('qbGap'),
  qb1X: qbDef('qb1X'), qb1Y: qbDef('qb1Y'), qb2X: qbDef('qb2X'), qb2Y: qbDef('qb2Y'), qb3X: qbDef('qb3X'), qb3Y: qbDef('qb3Y'),
};

export const SPEC: TunerSpec<RuneNodesConfig> = {
  id: 'runesheen',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Rune Nodes',
  note: 'dev · live',
  read: () => {
    const lay = getLayout();
    const merged = { ...getRuneSheenConfig() } as RuneNodesConfig;
    for (const k of QB_KEYS) merged[k] = lay[k] ?? qbDef(k);
    return merged;
  },
  write: (key, value) => {
    if (isQb(key)) setLayoutValue(key, value);
    else setRuneSheenValue(key as keyof RuneSheenConfig, value);
  },
  writeColor: (key, value) => setRuneSheenValue(key as keyof RuneSheenConfig, value), // blend selects only
  reset: () => {
    resetRuneSheenConfig();
    for (const k of QB_KEYS) setLayoutValue(k, qbDef(k)); // reset only the node keys, never all of Layout Lab
  },
  defaults: DEFAULTS,
  controls,
};

export function RuneSheenTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
