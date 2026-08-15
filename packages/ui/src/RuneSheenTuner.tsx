import {
  RSH_BLENDS, RSH_DEFAULTS, RSH_RANGES,
  getRuneSheenConfig, resetRuneSheenConfig, setRuneSheenValue,
  type RuneSheenConfig, type RshNumKey,
} from './runeSheenConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

type Key = Extract<keyof RuneSheenConfig, string>;

/** Label + unit for the four numeric fields each disc shares. */
const FIELD: Record<'x' | 'y' | 'w' | 'o', [string, TunerUnit | undefined, string]> = {
  x: ['Horizontal offset', 'px', 'Slide this disc over its rune node.'],
  y: ['Vertical offset', 'px', 'Raise / lower this disc.'],
  w: ['Size', 'px', 'Disc width; height follows the art aspect.'],
  o: ['Opacity', 'opacity', 'How strong this disc reads. 0 hides it.'],
};

// Three groups (Circle 1/2/3), each: x, y, size, opacity, then a blend SELECT (writes a string via writeColor).
const controls: TunerControl<Key>[] = [1, 2, 3].flatMap((n) => {
  const group = `Circle ${n}`;
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

export const SPEC: TunerSpec<RuneSheenConfig> = {
  id: 'runesheen',
  title: 'Rune Sheen',
  note: 'dev · live',
  read: getRuneSheenConfig,
  write: (key, value) => setRuneSheenValue(key, value),
  writeColor: (key, value) => setRuneSheenValue(key, value),
  reset: resetRuneSheenConfig,
  defaults: RSH_DEFAULTS,
  controls,
};

export function RuneSheenTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
