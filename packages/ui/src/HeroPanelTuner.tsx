import { useState } from 'react';
import {
  HPN_KEYS,
  HPN_RANGES,
  HPN_DESC,
  getHeroPanelConfig,
  resetHeroPanelConfig,
  setHeroPanelValue,
  type HeroPanelConfig,
} from './heroPanelConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the HERO PANEL (`heroPanelConfig.ts` — the bottom-left tray). Every part gets
 * x/y/scale: the whole panel about its corner anchor, the portrait, the player-name pill, the hero-name
 * pill, and the Resolve box. Values persist to localStorage (dev-only) and apply LIVE via the composed
 * `--hpn-*-t` transform vars. "Copy" grabs the JSON to paste back as the shipped defaults in
 * `heroPanelConfig.ts`. Panel-only: opened from the Dev Tuning Menu; dev-only, stripped from production.
 * (The power diamond has its own 💠 tuner; quest badges live in the Layout Lab.)
 */
const LABELS: Record<keyof HeroPanelConfig, string> = {
  panelX: 'panel · x',
  panelY: 'panel · y',
  panelScale: 'panel · scale',
  panelW: 'square · width (0=snug)',
  panelH: 'square · height (0=snug)',
  portraitX: 'portrait · x',
  portraitY: 'portrait · y',
  portraitScale: 'portrait · scale',
  playerNameX: 'player name · x',
  playerNameY: 'player name · y',
  playerNameScale: 'player name · scale',
  heroNameX: 'hero name · x',
  heroNameY: 'hero name · y',
  heroNameScale: 'hero name · scale',
  resolveX: 'resolve · x',
  resolveY: 'resolve · y',
  resolveScale: 'resolve · scale',
};

export function HeroPanelTuner() {
  const [cfg, setCfg] = useState<HeroPanelConfig>(getHeroPanelConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('heropanel');

  const set = (k: keyof HeroPanelConfig, v: number): void => {
    setHeroPanelValue(k, v);
    setCfg({ ...getHeroPanelConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getHeroPanelConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetHeroPanelConfig(); setCfg({ ...getHeroPanelConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Hero Panel <span>dev · live · recruit phase</span></div>
      {HPN_KEYS.map((k) => {
        const [min, max, step] = HPN_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={HPN_DESC[k]}>{LABELS[k]}</span>
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
