import { useCallback, useEffect, useRef, useState } from 'react';
import { perfMonitor, type PerfBucket, LONG_FRAME_MS, JANK_MS } from './perfMonitor';

/**
 * PERF HUD — the bottom-right frame-health readout (owner ask 2026-07-19: "track slowdowns and what is
 * causing it, and log performance so we can triage over a game's length").
 *
 * Ships in the production build, dormant. Opt in with `?perf=1` (sticky) or `localStorage.ascent.perf`, or
 * from the dev menu. That's deliberate: `CLAUDE.md` requires confirming any slowness against the prod
 * build, so a dev-only HUD would measure the wrong thing.
 *
 * **The HUD must not distort what it measures**, which shapes the whole component:
 * - It re-renders **once per second** (one bucket), not per frame. The big FPS number is the only thing
 *   updated more often, and it's written via `textContent` on a ref — no React work.
 * - The sparkline is a small `<canvas>` redrawn once per bucket. 60 DOM nodes with animated heights would
 *   repaint the compositor layer every second for no reason.
 * - Everything is `transform`/`opacity` only, per the project perf rules — no animated paint properties.
 *
 * Reading it: **fps is a ceiling, not a score.** rAF is capped at the display refresh, so 60 means "nothing
 * is dropping", not "fast". The numbers that actually find problems are p95/worst frame time and the
 * long/jank counts, so those sit on the face. Bars turn amber over ~33ms (a dropped frame) and red over
 * ~50ms (a visible hitch).
 */
const W = 132;
const H = 30;

function color(worst: number): string {
  if (worst > JANK_MS) return '#ff5f56';
  if (worst > LONG_FRAME_MS) return '#ffbd2e';
  return '#4ad66d';
}

export function PerfHud({ onClose }: { onClose?: () => void }) {
  const [bucket, setBucket] = useState<PerfBucket | null>(perfMonitor.latest());
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const histRef = useRef<PerfBucket[]>([]);

  // One re-render per closed bucket (1/s). The sparkline redraw rides the same tick.
  useEffect(() => perfMonitor.subscribe((b) => {
    histRef.current.push(b);
    if (histRef.current.length > W) histRef.current.shift();
    setBucket(b);
  }), []);

  // The live fps digit updates faster than the bucket rate, but WITHOUT a React render — a direct
  // textContent write on a ref. Rendering the whole HUD 4×/s to move one number would be self-defeating.
  useEffect(() => {
    if (!perfMonitor.isRunning) return;
    let raf = 0;
    let last = performance.now();
    let frames = 0;
    const loop = (now: number): void => {
      frames++;
      if (now - last >= 250) {
        const fps = (frames / (now - last)) * 1000;
        if (fpsRef.current) fpsRef.current.textContent = fps.toFixed(0);
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Sparkline of worst-frame-time per second — the shape that shows where the run got rough.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const hist = histRef.current;
    // Scale to the worst frame in view, floored at 50ms so a calm stretch doesn't amplify noise into peaks.
    const peak = Math.max(JANK_MS, ...hist.map((b) => b.worst));
    // The 33ms "dropped a frame" line, so the bars have a reference.
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    const y33 = H - (LONG_FRAME_MS / peak) * H;
    ctx.moveTo(0, y33);
    ctx.lineTo(W, y33);
    ctx.stroke();
    hist.forEach((b, i) => {
      const h = Math.max(1, (b.worst / peak) * H);
      ctx.fillStyle = b.hidden ? 'rgba(255,255,255,0.12)' : color(b.worst);
      ctx.fillRect(i, H - h, 1, h);
    });
  }, [bucket]);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(JSON.stringify(perfMonitor.summary(), null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, []);

  const b = bucket;
  const marks = b ? Object.entries(b.marks).sort((x, y) => y[1] - x[1]) : [];

  return (
    <div className={`perfhud${open ? ' open' : ''}`}>
      <div className="perfhud-face" onClick={() => setOpen((o) => !o)} title="Click for detail">
        <span className="perfhud-fps" ref={fpsRef}>–</span>
        <span className="perfhud-unit">fps</span>
        <canvas className="perfhud-spark" ref={canvasRef} width={W} height={H} />
        <span className="perfhud-worst" style={{ color: color(b?.worst ?? 0) }}>
          {b ? `${b.worst.toFixed(0)}ms` : '–'}
        </span>
      </div>
      {open && (
        <div className="perfhud-detail">
          <Row k="frame med / p95" v={b ? `${b.med.toFixed(1)} / ${b.p95.toFixed(1)} ms` : '–'} />
          <Row k="worst frame" v={b ? `${b.worst.toFixed(1)} ms` : '–'} warn={(b?.worst ?? 0) > LONG_FRAME_MS} />
          <Row k={`long / jank (>${LONG_FRAME_MS}/${JANK_MS}ms)`} v={b ? `${b.long} / ${b.jank}` : '–'} warn={(b?.jank ?? 0) > 0} />
          <Row k="longest task" v={b?.task ? `${b.task.toFixed(0)} ms` : '–'} warn={(b?.task ?? 0) > JANK_MS} />
          {b && Object.entries(b.counts).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
          <Row k="heap" v={b?.heapMb ? `${b.heapMb.toFixed(0)} MB` : 'n/a'} />
          <Row k="dom nodes" v={b ? String(b.nodes) : '–'} />
          <Row k="context" v={b ? `${b.phase ?? '–'}${b.wave !== undefined ? ` · wave ${b.wave}` : ''}` : '–'} />
          <Row k="marks (this sec)" v={marks.length ? marks.map(([k, v]) => `${k}×${v}`).join(' ') : '–'} />
          <div className="perfhud-btns">
            <button onClick={() => perfMonitor.exportLog()} title="Download the full timeline as JSON">⬇ log</button>
            <button onClick={copy} title="Copy the rolled-up summary">{copied ? '✓' : '⧉ summary'}</button>
            <button onClick={() => { perfMonitor.clear(); histRef.current = []; }} title="Clear the timeline">↺</button>
            {onClose && <button onClick={onClose} title="Hide the HUD">✕</button>}
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
