import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { perfMonitor, perfThresholds, type PerfBucket, type FrameThresholds } from './perfMonitor';
import { captureStats, graphColumns, rollingStats, topOffenders, type Offender } from './perfLive';
import { displaySubject, phaseName, plainSubject, shortName } from './perfNames';
import { DevPanelContext, useDraggablePanel } from './useDraggablePanel';
import { diagnose, whatIsSlow, type Diagnosis } from './perfDiagnose';
import { buildReport } from './perfReport';
import { saveRun, toRun } from './perfStore';
import { useGame } from './store';

/**
 * PERF HUD — the LIVE MONITOR (owner ask 2026-09-15: *"our performance HUD and analytics are not
 * functioning well. Take a deep pass at improving them so there is a LIVE MONITORING screen … we're
 * currently BLIND to what's causing it"*). Earlier asks it still honours: 2026-07-19 ("track slowdowns and
 * what is causing it"), 2026-08-29 ("point at cards or mechanics or effects"), 2026-08-30 (in-game names).
 *
 * A floating panel the owner leaves open while playing. Top to bottom:
 *
 *   · **the rolling graph** — the last ten seconds at FRAME resolution (one pixel column = ~10 s / width),
 *     each column the WORST frame in it (§0: a dropped frame must never be averaged away), against the
 *     per-frame budget line and the long-frame line, with dropped-frame ticks along the top, warm-up
 *     stretches shaded, and a phase strip (shop / combat / runeforge) along the bottom;
 *   · **two stat rows** — the rolling window and the whole capture, each `worst · p95 · long · jank`;
 *   · **top offenders** — labels ranked by their SELF time inside the frames that dropped (`perfLive.ts`),
 *     for the window or the capture. This list is the answer to "what is slow";
 *   · **the verdict** — `whatIsSlow`'s one plain-English line from those offenders;
 *   · **the counter strip** — particles, def layers, filters, sprite pool, unit renders;
 *   · details (calibration, longest task, heap, DOM, context, marks) and the capture / share buttons.
 *
 * Ships in the production build, dormant — `?perf=1`, `localStorage.ascent.perf`, or the dev menu — because
 * `docs/performance.md` requires judging slowness on the prod build. Recording is independent of the HUD.
 *
 * **THE HUD MUST COST NOTHING MEASURABLE**, which shapes every line below:
 * - No React render per frame. React renders ONCE PER SECOND (one bucket) for the offenders list and the
 *   details; the header numbers and the stat rows are `textContent` writes on refs at 4 Hz.
 * - The graph is a `<canvas>` redrawn at ≤ 30 Hz from the monitor's frame ring, read in place (no copy).
 * - No layout reads per frame: the canvas width comes from a `ResizeObserver`, never `clientWidth` in the
 *   loop. Nothing here animates.
 * - Styled as one of the game's floating panels and dragged / resized by `useDraggablePanel`.
 */
const GRAPH_H = 78;
/** The rolling window the graph and the "10 s" row cover. */
const WINDOW_MS = 10_000;
/** Redraw cap for the graph and the text-write cadence for the numbers. */
const DRAW_MS = 33;
const STATS_MS = 250;
/** How often (in closed buckets) the whole-capture diagnosis re-runs while the details are open. */
const DIAGNOSE_EVERY = 5;
/** Buckets kept for the rolling offenders window (~10 s). */
const WINDOW_BUCKETS = 10;
/** Phase strip colours by `PHASE_CODES` (0 none, 1 shop, 2 combat, 3 runeforge, 4 end). */
const PHASE_COLORS = ['transparent', '#3d7ad6', '#e5446b', '#b784f0', '#8f9099'];
const PHASE_LABELS = ['', 'shop', 'combat', 'runeforge', 'end'];

function color(ms: number, th: FrameThresholds): string {
  if (ms > th.jankMs) return '#e5446b';      // --threat
  if (ms > th.longFrameMs) return '#f0902e'; // --acc
  if (ms > th.frameMs) return '#c8922e';     // over budget, not yet a dropped frame
  return '#1f9d6b';                          // --tier-2 green
}
const fmt = (n: number): string => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const ms1 = (n: number): string => n.toFixed(1);

/**
 * The panel proper. It carries NO close of its own: the ✕ is the one `useDraggablePanel` injects, wired
 * through the provider in `PerfHud` below.
 */
function PerfHudPanel() {
  const [bucket, setBucket] = useState<PerfBucket | null>(perfMonitor.latest());
  const [open, setOpen] = useState(true);
  /** MINIMIZED folds the panel to its title bar — graph and body both go. Distinct from `open`, which only
   *  collapses the detail rows: minimized is "get out of the way", collapsed is "just the monitor". */
  const [min, setMin] = useState(false);
  const [scope, setScope] = useState<'window' | 'capture'>('window');
  const [copied, setCopied] = useState(false);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const worstRef = useRef<HTMLSpanElement>(null);
  const warmRef = useRef<HTMLSpanElement>(null);
  const rollRef = useRef<HTMLElement>(null);
  const countersRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The canvas's CSS width, kept by a ResizeObserver so the draw loop never reads layout. */
  const canvasWRef = useRef(0);
  const histRef = useRef<PerfBucket[]>([]);
  const { panelRef, panelElRef, headerPointerDown, panelStyle } = useDraggablePanel('perfhud');

  // One re-render per closed bucket (1/s). The offenders list, the capture row and the details ride it.
  useEffect(() => perfMonitor.subscribe((b) => {
    histRef.current.push(b);
    if (histRef.current.length > WINDOW_BUCKETS) histRef.current.shift();
    setBucket(b);
  }), []);

  // Canvas width without a per-frame layout read: observed once, on resize only.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || min) return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) canvasWRef.current = Math.max(40, Math.floor(e.contentRect.width));
    });
    ro.observe(cv);
    return () => { ro.disconnect(); };
  }, [min]);

  /**
   * THE LIVE LOOP. One rAF while the monitor runs; two throttles inside it. The graph redraws at ≤ 30 Hz
   * from the frame ring; the fps / worst / warm-up / rolling-stats / counter texts update at 4 Hz. Nothing
   * in here touches React state.
   */
  // Not gated on `perfMonitor.isRunning`: this is a CHILD of `Game`, so its effects run before the parent's
  // `perfMonitor.start()` — a guard here saw a stopped monitor at mount and the HUD came up frozen at "– fps".
  // The loop is cheap and the HUD is opt-in; while it is open, it runs.
  useEffect(() => {
    if (min) return undefined;
    let raf = 0;
    let lastDraw = 0;
    let lastStats = 0;
    let frames = 0;
    const loop = (now: number): void => {
      frames++;
      if (now - lastDraw >= DRAW_MS) {
        lastDraw = now;
        drawGraph(canvasRef.current, canvasWRef.current, now);
      }
      if (now - lastStats >= STATS_MS) {
        const span = now - lastStats;
        lastStats = now;
        const th = perfThresholds();
        const roll = rollingStats(perfMonitor.frameRing(), now - WINDOW_MS, th);
        if (fpsRef.current) fpsRef.current.textContent = ((frames / span) * 1000).toFixed(0);
        frames = 0;
        if (worstRef.current) {
          // The worst frame of the LAST SECOND, so the header number moves with what you just felt.
          const last = rollingStats(perfMonitor.frameRing(), now - 1000, th);
          worstRef.current.textContent = `${last.worst.toFixed(1)}ms`;
          worstRef.current.style.color = color(last.worst, th);
        }
        if (warmRef.current) {
          const w = perfMonitor.warmupState();
          warmRef.current.textContent = w.active
            ? `warm-up · ${w.reason} ${w.remainingMs > 0 ? `${(w.remainingMs / 1000).toFixed(1)}s` : `${w.framesLeft}f`}`
            : '';
        }
        if (rollRef.current) {
          rollRef.current.textContent = roll.frames === 0
            ? '–'
            : `${ms1(roll.worst)} · ${ms1(roll.p95)} · ${roll.long} · ${roll.jank}${roll.warm ? ` (${roll.warm}f warm)` : ''}`;
          rollRef.current.style.color = roll.jank > 0 ? '#ff7a90' : roll.long > 0 ? '#f0902e' : '#fff';
        }
        if (countersRef.current) {
          const c = perfMonitor.counterSnapshot();
          const parts: string[] = [];
          const add = (key: string, label: string): void => { if (c[key] !== undefined) parts.push(`${label} ${fmt(c[key]!)}`); };
          add('fx:particles', 'particles');
          add('fx:layers', 'layers');
          add('fx:filters', 'filters');
          add('sprite pool', 'sprites');
          add('weld rings', 'welds');
          countersRef.current.textContent = parts.length ? parts.join(' · ') : 'no FX counters registered';
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [min]);

  /**
   * THE SESSION FINDING for the whole capture — the top finding from the same engine the perf screen uses.
   * Throttled and gated as before: only while the panel is EXPANDED, and only every `DIAGNOSE_EVERY` buckets,
   * because `diagnose` walks every bucket and a 40-minute session is 2400 of them.
   */
  const [live, setLive] = useState<Diagnosis | null>(null);
  const lastDiagRef = useRef(-1);
  useEffect(() => {
    if (!open || !bucket) return;
    const n = perfMonitor.history().length;
    if (lastDiagRef.current >= 0 && n - lastDiagRef.current < DIAGNOSE_EVERY) return;
    lastDiagRef.current = n;
    setLive(diagnose(perfMonitor.history(), displaySubject));
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
    }, perfMonitor.startups())).then((ok) => {
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
      startups: perfMonitor.startups(),
    });
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  }, []);

  /**
   * HEAL A FOLDED HEIGHT SAVED BY THE BROKEN BUILD (2026-08-29). Minimizing used to let the ResizeObserver
   * persist the folded 44px as the panel's SIZE, so anyone who minimized once reopened the HUD as a sliver.
   * A stored height too short to be a real panel is dropped; the hook then falls back to the CSS size.
   */
  useEffect(() => {
    const el = panelElRef.current;
    if (!el) return;
    const h = parseFloat(el.style.height || '0');
    if (h > 0 && h < 120) {
      el.style.height = '';
      try {
        const k = 'ascent.devpanel.perfhud';
        const saved = JSON.parse(localStorage.getItem(k) ?? '{}') as { height?: number };
        delete saved.height;
        localStorage.setItem(k, JSON.stringify(saved));
      } catch { /* storage unavailable — the inline clear above is still the fix that matters */ }
    }
  }, [panelElRef]);

  /** THE FOLD, done imperatively, because `useDraggablePanel` owns the size imperatively (see 2026-08-29). */
  const heightBeforeMin = useRef<string>('');
  useEffect(() => {
    const el = panelElRef.current;
    if (!el) return;
    if (min) {
      heightBeforeMin.current = el.style.height;
      el.style.height = 'auto';
      return () => { if (heightBeforeMin.current) el.style.height = heightBeforeMin.current; };
    }
    if (heightBeforeMin.current) { el.style.height = heightBeforeMin.current; heightBeforeMin.current = ''; }
    return undefined;
  }, [min, panelElRef]);

  const b = bucket;
  // Re-read every bucket render (1/s), never cached: the detected refresh can move mid-session.
  const th = perfThresholds();
  const { detected } = perfMonitor.display;
  const marks = b ? Object.entries(b.marks).sort((x, y) => y[1] - x[1]) : [];
  // Whole-capture numbers and the offenders, once a second. `capture` scope walks every bucket; the window
  // scope walks ten. Both are O(buckets × labels) and happen at 1 Hz only while the panel is open.
  const cap = useMemo(() => captureStats(perfMonitor.history()), [b]);
  const offenders = useMemo<Offender[]>(
    () => topOffenders(scope === 'window' ? histRef.current : perfMonitor.history(), 6),
    [b, scope],
  );
  const verdict = useMemo(
    () => whatIsSlow(scope === 'window' ? histRef.current : perfMonitor.history(), plainSubject),
    [b, scope],
  );
  const startups = perfMonitor.startups();
  const lastStartup = startups[startups.length - 1];
  const windowLong = histRef.current.reduce((a, x) => a + (x.hidden ? 0 : x.long), 0);

  return (
    <div
      className={`perfhud${open ? ' open' : ''}${min ? ' min' : ''}`}
      ref={panelRef}
      style={panelStyle}
    >
      <div className="perfhud-h drag" onPointerDown={headerPointerDown}>
        <span className="perfhud-title">◆ Perf</span>
        <span className="perfhud-warm" ref={warmRef} title="Frames after a phase start are diverted to a startup record until the warm-up passes (docs/performance.md)" />
        <span className="perfhud-fps" ref={fpsRef}>–</span>
        <span className="perfhud-unit">fps</span>
        <span className="perfhud-worst" ref={worstRef} title="Worst frame in the last second">–</span>
        {/* THE CONTROLS SIT INSIDE THE DRAG HANDLE, so each one has to stop `pointerdown` reaching it (owner
            report 2026-08-29): the header captures the pointer to drag the panel, and a captured pointer never
            delivers the click that follows. */}
        <button
          className="perfhud-x"
          onPointerDown={(e) => { e.stopPropagation(); }}
          onClick={() => { setMin((m) => !m); }}
          title={min ? 'Expand the panel' : 'Minimize to the title bar'}
          aria-label={min ? 'Expand' : 'Minimize'}
        >{min ? '▢' : '—'}</button>
        <button
          className="perfhud-x"
          onPointerDown={(e) => { e.stopPropagation(); }}
          onClick={() => { setOpen((o) => !o); }}
          title={open ? 'Collapse the details' : 'Show the details'}
          aria-label={open ? 'Collapse details' : 'Show details'}
        >{open ? '▾' : '▸'}</button>
        {/* NO ✕ HERE — `useDraggablePanel` injects one, wired through the provider in `PerfHud`. */}
      </div>

      {!min && (
        <>
          <canvas className="perfhud-graph" ref={canvasRef} height={GRAPH_H} title="Last 10 s, one column per pixel = the worst frame in that slice. Dashed: per-frame budget. Dotted: dropped-frame line. Ticks on top: a dropped frame. Shaded: warm-up." />
          <div className="perfhud-legend">
            <span><i style={{ background: PHASE_COLORS[1] }} />{PHASE_LABELS[1]}</span>
            <span><i style={{ background: PHASE_COLORS[2] }} />{PHASE_LABELS[2]}</span>
            <span><i style={{ background: PHASE_COLORS[3] }} />{PHASE_LABELS[3]}</span>
            <span className="perfhud-legend-budget">budget {th.frameMs.toFixed(2)} · long {ms1(th.longFrameMs)} · jank {ms1(th.jankMs)} ms</span>
          </div>
          <div className="perfhud-stats">
            <div className="perfhud-row" title="Rolling window: worst · p95 · frames over the long line · frames over the jank line">
              <span>10 s · worst · p95 · long · jank</span><b ref={rollRef}>–</b>
            </div>
            <div className="perfhud-row" title="Whole capture (warm-ups excluded): worst · p95 (median of per-second p95s) · long · jank">
              <span>capture {cap.seconds}s</span>
              <b style={{ color: cap.jank > 0 ? '#ff7a90' : cap.long > 0 ? '#f0902e' : '#fff' }}>
                {cap.seconds ? `${ms1(cap.worst)} · ${ms1(cap.p95)} · ${cap.long} · ${cap.jank}` : '–'}
              </b>
            </div>
          </div>
        </>
      )}

      {open && !min && (
        <div className="perfhud-body">
          {/* TOP OFFENDERS — who owns the dropped frames. Self time inside long frames, ranked. */}
          <div className="perfhud-sub perfhud-sub-tabs">
            <span>Top offenders · self time in dropped frames</span>
            <button className={scope === 'window' ? 'on' : ''} onClick={() => { setScope('window'); }}>10 s</button>
            <button className={scope === 'capture' ? 'on' : ''} onClick={() => { setScope('capture'); }}>capture</button>
          </div>
          {offenders.length === 0
            ? (
              <div className="perfhud-empty">
                {(scope === 'window' ? windowLong : cap.long) === 0
                  ? `no dropped frames in the ${scope === 'window' ? 'last 10 s' : 'capture'}`
                  : 'frames dropped, but nothing instrumented ran in them — the cost is in render / paint / GC (docs/performance.md §3)'}
              </div>
            )
            : (
              <div className="perfhud-off">
                {offenders.map((o) => (
                  <div key={o.label} className="perfhud-off-row" title={`${o.label} — ${o.ms.toFixed(1)} ms self time across ${o.frames} dropped frame(s); ${o.n} call(s); worst call ${o.maxMs.toFixed(1)} ms`}>
                    <i style={{ width: `${Math.round(o.share * 100)}%` }} />
                    <span>{shortName(o.label)}</span>
                    <b>{Math.round(o.share * 100)}%</b>
                    <b>{ms1(o.avgMs)}<small>ms/f</small></b>
                    <b>{ms1(o.maxMs)}<small>max</small></b>
                  </div>
                ))}
              </div>
            )}
          {/* THE VERDICT — the one line that answers "what is slow", from the offenders + counters. */}
          {verdict && (
            <div className={`perfhud-verdict sev-${verdict.severity}`}>
              <b>{verdict.title}</b>
              {verdict.detail && <i>{verdict.detail}</i>}
            </div>
          )}

          <div className="perfhud-sub">Scene</div>
          <div className="perfhud-counters" ref={countersRef}>–</div>
          {b && (
            <Row
              k="renders this second"
              v={`units ${b.counts['unit renders'] ?? 0} · recruit ${b.counts['recruit renders'] ?? 0} · moves ${b.counts.pointermoves ?? 0}`}
            />
          )}
          {lastStartup && (
            <Row
              k={`last startup · ${lastStartup.reason}`}
              v={`${ms1(lastStartup.worst)} ms worst · ${lastStartup.frames}f · ${lastStartup.long} long`}
              title="The most recent warm-up's diverted spike — recorded, but excluded from the graph and the verdict"
            />
          )}

          <div className="perfhud-sub">Details</div>
          <Row
            k="display · budget"
            v={`${th.refreshHz.toFixed(0)} Hz${detected ? '' : ' (assumed)'} · ${th.frameMs.toFixed(2)} ms`}
          />
          <Row k="longest task" v={b?.task ? `${b.task.toFixed(0)} ms` : '–'} warn={(b?.task ?? 0) > th.jankMs} />
          {live && !live.thin && live.verdicts[0] && (
            <Row k="session finding" v={live.verdicts[0].title} warn={live.verdicts[0].severity !== 'info'} title={live.verdicts[0].suggestion} />
          )}
          <Row k="heap" v={b?.heapMb ? `${b.heapMb.toFixed(0)} MB` : 'n/a'} />
          <Row k="dom nodes" v={b ? String(b.nodes) : '–'} />
          <Row k="context" v={b ? `${b.phase ? phaseName(b.phase) : '–'}${b.wave !== undefined ? ` · wave ${b.wave}` : ''}` : '–'} />
          <Row k="marks" v={marks.length ? marks.map(([k, v]) => `${shortName(k)}×${v}`).join(' ') : '–'} />

          <div className="perfhud-btns">
            <button onClick={copy} title="Copy a markdown report — offenders, findings, phases, worst moments — ready to paste to Claude">
              {copied ? '✓ copied' : '📋 report'}
            </button>
            <button onClick={save} title="Save this recording so the Perf Analytics screen can compare it against later ones">
              {saved || '💾 save'}
            </button>
            <button onClick={() => { useGame.getState().openPerf(); }} title="Open Perf Analytics — findings, phases, timeline, comparison">📈</button>
            <button onClick={() => perfMonitor.exportLog()} title="Download the full timeline as JSON">⬇</button>
            <button onClick={() => { perfMonitor.clear(); histRef.current = []; setLive(null); lastDiagRef.current = -1; setBucket(null); }} title="Clear the timeline">↺</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The rolling graph. Reads the monitor's frame ring in place, folds it into one column per CSS pixel, and
 * paints: warm-up shading, the bars (worst frame per column, coloured against the thresholds in force), the
 * budget and long-frame reference lines, the dropped-frame ticks, and the phase strip. Runs at ≤ 30 Hz.
 *
 * The vertical scale is clamped: `[2× jank … 8× jank]`, tracking the worst frame in view. Without the cap a
 * single 300 ms stall would flatten ten seconds of 6 ms frames into a green floor; with it the stall is
 * clipped and drawn with a bright cap so it is still unmistakably there.
 */
function drawGraph(cv: HTMLCanvasElement | null, cssW: number, now: number): void {
  if (!cv || cssW <= 0) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== cssW * dpr || cv.height !== GRAPH_H * dpr) {
    cv.width = cssW * dpr;
    cv.height = GRAPH_H * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, GRAPH_H);
  const th = perfThresholds();
  const cols = graphColumns(perfMonitor.frameRing(), now, WINDOW_MS, cssW, th);
  const STRIP = 4; // phase strip height
  const TICK = 3;  // dropped-frame tick row
  const top = TICK + 1;
  const area = GRAPH_H - STRIP - top;
  let viewMax = 0;
  for (let i = 0; i < cssW; i++) if (cols.max[i]! > viewMax) viewMax = cols.max[i]!;
  const scaleMax = Math.max(th.jankMs * 2, Math.min(viewMax, th.jankMs * 8));
  const yOf = (v: number): number => top + area - Math.min(1, v / scaleMax) * area;

  // Warm-up shading first, under everything.
  ctx.fillStyle = 'rgba(240, 192, 90, 0.16)';
  for (let i = 0; i < cssW; i++) if (cols.warm[i]) ctx.fillRect(i, top, 1, area);

  // Bars. One fillRect per non-empty column; colour by the threshold band the column's worst frame is in.
  for (let i = 0; i < cssW; i++) {
    const v = cols.max[i]!;
    if (v <= 0) continue;
    const y = yOf(v);
    ctx.fillStyle = cols.warm[i] ? 'rgba(240, 192, 90, 0.55)' : color(v, th);
    ctx.fillRect(i, y, 1, top + area - y);
    if (v > scaleMax) { ctx.fillStyle = '#fff'; ctx.fillRect(i, top, 1, 2); } // clipped: a bright cap
  }

  // Reference lines: the per-frame budget (dashed) and the long-frame line (dotted).
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(0, yOf(th.frameMs) + 0.5); ctx.lineTo(cssW, yOf(th.frameMs) + 0.5); ctx.stroke();
  ctx.strokeStyle = 'rgba(240,144,46,0.7)';
  ctx.setLineDash([1, 3]);
  ctx.beginPath(); ctx.moveTo(0, yOf(th.longFrameMs) + 0.5); ctx.lineTo(cssW, yOf(th.longFrameMs) + 0.5); ctx.stroke();
  ctx.setLineDash([]);

  // Dropped-frame ticks along the top and the phase strip along the bottom.
  ctx.fillStyle = '#ff7a90';
  for (let i = 0; i < cssW; i++) if (cols.long[i]) ctx.fillRect(i, 0, 1, TICK);
  for (let i = 0; i < cssW; i++) {
    const p = cols.phase[i]!;
    if (p === 0) continue;
    ctx.fillStyle = PHASE_COLORS[p] ?? PHASE_COLORS[0]!;
    ctx.fillRect(i, GRAPH_H - STRIP, 1, STRIP);
  }
}

/** `title` carries the RAW measured label behind a friendly name, so a row stays greppable on hover. */
function Row({ k, v, warn, title }: { k: string; v: string; warn?: boolean; title?: string }) {
  return (
    <div className={`perfhud-row${warn ? ' warn' : ''}`} title={title}>
      <span>{k}</span><b>{v}</b>
    </div>
  );
}

/**
 * `useDraggablePanel` injects a ✕ into every panel it manages and wires it to `DevPanelContext`'s `close`.
 * This panel was once mounted outside any provider, so that button called a no-op (owner report 2026-08-29).
 * The provider here makes it the real close.
 */
export function PerfHud({ onClose }: { onClose?: () => void }): JSX.Element {
  return (
    <DevPanelContext.Provider value={{ close: () => onClose?.() }}>
      <PerfHudPanel />
    </DevPanelContext.Provider>
  );
}
