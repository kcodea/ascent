import { numToHsb, hsbToNum, numToHex } from '../color';

export function ColorPickerHSB({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const hsb = numToHsb(value);
  const hueColor = hsbToNum({ h: hsb.h, s: 1, b: 1 });
  const set = (patch: Partial<typeof hsb>) => onChange(hsbToNum({ ...hsb, ...patch }));
  const barDrag = (e: React.PointerEvent, apply: (t: number) => void) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const move = (px: number) => apply(Math.min(1, Math.max(0, (px - rect.left) / rect.width)));
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', up);
  };
  return (
    <div className="fxwb-hsb">
      <div className="fxwb-hsb-swatch" style={{ background: numToHex(value) }} />
      <Bar label="Hue" t={hsb.h / 360} gradient="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
        onDrag={(e) => barDrag(e, (t) => set({ h: t * 360 }))} />
      <Bar label="Saturation" t={hsb.s} gradient={`linear-gradient(90deg,#bbb,${numToHex(hueColor)})`}
        onDrag={(e) => barDrag(e, (t) => set({ s: t }))} />
      <Bar label="Brightness" t={hsb.b} gradient={`linear-gradient(90deg,#000,${numToHex(hueColor)})`}
        onDrag={(e) => barDrag(e, (t) => set({ b: t }))} />
    </div>
  );
}
function Bar({ label, t, gradient, onDrag }: { label: string; t: number; gradient: string; onDrag: (e: React.PointerEvent) => void }) {
  return (
    <div className="fxwb-hsb-bar">
      <span className="fxwb-hsb-lab">{label}</span>
      <div className="fxwb-hsb-track" style={{ background: gradient }} onPointerDown={onDrag}>
        <span className="fxwb-hsb-knob" style={{ left: `${t * 100}%` }} />
      </div>
    </div>
  );
}
