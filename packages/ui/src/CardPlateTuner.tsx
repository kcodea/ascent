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
 * Those three sliders are NOT live like the other six: `Card` is `React.memo`'d (deliberately, for combat
 * perf — do not weaken it for this) and the bucket class is picked at render time from the card's own props,
 * so dragging bucketM/L/Xl won't visibly move an already-rendered hand card. The new threshold takes effect
 * the next time that card actually re-renders (a new card drawn, its live text changing, etc.) — drag a
 * slider, then draw/discard to see the new threshold applied.
 *
 * "Copy" grabs the JSON to paste back as the shipped defaults in `cardPlateConfig.ts` — and those MUST be
 * mirrored into the CSS `var(--plate-*, …)` fallbacks in styles.css. `cardPlateConfig.ts` itself DOES ship in
 * production (`Card.tsx` imports `plateTextBucket`), so `applyCardPlateVars()` sets `:root` from DEFAULTS there
 * too — but the CSS fallbacks are still the real rendering path whenever a var is missing, so keeping them in
 * sync matters. This tuner panel is dev-only and stripped from production.
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
      <div className="lunge-mod">text · shrink sliders apply on next hand change (Card is memoized) — draw/discard to see it</div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
