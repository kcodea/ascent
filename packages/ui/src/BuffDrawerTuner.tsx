import { useState } from 'react';
import {
  BFD_NUM_KEYS,
  BFD_RANGES,
  BFD_DESC,
  getBuffDrawerConfig,
  resetBuffDrawerConfig,
  setBuffDrawerValue,
  type BuffDrawerConfig,
} from './buffDrawerConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the run-buffs drawer (`buffDrawerConfig.ts` / `BuffsFrame.tsx`) — the panel that
 * extends right out of the hero portrait behind a tab eclipsing its edge.
 *
 * The tab is VERTICAL so it covers as little of the portrait as possible; `tab · x (eclipse)` is the dial
 * that decides how much it overlaps, which is the judgement call this tuner exists for. Type sizes are here
 * too, since the drawer sits over board art and legibility depends on the background behind it.
 *
 * Values persist to localStorage (dev only); "Copy values" grabs the JSON to bake into DEFAULTS + the
 * styles.css fallbacks. Opened from the Dev Tuning Menu; dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof BuffDrawerConfig, string> = {
  tabX: 'tab · x (eclipse)',
  tabY: 'tab · y',
  tabS: 'tab · scale',
  tabH: 'tab · height',
  tabW: 'tab · width',
  bodyX: 'drawer · x',
  bodyY: 'drawer · y',
  bodyS: 'drawer · scale',
  minW: 'drawer · min width',
  textS: 'text · rows',
  titleS: 'text · title',
};

export function BuffDrawerTuner() {
  const [cfg, setCfg] = useState<BuffDrawerConfig>(getBuffDrawerConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('buffdrawer');

  const set = (k: keyof BuffDrawerConfig, v: number): void => {
    setBuffDrawerValue(k, v);
    setCfg({ ...getBuffDrawerConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getBuffDrawerConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetBuffDrawerConfig(); setCfg({ ...getBuffDrawerConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Buffs Drawer <span>dev · live · open it</span></div>
      <div className="sfxmix-sub">Open the drawer to see changes</div>
      {BFD_NUM_KEYS.map((k) => {
        const [min, max, step] = BFD_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={BFD_DESC[k]}>{LABELS[k]}</span>
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
