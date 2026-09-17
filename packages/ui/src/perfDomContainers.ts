import type { PerfBucket } from './perfMonitor';

/**
 * DOM NODE COUNTS BY CONTAINER — so a leak names itself.
 *
 * The 2026-09-17 captures grew from 100 to ~1,000 DOM nodes over four minutes, "with time, not with
 * actions". A total says *that* something mounts and never unmounts; it cannot say *where*. Counting once a
 * second inside each of the containers a transient element could be stranded in — the shop row, the hand,
 * the warband, the FX roots, and everything portaled to `<body>` outside the React root — turns the total
 * into a ranking: whichever container's count climbs is the one to open in the Elements panel.
 *
 * `PERF_DOM_CONTAINERS` is the game's map (selector per name); `perfMonitor.setDomContainers` takes it so
 * the monitor itself stays free of any knowledge of the shop's markup. The selectors are chosen to be
 * DISJOINT (no container nests another), so `other` — the total minus every container — is an honest
 * remainder rather than a double-count. `containerGrowth` is the pure roll-up the report and HUD read.
 */
export const PERF_DOM_CONTAINERS: Readonly<Record<string, string>> = {
  shop: '[data-zone="tavern"]',
  hand: '[data-zone="hand"]',
  board: '[data-zone="warband"]',
  fx: '.pixifx, .pixifx-below',
  // Everything mounted on <body> outside the React root: the Discover / curtain / drag-card / ref-tip portals,
  // and any FX DOM wrapper that appends itself there.
  portals: 'body > :not(#root):not(script):not(style):not(link)',
};

/** The remainder key — nodes outside every named container. */
export const OTHER_CONTAINER = 'other';

/** How one container's node count moved across a run. */
export interface ContainerGrowth {
  name: string;
  first: number;
  last: number;
  /** `last − first` — the ranking key. Positive = grew. */
  delta: number;
  peak: number;
}

/**
 * Per-container node growth across the live buckets, biggest growth first. Buckets recorded before the
 * per-container count existed have no `nodesBy`; they are skipped so an old recording still diagnoses.
 */
export function containerGrowth(buckets: readonly PerfBucket[]): ContainerGrowth[] {
  const live = buckets.filter((b) => !b.hidden && b.nodesBy);
  if (live.length === 0) return [];
  const names = new Set<string>();
  for (const b of live) for (const k of Object.keys(b.nodesBy!)) names.add(k);
  const out: ContainerGrowth[] = [];
  for (const name of names) {
    let first = -1;
    let last = 0;
    let peak = 0;
    for (const b of live) {
      const v = b.nodesBy![name];
      if (v === undefined) continue;
      if (first < 0) first = v;
      last = v;
      if (v > peak) peak = v;
    }
    if (first < 0) continue;
    out.push({ name, first, last, delta: last - first, peak });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/** The growth table as one report line: `shop +412 (61→473), portals +305 (0→305)`. Growers only. */
export function growthSummary(growth: readonly ContainerGrowth[], max = 3): string {
  return growth
    .filter((g) => g.delta > 0)
    .slice(0, max)
    .map((g) => `${g.name} +${g.delta} (${g.first}→${g.last})`)
    .join(', ');
}
