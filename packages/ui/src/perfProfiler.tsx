import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { perfMonitor } from './perfMonitor';

/**
 * `render:recruit` BY CHILD — a `React.Profiler` around each region of the Recruit subtree (the shop row, the
 * warband, the hand, the HUD, the overlays), so a 24 ms recruit commit says WHICH part of the tree it spent
 * on instead of only that it happened.
 *
 * DEV ONLY, structurally: the production React build compiles `Profiler` to a passthrough and never calls
 * `onRender`, so in prod this is `children`. In dev the per-commit callback is one `record` per region, and
 * `record` is a no-op while the monitor is off. The `actualDuration` React reports is the time spent
 * rendering the region and its descendants for that commit — the same quantity `render:recruit` measures
 * for the whole screen — so the children are a BREAKDOWN of the parent, not extra cost. They are recorded
 * with `self = 0` for that reason: they appear in `timings` (n / total / max) and never in the dropped-frame
 * attribution, where `render:recruit` already owns the milliseconds.
 *
 * Every `id` here must be registered in `perfNames.ts` (`render:recruit:*` is a family, and each is named);
 * `perfNames.test.ts` scans every static PerfProfiler id in the source for it.
 */
const onRender: ProfilerOnRenderCallback = (id, _phase, actualDuration) => {
  perfMonitor.record(id, actualDuration, 0);
};

export function PerfProfiler({ id, children }: { id: string; children: ReactNode }): ReactNode {
  if (!import.meta.env.DEV) return children;
  return <Profiler id={id} onRender={onRender}>{children}</Profiler>;
}
