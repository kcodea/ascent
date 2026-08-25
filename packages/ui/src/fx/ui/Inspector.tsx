import { useEffect, useMemo, useRef, useState } from 'react';
import { insertCurvePoint, removeCurvePoint, MIN_CURVE_POINTS, CURVE_T_EPSILON } from '../curve';
import { svgToEmitPointsAsync, EMIT_POINTS_DEFAULT } from '../svgEmit';
import type { GradientStop } from '../gradient';
import {
  changedParamKeys,
  DEFAULT_PARAM_GROUP,
  defaultOpenGroups,
  defaultsOf,
  groupParamKeys,
  isParamEnabled,
  matchesParamQuery,
  paramDisabledReason,
  visibleParamKeys,
  type FxParamSpec,
  type FxParamSpecs,
} from '../params';
import { filterEntries, filterOnCount, isFilterGroup, type FilterEntry } from './filterGroups';
import { importShapeFromFile, listShapeOptions, removeImportedShape } from '../shapeLibrary';
import { ColorPickerHSB } from './ColorPickerHSB';
import { PalettePicker } from './PalettePicker';
import { GradientEditor } from './GradientEditor';

/**
 * Every control here is generated from the primitive's own FxParamSpec record — there is no separate
 * labels map, ranges table, or keys array to keep in sync. That triplication (and its silent drift) is the
 * exact thing the workbench exists to kill.
 *
 * What the record can NOT do on its own is decide how much of itself to show at once. Burst alone declares 35
 * params; the rail is 288px; every group used to be expanded, always, with no tier, no search and no sign of
 * which controls were inert. So this file adds the three things every mature FX editor has and this one
 * didn't:
 *
 *  - **A tier.** "Essentials" (the default) shows only the handful of params flagged `essential` in the spec —
 *    the ones that carry the look. "All" shows the full surface. This is After Effects' Essential Graphics /
 *    Niagara's User Parameters, and it is the difference between opening on ~6 controls and opening on 43.
 *  - **Collapsible groups** with a count and a persisted open/closed state — Shuriken's 24 collapsed modules,
 *    the reason 150+ fields there are tolerable.
 *  - **Disabled-with-a-reason.** A param whose spec declares `enabledWhen` is greyed out with the condition
 *    printed under it ("Needs Erode above 0") instead of silently doing nothing. Disabled, never hidden: a
 *    control that vanishes takes its own discoverability with it, and makes the rail jump as you tune.
 *
 * Plus a search box and a per-row `?` — help used to be a `title=` on the row div, which is invisible until
 * you hover the right pixel for a second and does not exist at all on touch/keyboard.
 *
 * The rules about WHICH params are live/shown/grouped are pure functions in `../params` (the vitest include is
 * `packages/**\/*.test.ts` on a node environment, so they'd be untestable if they lived in this .tsx).
 */
/** Which parameter tier the inspector is showing. */
type InspectorTier = 'essentials' | 'all' | 'changed';

/** Per-primitive so the groups you opened for `burst` don't decide what `ribbon` looks like. */
const groupsKey = (primitiveId: string): string => `fxwb.inspector.groups.${primitiveId}`;

/** The synthetic group key the "Filters" master group's open/closed state persists under. Not a real spec
 *  `group` value (those are the individual filters' own labels, e.g. "Bloom (Advanced)") — see
 *  `filterGroups.ts`. Kept distinct (double-underscored) so it can never collide with an author's own group
 *  name. */
const FILTERS_GROUP_KEY = '__filters__';

/** Read the persisted open/closed OVERRIDES. Total: any storage failure (private mode, disabled storage,
 *  corrupt JSON) degrades to "no stored state", never to a thrown render. */
function readOpenGroups(primitiveId: string): unknown {
  try {
    const raw = window.localStorage.getItem(groupsKey(primitiveId));
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Persist the open/closed OVERRIDE map. Swallows storage failures for the same reason as the read.
 *  Deliberately a DELTA, not a full per-group snapshot — see `toggleGroup`'s comment for why that matters. */
function writeOpenGroups(primitiveId: string, overrides: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(groupsKey(primitiveId), JSON.stringify(overrides));
  } catch {
    /* a workbench that can't remember which groups were open is still a working workbench */
  }
}

/** Defensively parse the persisted map into ONLY the groups this primitive actually has, keeping ONLY the
 *  entries actually present (i.e. sparse — never padded out with a default for every group). That sparseness
 *  is what makes a stored value mean "the author explicitly set this group", rather than "this group's
 *  computed state at the moment ANY group was last toggled" — the distinction `toggleGroup` depends on to
 *  avoid baking a tier-specific default-open seed into storage. Mirrors `mergeOpenGroups`'s own validation
 *  (only boolean values, only known groups) without merging over a full defaults map. */
function sanitizeOpenOverrides(specs: FxParamSpecs, raw: unknown): Record<string, boolean> {
  const knownGroups = new Set(Object.keys(specs).map((k) => specs[k].group ?? DEFAULT_PARAM_GROUP));
  // The Filters master group is synthetic (its members' own `group` values are the individual filters'
  // labels, never this key — see FILTERS_GROUP_KEY above), so it would otherwise be sanitized away as an
  // "unknown" group and a user's explicit open/close of the master group would never survive a reload.
  knownGroups.add(FILTERS_GROUP_KEY);
  const out: Record<string, boolean> = {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [group, value] of Object.entries(raw as Record<string, unknown>)) {
    if (knownGroups.has(group) && typeof value === 'boolean') out[group] = value;
  }
  return out;
}

export function Inspector({
  specs,
  values,
  onChange,
  primitiveId,
  layerKey,
  focusKey,
  onFocusHandled,
}: {
  specs: FxParamSpecs;
  values: Record<string, unknown>;
  onChange: (key: string, value: number | boolean | string | number[] | number[][] | GradientStop[]) => void;
  /** Which primitive these specs belong to — the key the open/closed group state is persisted under. */
  primitiveId: string;
  /** Stable per-layer identity — the `emitpoints` control stores the uploaded SVG in localStorage under it,
   *  so two SVG-emit layers don't clobber each other's source during authoring. */
  layerKey: string;
  /** A ⌘K param-jump target. When set to a param key, the inspector switches to the All tier, opens that
   *  param's group and scrolls its row into view. ADDITIVE: undefined/null is exactly today's behaviour.
   *  The parent clears it (it is reset every time the command palette opens), so re-jumping to the same
   *  param fires again. */
  focusKey?: string | null;
  /** Called once the ⌘K jump above has actually scrolled a matching row into view, so the parent can clear
   *  `focusKey` right away instead of waiting for the next ⌘K open. Without this, a later layer switch to a
   *  different primitive that happens to share the same param key re-triggers the scroll/open unexpectedly —
   *  the stale `focusKey` still matches a param on the new primitive. ADDITIVE: omitted is exactly today's
   *  behaviour (the parent clears on next open, as before). Not called when `focusKey` names a param this
   *  primitive doesn't have, or when the row can't be found on screen. */
  onFocusHandled?: () => void;
}): React.ReactElement {
  const [tier, setTier] = useState<InspectorTier>('essentials');
  const [query, setQuery] = useState('');
  // EXPLICIT per-group open/closed OVERRIDES the author has actually set, keyed by primitive — deliberately
  // sparse (a group nobody has toggled has no entry here at all). This is the fix for a real regression: an
  // earlier version of this state held a full per-group snapshot (defaults + persisted + tier-seed all baked
  // together), and `toggleGroup` persisted that WHOLE snapshot on every click — so opening the Changed tier
  // (whose "group has a changed param" seed forces extra groups open) and then toggling any unrelated group
  // baked those tier-only forced-opens into localStorage, where Essentials/All read them back as if the user
  // had explicitly opened them. Keeping this sparse means only a group the author actually clicked ever gets
  // an entry, so a tier's default-open seed can never leak into another tier's storage.
  const [openByPrimitive, setOpenByPrimitive] = useState<Record<string, Record<string, boolean>>>({});
  // The inspector's scroll container — the ⌘K jump queries within it for the target row.
  const rootRef = useRef<HTMLDivElement>(null);

  // Which params have drifted from their spec default — feeds the Changed tier's filter, its group-open
  // seed below, and the per-group "N changed" badges. Cheap to recompute every render (see `changedParamKeys`).
  const changed = useMemo(() => changedParamKeys(specs, values), [specs, values]);
  // The spec defaults, keyed by param — what a double-click-to-reset on a row's label restores. Computed once
  // per `specs` change (not per row per render): `defaultsOf` deep-copies palette/curve/emitpoints/gradient
  // defaults, so recomputing it inside `renderRow` would allocate a fresh copy for every row on every render.
  const defaults = useMemo(() => defaultsOf(specs) as Record<string, unknown>, [specs]);

  // The ordinary essential-based seed (Essentials/All), computed exactly as before this tier existed.
  const defaultSeed = useMemo(() => defaultOpenGroups(specs), [specs]);
  // A SPARSE, Changed-tier-only addition: `true` for a group holding at least one changed param, so
  // switching to Changed doesn't require expanding every group by hand to see what you touched. Never
  // written to storage (see `sanitizeOpenOverrides`/`toggleGroup`) and never referenced when computing
  // Essentials/All's open state, so it cannot leak into either.
  const changedGroupSeed = useMemo(() => {
    const seed: Record<string, boolean> = {};
    for (const key of Object.keys(specs)) {
      if (!changed.has(key)) continue;
      seed[specs[key].group ?? DEFAULT_PARAM_GROUP] = true;
    }
    return seed;
  }, [specs, changed]);
  // The persisted EXPLICIT overrides for this primitive — sparse, per `sanitizeOpenOverrides`.
  const storedOverrides = useMemo(
    () => sanitizeOpenOverrides(specs, readOpenGroups(primitiveId)),
    [specs, primitiveId],
  );
  // This session's live overrides for the primitive, falling back to whatever was persisted.
  const overrides = openByPrimitive[primitiveId] ?? storedOverrides;

  // Hoisted above its historical spot (just before `total`/`keys` below) so `filtersDefaultOpen` — which
  // `isGroupOpen` needs — can read it without forward-referencing a later `const`.
  const searching = query.trim() !== '';

  // Every registry filter this PRIMITIVE actually has specs for — specs-driven, deliberately NOT filtered by
  // tier/essentials/changed. The Filters master group is a constant fixture of the grouped view (its own
  // "N on · total" badge already says what matters); narrowing its membership by tier would make "Changed"
  // hide an enabled-but-unchanged filter's controls, which is the opposite of decluttering.
  const filterEntriesList = useMemo(() => filterEntries(specs, values), [specs, values]);
  // Does `query` (the shared search box) match this filter at all — its own label/toggle or any of its
  // inline params? Mirrors `matchesParamQuery`'s label-or-key match, extended across the filter's whole
  // param set, since the filter's toggle spec label already equals the filter's own label (see
  // `filterLabSpecs`), so checking the toggle spec covers the "matches the filter label" half for free.
  const filterEntryMatchesQuery = (entry: FilterEntry): boolean =>
    matchesParamQuery(specs[entry.onKey], entry.onKey, query) ||
    entry.paramKeys.some((k) => matchesParamQuery(specs[k], k, query));
  // The Filters master group's own collapse-by-default rule — the exact analogue of `defaultSeed` (which only
  // knows about primitive-declared `group`s, so it never has an entry for this synthetic one): open when at
  // least one filter is ON. Deliberately does NOT fold the search-match case in here too — `defaultSeed`
  // doesn't consider `query` either; both leave "does the live search match" to the render call site's own
  // `searching || isGroupOpen(...)` (see below), the same override-bypassing force-open every plain group gets.
  const filtersDefaultOpen = filterOnCount(filterEntriesList) > 0;
  // Whether the live search is actively hitting something INSIDE the Filters master (as opposed to `searching`
  // alone, which is true for ANY query — including one that only matches an unrelated primitive param and has
  // nothing to do with filters at all). Forcing the master open on every keystroke regardless of relevance
  // would mean a primitive with filters flashes open when searching for something else entirely.
  const filtersSearchMatch = searching && filterEntriesList.some(filterEntryMatchesQuery);

  // A group's effective open/closed state: an explicit override (this session's toggle, or a persisted one)
  // always wins; otherwise fall back to the current tier's seed. Essentials/All see ONLY `defaultSeed` here —
  // byte-for-byte the same computation as before the Changed tier existed. The Filters master group (a
  // synthetic group, never a key in `defaultSeed`) falls back to `filtersDefaultOpen` instead.
  const isGroupOpen = (group: string): boolean => {
    if (group in overrides) return overrides[group];
    if (group === FILTERS_GROUP_KEY) return filtersDefaultOpen;
    if (tier === 'changed' && changedGroupSeed[group] === true) return true;
    return defaultSeed[group] ?? true;
  };

  // ⌘K PARAM JUMP. When the command palette targets a specific param, make sure that param is actually on
  // screen — a non-essential param is filtered out of the Essentials tier and its group may be collapsed —
  // then scroll its row into view. Switching to All and force-opening the group both go through the SAME
  // state the manual controls use, so nothing here is a special render path. The scroll waits a frame so it
  // measures AFTER that state has rendered the row. No-op (early return) when there is no target, which is
  // what keeps this additive. Matches the pre-existing behaviour of NOT persisting the jump-forced group —
  // only an explicit click through `toggleGroup` writes to storage.
  useEffect(() => {
    if (focusKey === undefined || focusKey === null) return;
    const spec = specs[focusKey];
    if (spec === undefined) return;
    const rawGroup = spec.group ?? DEFAULT_PARAM_GROUP;
    // A filter's own param (e.g. one of its knobs) declares its GROUP as the filter's label — but that group
    // no longer renders on its own (see the grouped-render path below); it lives inside the Filters master.
    // Force-open the master group instead so the jump still lands somewhere visible. The row itself only
    // renders once the target filter is ON or matches a search (see `filterEntryMatchesQuery`) — jumping to
    // an off, non-matching filter's knob still can't surface a row that's deliberately hidden, so the scroll
    // below is a no-op in that case (same graceful "row not found" fallback as any other missing target).
    const group = isFilterGroup(rawGroup) ? FILTERS_GROUP_KEY : rawGroup;
    setTier('all');
    setOpenByPrimitive((prev) => ({
      ...prev,
      [primitiveId]: { ...(prev[primitiveId] ?? storedOverrides), [group]: true },
    }));
    const raf = requestAnimationFrame(() => {
      // A plain param's row is `.fxwb-row`; a filter's own toggle (rendered as the Filters master group's
      // header control, not a `ParamRow`) lives in a `.fxwb-filterrow` instead — match either so jumping
      // straight to a filter's on/off switch finds a scrollable target too.
      const row = rootRef.current
        ?.querySelector(`#fxwb-${CSS.escape(focusKey)}`)
        ?.closest('.fxwb-row, .fxwb-filterrow');
      if (row === null || row === undefined) return;
      row.scrollIntoView({ block: 'nearest' });
      onFocusHandled?.();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusKey, primitiveId, specs, storedOverrides, onFocusHandled]);

  // Persists only the DELTA — the one group the author clicked, folded over whatever overrides already
  // existed — never the tier's whole seeded snapshot. This is what keeps a Changed-tier default-open from
  // ever reaching localStorage (and therefore Essentials/All) for a group the author didn't touch.
  const toggleGroup = (group: string): void => {
    const next = { ...overrides, [group]: !isGroupOpen(group) };
    setOpenByPrimitive((prev) => ({ ...prev, [primitiveId]: next }));
    writeOpenGroups(primitiveId, next);
  };

  const total = Object.keys(specs).length;
  const essentialCount = Object.keys(specs).filter((k) => specs[k].essential === true).length;
  const keys = visibleParamKeys(specs, {
    essentialsOnly: tier === 'essentials',
    changedOnly: tier === 'changed',
    changed,
    query,
  });
  // Flat while browsing Essentials (a handful of rows needs no filing system); grouped in All and Changed
  // (so a touched param still says which part of the primitive it came from), and grouped while SEARCHING
  // from any tier for the same reason. A search also reaches past the Essentials tier — someone typing
  // "turb" wants the turbulence knobs either way.
  const grouped = tier === 'all' || tier === 'changed' || searching;
  // Every registry filter's params share a `group` equal to that filter's own label (`filterLabSpecs`) — one
  // real accordion section PER filter otherwise, 30+ of them competing with the primitive's own groups for
  // attention. Drop them from the plain group list entirely; they render once, together, under the single
  // "Filters" master group below (see `filterEntriesList`). Every other group renders exactly as before this
  // task — same `groupParamKeys`/`isGroupOpen`/`toggleGroup` path, just minus the filter groups.
  const plainGroups = grouped
    ? groupParamKeys(specs, keys).filter(({ group }) => !isFilterGroup(group))
    : [];

  const renderRow = (key: string): React.ReactElement => (
    <ParamRow
      key={key}
      paramKey={key}
      spec={specs[key]}
      // FALL BACK TO THE SPEC'S DEFAULT. A def only stores params it actually sets, so any param left at its
      // default arrives here `undefined` — and the slider row printed `String(undefined)`, putting the literal
      // word "undefined" on screen where a number belongs (seen on `Emit squash` in `coins`). The range input
      // also went uncontrolled and snapped to its minimum, so the control lied about the value it was editing.
      // The palette, enum and curve rows already defaulted inline; doing it once here covers every kind.
      value={values[key] ?? specs[key].default}
      values={values}
      layerKey={layerKey}
      enabled={isParamEnabled(specs[key], values)}
      reason={paramDisabledReason(specs, key, values)}
      changed={changed.has(key)}
      defaultValue={defaults[key]}
      onChange={onChange}
    />
  );

  return (
    <div className="fxwb-inspector" ref={rootRef}>
      <div className="fxwb-tierbar">
        <div className="fxwb-tier" role="group" aria-label="Parameter tier">
          <button
            type="button"
            className={`fxwb-tierbtn${tier === 'essentials' ? ' on' : ''}`}
            aria-pressed={tier === 'essentials'}
            title="Only the few params that carry this effect's look"
            onClick={() => setTier('essentials')}
          >
            Essentials
          </button>
          <button
            type="button"
            className={`fxwb-tierbtn${tier === 'all' ? ' on' : ''}`}
            aria-pressed={tier === 'all'}
            title={`Every parameter this primitive has (${total}), grouped`}
            onClick={() => setTier('all')}
          >
            All
          </button>
          <button
            type="button"
            className={`fxwb-tierbtn${tier === 'changed' ? ' on' : ''}`}
            aria-pressed={tier === 'changed'}
            title={`Only the ${changed.size} param${changed.size === 1 ? '' : 's'} you've changed from default`}
            onClick={() => setTier('changed')}
          >
            Changed
          </button>
        </div>
        <input
          className="fxwb-search"
          type="search"
          spellCheck={false}
          placeholder="Search params…"
          aria-label="Search parameters"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="fxwb-tierhint">
          {searching
            ? `${keys.length} of ${total} match “${query.trim()}”`
            : tier === 'essentials'
              ? `${essentialCount} of ${total} — the ones that change the look. Switch to All for the rest.`
              : tier === 'changed'
                ? `${changed.size} of ${total} changed from default. Click a group to fold it away.`
                : `All ${total} params. Click a group to fold it away.`}
        </div>
      </div>

      {keys.length === 0 && (
        <div className="fxwb-tierempty">
          {searching
            ? `Nothing matches “${query.trim()}”.`
            : tier === 'changed'
              ? 'Nothing changed from its defaults yet.'
              : 'This primitive declares no parameters.'}
        </div>
      )}

      {grouped
        ? (
          <>
            {plainGroups.map(({ group, keys: groupKeys }) => {
              // A search forces every group holding a hit open — a filtered-but-collapsed group would just be
              // a heading you have to click to discover the thing you already searched for.
              const isOpen = searching || isGroupOpen(group);
              // How many of THIS group's currently-visible rows have drifted from default — independent of
              // tier, so browsing All still flags which groups hold edits without switching to Changed.
              const changedInGroup = groupKeys.reduce((n, k) => (changed.has(k) ? n + 1 : n), 0);
              return (
                <section className="fxwb-grp" key={group}>
                  <button
                    type="button"
                    className="fxwb-grphead"
                    aria-expanded={isOpen}
                    title={isOpen ? `Collapse ${group}` : `Expand ${group}`}
                    onClick={() => toggleGroup(group)}
                  >
                    <span className="fxwb-grpcaret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                    <span className="fxwb-grpname">{group}</span>
                    {changedInGroup > 0 && (
                      <span className="fxwb-grpbadge" title={`${changedInGroup} changed from default`}>
                        {changedInGroup} changed
                      </span>
                    )}
                    <span className="fxwb-grpcount">{groupKeys.length}</span>
                  </button>
                  {isOpen && <div className="fxwb-grpbody">{groupKeys.map(renderRow)}</div>}
                </section>
              );
            })}
            {/* The Filters master group — every registry filter's toggle + (when it matters) its inline
                params, folded under ONE accordion instead of 30+ competing sections. Rendered only when this
                primitive actually has filter specs (a primitive with no filters shows nothing extra). Its
                open/closed state goes through the SAME `isGroupOpen`/`toggleGroup` path as every other group
                (keyed by `FILTERS_GROUP_KEY`), so a search still force-opens it exactly like any other group. */}
            {filterEntriesList.length > 0 && (() => {
              const filtersOn = filterOnCount(filterEntriesList);
              // `filtersSearchMatch`, not the blanket `searching` the plain groups above use — a plain group
              // only ever appears there once it already holds a search hit (it came straight out of `keys`),
              // so forcing it open is always correct. The Filters master renders whenever this primitive HAS
              // filters at all, whether or not the live query matches anything inside one, so blanket-opening
              // it on every keystroke would flash it open while searching for an unrelated primitive param.
              const isOpen = filtersSearchMatch || isGroupOpen(FILTERS_GROUP_KEY);
              return (
                <section className="fxwb-grp fxwb-filtersgrp" key={FILTERS_GROUP_KEY}>
                  <button
                    type="button"
                    className="fxwb-grphead"
                    aria-expanded={isOpen}
                    title={isOpen ? 'Collapse Filters' : 'Expand Filters'}
                    onClick={() => toggleGroup(FILTERS_GROUP_KEY)}
                  >
                    <span className="fxwb-grpcaret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                    <span className="fxwb-grpname">Filters</span>
                    <span
                      className={`fxwb-filtersbadge${filtersOn > 0 ? ' on' : ''}`}
                      title={`${filtersOn} of ${filterEntriesList.length} filters enabled`}
                    >
                      {filtersOn} on · {filterEntriesList.length}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="fxwb-grpbody fxwb-filtersbody">
                      {filterEntriesList.map((entry) => {
                        // On floats it to the top (see `filterEntries`'s ordering) and always shows its
                        // params; off but matching the live search also expands, so search still finds a
                        // knob buried inside a filter that isn't switched on. Otherwise stays collapsed to
                        // just its toggle — the entire point of folding 30+ groups into one.
                        const expanded = entry.on || (searching && filterEntryMatchesQuery(entry));
                        return (
                          <div className="fxwb-filterrow" key={entry.id}>
                            <label className="fxwb-filterhead" htmlFor={`fxwb-${entry.onKey}`}>
                              <input
                                id={`fxwb-${entry.onKey}`}
                                type="checkbox"
                                checked={entry.on}
                                onChange={(e) => onChange(entry.onKey, e.target.checked)}
                              />
                              <span className="fxwb-filtername">{entry.label}</span>
                            </label>
                            {expanded && entry.paramKeys.length > 0 && (
                              <div className="fxwb-filterbody">{entry.paramKeys.map(renderRow)}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })()}
          </>
        )
        : keys.map(renderRow)}
    </div>
  );
}

/**
 * One parameter's row: label, help affordance, the control itself, and — when the spec says the param is
 * inert right now — the reason it's greyed out.
 *
 * Its own component because the `?` toggle is state, and state inside Inspector's mapped render would violate
 * the rules of hooks (the same reason `CurveEditor`/`ShapeField` below are components).
 */
function ParamRow({
  paramKey: key,
  spec,
  value,
  values,
  layerKey,
  enabled,
  reason,
  changed,
  defaultValue,
  onChange,
}: {
  paramKey: string;
  spec: FxParamSpec;
  value: unknown;
  /** The whole layer's params — the `emitpoints` control reads its sibling `emitFill`/`emitDensity` to bake. */
  values: Record<string, unknown>;
  /** Stable per-layer identity for the `emitpoints` control's localStorage SVG stash. */
  layerKey: string;
  enabled: boolean;
  reason: string | null;
  /** Whether this param has drifted from its spec default (from the Inspector's `changed` set) — drives the
   *  modified-dot affordance and gates the double-click-to-reset gesture below. */
  changed: boolean;
  /** This param's spec default (from `defaultsOf`, computed once by the Inspector) — what a double-click
   *  reset restores. */
  defaultValue: unknown;
  onChange: (key: string, value: number | boolean | string | number[] | number[][] | GradientStop[]) => void;
}): React.ReactElement {
  const [helpOpen, setHelpOpen] = useState(false);
  // Plays the one-shot reset-confirmation pop; cleared on the animation's own `onAnimationEnd` so it can
  // replay on a second reset (a class that's still present wouldn't re-trigger the CSS animation).
  const [resetFlash, setResetFlash] = useState(false);
  const off = !enabled;

  // Double-click the label resets the param to its spec default. No-op when the param is already at default
  // (nothing to reset, and no flash to confirm) — `changed` is the same set the modified dot renders from, so
  // the affordance and the gesture it enables never disagree with each other.
  const resetToDefault = (): void => {
    if (!changed) return;
    onChange(key, defaultValue as number | boolean | string | number[] | number[][] | GradientStop[]);
    setResetFlash(true);
  };

  return (
    <div className={`fxwb-row${off ? ' fxwb-off' : ''}${changed ? ' changed' : ''}`}>
      <span
        className={`fxwb-lab${resetFlash ? ' fxwb-reset-flash' : ''}`}
        onAnimationEnd={() => setResetFlash(false)}
      >
        {/* The double-click-to-reset target is the LABEL TEXT ONLY, not this whole wrapper — the wrapper
            also contains the `?` help-toggle button, and a native dblclick on that button bubbles up
            through any handler on the wrapper. Scoping to just the label means double-clicking the help
            icon (a habit for small icon buttons) can never silently discard a tuned value. */}
        <label
          htmlFor={`fxwb-${key}`}
          onDoubleClick={resetToDefault}
          title={changed ? `${spec.label} — double-click to reset to default` : undefined}
        >
          {spec.label}
        </label>
        {changed && <span className="fxwb-moddot" aria-hidden="true" />}
        {spec.help !== undefined && (
          <button
            type="button"
            className={`fxwb-help${helpOpen ? ' on' : ''}`}
            // Kept as a title as well as a click target: hover is the fast path for someone already using a
            // mouse, the click is the one that works on a trackpad, a touchscreen, or the keyboard.
            title={spec.help}
            aria-expanded={helpOpen}
            aria-label={`What ${spec.label} does`}
            onClick={() => setHelpOpen((v) => !v)}
          >
            ?
          </button>
        )}
      </span>
      {spec.kind === 'slider' && (
        <>
          <input id={`fxwb-${key}`} type="range" min={spec.min} max={spec.max} step={spec.step}
            disabled={off}
            value={value as number} onChange={(e) => onChange(key, Number(e.target.value))} />
          <span className="fxwb-val">{String(value)}</span>
        </>
      )}
      {spec.kind === 'toggle' && (
        <input id={`fxwb-${key}`} type="checkbox" checked={value as boolean} disabled={off}
          onChange={(e) => onChange(key, e.target.checked)} />
      )}
      {spec.kind === 'enum' && (
        <select id={`fxwb-${key}`} value={value as string} disabled={off}
          onChange={(e) => onChange(key, e.target.value)}>
          {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {spec.kind === 'color' && (
        <ColorPickerHSB value={value as number} onChange={(n) => onChange(key, n)} disabled={off} />
      )}
      {spec.kind === 'palette' && (
        <PalettePicker
          value={((value as number[] | undefined) ?? spec.default) as [number, number, number, number]}
          onChange={(next) => onChange(key, next)}
          disabled={off}
        />
      )}
      {spec.kind === 'gradient' && (
        <GradientEditor
          value={(value as GradientStop[] | undefined) ?? [...spec.default]}
          onChange={(next) => onChange(key, next)}
          disabled={off}
        />
      )}
      {spec.kind === 'shape' && (
        <ShapeField
          id={`fxwb-${key}`}
          value={(value as string | undefined) ?? spec.default}
          fallback={spec.default}
          disabled={off}
          onChange={(next) => onChange(key, next)}
        />
      )}
      {spec.kind === 'emitpoints' && (
        <EmitPointsField
          value={(value as number[][] | undefined) ?? []}
          fill={!!values.emitFill}
          density={Number(values.emitDensity) || EMIT_POINTS_DEFAULT}
          storageKey={`fx.emitsvg.${layerKey}`}
          disabled={off}
          onChange={(next) => onChange(key, next)}
        />
      )}
      {spec.kind === 'curve' && (
        <CurveEditor
          value={(value as [number, number][] | undefined) ?? spec.default.map((p) => [p[0], p[1]])}
          label={spec.label}
          presets={spec.presets}
          vMax={spec.vMax}
          disabled={off}
          onChange={(next) => onChange(key, next)}
        />
      )}
      {/* The two full-width lines under the control. The reason is the whole point of the `enabledWhen` data:
          "this slider is doing nothing, and here is the exact knob that would change that". */}
      {off && reason !== null && <div className="fxwb-rowwhy">{reason}</div>}
      {helpOpen && spec.help !== undefined && <div className="fxwb-rowhelp">{spec.help}</div>}
    </div>
  );
}

/**
 * The `shape` param's control: a picker over the runtime shape library (built-ins + this browser's imports,
 * see `shapeLibrary.ts`) plus an Import button and a remove affordance for the selected import.
 *
 * Its own component (not an inline IIFE like the palette branch) for the same reason `CurveEditor` is: it
 * holds hooks, and hooks inside Inspector's mapped render would violate the rules of hooks.
 *
 * The library is module-level mutable state that React knows nothing about, so an import/remove bumps a
 * local counter to force this component to re-read `listShapeOptions()`.
 */
function ShapeField({
  id,
  value,
  fallback,
  disabled = false,
  onChange,
}: {
  id: string;
  value: string;
  /** The spec's default — what a removed shape's slot resets to. */
  fallback: string;
  /** The param is inert right now (see `enabledWhen`): show it, don't let it be edited. */
  disabled?: boolean;
  onChange: (next: string) => void;
}): React.ReactElement {
  // Array hole rather than a named-but-unused state value: the counter exists purely to trigger a re-render
  // after the module-level registry changes.
  const [, bumpRegistry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = listShapeOptions();
  const builtins = options.filter((o) => o.builtin);
  const imports = options.filter((o) => !o.builtin);
  const selected = options.find((o) => o.id === value);

  const runImport = async (file: File): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const shape = await importShapeFromFile(file);
      bumpRegistry((n) => n + 1);
      onChange(shape.id);
    } catch (err) {
      // Never throw into render — surface it as a line under the picker.
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fxwb-shape">
      <div className="fxwb-shape-row">
        <select id={id} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <optgroup label="Built-in">
            {builtins.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </optgroup>
          {imports.length > 0 && (
            <optgroup label="Imported">
              {imports.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </optgroup>
          )}
          {/* A def can name a shape this browser never imported (shared from another machine). Keep the id
              visible + selected rather than silently snapping the dropdown to something else — the render
              path is already drawing the fallback silhouette for it. */}
          {selected === undefined && <option value={value}>{value} (missing)</option>}
        </select>
        {selected !== undefined && !selected.builtin && (
          <button
            type="button"
            className="fxwb-shape-remove"
            title={`Remove '${selected.label}'`}
            aria-label={`Remove ${selected.label}`}
            disabled={disabled}
            onClick={() => {
              removeImportedShape(value);
              bumpRegistry((n) => n + 1);
              onChange(fallback);
            }}
          >
            ✕
          </button>
        )}
      </div>
      <label className="fxwb-shape-import">
        {busy ? 'Importing…' : 'Import PNG / SVG…'}
        <input
          type="file"
          accept="image/png,image/svg+xml,.png,.svg"
          disabled={busy || disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = ''; // clear so re-picking the same file fires change again
            if (file) void runImport(file);
          }}
        />
      </label>
      <div className="fxwb-shape-hint">Transparency is the silhouette — opaque art is auto-traced from brightness.</div>
      {error !== null && <div className="fxwb-shape-err">{error}</div>}
    </div>
  );
}

/**
 * The `emitpoints` param's control: an "Upload SVG" button + a live point-count readout, plus the re-bake
 * wiring that keeps the sibling `emitFill`/`emitDensity` in sync with a stored source.
 *
 * The uploaded SVG text itself is NOT a def value — only the baked `emitPoints` cloud persists (it round-trips
 * through `coerceParams` like any param). The source lives in `localStorage` under a per-layer key purely so
 * that flipping fill or dragging density can re-bake without asking the author to re-upload. A def opened on
 * another machine (no stored SVG) still renders its baked points; it just can't re-bake fill/density until the
 * author re-uploads — which the hint says out loud.
 *
 * Its own component (not an inline IIFE) for the same reason `ShapeField` is: it holds hooks (busy/error state
 * and the re-bake effect), and hooks inside Inspector's mapped render would violate the rules of hooks.
 */
function EmitPointsField({
  value,
  fill,
  density,
  storageKey,
  disabled = false,
  onChange,
}: {
  /** The baked cloud currently in the def — drives the point-count readout. */
  value: number[][];
  /** Sibling `emitFill` — outline vs filled silhouette. */
  fill: boolean;
  /** Sibling `emitDensity` — how many points to sample. */
  density: number;
  /** localStorage key the uploaded SVG text is stashed under (per-layer). */
  storageKey: string;
  /** The param is inert right now (emitShape ≠ svg): show it, don't let it be edited. */
  disabled?: boolean;
  onChange: (next: number[][]) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Whether a source SVG is stashed for this layer — decides between "re-bake on fill/density" and the
  // "re-upload to change fill/density" hint. Recomputed per render (cheap; the value only moves on upload).
  const hasStored = ((): boolean => {
    try {
      return window.localStorage.getItem(storageKey) !== null;
    } catch {
      return false;
    }
  })();

  const bake = async (text: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      // Async so the FILL path actually decodes the image before rasterizing (the sync bake returns [] on a
      // cold image). Outline delegates to the sync sampler internally.
      const pts = await svgToEmitPointsAsync(text, { fill, count: density });
      if (pts.length === 0) setError('No points baked — is this a path-based SVG?');
      onChange(pts);
    } catch {
      // Never throw into render — surface it as a line under the control (mirrors ShapeField).
      setError('Bake failed.');
    } finally {
      setBusy(false);
    }
  };

  // Re-bake ONLY on a deliberate fill/density change of the CURRENTLY-selected layer — never on selection.
  // `EmitPointsField` is NOT remounted when the author switches between two layers of the same primitive (the
  // Inspector has no React `key`), so `storageKey` can change on a plain re-render. If the effect baked on a
  // `storageKey` change it would commit `emitPoints` (arming autosave + an undo entry) on mere selection, and —
  // because the key is index-based — a post-reorder reselect could write a STALE stash's cloud into a surviving
  // layer's def. So we track the previous fill/density/storageKey in a ref and bake only when fill or density
  // actually moved WHILE storageKey stayed the same; a layer switch just adopts the new layer's values
  // silently. Deps exclude `bake`/`onChange` (recreated every parent render) on purpose.
  const prev = useRef({ fill, density, storageKey });
  useEffect(() => {
    const p = prev.current;
    const layerChanged = p.storageKey !== storageKey;
    const settingsChanged = p.fill !== fill || p.density !== density;
    prev.current = { fill, density, storageKey };
    // A selection (or the first mount) is inert; only a same-layer fill/density edit re-bakes.
    if (layerChanged || !settingsChanged) return;
    let text: string | null = null;
    try {
      text = window.localStorage.getItem(storageKey);
    } catch {
      text = null;
    }
    if (text !== null) void bake(text);
    // NOTE (out-of-scope, documented): the stash key is still index-based, so a mid-session reorder/delete that
    // shifts indices could make a later deliberate fill/density change read the WRONG layer's stashed SVG. That
    // is a re-bake *convenience* limitation only — it can no longer fire on selection, so it never silently
    // commits. A durable per-layer id would close it; deliberately left for a separate change.
  }, [fill, density, storageKey]);

  return (
    <div className="fxwb-emitsvg">
      <div className="fxwb-emitsvg-row">
        <label className="fxwb-shape-import">
          {busy ? 'Baking…' : 'Upload SVG…'}
          <input
            type="file"
            accept=".svg,image/svg+xml"
            disabled={busy || disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = ''; // clear so re-picking the same file fires change again
              if (!file) return;
              void (async (): Promise<void> => {
                const text = await file.text();
                try {
                  window.localStorage.setItem(storageKey, text);
                } catch {
                  /* ignore quota / disabled storage — the bake below still runs off the in-memory text */
                }
                await bake(text);
              })();
            }}
          />
        </label>
        <span className="fxwb-emitsvg-count">
          {value.length > 0 ? `${value.length} pts` : 'no SVG'}
        </span>
      </div>
      <div className="fxwb-shape-hint">
        {hasStored
          ? 'Off traces the outline; SVG fill scatters across the interior. Fill/density re-bake live.'
          : 'Re-upload to change fill/density — the source SVG lives only in this browser, not the saved def.'}
      </div>
      {error !== null && <div className="fxwb-shape-err">{error}</div>}
    </div>
  );
}

/** SVG dimensions for the compact curve editor (px). Curve-space is t∈[0,1] left→right, v∈[0,vMax]
 *  bottom→top; SVG y is flipped (0 at the top). A small inset keeps the edge handles fully inside the
 *  drawable box. */
const CURVE_W = 160;
const CURVE_H = 80;
const CURVE_PAD = 8;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
/** Clamp a control-point value into its spec's [0, vMax] band. */
const clampV = (n: number, vMax: number): number => (n < 0 ? 0 : n > vMax ? vMax : n);
/** Curve-space t (0→1) → SVG x. */
const tToX = (t: number): number => CURVE_PAD + t * (CURVE_W - 2 * CURVE_PAD);
/** Curve-space v (0→vMax) → SVG y (flipped: v = vMax at the top). `vMax` defaults to 1, so a spec that
 *  omits it maps exactly as before. */
const vToY = (v: number, vMax = 1): number => CURVE_H - CURVE_PAD - (v / vMax) * (CURVE_H - 2 * CURVE_PAD);
/** SVG x → curve-space t. */
const xToT = (x: number): number => (x - CURVE_PAD) / (CURVE_W - 2 * CURVE_PAD);
/** SVG y → curve-space v (flipped, scaled to [0, vMax]). */
const yToV = (y: number, vMax = 1): number => ((CURVE_H - CURVE_PAD - y) / (CURVE_H - 2 * CURVE_PAD)) * vMax;

/** Pointer px → curve space (t, v), both already clamped to their axes. Goes through the SVG's own viewBox
 *  units because the element is laid out at a different CSS size than its 160×80 coordinate system. */
const pointerToCurve = (
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
  vMax: number,
): { t: number; v: number } => {
  const rect = svg.getBoundingClientRect();
  const px = ((clientX - rect.left) / rect.width) * CURVE_W;
  const py = ((clientY - rect.top) / rect.height) * CURVE_H;
  return { t: clamp01(xToT(px)), v: clampV(yToV(py, vMax), vMax) };
};

/**
 * A self-contained SVG editor for a `curve` param — a draggable control-point polyline over a normalized
 * life axis. Its own component (not an inline IIFE like the palette branch) because it holds hooks
 * (useRef for the live drag index): hooks inside the mapped render of Inspector would violate the rules of
 * hooks, so the curve editor keeps them at its own top level.
 *
 * Points can be ADDED (double-click the box) and REMOVED (alt-click or right-click a handle) as well as
 * dragged — without that, a curve param that defaults to 2 points could only ever be a straight line by
 * direct manipulation, and a 3-point preset could never be simplified back. The endpoints stay pinned to
 * t=0 / t=1 and are never removable, and the list can never drop below `MIN_CURVE_POINTS` (which
 * `coerceParams` would reject outright) — both rules live in `curve.ts` alongside the sampler, so they are
 * unit-tested rather than trusted to the event handlers here.
 */
/**
 * A draggable value-over-life curve. EXPORTED because the workbench's def-level ease reuses it: the control
 * is identical, only what it drives differs (a param there, the composition's clock here).
 */
export function CurveEditor({
  value,
  label,
  presets,
  vMax = 1,
  disabled = false,
  onChange,
}: {
  value: number[][];
  label: string;
  presets?: Record<string, readonly (readonly [number, number])[]>;
  /** The spec's value ceiling — the top of the box. 1 (the default) is the historical behaviour. */
  vMax?: number;
  /** The param is inert right now (see `enabledWhen`): the curve still DRAWS (its shape is information),
   *  it just stops accepting gestures. */
  disabled?: boolean;
  onChange: (next: number[][]) => void;
}): React.ReactElement {
  const points = value;
  const dragIndex = useRef<number | null>(null);
  const presetEntries = Object.entries(presets ?? {});
  /** Interior points only, and never the last two — the endpoints define the curve's span and a curve
   *  needs at least `MIN_CURVE_POINTS`. Mirrors `removeCurvePoint`'s own refusals so the affordance is
   *  hidden rather than offered-and-ignored. */
  const removable = (i: number): boolean =>
    i > 0 && i < points.length - 1 && points.length > MIN_CURVE_POINTS;

  const moveHandle = (e: React.PointerEvent<SVGSVGElement>): void => {
    const i = dragIndex.current;
    if (i === null) return;
    const { t: rawT, v } = pointerToCurve(e.currentTarget, e.clientX, e.clientY, vMax);
    let t: number;
    if (i === 0) {
      t = 0; // first point pinned to birth
    } else if (i === points.length - 1) {
      t = 1; // last point pinned to death
    } else {
      // Interior point: keep strictly between its neighbours so points can't cross/reorder.
      const lo = points[i - 1][0];
      const hi = points[i + 1][0];
      t = Math.min(hi - CURVE_T_EPSILON, Math.max(lo + CURVE_T_EPSILON, rawT));
    }
    const next = points.map((p, idx) => (idx === i ? [t, v] : [p[0], p[1]]));
    onChange(next);
  };

  /** Double-click on the box adds a point there (double rather than single, so a stray click while reading
   *  the curve doesn't silently reshape it). Handles stop the event themselves, so this only ever fires on
   *  empty canvas. */
  const addAt = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (disabled) return;
    const { t, v } = pointerToCurve(e.currentTarget, e.clientX, e.clientY, vMax);
    onChange(insertCurvePoint(points, t, v, vMax));
  };

  const polyline = points.map((p) => `${tToX(p[0])},${vToY(p[1], vMax)}`).join(' ');

  return (
    <div className="fxwb-curve">
      {presetEntries.length > 0 && (
        <select
          aria-label={`${label} preset`}
          value=""
          disabled={disabled}
          onChange={(e) => {
            const preset = presets?.[e.target.value];
            if (preset) onChange(preset.map((p) => [p[0], p[1]]));
          }}
        >
          <option value="" disabled>Preset…</option>
          {presetEntries.map(([name]) => <option key={name} value={name}>{name}</option>)}
        </select>
      )}
      <svg
        className="fxwb-curve-svg"
        viewBox={`0 0 ${CURVE_W} ${CURVE_H}`}
        role="img"
        aria-label={vMax === 1 ? `${label} curve` : `${label} curve (max ${vMax}×)`}
        onPointerMove={(e) => {
          if (dragIndex.current !== null) moveHandle(e);
        }}
        onPointerUp={(e) => {
          if (dragIndex.current !== null) {
            e.currentTarget.releasePointerCapture(e.pointerId);
            dragIndex.current = null;
          }
        }}
        onDoubleClick={addAt}
      >
        <rect x={0} y={0} width={CURVE_W} height={CURVE_H} className="fxwb-curve-bg" />
        {vMax === 1 ? (
          // Plain half-height guide — the historical grid.
          <line x1={tToX(0)} y1={vToY(0.5)} x2={tToX(1)} y2={vToY(0.5)} className="fxwb-curve-grid" />
        ) : (
          // With a raised ceiling the interesting level is no longer the middle of the box but v = 1: the
          // "unchanged / 1×" line, above which the curve AMPLIFIES the base value. Draw it dashed (and skip
          // the plain mid-line, which at vMax = 2 would land in exactly the same place) plus a tiny label,
          // so it is obvious at a glance where neutral sits and how high the top is.
          <>
            <line
              x1={tToX(0)}
              y1={vToY(1, vMax)}
              x2={tToX(1)}
              y2={vToY(1, vMax)}
              className="fxwb-curve-grid"
              style={{ strokeDasharray: '3 3' }}
            />
            <text
              x={CURVE_W - CURVE_PAD}
              y={vToY(1, vMax) - 3}
              textAnchor="end"
              style={{ fill: 'currentColor', opacity: 0.5, fontSize: 8, pointerEvents: 'none' }}
            >
              1×
            </text>
            <text
              x={CURVE_W - CURVE_PAD}
              y={CURVE_PAD + 2}
              textAnchor="end"
              style={{ fill: 'currentColor', opacity: 0.35, fontSize: 8, pointerEvents: 'none' }}
            >
              {vMax}×
            </text>
          </>
        )}
        <line x1={tToX(0.5)} y1={vToY(0, vMax)} x2={tToX(0.5)} y2={vToY(vMax, vMax)} className="fxwb-curve-grid" />
        <polyline points={polyline} className="fxwb-curve-line" fill="none" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={tToX(p[0])}
            cy={vToY(p[1], vMax)}
            r={5}
            className="fxwb-curve-handle"
            onPointerDown={(e) => {
              if (disabled) return;
              // Alt-click removes instead of starting a drag -- the pointer-native twin of the right-click
              // below, for trackpads and for anyone whose browser eats the context menu.
              if (e.altKey && removable(i)) {
                e.preventDefault();
                e.stopPropagation();
                onChange(removeCurvePoint(points, i));
                return;
              }
              dragIndex.current = i;
              e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
            }}
            onContextMenu={(e) => {
              e.preventDefault(); // never show the browser menu over a handle, removable or not
              if (!disabled && removable(i)) onChange(removeCurvePoint(points, i));
            }}
            // A double-click that lands ON a handle must not also drop a new point beside it.
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <title>
              {removable(i)
                ? 'Drag to move · alt-click or right-click to remove'
                : 'Drag to move (pinned endpoint — cannot be removed)'}
            </title>
          </circle>
        ))}
      </svg>
      {/* The editor had no visible instructions at all, so the add/remove gestures were undiscoverable
          (and before this change, non-existent). Styled inline to match `.fxwb-shape-hint` rather than
          adding a rule to the shared stylesheet. */}
      <div className="fxwb-curve-hint" style={{ fontSize: 10, lineHeight: 1.3, color: '#9a8c74' }}>
        Drag points · double-click to add · alt-click or right-click a point to remove (ends are pinned).
      </div>
    </div>
  );
}
