import { useState } from 'react';
import { PALETTE_STOP_LABELS, PALETTE_LIBRARY } from '../palettes';
import { numToHex } from '../color';
import { ColorPickerHSB } from './ColorPickerHSB';

type Quad = [number, number, number, number];

/** Four labelled rim→core stops (Rim/Outer/Inner/Core) + a grouped preset library. Selecting a stop opens
 *  the shared HSB picker (Task 4) for just that stop; clicking a preset chip replaces all four at once.
 *  Presentation only — the palette data lives in fx/palettes.ts. */
export function PalettePicker({ value, onChange }: { value: Quad; onChange: (v: Quad) => void }) {
  const [sel, setSel] = useState(2);
  const setStop = (c: number) => onChange(value.map((v, i) => (i === sel ? c : v)) as Quad);
  return (
    <div className="fxwb-pal">
      <div className="fxwb-pal-stops">
        {value.map((c, i) => (
          <button key={i} className={`fxwb-pal-stop${i === sel ? ' sel' : ''}`} onClick={() => setSel(i)}>
            <span className="sw" style={{ background: numToHex(c) }} />
            <span className="nm">{PALETTE_STOP_LABELS[i]}</span>
          </button>
        ))}
      </div>
      <ColorPickerHSB value={value[sel]} onChange={setStop} />
      <details className="fxwb-pal-lib"><summary>Presets</summary>
        {Object.entries(PALETTE_LIBRARY).map(([group, pals]) => (
          <div key={group} className="fxwb-pal-group">
            <div className="fxwb-pal-gname">{group}</div>
            <div className="fxwb-pal-grid">
              {Object.entries(pals).map(([name, cols]) => (
                <button key={name} className="fxwb-pal-chip" title={name} onClick={() => onChange([...cols] as Quad)}>
                  {cols.map((c, i) => <span key={i} style={{ background: numToHex(c) }} />)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </details>
    </div>
  );
}
