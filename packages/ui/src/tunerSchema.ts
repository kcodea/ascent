/**
 * The DEV tuner schema — one declarative description of a tuner panel, so all 47 of them can render from a
 * single component instead of each hand-rolling the same ~50-line skeleton.
 *
 * WHY A WRAPPER AND NOT A REWRITE. Forty config modules already own their own `localStorage` key and their own
 * `get / set / reset` trio, and those keys hold values the owner has dialled by eye over months. A schema that
 * re-implemented persistence would silently discard all of it. So a `TunerSpec` never stores anything: it
 * *points at* the config module's existing accessors and adds only the presentation metadata the old panels
 * kept scattered between a `LABELS` map in the component and a `_RANGES` / `_DESC` pair in the config.
 *
 * The units vocabulary below is the fix for a real audit finding: across 867 labelled controls the codebase
 * spelled degrees as both `°` and `deg`, and opacity as `α` in thirty places and "opacity" elsewhere. A
 * control declares a `unit` and the panel renders it — labels stop carrying units as free text, so the
 * spellings cannot drift apart again.
 *
 * NOTE both `ms` and `s` exist. An earlier draft of this contract banned bare seconds, but several configs
 * genuinely store seconds because they feed CSS animation durations directly; normalising them would mean
 * rewriting stored values, which is a behaviour change and not this refactor's job. Declaring the unit makes
 * the mixture unambiguous, which was the actual problem — a bare "2.4" that might be either.
 */

/** The complete unit vocabulary. A control that renders a bare number declares no unit at all. */
export type TunerUnit =
  | 'ms'      // milliseconds
  | 's'       // seconds — only where the value feeds a CSS duration in seconds
  | 'px'      // absolute pixels
  | 'px/s'    // speed
  | '%'       // percentage
  | '×'       // multiplier of some base
  | '°'       // degrees — never "deg"
  | 'opacity' // 0–1 alpha — never "α"
  | 'cards';  // a count of card widths

/** How a control is presented. `range` is the overwhelming majority; the rest exist so the odd ones fit too. */
export type TunerControlKind = 'range' | 'color' | 'toggle';

export interface TunerControl<K extends string = string> {
  /** The config key this control writes. */
  key: K;
  /** Plain-language name. Says WHAT IT AFFECTS, and carries no unit — the unit field does that. */
  label: string;
  /** One line answering "what would I see change?" — shown on hover. */
  hint?: string;
  unit?: TunerUnit;
  /**
   * A caveat that belongs to THIS control, not the panel — most often "this one is not live". `CardPlateTuner`
   * had three such sliders (the text-shrink buckets don't move a card already on screen, because `Card` is
   * memoized) and warned about them with one blanket line at the panel's foot that never said which three.
   * A control that carries a note renders a marker you can hover, right where the caveat applies.
   */
  note?: string;
  min: number;
  max: number;
  step: number;
  /** Section heading. Controls sharing a group render together under it, in declaration order. */
  group?: string;
  kind?: TunerControlKind;
}

/**
 * A panel-local preview switch — NOT a config value, and this distinction is the point.
 *
 * Several tuners dial a look that only exists in a transient state: the hero-power glow appears on hover or
 * when the power is ready, so its sliders are unusable unless that state can be pinned. Those panels each
 * hand-rolled a checkbox that toggled a body class, sitting in the same row markup as the real controls and
 * looking identical to them, while writing nothing and persisting nothing. Declaring them separately keeps
 * "things that change the game" and "things that change what I can currently see" from wearing the same face.
 */
export interface TunerToggle {
  id: string;
  label: string;
  hint?: string;
  /** Class pinned on `document.body` while the toggle is on. */
  bodyClass: string;
  /** Whether it starts on — usually true, since the point is to make a hidden state visible. */
  defaultOn?: boolean;
}

export interface TunerAction {
  label: string;
  run: () => void;
  /** Hover explanation — these fire something on the board, which is not always obvious from the label. */
  hint?: string;
}

/**
 * `C` is constrained to `object` rather than `Record<string, number>` on purpose: every config module declares
 * its shape as an `interface`, and an interface has no implicit index signature, so a Record constraint would
 * reject all forty of them.
 */
export interface TunerSpec<C extends object> {
  /**
   * The panel id. FROZEN: `useDraggablePanel(id)` persists this panel's dragged position under it, so changing
   * an id silently resets where that panel opens. It must match the key used in DevMenu's group tables.
   */
  id: string;
  title: string;
  /** The small right-hand note in the header (e.g. "dev · next move · drag"). */
  note?: string;
  controls: TunerControl<Extract<keyof C, string>>[];
  /** Live read of the config module's current values. */
  read: () => C;
  /** Write one value through the config module's own setter, so its persistence stays authoritative. */
  write: (key: Extract<keyof C, string>, value: number) => void;
  /** Same, for `kind: 'color'` controls. Required only by panels that declare one. */
  writeColor?: (key: Extract<keyof C, string>, value: string) => void;
  /** Reset via the config module's own reset, so it clears the same storage key it wrote. */
  reset: () => void;
  /**
   * The shipped defaults, used only to mark which controls you have moved. Optional because several config
   * modules keep their DEFAULTS private today; without it the panel simply shows no modified marks.
   */
  defaults?: C;
  /** Panel-specific buttons — "Test", "Fire", "Demo". */
  actions?: TunerAction[];
  /** Preview switches that pin an otherwise-transient state so it can be tuned. See `TunerToggle`. */
  toggles?: TunerToggle[];
}

/**
 * The suffix shown beside a control's number box. `opacity` has none — a 0–1 alpha reads as a bare decimal,
 * and the label already says what it is.
 */
export function unitSuffix(unit?: TunerUnit): string {
  if (!unit || unit === 'opacity') return '';
  if (unit === 'cards') return 'cards';
  return unit;
}

/** Render a value with its unit. Kept here so every panel prints a number the same way. */
export function formatValue(value: number, unit?: TunerUnit): string {
  if (unit === 'opacity') return value.toFixed(2);
  if (unit === '×') return `${value}×`;
  if (unit === '%') return `${value}%`;
  if (unit === '°') return `${value}°`;
  if (unit === 'ms') return `${value}ms`;
  if (unit === 's') return `${value}s`;
  if (unit === 'px') return `${value}px`;
  if (unit === 'px/s') return `${value}px/s`;
  if (unit === 'cards') return `${value} cards`;
  return String(value);
}

/**
 * Group a control list for rendering, preserving declaration order and keeping ungrouped controls in a leading
 * unnamed section. Returns `[groupTitle | null, controls][]`.
 *
 * Only ADJACENT controls sharing a group merge — declaration order stays authoritative, because silently
 * hoisting a stray control up to its group's first appearance would reorder a panel behind the author's back.
 * The cost is that a group interrupted by another one renders TWICE under the same heading, which is always a
 * mistake in the spec; `assertGroupRuns` below turns that into a dev-time warning instead of something you
 * only notice by counting headings in a screenshot.
 */
export function groupControls<K extends string>(
  controls: TunerControl<K>[],
): [string | null, TunerControl<K>[]][] {
  const out: [string | null, TunerControl<K>[]][] = [];
  for (const c of controls) {
    const g = c.group ?? null;
    const last = out[out.length - 1];
    if (last && last[0] === g) last[1].push(c);
    else out.push([g, [c]]);
  }
  return out;
}

/**
 * Dev-time check: warn when a group title appears in more than one run, which renders a duplicate heading. Hit
 * exactly this while migrating the hero-power tuner — its glow colour was appended after the Glow fit controls
 * and opened a second "Face glow" section. With 39 panels still to migrate, a warning is cheaper than each one
 * being caught by eye.
 */
export function assertGroupRuns<K extends string>(panelId: string, controls: TunerControl<K>[]): void {
  const seen = new Set<string>();
  let prev: string | null = null;
  for (const [title] of groupControls(controls)) {
    if (title !== null && title !== prev && seen.has(title)) {
      console.warn(
        `[tuner:${panelId}] group "${title}" appears in more than one run, so it renders as two headings. `
        + 'Move those controls together in the spec — only adjacent controls merge into one section.',
      );
    }
    if (title !== null) seen.add(title);
    prev = title;
  }
}

/**
 * Build controls from a config module's existing `_RANGES` / `_DESC` maps plus a label table. This is the
 * migration shim: it lets a panel move onto the schema without its 40-odd ranges being retyped by hand, so the
 * risky mechanical step and the careful language step stay separate commits.
 */
export function controlsFrom<K extends string>(
  ranges: Record<K, [number, number, number]>,
  labels: Record<K, string>,
  extra?: Partial<Record<K, Pick<TunerControl<K>, 'hint' | 'unit' | 'group' | 'kind'>>>,
  order?: K[],
): TunerControl<K>[] {
  const keys = order ?? (Object.keys(ranges) as K[]);
  return keys.map((key) => {
    const [min, max, step] = ranges[key];
    return { key, label: labels[key], min, max, step, ...(extra?.[key] ?? {}) };
  });
}
