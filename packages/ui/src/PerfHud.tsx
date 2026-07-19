import { useCallback, useEffect, useRef, useState } from 'react';
import { perfMonitor, type PerfBucket, LONG_FRAME_MS, JANK_MS } from './perfMonitor';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * PERF HUD — the frame-health readout (owner ask 2026-07-19: "track slowdowns and what is causing it, and
 * log performance so we can triage over a game's length").
 *
 * Ships in the production build, dormant. Opt in with `?perf=1` (sticky), `localStorage.ascent.perf`, or
 * the dev menu. That's deliberate: `performance.md` requires confirming slowness against the prod build,
 * so a dev-only HUD would measure the wrong binary.
 *
 * Styled as one of the game's own floating panels (the `.sfxmix` language — parchment card, 2px `--line`
 * border, `--acc` orange accent, Outfit for chrome and tabular mono for numbers) and dragged/resized by the
 * shared `useDraggablePanel` hook, so position and size persist exactly like every tuner.
 *
 * **The HUD must not distort what it measures**, which shapes the component:
 * - It re-renders **once per second** (one bucket), not per frame. The big fps number is the exception and
 *   it's written via `textContent` on a ref — no React work.
 * - The sparkline is a `<canvas>` redrawn once per bucket, sized to the panel. 60 DOM nodes with animated
 *   heights would repaint every second for nothing.
 * - Everything is `transform`/`opacity` only, per the project perf rules.
 *
 * Reading it: **fps is a ceiling, not a score** — rAF is capped at the display refresh, so 60 means
 * "nothing dropped", not "fast". The numbers that find problems are worst-frame, the jank count, and
 * HOTSPOTS, which is measured time attributed to named code rather than correlation.
 */
const SPARK_H = 34;

function color(worst: number): string {
  if (worst > JANK_MS) return '#e5446b'; // --threat
  if (worst > LONG_FRAME_MS) return '#f0902e'; // --acc
  return '#1f9d6b'; // --tier-2 green
}

export function PerfHud({ onClose }: { onClose?: () => void }) {
  const [bucket, setBucket] = useState<PerfBucket | null>(perfMonitor.latest());
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<PerfBucket[]>([]);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('perfhud');

  // One re-render per closed bucket (1/s). The sparkline redraw rides the same tick.
  useEffect(() => perfMonitor.subscribe((b) => {
    histRef.current.push(b);
    if (histRef.current.length > 600) histRef.current.shift();
    setBucket(b);
  }), []);

  // The live fps digit updates faster than the bucket rate, but WITHOUT a React render — a direct
  // textContent write on a ref. Re-rendering the HUD 4×/s to move one number would be self-defeating.
  useEffect(() => {
    if (!perfMonitor.isRunning) return;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    const loop = (now: number): void => {
      frames++;
      if (now - last >= 250) {
        if (fpsRef.current) fpsRef.current.textContent = ((frames / (now - last)) * 1000).toFixed(0);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Sparkline of worst-frame-time per second — the shape that shows where the run got rough. Sized from
  // the canvas's own laid-out width so it follows the panel's resize grip instead of a fixed constant.
  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const w = Math.max(40, Math.floor(cv.clientWidth));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== w * dpr || cv.height !== SPARK_H * dpr) {
      cv.width = w * dpr;
      cv.height = SPARK_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, SPARK_H);
    const hist = histRef.current.slice(-w); // one column per pixel — the panel's width IS the time window
    // Scale to the worst frame in view, floored at the jank threshold so a calm stretch doesn't amplify
    // ordinary noise into alarming peaks.
    const peak = Math.max(JANK_MS, ...hist.map((b) => b.worst));
    ctx.strokeStyle = 'rgba(42,32,23,0.22)'; // --ink at low alpha: the "dropped a frame" reference line
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    const y33 = SPARK_H - (LONG_FRAME_MS / peak) * SPARK_H;
    ctx.moveTo(0, y33);
    ctx.lineTo(w, y33);
    ctx.stroke();
    ctx.setLineDash([]);
    const x0 = w - hist.length; // right-aligned: newest at the grip edge
    hist.forEach((b, i) => {
      const h = Math.max(1, (b.worst / peak) * SPARK_H);
      ctx.fillStyle = b.hidden ? 'rgba(156,139,113,0.35)' : color(b.worst);
      ctx.fillRect(x0 + i, SPARK_H - h, 1, h);
    });
  }, [bucket, open]);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(JSON.stringify(perfMonitor.summary(), null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, []);

  const b = bucket;
  const marks = b ? Object.entries(b.marks).sort((x, y) => y[1] - x[1]) : [];
  // Measured spans this second, worst single call first — the attribution the marks alone can't give.
  const hot = b ? Object.entries(b.timings ?? {}).sort((x, y) => y[1].max - x[1].max).slice(0, 5) : [];

  return (
    <div className={`perfhud${open ? ' open' : ''}`} ref={panelRef} style={panelStyle}>
      <div className="perfhud-h drag" onPointerDown={headerPointerDown}>
        <span className="perfhud-title">◆ Perf</span>
        <span className="perfhud-fps" ref={fpsRef}>–</span>
        <span className="perfhud-unit">fps</span>
        <span className="perfhud-worst" style={{ color: color(b?.worst ?? 0) }}>
          {b ? `${b.worst.toFixed(0)}ms` : '–'}
        </span>
        <button className="perfhud-x" onClick={() => setOpen((o) => !o)} title={open ? 'Collapse' : 'Expand'}>
          {open ? '▾' : '▸'}
        </button>
        {onClose && <button className="perfhud-x" onClick={onClose} title="Hide the HUD">✕</button>}
      </div>

      <canvas className="perfhud-spark" ref={canvasRef} height={SPARK_H} />

      {open && (
        <div className="perfhud-body">
          <Row k="frame med / p95" v={b ? `${b.med.toFixed(1)} / ${b.p95.toFixed(1)} ms` : '–'} />
          <Row k="worst frame" v={b ? `${b.worst.toFixed(1)} ms` : '–'} warn={(b?.worst ?? 0) > LONG_FRAME_MS} />
          <Row k={`long / jank (>${LONG_FRAME_MS}/${JANK_MS}ms)`} v={b ? `${b.long} / ${b.jank}` : '–'} warn={(b?.jank ?? 0) > 0} />
          <Row k="longest task" v={b?.task ? `${b.task.toFixed(0)} ms` : '–'} warn={(b?.task ?? 0) > JANK_MS} />

          <div className="perfhud-sub">Hotspots · measured</div>
          {hot.length === 0
            ? <div className="perfhud-empty">nothing measured this second</div>
            : hot.map(([k, v]) => (
              <Row key={k} k={`${k}${v.n > 1 ? ` ×${v.n}` : ''}`} v={`${v.max.toFixed(1)} ms`} warn={v.max > LONG_FRAME_MS} />
            ))}

          <div className="perfhud-sub">Scene</div>
          {b && Object.entries(b.counts).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
          <Row k="heap" v={b?.heapMb ? `${b.heapMb.toFixed(0)} MB` : 'n/a'} />
          <Row k="dom nodes" v={b ? String(b.nodes) : '–'} />
          <Row k="context" v={b ? `${b.phase ?? '–'}${b.wave !== undefined ? ` · wave ${b.wave}` : ''}` : '–'} />
          <Row k="marks" v={marks.length ? marks.map(([k, v]) => `${k}×${v}`).join(' ') : '–'} />

          <div className="perfhud-btns">
            <button onClick={() => perfMonitor.exportLog()} title="Download the full timeline as JSON">⬇ log</button>
            <button onClick={copy} title="Copy the rolled-up summary">{copied ? '✓ copied' : '⧉ summary'}</button>
            <button onClick={() => { perfMonitor.clear(); histRef.current = []; }} title="Clear the timeline">↺</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className={`perfhud-row${warn ? ' warn' : ''}`}>
      <span>{k}</span><b>{v}</b>
    </div>
  );
}
