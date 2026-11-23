import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useDraggablePanel } from '../../useDraggablePanel';
import { PackOpener, type PackQueueItem } from './PackOpener';
import { PACK_FEEL_KNOBS, getPackFeel, resetPackFeel, setPackFeel, subscribePackFeel } from './packFxConfig';
import type { PackLook } from '@game/progression';
import { PACK_LAB_LOOKS, PACK_LAB_SAMPLES, cancelLabTimers, makeLabOpen, type LabTimers, type PackLabSample } from './packLabSamples';

/**
 * THE PACK LAB (dev only; the only place the new pack opening is visible for now). Pick a sample pack and a look, press
 * Open, and the real `PackOpener` runs against it: the sample's `delayMs` is the server's answer time and `fail` is a
 * server error. Every tear / sleeve / flip knob is live (read by the scene every frame) and persisted by packFxConfig.
 * Slow-mo runs the scene and the DOM handoff at a quarter speed.
 */

const SLOW = 0.25;
const fillPct = (v: number, lo: number, hi: number): number => (hi > lo ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) : 0);

export function PackLabTuner(): JSX.Element {
  // The key MUST match DevMenu's, so the panel's own close button works.
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('packlab');
  const [feel, setFeel] = useState(getPackFeel);
  const [sampleId, setSampleId] = useState(PACK_LAB_SAMPLES[0]!.id);
  const [lookId, setLookId] = useState(PACK_LAB_LOOKS[0]!.id);
  const [slow, setSlow] = useState(false);
  const [run, setRun] = useState<{ n: number; queue: readonly PackQueueItem[]; sample: PackLabSample; look: PackLook } | null>(null);
  // Pending sample-delay timers: cleared on unmount, on close and before a new run, so none fires into a gone opener.
  const timersRef = useRef<LabTimers>(new Set());
  useEffect(() => { const t = timersRef.current; return () => cancelLabTimers(t); }, []);

  useEffect(() => subscribePackFeel(() => setFeel(getPackFeel())), []);

  const sample = PACK_LAB_SAMPLES.find((s) => s.id === sampleId) ?? PACK_LAB_SAMPLES[0]!;
  const look = PACK_LAB_LOOKS.find((l) => l.id === lookId) ?? PACK_LAB_LOOKS[0]!;

  const openPack = (): void => {
    cancelLabTimers(timersRef.current);
    setRun((prev) => ({ n: (prev?.n ?? 0) + 1, sample, look, queue: [{ packId: sample.result.packId, look }] }));
  };
  const closeRun = (): void => { cancelLabTimers(timersRef.current); setRun(null); };

  return (
    <div className="sfxmix tunerpanel" ref={panelRef} style={{ minWidth: 420, ...panelStyle }}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
        <span aria-hidden="true">🎴</span> <b>Pack Lab</b>
      </div>

      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name">Sample</span>
        <select value={sampleId} aria-label="Sample pack" onChange={(e) => setSampleId(e.target.value)}>
          {PACK_LAB_SAMPLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>
      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name">Look</span>
        <select value={lookId} aria-label="Pack look" onChange={(e) => setLookId(e.target.value)}>
          {PACK_LAB_LOOKS.map((l) => <option key={l.id} value={l.id}>{`${l.kind}: ${l.name}`}</option>)}
        </select>
      </div>
      <div className="lunge-btns">
        <button type="button" className="sfxmix-copy" onClick={openPack}>Open</button>
        <button type="button" className="sfxmix-copy" aria-pressed={slow} onClick={() => setSlow((v) => !v)}>
          {slow ? 'Slow-mo ON (0.25×)' : 'Slow-mo (0.25×)'}
        </button>
        <button type="button" className="sfxmix-copy" onClick={resetPackFeel}>Reset to defaults</button>
      </div>

      {PACK_FEEL_KNOBS.map((k) => {
        const value = feel[k.key];
        return (
          <div className="sfxmix-row tuner-row" key={k.key}>
            <span className="sfxmix-name">{k.label}</span>
            <input
              type="range"
              min={k.min}
              max={k.max}
              step={k.step}
              value={value}
              aria-label={k.label}
              style={{ '--fill': `${fillPct(value, k.min, k.max)}%` } as CSSProperties}
              onChange={(e) => setPackFeel({ [k.key]: Number(e.target.value) })}
            />
            <span className="sfxmix-val">{value}</span>
          </div>
        );
      })}

      {run && (
        <PackOpener
          key={run.n}
          queue={run.queue}
          open={makeLabOpen(run.sample, run.look, timersRef.current)}
          speed={slow ? SLOW : 1}
          onClose={closeRun}
        />
      )}
    </div>
  );
}
