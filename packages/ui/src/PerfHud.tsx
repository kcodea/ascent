import { useCallback, useEffect, useRef, useState } from 'react';
import { perfMonitor, perfThresholds, type PerfBucket, type FrameThresholds } from './perfMonitor';
import { thresholdsFor } from './refreshRate';
import { useDraggablePanel } from './useDraggablePanel';
import { diagnose, type Diagnosis } from './perfDiagnose';
import { buildReport } from './perfReport';
import { saveRun, toRun } from './perfStore';
import { useGame } from './store';

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
 *
 * The long/jank thresholds are DERIVED from the measured refresh (see `refreshRate.ts`), so they are read
 * fresh from `perfThresholds()` on each bucket render rather than imported as constants — a 240 Hz display
 * warns at 8.33 ms where a 60 Hz one warns at 33.3. The `display` row shows which calibration is in force.
 */
const SPARK_H = 34;
/** How often (in closed buckets) the live diagnosis re-runs while the panel is open. See `live` below. */
const DIAGNOSE_EVERY = 5;

function color(worst: number, th: FrameThresholds): string {
  if (worst > th.jankMs) return '#e5446b'; // --threat
  if (worst > th.longFrameMs) return '#f0902e'; // --acc
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
    const th = perfThresholds();
    // Scale to the worst frame in view, floored at the jank threshold so a calm stretch doesn't amplify
    // ordinary noise into alarming peaks.
    const peak = Math.max(th.jankMs, ...hist.map((b) => b.worst));
    ctx.strokeStyle = 'rgba(42,32,23,0.22)'; // --ink at low alpha: the "dropped a frame" reference line
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    const yLong = SPARK_H - (th.longFrameMs / peak) * SPARK_H;
    ctx.moveTo(0, yLong);
    ctx.lineTo(w, yLong);
    ctx.stroke();
    ctx.setLineDash([]);
    const x0 = w - hist.length; // right-aligned: newest at the grip edge
    hist.forEach((b, i) => {
      const h = Math.max(1, (b.worst / peak) * SPARK_H);
      // Each column is coloured against the calibration that was in force WHEN IT WAS RECORDED — if the
      // detected refresh moved mid-session, recolouring the history to the new one would be a lie.
      ctx.fillStyle = b.hidden ? 'rgba(156,139,113,0.35)' : color(b.worst, thresholdsFor(b.hz));
      ctx.fillRect(x0 + i, SPARK_H - h, 1, h);
    });
  }, [bucket, open]);

  /**
   * THE LIVE VERDICT — the top finding for the session so far, on the HUD face.
   *
   * The old HUD showed only the CURRENT second, so reading it meant holding a minute of numbers in your head
   * and doing the diagnosis yourself. This runs the same engine the perf screen uses and prints its worst
   * finding in one line.
   *
   * Deliberately throttled and gated: `diagnose` walks every bucket, and a 40-minute session is 2400 of them.
   * It runs only while the panel is EXPANDED, and only every `DIAGNOSE_EVERY` buckets — so the collapsed HUD
   * costs exactly what it did before, and the expanded one pays a linear pass every few seconds rather than
   * every frame. A perf tool that shows up in its own measurements is worthless.
   */
  const [live, setLive] = useState<Diagnosis | null>(null);
  /** Buckets seen at the last diagnosis. A ref, not state, so throttling never re-runs the effect it gates. */
  const lastDiagRef = useRef(-1);
  useEffect(() => {
    if (!open || !bucket) return;
    const n = perfMonitor.history().length;
    if (lastDiagRef.current >= 0 && n - lastDiagRef.current < DIAGNOSE_EVERY) return;
    lastDiagRef.current = n;
    setLive(diagnose(perfMonitor.history()));
  }, [open, bucket]);

  const [saved, setSaved] = useState('');
  const save = useCallback(() => {
    const buckets = perfMonitor.history();
    if (buckets.length === 0) { setSaved('nothing recorded'); return; }
    const st = useGame.getState();
    const note = window.prompt('Label this recording (optional) — e.g. "after the sheen change"') ?? undefined;
    void saveRun(toRun(buckets, {
      id: `${Date.now()}`,
      startedAt: Date.now() - buckets.length * 1000,
      build: `${__APP_VERSION__}+${__BUILD_SHA__}`,
      mode: st.run?.mode,
      heroId: st.run?.heroId,
      note: note || undefined,
    })).then((ok) => {
      setSaved(ok ? '✓ saved' : 'storage unavailable');
      window.setTimeout(() => { setSaved(''); }, 2500);
    });
  }, []);

  /** The markdown report — the same artefact the perf screen copies, so both paths say the same thing. */
  const copy = useCallback(() => {
    const st = useGame.getState();
    const text = buildReport({
      buckets: perfMonitor.history(),
      meta: { build: `${__APP_VERSION__}+${__BUILD_SHA__}`, mode: st.run?.mode, heroId: st.run?.heroId },
    });
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, []);

  const b = bucket;
  // Re-read every bucket render (1/s), never cached: the detected refresh can move mid-session.
  const th = perfThresholds();
  const { detected } = perfMonitor.display;
  const marks = b ? Object.entries(b.marks).sort((x, y) => y[1] - x[1]) : [];
  // Measured spans this second, worst single call first — the attribution the marks alone can't give.
  const hot = b ? Object.entries(b.timings ?? {}).sort((x, y) => y[1].max - x[1].max).slice(0, 5) : [];

  return (
    <div className={`perfhud${open ? ' open' : ''}`} ref={panelRef} style={panelStyle}>
      <div className="perfhud-h drag" onPointerDown={headerPointerDown}>
        <span className="perfhud-title">◆ Perf</span>
        <span className="perfhud-fps" ref={fpsRef}>–</span>
        <span className="perfhud-unit">fps</span>
        <span className="perfhud-worst" style={{ color: color(b?.worst ?? 0, th) }}>
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
          {/* The calibration everything below is measured against — the thresholds are meaningless without
              it, and "60 Hz (assumed)" is the tell that no window has been measured yet. */}
          <Row
            k="display · budget"
            v={`${th.refreshHz.toFixed(0)} Hz${detected ? '' : ' (assumed)'} · ${th.frameMs.toFixed(2)} ms`}
          />
          <Row k="frame med / p95" v={b ? `${b.med.toFixed(1)} / ${b.p95.toFixed(1)} ms` : '–'} />
          <Row k="worst frame" v={b ? `${b.worst.toFixed(1)} ms` : '–'} warn={(b?.worst ?? 0) > th.longFrameMs} />
          <Row k={`long / jank (>${th.longFrameMs}/${th.jankMs}ms)`} v={b ? `${b.long} / ${b.jank}` : '–'} warn={(b?.jank ?? 0) > 0} />
          <Row k="longest task" v={b?.task ? `${b.task.toFixed(0)} ms` : '–'} warn={(b?.task ?? 0) > th.jankMs} />

          {/* THE HEADLINE. What the whole tool is for: one sentence naming the worst thing, and whether it is
              measured or merely correlated — a distinction that decides whether it is worth an afternoon. */}
          {live && !live.thin && live.verdicts[0] && (
            <div className={`perfhud-verdict sev-${live.verdicts[0].severity}`}>
              <b>{live.verdicts[0].title}</b>
              <span className={`perfhud-conf ${live.verdicts[0].confidence}`}>
                {live.verdicts[0].confidence === 'measured' ? 'measured' : 'lead'}
              </span>
              <i>{live.verdicts[0].suggestion}</i>
            </div>
          )}
          {live && !live.thin && (
            <Row
              k="session"
              v={`${live.seconds}s · worst ${live.worstFrame.toFixed(1)}ms · ${live.jankFrames} dropped`}
              warn={live.worstFrame > th.jankMs}
            />
          )}
          {/* Where the run's pain actually is. Two lines, worst phase first — the full table is on the screen. */}
          {live && live.phases.filter((p) => p.seconds >= 3).length > 1 && (
            <>
              <div className="perfhud-sub">Worst phases</div>
              {live.phases.filter((p) => p.seconds >= 3).slice(0, 2).map((p) => (
                <Row key={p.phase} k={p.phase} v={`${p.jankRate}/s dropped · worst ${p.worst.toFixed(1)}ms`}
                  warn={p.overBudget} />
              ))}
            </>
          )}

          <div className="perfhud-sub">Hotspots · measured</div>
          {hot.length === 0
            ? <div className="perfhud-empty">nothing measured this second</div>
            : hot.map(([k, v]) => (
              <Row key={k} k={`${k}${v.n > 1 ? ` ×${v.n}` : ''}`} v={`${v.max.toFixed(1)} ms`} warn={v.max > th.longFrameMs} />
            ))}

          <div className="perfhud-sub">Scene</div>
          {b && Object.entries(b.counts).map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
          <Row k="heap" v={b?.heapMb ? `${b.heapMb.toFixed(0)} MB` : 'n/a'} />
          <Row k="dom nodes" v={b ? String(b.nodes) : '–'} />
          <Row k="context" v={b ? `${b.phase ?? '–'}${b.wave !== undefined ? ` · wave ${b.wave}` : ''}` : '–'} />
          <Row k="marks" v={marks.length ? marks.map(([k, v]) => `${k}×${v}`).join(' ') : '–'} />

          <div className="perfhud-btns">
            <button onClick={copy} title="Copy a markdown report — findings, phases and worst moments — ready to paste to Claude">
              {copied ? '✓ copied' : '📋 report'}
            </button>
            <button onClick={save} title="Save this recording so the Perf Analytics screen can compare it against later ones">
              {saved || '💾 save'}
            </button>
            <button onClick={() => { useGame.getState().openPerf(); }} title="Open Perf Analytics — findings, phases, timeline, comparison">📈</button>
            <button onClick={() => perfMonitor.exportLog()} title="Download the full timeline as JSON">⬇</button>
            <button onClick={() => { perfMonitor.clear(); histRef.current = []; setLive(null); lastDiagRef.current = -1; }} title="Clear the timeline">↺</button>
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
