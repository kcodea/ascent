import { useState } from 'react';
import {
  EXECUTEFX_COLOR_GROUPS, EXECUTEFX_GROUPS, EXECUTEFX_RANGES, executeFxOverrides, getExecuteFxConfig,
  resetExecuteFxConfig, setExecuteFxValue, type ExecuteFxConfig,
} from './executeFxConfig';
import { pixiFx } from './pixiFx';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the EXECUTION STRIKE — the one-shot crescent slash when an Execute (`V`) minion
 * procs and destroys its target.
 *
 * The config is read at FIRE TIME, so there's nothing to reflect or re-render: change a dial, hit **Test**, and
 * the next strike uses it. Test fires at screen centre (`pixiFx.testExecute()`), so the look can be dialled
 * without hunting for a real proc mid-combat.
 *
 * Persisted to localStorage; "Copy" grabs the JSON to paste into `DEFAULTS` in `executeFxConfig.ts`.
 *
 * Panel-only: opened from the Dev Tuning Menu; dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof ExecuteFxConfig, string> = {
  power: 'overall size ×',
  arcCount: 'cuts',
  arcSize: 'size px',
  arcGrow: 'expand ×',
  arcLife: 'life ms',
  arcTilt: 'tilt °',
  arcSpread: 'tilt spread °',
  arcSpin: 'sweep °/s',
  arcAlpha: 'opacity',
  arcSweep: 'arc length °',
  arcThick: 'thickness px',
  flashSize: 'size px',
  flashLife: 'life ms',
  flashAlpha: 'opacity',
  emberCount: 'embers',
  emberSpeed: 'speed px/s',
  emberSize: 'size px',
  emberLife: 'life ms',
  emberSpread: 'spread °',
  emberGravity: 'gravity',
  bloodCount: 'droplets',
  bloodSpeed: 'speed px/s',
  bloodSize: 'size px',
  bloodLife: 'life ms',
  bloodSpread: 'spread °',
  bloodGravity: 'gravity',
  tailColor: 'crescent · tail',
  midColor: 'crescent · mid',
  tipColor: 'crescent · tip',
  flashColor: 'core flash',
  emberColor: 'embers',
  bloodColor: 'blood',
};

export function ExecuteFxTuner() {
  const [cfg, setCfg] = useState<ExecuteFxConfig>(getExecuteFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('executefx');

  const set = (k: keyof ExecuteFxConfig, v: number | string): void => {
    setExecuteFxValue(k, v);
    setCfg({ ...getExecuteFxConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getExecuteFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetExecuteFxConfig(); setCfg({ ...getExecuteFxConfig() }); };

  const overrides = executeFxOverrides();

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Execute Strike <span>dev · drag</span></div>

      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={() => pixiFx.testExecute()}>▶ Test strike</button>
      </div>

      {overrides.length > 0 && (
        <div className="lunge-mod">
          MODIFIED ({overrides.length}): {overrides.map((k) => LABELS[k]).join(', ')}
        </div>
      )}

      {EXECUTEFX_GROUPS.map((g) => (
        <div className="lunge-sec" key={g.title}>
          <div className="lunge-sec-h">{g.title}</div>
          {g.keys.map((k) => {
            const [min, max, step] = EXECUTEFX_RANGES[k];
            return (
              <div className="sfxmix-row" key={k}>
                <span className="sfxmix-name">{LABELS[k]}</span>
                <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
                <span className="sfxmix-val">{cfg[k]}</span>
              </div>
            );
          })}
        </div>
      ))}

      {EXECUTEFX_COLOR_GROUPS.map((g) => (
        <div className="lunge-sec" key={g.title}>
          <div className="lunge-sec-h">{g.title}</div>
          {g.keys.map((k) => (
            <div className="sfxmix-row" key={k}>
              <span className="sfxmix-name">{LABELS[k]}</span>
              <input type="color" value={cfg[k]} onChange={(e) => set(k, e.target.value)} />
              <span className="sfxmix-val">{cfg[k]}</span>
            </div>
          ))}
        </div>
      ))}

      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
