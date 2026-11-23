import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useDraggablePanel } from '../../useDraggablePanel';
import { PackOpener, type PackOpenOutcome, type PackQueueItem } from './PackOpener';
import { PACK_FEEL_KNOBS, getPackFeel, resetPackFeel, setPackFeel, subscribePackFeel } from './packFxConfig';
import { PACK_LAB_LOOKS, PACK_LAB_SAMPLES, withLook } from './packLabSamples';

/**
 * THE PACK LAB (dev only; the only place the new pack opening is visible for now). Pick a sample pack and a look, press
 * Open, and the real `PackOpener` runs against it: the sample's `delayMs` is the server's answer time and `fail` is a
 * server error. Every tear / sleeve / flip knob is live (read by the scene every frame) and persisted by packFxConfig.
 * Slow-mo runs the scene and the DOM handoff at a quarter speed.
 */

const SLOW = 0.25;
const SLEEP = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
const fillPct = (v: number, lo: number, hi: number): number => (hi > lo ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) : 0);

export function PackLabTuner(): JSX.Element {
  // The key MUST match DevMenu's, so the panel's own close button works.
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('packlab');
  const [feel, setFeel] = useState(getPackFeel);
  const [sampleId, setSampleId] = useState(PACK_LAB_SAMPLES[0]!.id);
  const [lookId, setLookId] = useState(PACK_LAB_LOOKS[0]!.id);
  const [slow, setSlow] = useState(false);
  const [run, setRun] = useState<{ n: number; queue: readonly PackQueueItem[]; sampleId: string } | null>(null);

  useEffect(() => subscribePackFeel(() => setFeel(getPackFeel())), []);

  const sample = PACK_LAB_SAMPLES.find((s) => s.id === sampleId) ?? PACK_LAB_SAMPLES[0]!;
  const look = PACK_LAB_LOOKS.find((l) => l.id === lookId) ?? PACK_LAB_LOOKS[0]!;

  const openPack = (): void => {
    setRun((prev) => ({ n: (prev?.n ?? 0) + 1, sampleId: sample.id, queue: [{ packId: sample.result.packId, look }] }));
  };

  const open = useCallback(async (): Promise<PackOpenOutcome> => {
    const s = PACK_LAB_SAMPLES.find((x) => x.id === run?.sampleId);
    if (!s) return { status: 'error', reason: 'no sample' };
    if (s.delayMs) await SLEEP(s.delayMs);
    if (s.fail) return { status: 'error', reason: 'lab: simulated failure' };
    return { status: 'ok', result: withLook(s.result, look) };
  }, [run?.sampleId, look]);

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
          open={open}
          speed={slow ? SLOW : 1}
          onClose={() => setRun(null)}
        />
      )}
    </div>
  );
}
