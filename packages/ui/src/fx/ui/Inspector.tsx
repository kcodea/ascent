import type { FxParamSpecs } from '../params';

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
  onChange: (key: string, value: number | boolean | string | number[]) => void;
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
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
