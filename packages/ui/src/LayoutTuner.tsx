import { useState } from 'react';
import { LAYOUT_VARS, getLayout, resetLayout, setLayoutValue, type LayoutConfig } from './layoutConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only Layout Lab — live scale + position tuning for the board. Global multipliers scale every card
 * (`--card-scale`) and all UI chrome (`--ui-scale`); per-region rows resize + move the shop, warband, hand,
 * and top HUD bar. Drives CSS vars on `:root` (see layoutConfig.ts), persists to localStorage, applies at
 * boot. "Copy" grabs the JSON (paste into layoutConfig defaults to ship a change); "Reset" restores ×1 / 0px.
 * Opened from the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
export function LayoutTuner() {
  const [cfg, setCfg] = useState<LayoutConfig>(() => ({ ...getLayout() }));
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('layout');

  const set = (key: string, v: number): void => {
    setLayoutValue(key, v);
    setCfg({ ...getLayout() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getLayout(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetLayout(); setCfg({ ...getLayout() }); };

  // Section order, first-seen (Global · Shop row · Warband · Hand · HUD bar).
  const groups: string[] = [];
  for (const v of LAYOUT_VARS) if (!groups.includes(v.group)) groups.push(v.group);

  return (
    <div className="sfxmix layoutlab" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Layout Lab <span>dev · scale + position · drag</span></div>
      {groups.map((g) => (
        <div className="layoutlab-group" key={g}>
          <div className="layoutlab-grouphead">{g}</div>
          {LAYOUT_VARS.filter((v) => v.group === g).map((v) => {
            const val = cfg[v.key] ?? v.def;
            return (
              <div className="sfxmix-row" key={v.key}>
                <span className="sfxmix-name">{v.label}</span>
                <input type="range" min={v.min} max={v.max} step={v.step} value={val} onChange={(e) => set(v.key, Number(e.target.value))} />
                <span className="sfxmix-val">{v.fmt === 'px' ? `${val}px` : `${val.toFixed(2)}×`}</span>
              </div>
            );
          })}
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset all</button>
      </div>
    </div>
  );
}
