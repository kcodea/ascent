import type { FxParamSpecs } from '../params';

/**
 * Every control here is generated from the primitive's own FxParamSpec record — there is no separate
 * labels map, ranges table, or keys array to keep in sync. That triplication (and its silent drift) is the
 * exact thing the workbench exists to kill.
 */
export function Inspector({
  specs,
  values,
  onChange,
}: {
  specs: FxParamSpecs;
  values: Record<string, unknown>;
  onChange: (key: string, value: number | boolean | string) => void;
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
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
