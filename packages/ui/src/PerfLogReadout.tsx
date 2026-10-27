import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PERF_READOUT_ON } from './perfLogFlag';
import { perfLogActive, perfLogView, uploadPerfNow, type PerfLogView } from './phonePerfLog';
import { stageHost } from './stage';
import './perfLog.css';

/**
 * The phone perf log's readout (R-PHONE-PERFLOG-01): `?perflog=1` (remembered until `?perflog=0`). Frames per scene
 * (p50 / p95 / p99 / worst, frames over 16.7 and 33.3 ms), the WebGL contexts and Pixi renderers, the effects asked for
 * against the ones that drew and the worst misses, and Send (upload now). Refreshes every 2 s, never per frame.
 * Portalled into the stage host like the crash log, counter-scaled in perfLog.css.
 */
export function PerfLogReadout(): React.ReactElement | null {
  const [open, setOpen] = useState(PERF_READOUT_ON && perfLogActive());
  const [v, setV] = useState<PerfLogView | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    setV(perfLogView());
    const id = window.setInterval(() => setV(perfLogView()), 2000);
    return () => window.clearInterval(id);
  }, [open]);
  if (!open || !v || typeof document === 'undefined') return null;
  const gl = v.gl;
  return createPortal(
    <div className="perflog" role="status">
      <div className="perflog-head">
        <span>Perf {Math.round(v.durS)} s, {v.frames} frames, {Math.round(v.hz)} Hz{v.hzDetected ? '' : '?'}</span>
        <button type="button" className="perflog-btn" disabled={sending} onClick={() => { setSending(true); void uploadPerfNow().finally(() => { setSending(false); setV(perfLogView()); }); }}>
          {sending ? 'Sending' : 'Send'}
        </button>
        <button type="button" className="perflog-btn" aria-label="Hide the perf log" onClick={() => setOpen(false)}>✕</button>
      </div>
      <table className="perflog-table">
        <thead><tr><th>scene</th><th>s</th><th>p50</th><th>p95</th><th>p99</th><th>worst</th><th>&gt;17</th><th>&gt;33</th></tr></thead>
        <tbody>
          {v.scenes.map(({ scene, sum }) => (
            <tr key={scene}><td>{scene}</td><td>{Math.round(sum.s)}</td><td>{sum.p50}</td><td>{sum.p95}</td><td>{sum.p99}</td><td>{Math.round(sum.worst)}</td><td>{sum.o17}</td><td>{sum.o33}</td></tr>
          ))}
        </tbody>
      </table>
      {gl && <div className="perflog-line">WebGL {gl.alive} alive of {gl.made} made, {gl.mb} MB, lost {gl.lostEvents} / restored {gl.restoredEvents}{gl.lostNow ? `, ${gl.lostNow} LOST IN PAGE` : ''}</div>}
      {v.pixi && <div className="perflog-line">Pixi {v.pixi.alive.map((a) => `${a.label} ${a.bw}x${a.bh} r${a.res}${a.lost ? ' LOST' : ''}`).join('; ') || 'none'}</div>}
      <div className="perflog-line">Images {v.imgMb} MB ({v.imgUniqueMb} MB distinct){v.audioMb !== null ? `, audio ${v.audioMb} MB` : ''}{v.heap !== null ? `, heap ${v.heap} MB` : ''}</div>
      <div className="perflog-line">FX asked {v.fx.req}, drew {v.fx.started}, missed {v.fx.missed}</div>
      {v.fx.top.length > 0 && <ol className="perflog-miss">{v.fx.top.map((m) => <li key={m.kind}><b>{m.kind}</b> {m.why}</li>)}</ol>}
      {v.upload && <div className="perflog-line">{v.upload}</div>}
    </div>,
    stageHost(),
  );
}
