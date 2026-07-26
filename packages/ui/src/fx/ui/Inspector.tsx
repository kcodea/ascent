import { useMemo, useRef, useState } from 'react';
import { insertCurvePoint, removeCurvePoint, MIN_CURVE_POINTS, CURVE_T_EPSILON } from '../curve';
import {
  defaultOpenGroups,
  groupParamKeys,
  isParamEnabled,
  mergeOpenGroups,
  paramDisabledReason,
  visibleParamKeys,
  type FxParamSpec,
  type FxParamSpecs,
} from '../params';
import { importShapeFromFile, listShapeOptions, removeImportedShape } from '../shapeLibrary';

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
const STOP_LABELS = ['Rim', 'Mid', 'Bright', 'Core'] as const;

/** `#rrggbb` -> 0xRRGGBB, matching the existing `color` kind's own inline parse below. */
const hexToColor = (hex: string): number => parseInt(hex.slice(1), 16);
/** 0xRRGGBB -> `#rrggbb`, matching the existing `color` kind's own inline format below. */
const colorToHex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0')}`;

/** Which parameter tier the inspector is showing. */
type InspectorTier = 'essentials' | 'all';

/** Per-primitive so the groups you opened for `burst` don't decide what `ribbon` looks like. */
const groupsKey = (primitiveId: string): string => `fxwb.inspector.groups.${primitiveId}`;

/** Read the persisted open/closed map. Total: any storage failure (private mode, disabled storage, corrupt
 *  JSON) degrades to "no stored state", never to a thrown render. */
function readOpenGroups(primitiveId: string): unknown {
  try {
    const raw = window.localStorage.getItem(groupsKey(primitiveId));
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Persist the open/closed map. Swallows storage failures for the same reason as the read. */
function writeOpenGroups(primitiveId: string, open: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(groupsKey(primitiveId), JSON.stringify(open));
  } catch {
    /* a workbench that can't remember which groups were open is still a working workbench */
  }
}

export function Inspector({
  specs,
  values,
  onChange,
  primitiveId,
}: {
  specs: FxParamSpecs;
  values: Record<string, unknown>;
  onChange: (key: string, value: number | boolean | string | number[] | number[][]) => void;
  /** Which primitive these specs belong to — the key the open/closed group state is persisted under. */
  primitiveId: string;
}): React.ReactElement {
  const [tier, setTier] = useState<InspectorTier>('essentials');
  const [query, setQuery] = useState('');
  // Open/closed lives here keyed by primitive rather than being re-read from storage every render: the
  // stored map is the STARTING point (below), this is the live one for primitives touched this session.
  const [openByPrimitive, setOpenByPrimitive] = useState<Record<string, Record<string, boolean>>>({});

  const stored = useMemo(
    () => mergeOpenGroups(defaultOpenGroups(specs), readOpenGroups(primitiveId)),
    [specs, primitiveId],
  );
  const open = openByPrimitive[primitiveId] ?? stored;

  const toggleGroup = (group: string): void => {
    const next = { ...open, [group]: !(open[group] ?? true) };
    setOpenByPrimitive((prev) => ({ ...prev, [primitiveId]: next }));
    writeOpenGroups(primitiveId, next);
  };

  const searching = query.trim() !== '';
  const total = Object.keys(specs).length;
  const essentialCount = Object.keys(specs).filter((k) => specs[k].essential === true).length;
  const keys = visibleParamKeys(specs, { essentialsOnly: tier === 'essentials', query });
  // Flat while browsing Essentials (a handful of rows needs no filing system); grouped in All, and grouped
  // while SEARCHING from either tier so a hit still says which part of the primitive it came from. A search
  // also reaches past the Essentials tier — someone typing "turb" wants the turbulence knobs either way.
  const grouped = tier === 'all' || searching;

  const renderRow = (key: string): React.ReactElement => (
    <ParamRow
      key={key}
      paramKey={key}
      spec={specs[key]}
      value={values[key]}
      enabled={isParamEnabled(specs[key], values)}
      reason={paramDisabledReason(specs, key, values)}
      onChange={onChange}
    />
  );

  return (
    <div className="fxwb-inspector">
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
              : `All ${total} params. Click a group to fold it away.`}
        </div>
      </div>

      {keys.length === 0 && (
        <div className="fxwb-tierempty">
          {searching ? `Nothing matches “${query.trim()}”.` : 'This primitive declares no parameters.'}
        </div>
      )}

      {grouped
        ? groupParamKeys(specs, keys).map(({ group, keys: groupKeys }) => {
            // A search forces every group holding a hit open — a filtered-but-collapsed group would just be a
            // heading you have to click to discover the thing you already searched for.
            const isOpen = searching || (open[group] ?? true);
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
                  <span className="fxwb-grpcount">{groupKeys.length}</span>
                </button>
                {isOpen && <div className="fxwb-grpbody">{groupKeys.map(renderRow)}</div>}
              </section>
            );
          })
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
  enabled,
  reason,
  onChange,
}: {
  paramKey: string;
  spec: FxParamSpec;
  value: unknown;
  enabled: boolean;
  reason: string | null;
  onChange: (key: string, value: number | boolean | string | number[] | number[][]) => void;
}): React.ReactElement {
  const [helpOpen, setHelpOpen] = useState(false);
  const off = !enabled;

  return (
    <div className={`fxwb-row${off ? ' fxwb-off' : ''}`}>
      <span className="fxwb-lab">
        <label htmlFor={`fxwb-${key}`}>{spec.label}</label>
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
        <input id={`fxwb-${key}`} type="color" disabled={off}
          value={`#${((value as number) >>> 0).toString(16).padStart(6, '0')}`}
          onChange={(e) => onChange(key, parseInt(e.target.value.slice(1), 16))} />
      )}
      {spec.kind === 'palette' && (() => {
        const stops = (value as number[] | undefined) ?? spec.default;
        const presetEntries = Object.entries(spec.presets ?? {});
        return (
          <div className="fxwb-palette">
            {presetEntries.length > 0 && (
              <select
                id={`fxwb-${key}`}
                aria-label={`${spec.label} preset`}
                value=""
                disabled={off}
                onChange={(e) => {
                  const preset = spec.presets?.[e.target.value];
                  if (preset) onChange(key, [...preset]);
                }}
              >
                <option value="" disabled>Preset…</option>
                {presetEntries.map(([name]) => <option key={name} value={name}>{name}</option>)}
              </select>
            )}
            <div className="fxwb-palette-stops">
              {STOP_LABELS.map((stopLabel, i) => (
                <input
                  key={stopLabel}
                  type="color"
                  title={stopLabel}
                  aria-label={`${spec.label} ${stopLabel}`}
                  disabled={off}
                  value={colorToHex(stops[i] ?? 0)}
                  onChange={(e) => {
                    const next = [...stops];
                    next[i] = hexToColor(e.target.value);
                    onChange(key, next);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })()}
      {spec.kind === 'shape' && (
        <ShapeField
          id={`fxwb-${key}`}
          value={(value as string | undefined) ?? spec.default}
          fallback={spec.default}
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
function CurveEditor({
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
      <div className="fxwb-curve-hint" style={{ fontSize: 10, lineHeight: 1.3, color: '#8a7fa8' }}>
        Drag points · double-click to add · alt-click or right-click a point to remove (ends are pinned).
      </div>
    </div>
  );
}
