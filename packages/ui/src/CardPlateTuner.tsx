import { useState } from 'react';
import {
  PLATE_KEYS,
  PLATE_RANGES,
  PLATE_DESC,
  getCardPlateConfig,
  resetCardPlateConfig,
  setCardPlateValue,
  type CardPlateConfig,
} from './cardPlateConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the HAND CARD BACKPLATE (`cardPlateConfig.ts`). Dials the plate's geometry
 * (width × card width, vertical offset, corner radius), the rules-text shrink thresholds, and the placeholder
 * dissolve. Values persist to localStorage and apply LIVE via `--plate-*` CSS vars.
 *
 * The text-bucket sliders are character counts, not sizes: lower them to make text shrink SOONER. They're
 * conservative by default because character count is a proxy for wrapped height — long-word text wraps taller
 * than short-word text at the same length.
 *
 * "Copy" grabs the JSON to paste back as the shipped defaults in `cardPlateConfig.ts` — and those MUST be
 * mirrored into the CSS `var(--plate-*, …)` fallbacks in styles.css, because production doesn't import this
 * module and renders from the fallback. Panel-only: opened from the Dev Tuning Menu; dev-only, so it's
 * stripped from production.
 */
const LABELS: Record<keyof CardPlateConfig, string> = {
  scale: 'plate · width',
  top: 'plate · y offset',
  radius: 'plate · corner radius',
  bucketM: 'text · shrink at (m)',
  bucketL: 'text · shrink at (l)',
  bucketXl: 'text · shrink at (xl)',
  puffMs: 'dissolve · duration',
  puffScale: 'dissolve · growth',
  puffDust: 'dissolve · dust',
};

export function CardPlateTuner() {
  const [cfg, setCfg] = useState<CardPlateConfig>(getCardPlateConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('cardplate');

  const set = (k: keyof CardPlateConfig, v: number): void => {
    setCardPlateValue(k, v);
    setCfg({ ...getCardPlateConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getCardPlateConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetCardPlateConfig(); setCfg({ ...getCardPlateConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Card Plate <span>dev · live · hand cards</span></div>
      {PLATE_KEYS.map((k) => {
        const [min, max, step] = PLATE_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={PLATE_DESC[k]}>{LABELS[k]}</span>
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
