import { useState } from 'react';
import { FLIP_KEYS, FLIP_RANGES, FLIP_DESC, getFlipConfig, resetFlipConfig, setFlipValue, type FlipConfig } from './flipConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the warband/shop Flip slide — the reposition animation (reorder, close a sold
 * gap, make room). Drag the sliders to dial the live-drag glide (`dragMs`) and the committed settle (`commitMs`)
 * by eye — values persist to localStorage and apply to the NEXT reposition (drag a card or sell one to judge).
 * "Copy" grabs the JSON to paste back as the shipped defaults in `flipConfig.ts`; "Reset" clears to defaults.
 * Panel-only: opened from the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof FlipConfig, string> = {
  dragMs: 'drag slide ms',
  commitMs: 'commit settle ms (0=off)',
};

export function FlipTuner() {
  const [cfg, setCfg] = useState<FlipConfig>(getFlipConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('flip');

  const set = (k: keyof FlipConfig, v: number): void => {
    setFlipValue(k, v);
    setCfg({ ...getFlipConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getFlipConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetFlipConfig(); setCfg({ ...getFlipConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Reposition Slide <span>dev · next move · drag</span></div>
      {FLIP_KEYS.map((k) => {
        const [min, max, step] = FLIP_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={FLIP_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
