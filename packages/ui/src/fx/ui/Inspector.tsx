import { useRef, useState } from 'react';
import type { FxParamSpecs } from '../params';
import { importShapeFromFile, listShapeOptions, removeImportedShape } from '../shapeLibrary';

/**
 * Every control here is generated from the primitive's own FxParamSpec record — there is no separate
 * labels map, ranges table, or keys array to keep in sync. That triplication (and its silent drift) is the
 * exact thing the workbench exists to kill.
 */
const STOP_LABELS = ['Rim', 'Mid', 'Bright', 'Core'] as const;

/** `#rrggbb` -> 0xRRGGBB, matching the existing `color` kind's own inline parse below. */
const hexToColor = (hex: string): number => parseInt(hex.slice(1), 16);
/** 0xRRGGBB -> `#rrggbb`, matching the existing `color` kind's own inline format below. */
const colorToHex = (n: number): string => `#${(n >>> 0).toString(16).padStart(6, '0')}`;

export function Inspector({
  specs,
  values,
  onChange,
}: {
  specs: FxParamSpecs;
  values: Record<string, unknown>;
  onChange: (key: string, value: number | boolean | string | number[] | number[][]) => void;
}): React.ReactElement {
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(specs)) {
    const g = specs[key].group ?? 'General';
    const list = groups.get(g) ?? [];
    list.push(key);
    groups.set(g, list);
  }

  return (
    <div className="fxwb-inspector">
      {[...groups.entries()].map(([group, keys]) => (
        <section key={group}>
          <h3>{group}</h3>
          {keys.map((key) => {
            const spec = specs[key];
            return (
              <div className="fxwb-row" key={key} title={spec.help ?? ''}>
                <label htmlFor={`fxwb-${key}`}>{spec.label}</label>
                {spec.kind === 'slider' && (
                  <>
                    <input id={`fxwb-${key}`} type="range" min={spec.min} max={spec.max} step={spec.step}
                      value={values[key] as number} onChange={(e) => onChange(key, Number(e.target.value))} />
                    <span className="fxwb-val">{String(values[key])}</span>
                  </>
                )}
                {spec.kind === 'toggle' && (
                  <input id={`fxwb-${key}`} type="checkbox" checked={values[key] as boolean}
                    onChange={(e) => onChange(key, e.target.checked)} />
                )}
                {spec.kind === 'enum' && (
                  <select id={`fxwb-${key}`} value={values[key] as string}
                    onChange={(e) => onChange(key, e.target.value)}>
                    {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {spec.kind === 'color' && (
                  <input id={`fxwb-${key}`} type="color"
                    value={`#${((values[key] as number) >>> 0).toString(16).padStart(6, '0')}`}
                    onChange={(e) => onChange(key, parseInt(e.target.value.slice(1), 16))} />
                )}
                {spec.kind === 'palette' && (() => {
                  const stops = (values[key] as number[] | undefined) ?? spec.default;
                  const presetEntries = Object.entries(spec.presets ?? {});
                  return (
                    <div className="fxwb-palette">
                      {presetEntries.length > 0 && (
                        <select
                          id={`fxwb-${key}`}
                          aria-label={`${spec.label} preset`}
                          value=""
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
                    value={(values[key] as string | undefined) ?? spec.default}
                    fallback={spec.default}
                    onChange={(next) => onChange(key, next)}
                  />
                )}
                {spec.kind === 'curve' && (
                  <CurveEditor
                    value={(values[key] as [number, number][] | undefined) ?? spec.default.map((p) => [p[0], p[1]])}
                    label={spec.label}
                    presets={spec.presets}
                    vMax={spec.vMax}
                    onChange={(next) => onChange(key, next)}
                  />
                )}
              </div>
            );
          })}
        </section>
      ))}
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
  onChange,
}: {
  id: string;
  value: string;
  /** The spec's default — what a removed shape's slot resets to. */
  fallback: string;
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
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
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
          disabled={busy}
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

/**
 * A self-contained SVG editor for a `curve` param — a draggable control-point polyline over a normalized
 * life axis. Its own component (not an inline IIFE like the palette branch) because it holds hooks
 * (useRef for the live drag index): hooks inside the mapped render of Inspector would violate the rules of
 * hooks, so the curve editor keeps them at its own top level.
 */
function CurveEditor({
  value,
  label,
  presets,
  vMax = 1,
  onChange,
}: {
  value: number[][];
  label: string;
  presets?: Record<string, readonly (readonly [number, number])[]>;
  /** The spec's value ceiling — the top of the box. 1 (the default) is the historical behaviour. */
  vMax?: number;
  onChange: (next: number[][]) => void;
}): React.ReactElement {
  const points = value;
  const dragIndex = useRef<number | null>(null);
  const presetEntries = Object.entries(presets ?? {});

  const moveHandle = (e: React.PointerEvent<SVGSVGElement>): void => {
    const i = dragIndex.current;
    if (i === null) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    // Map pointer px → the SVG's own viewBox units (the element may be laid out at a different CSS size).
    const px = ((e.clientX - rect.left) / rect.width) * CURVE_W;
    const py = ((e.clientY - rect.top) / rect.height) * CURVE_H;
    const v = clampV(yToV(py, vMax), vMax);
    let t: number;
    if (i === 0) {
      t = 0; // first point pinned to birth
    } else if (i === points.length - 1) {
      t = 1; // last point pinned to death
    } else {
      // Interior point: keep strictly between its neighbours so points can't cross/reorder.
      const lo = points[i - 1][0];
      const hi = points[i + 1][0];
      const eps = 1e-3;
      t = Math.min(hi - eps, Math.max(lo + eps, clamp01(xToT(px))));
    }
    const next = points.map((p, idx) => (idx === i ? [t, v] : [p[0], p[1]]));
    onChange(next);
  };

  const polyline = points.map((p) => `${tToX(p[0])},${vToY(p[1], vMax)}`).join(' ');

  return (
    <div className="fxwb-curve">
      {presetEntries.length > 0 && (
        <select
          aria-label={`${label} preset`}
          value=""
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
              dragIndex.current = i;
              e.currentTarget.ownerSVGElement?.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
