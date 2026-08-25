import { useState } from 'react';
import { addStop, removeStop, type GradientStop } from '../gradient';
import { numToHex } from '../color';
import { ColorPickerHSB } from './ColorPickerHSB';

/** Multi-stop gradient bar: click the bar to add a stop, click a stop to select it (opens the HSB
 * picker below), double-click a stop to remove it. Delegates all stop maths to fx/gradient.ts — this
 * is presentation only. */
export function GradientEditor({ value, onChange }: { value: GradientStop[]; onChange: (s: GradientStop[]) => void }) {
  const [sel, setSel] = useState(0);
  // `value` isn't guaranteed sorted (coerceParams doesn't re-sort a saved/edited gradient — see Task 2
  // note), so sort a copy for the CSS gradient string. The stop markers below are positioned by
  // `left:%` so their render order doesn't matter and can stay keyed off the original array.
  const sortedStops = [...value].sort((a, b) => a.at - b.at);
  const css = `linear-gradient(90deg,${sortedStops.map((s) => `${numToHex(s.color)} ${s.at * 100}%`).join(',')})`;
  const onBar = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const at = (e.clientX - r.left) / r.width;
    const next = addStop(value, at, value[sel]?.color ?? 0xffffff);
    onChange(next);
    setSel(next.findIndex((s) => Math.abs(s.at - Math.min(1, Math.max(0, at))) < 1e-6));
  };
  return (
    <div className="fxwb-grad">
      <div className="fxwb-grad-bar" style={{ background: css }} onPointerDown={onBar}>
        {value.map((s, i) => (
          <span
            key={i}
            className={`fxwb-grad-stop${i === sel ? ' sel' : ''}`}
            style={{ left: `${s.at * 100}%`, background: numToHex(s.color) }}
            onPointerDown={(e) => { e.stopPropagation(); setSel(i); }}
            onDoubleClick={(e) => { e.stopPropagation(); onChange(removeStop(value, i)); setSel(0); }}
          />
        ))}
      </div>
      {value[sel] && (
        <ColorPickerHSB
          value={value[sel].color}
          onChange={(c) => onChange(value.map((s, i) => (i === sel ? { ...s, color: c } : s)))}
        />
      )}
    </div>
  );
}
