import {
  RRL_DEFAULTS, RRL_RANGES,
  getReplayRailConfig, resetReplayRailConfig, setReplayRailValue, type ReplayRailConfig,
} from './replayRailConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the replay ROUND RAIL + its metrics dock (owner ask 2026-08-19). Applies live via
 * `--rrl-*` vars; shipping a look means pasting the JSON into replayRailConfig DEFAULTS *and* mirroring it
 * into the styles.css fallbacks. Only visible in action during a replay — start one (end screen → Rewatch)
 * before dialing.
 */
const SPECS: Record<keyof ReplayRailConfig, [string, TunerUnit | undefined, string, string]> = {
  x:     ['Horizontal', 'px', 'How far from the viewport’s left edge the rail sits.', 'Rail'],
  y:     ['Vertical', 'px', 'Vertical nudge off dead-center. Negative lifts it.', 'Rail'],
  s:     ['Size', '×', 'Overall scale — the rail and the dock together.', 'Rail'],
  dockW: ['Dock width', 'px', 'Width of the slide-out metrics dock.', 'Dock'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof ReplayRailConfig)[] = ['x', 'y', 's', 'dockW'];

const controls: TunerControl<Extract<keyof ReplayRailConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = RRL_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<ReplayRailConfig> = {
  id: 'replayrail',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Replay Rail',
  note: 'dev · live · drag',
  read: getReplayRailConfig,
  write: setReplayRailValue,
  reset: resetReplayRailConfig,
  defaults: RRL_DEFAULTS,
  controls,
};

export function ReplayRailTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
