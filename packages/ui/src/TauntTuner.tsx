import { useState } from 'react';
import { TAUNT_KEYS, TAUNT_RANGES, getTauntConfig, resetTauntConfig, setTauntValue, type TauntConfig } from './tauntConfig';
import { tauntFx } from './pixiFx';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the Taunt bulwark (the silver heater shield behind a Taunt minion). Drag the
 * sliders to dial the shape (top/bottom/width/taper), the chrome rim, the central gem, the glint speed, the
 * silver tint, the footprint size, and the deploy "thwap" speed by eye — values persist to localStorage and
 * drive the shader LIVE (a held demo bubble updates as you slide). "Hold demo" parks a bulwark at screen
 * centre so shape/colour edits show instantly; "Deploy ▸" re-fires the thwap. "Copy" grabs the JSON to paste
 * back as the shipped defaults in `tauntConfig.ts`; "Reset" clears to defaults. Panel-only: opened from
 * the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof TauntConfig, string> = {
  topY: 'top edge',
  botY: 'bottom pt',
  halfW: 'width',
  widthPow: 'taper',
  rimW: 'rim',
  gemSize: 'gem',
  glintSpeed: 'glint spd',
  colorR: 'tint R',
  colorG: 'tint G',
  colorB: 'tint B',
  margin: 'size',
  offsetX: 'shift ←→',
  offsetY: 'shift ↑↓',
  deployMs: 'deploy ms',
};

const DEMO = '__tauntTune';
function demoRect(): { cx: number; cy: number; cw: number; ch: number } {
  return { cx: window.innerWidth / 2, cy: window.innerHeight / 2, cw: 150, ch: 190 };
}

export function TauntTuner() {
  const [cfg, setCfg] = useState<TauntConfig>(getTauntConfig());
  const [held, setHeld] = useState(false);
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('taunt');

  const set = (k: keyof TauntConfig, v: number): void => {
    setTauntValue(k, v);
    setCfg({ ...getTauntConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getTauntConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetTauntConfig(); setCfg({ ...getTauntConfig() }); };

  const hold = (): void => {
    const { cx, cy, cw, ch } = demoRect();
    if (held) { tauntFx.clearShield(DEMO, 'taunt'); setHeld(false); }
    else { tauntFx.setShield(DEMO, cx, cy, cw, ch, false, 'taunt'); setHeld(true); }
  };
  const deploy = (): void => {
    const { cx, cy, cw, ch } = demoRect();
    tauntFx.clearShield(DEMO, 'taunt'); // drop the old bubble so the next set re-runs the deploy thwap
    window.setTimeout(() => { tauntFx.setShield(DEMO, cx, cy, cw, ch, false, 'taunt'); setHeld(true); }, 60);
  };

  const swatch = `rgb(${Math.round(cfg.colorR * 255)}, ${Math.round(cfg.colorG * 255)}, ${Math.round(cfg.colorB * 255)})`;

  return (
    <div className="sfxmix lunge taunt" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
        Taunt Bulwark <span>dev · live · drag</span>
        <span className="taunt-swatch" style={{ background: swatch }} aria-hidden="true" />
      </div>
      {TAUNT_KEYS.map((k) => {
        const [min, max, step] = TAUNT_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={hold}>{held ? 'Hide demo' : 'Hold demo'}</button>
        <button className="sfxmix-copy" onClick={deploy}>Deploy ▸</button>
      </div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
