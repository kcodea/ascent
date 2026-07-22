import { useState } from 'react';
import {
  EXECUTE_COLOR_GROUPS, EXECUTE_GROUPS, EXECUTE_RANGES, executeOverrides, getExecuteConfig,
  resetExecuteConfig, setExecuteValue, type ExecuteConfig,
} from './executeConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the EXECUTE (V) rage aura — the swirling ring of smoke, comet arcs, glints and
 * shards around an Execute card.
 *
 * Unlike the Ward tuner (which pokes CSS vars and lets the DOM sit still), the layer COUNTS here are dials, so
 * every change rebuilds the aura's DOM: `setExecuteValue` commits a fresh snapshot and each mounted card
 * re-renders through `useSyncExternalStore`. Live either way — you'll see it on any Execute card on screen.
 *
 * Persisted to localStorage; "Copy" grabs the JSON to paste into `DEFAULTS` in `executeConfig.ts`. There are NO
 * CSS fallbacks to update alongside it — the config module is the single source of truth for this effect
 * (see the note at the top of executeConfig.ts).
 *
 * Panel-only: opened from the Dev Tuning Menu; dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof ExecuteConfig, string> = {
  size: 'size × card',
  y: 'vertical centre %',
  sx: 'width × (±flips)',
  sy: 'height × (±flips)',
  pulse: 'breathe cycle s',
  pulseMin: 'breathe dip',
  smokeCount: 'blobs',
  smokeRadius: 'ring radius %',
  smokeSize: 'blob size %',
  smokeBlur: 'blur px',
  smokeA0: 'opacity low',
  smokeA1: 'opacity high',
  smokeSc0: 'scale low',
  smokeSc1: 'scale high',
  smokeSpin: 'ring spin s',
  smokePulse: 'blob pulse s',
  arcCount: 'arc rings',
  arcD: 'diameter × box',
  arcSx: 'arc width ×',
  arcSy: 'arc height ×',
  arcGap: 'ring spacing',
  arcThick: 'band thickness %',
  arcBlades: 'comets / ring',
  arcTail: 'tail °',
  arcEdge: 'leading edge °',
  arcAlpha: 'opacity',
  arcBlur: 'blur px',
  arcSpin: 'spin s',
  glintCount: 'glints',
  glintRadius: 'ring radius %',
  glintLen: 'spike length',
  glintThick: 'spike thickness',
  glintAlpha: 'opacity',
  glintSpin: 'twinkle s',
  shardCount: 'shards',
  shardRadius: 'ring radius %',
  shardSize: 'shard size px',
  shardTail: 'tail px',
  shardBlur: 'blur px',
  shardOut: 'drift out px',
  shardSweep: 'sweep °',
  shardAlpha: 'opacity',
  shardSpin: 'drift time s',
  smokeHot: 'smoke · hot core',
  smokeMid: 'smoke · mid body',
  arcColor: 'arc',
  glintColor: 'glint',
  shardColor: 'shard',
};

export function ExecuteTuner() {
  const [cfg, setCfg] = useState<ExecuteConfig>(getExecuteConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('execute');

  const set = (k: keyof ExecuteConfig, v: number | string): void => {
    setExecuteValue(k, v); // commits a new snapshot → every mounted Execute card rebuilds
    setCfg({ ...getExecuteConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getExecuteConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetExecuteConfig(); setCfg({ ...getExecuteConfig() }); };

  const overrides = executeOverrides();

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Execute Aura <span>dev · live · drag</span></div>

      {overrides.length > 0 && (
        <div className="lunge-mod">
          MODIFIED ({overrides.length}): {overrides.map((k) => LABELS[k]).join(', ')}
        </div>
      )}

      {EXECUTE_GROUPS.map((g) => (
        <div className="lunge-sec" key={g.title}>
          <div className="lunge-sec-h">{g.title}</div>
          {g.keys.map((k) => {
            const [min, max, step] = EXECUTE_RANGES[k];
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

      {EXECUTE_COLOR_GROUPS.map((g) => (
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
