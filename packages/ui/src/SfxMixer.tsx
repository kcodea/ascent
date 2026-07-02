import { useState } from 'react';
import { SFX_KEYS, getSampleVolumes, previewSfx, setSampleVolume } from './sfx';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating SFX mixer. Tweak each sourced clip's volume live (it persists to localStorage so it
 * survives reloads), preview it with ▶, then "Copy values" to grab the whole map as JSON — paste it back
 * and the numbers become the shipped defaults (`SAMPLE_VOL_DEFAULTS` in sfx.ts). Panel-only: opened from
 * the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
export function SfxMixer() {
  const [vols, setVols] = useState(getSampleVolumes());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('sfx');

  const set = (k: string, v: number): void => {
    setSampleVolume(k, v);
    setVols(getSampleVolumes());
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getSampleVolumes(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="sfxmix" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>SFX Mixer <span>dev · drag</span></div>
      {SFX_KEYS.map((k) => {
        const pct = Math.round((vols[k] ?? 0) * 100);
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{k}</span>
            <input type="range" min={0} max={100} value={pct} onChange={(e) => set(k, Number(e.target.value) / 100)} />
            <span className="sfxmix-val">{pct}</span>
            <button className="sfxmix-play" onClick={() => previewSfx(k)} title={`Preview ${k}`}>▶</button>
          </div>
        );
      })}
      <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
    </div>
  );
}
