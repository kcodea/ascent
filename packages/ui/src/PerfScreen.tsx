import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGame } from './store';
import { perfMonitor } from './perfMonitor';
import type { PerfBucket } from './perfMonitor';
import { compareRuns, diagnose, type Diagnosis, type Severity, type Spike } from './perfDiagnose';
import { buildReport } from './perfReport';
import { clearRuns, deleteRun, listRuns, loadRun, toRun, type PerfRunMeta } from './perfStore';
import { deleteCloudRun, listCloudRuns, loadCloudRun, uploadRun, type CloudRunMeta } from './perfCloud';

/**
 * PERF ANALYTICS — the screen that turns recordings into decisions (owner ask 2026-08-29: *"a new
 * perf-screen that shows analytics of games … then we can send reports to claude from there to further
 * diagnose and confirm/deny issues"*).
 *
 * The HUD answers "is it smooth right now". This answers the four questions you actually have afterwards:
 *
 *   1. **What is wrong?** — `Findings`, plain English, worst first, each with a next step.
 *   2. **Where?** — `By phase`, so "the game is janky" becomes "combat is janky and the shop is fine".
 *   3. **When, and what was happening?** — the timeline, with every spike annotated by what fired in it.
 *   4. **Did my change make it worse?** — a comparison against any earlier recording.
 *
 * Then one button puts all of it on the clipboard as markdown.
 *
 * ── Two things it deliberately refuses to do ──────────────────────────────────────────────────────────────
 *
 * · **It does not overstate.** Findings carry their confidence into the UI: a measured attribution and a
 *   correlated lead are visually different, because reading a guess as a fact is how a day gets spent on the
 *   wrong thing.
 * · **It does not run while you play.** Rendering charts is real work, and a perf tool that costs frames is
 *   worse than none. The screen mounts nothing until it is open, reads from storage rather than from the
 *   live sampler, and never subscribes to per-frame anything.
 */

const SEV_ICON: Record<Severity, string> = { critical: '🔴', warn: '🟠', info: '⚪' };
const fmtTime = (ms: number): string => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const fmtDate = (t: number): string => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** A loaded recording: its metadata, its buckets, and the diagnosis drawn from them. */
interface Loaded { meta: PerfRunMeta | null; buckets: PerfBucket[]; d: Diagnosis }

/**
 * The jank timeline. One column per second, height = worst frame in that second, colour = severity against
 * the budget. A `<canvas>` rather than DOM: a 40-minute run is 2400 columns, and 2400 divs is a layout the
 * browser has to do every time this screen opens.
 */
function Timeline({ buckets, d, onPick, picked }: {
  buckets: PerfBucket[]; d: Diagnosis; onPick: (i: number) => void; picked: number | null;
}): JSX.Element {
  const live = useMemo(() => buckets.filter((b) => !b.hidden), [buckets]);
  const max = useMemo(() => Math.max(d.budgetMs * 2, ...live.map((b) => b.worst)), [live, d.budgetMs]);
  const ref = useCallback((el: HTMLCanvasElement | null) => {
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.clientWidth;
    const h = el.clientHeight;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    const g = el.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    // The budget line is the only reference that matters — everything above it is a dropped frame.
    const budgetY = h - (d.budgetMs / max) * h;
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(0, budgetY); g.lineTo(w, budgetY); g.stroke();
    g.setLineDash([]);
    const cw = Math.max(1, w / Math.max(1, live.length));
    live.forEach((b, i) => {
      const bh = Math.min(h, (b.worst / max) * h);
      g.fillStyle = b.worst > d.thresholds.jankMs ? '#e5446b'
        : b.worst > d.thresholds.longFrameMs ? '#f0902e'
        : b.worst > d.budgetMs ? '#c8922e' : '#1f9d6b';
      g.fillRect(i * cw, h - bh, Math.max(1, cw - 0.5), bh);
    });
    if (picked !== null && live[picked]) {
      g.fillStyle = 'rgba(255,255,255,0.85)';
      g.fillRect(picked * cw, 0, Math.max(1, cw), h);
    }
  }, [live, max, d, picked]);

  return (
    <canvas
      className="perfsc-timeline" ref={ref}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const i = Math.floor(((e.clientX - r.left) / r.width) * live.length);
        onPick(Math.max(0, Math.min(live.length - 1, i)));
      }}
    />
  );
}

/** One inspected second, fully annotated — the answer to "what was happening when it spiked". */
function SecondDetail({ b, d }: { b: PerfBucket; d: Diagnosis }): JSX.Element {
  const rows = (rec: Record<string, number>): [string, number][] =>
    Object.entries(rec ?? {}).sort((a, c) => c[1] - a[1]).slice(0, 8);
  const timings = Object.entries(b.timings ?? {}).sort((a, c) => c[1].max - a[1].max).slice(0, 8);
  return (
    <div className="perfsc-second">
      <div className="perfsc-second-head">
        <b>{fmtTime(b.t)}</b>
        <span className={b.worst > d.thresholds.jankMs ? 'bad' : b.worst > d.budgetMs ? 'warn' : 'ok'}>
          worst {b.worst.toFixed(1)}ms
        </span>
        <span>p95 {b.p95.toFixed(1)}ms</span>
        <span>{b.fps} fps</span>
        {b.phase ? <span className="perfsc-chip">{b.phase}{b.wave !== undefined ? ` · wave ${b.wave}` : ''}</span> : null}
        {b.task > 0 ? <span className="bad">task {b.task.toFixed(0)}ms</span> : null}
      </div>
      <div className="perfsc-second-cols">
        <div>
          <h5>Measured</h5>
          {timings.length === 0
            ? <p className="perfsc-empty">Nothing timed this second. If it spiked, the cost is somewhere uninstrumented.</p>
            : timings.map(([k, t]) => (
              <div key={k} className="perfsc-kv"><span>{k}</span><b>{t.max.toFixed(1)}ms</b><i>×{t.n}</i></div>
            ))}
        </div>
        <div>
          <h5>Fired</h5>
          {rows(b.marks).length === 0
            ? <p className="perfsc-empty">—</p>
            : rows(b.marks).map(([k, n]) => <div key={k} className="perfsc-kv"><span>{k}</span><b>×{n}</b></div>)}
        </div>
        <div>
          <h5>Live counts</h5>
          {rows(b.counts).length === 0
            ? <p className="perfsc-empty">—</p>
            : rows(b.counts).map(([k, n]) => <div key={k} className="perfsc-kv"><span>{k}</span><b>{n}</b></div>)}
        </div>
      </div>
    </div>
  );
}

export function PerfScreen(): JSX.Element | null {
  const open = useGame((s) => s.showPerf);
  const close = useGame((s) => s.closePerf);

  const [runs, setRuns] = useState<PerfRunMeta[]>([]);
  /**
   * SHARED RECORDINGS (owner ask 2026-08-29). `null` while unread; `'notReady'` when the table has not been
   * created yet — which is a SETUP state, not an error, and is worded that way. Everything local keeps
   * working either way, which is the whole point of separating the two lists.
   */
  const [cloud, setCloud] = useState<CloudRunMeta[] | 'notReady' | null>(null);
  const [tab, setTab] = useState<'local' | 'cloud'>('local');
  const [busy, setBusy] = useState('');
  const [cur, setCur] = useState<Loaded | null>(null);
  const [prev, setPrev] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [copied, setCopied] = useState('');

  const refresh = useCallback(() => { void listRuns().then(setRuns); }, []);
  const refreshCloud = useCallback(() => {
    void listCloudRuns().then((r) => { setCloud(r.kind === 'ok' ? r.runs : r.kind === 'notReady' ? 'notReady' : []); });
  }, []);

  // Load only when the screen opens — nothing here costs anything while the game is running.
  useEffect(() => {
    if (!open) return;
    refresh();
    refreshCloud();
    // The LIVE recording is offered first when one is in progress: the most common reason to open this is
    // "that felt bad just now", and making you stop and save first would lose the moment.
    const liveBuckets = [...perfMonitor.history()];
    if (liveBuckets.length > 0) setCur({ meta: null, buckets: liveBuckets, d: diagnose(liveBuckets) });
  }, [open, refresh, refreshCloud]);

  useEffect(() => { if (!open) { setPicked(null); setCopied(''); } }, [open]);

  const pick = useCallback(async (id: string, into: 'cur' | 'prev') => {
    const run = await loadRun(id);
    if (!run) return;
    const loaded: Loaded = { meta: run, buckets: run.buckets, d: diagnose(run.buckets) };
    if (into === 'cur') { setCur(loaded); setPicked(null); } else setPrev(loaded);
  }, []);

  /** Publish the open recording so the other machine can read it. */
  const share = useCallback(() => {
    if (!cur) return;
    setBusy('sharing…');
    const st = useGame.getState();
    const run = cur.meta ?? toRun(cur.buckets, {
      id: `${Date.now()}`, startedAt: Date.now() - cur.buckets.length * 1000,
      build: `${__APP_VERSION__}+${__BUILD_SHA__}`, mode: st.run?.mode, heroId: st.run?.heroId,
    });
    void uploadRun({ ...run, buckets: cur.buckets }, st.playerName || 'dev').then((r) => {
      setBusy(r.kind === 'ok' ? '✓ shared'
        : r.kind === 'notReady' ? 'Supabase table not created yet — see docs/performance.md'
        : `Share failed: ${r.error}`);
      if (r.kind === 'ok') refreshCloud();
      window.setTimeout(() => { setBusy(''); }, 5000);
    });
  }, [cur, refreshCloud]);

  /** Load a SHARED recording's timeline into the open slot (or the comparison slot). */
  const pickCloud = useCallback(async (meta: CloudRunMeta, into: 'cur' | 'prev' = 'cur') => {
    setBusy('loading…');
    const buckets = await loadCloudRun(meta.id);
    setBusy(buckets ? '' : 'Could not load that recording.');
    if (!buckets) { window.setTimeout(() => { setBusy(''); }, 4000); return; }
    const loaded: Loaded = { meta, buckets, d: diagnose(buckets) };
    if (into === 'cur') { setCur(loaded); setPicked(null); } else setPrev(loaded);
  }, []);

  const copy = useCallback(() => {
    if (!cur) return;
    const text = buildReport({
      buckets: cur.buckets,
      meta: cur.meta ?? { build: undefined },
      previous: prev?.meta ? { meta: prev.meta, buckets: prev.buckets } : undefined,
    });
    void navigator.clipboard.writeText(text).then(
      () => { setCopied('Copied — paste it to Claude'); },
      () => { setCopied('Clipboard blocked; use ⬇ to download instead'); },
    );
    window.setTimeout(() => { setCopied(''); }, 4000);
  }, [cur, prev]);

  const live = useMemo(() => (cur ? cur.buckets.filter((b) => !b.hidden) : []), [cur]);
  const regs = useMemo(() => (cur && prev ? compareRuns(prev.d, cur.d) : []), [cur, prev]);

  if (!open) return null;

  return (
    <div className="perfsc-wrap" role="dialog" aria-label="Performance analytics">
      <div className="perfsc">
        <header className="perfsc-top">
          <div className="esch disp">Performance</div>
          <button className="perfsc-x" onClick={close} aria-label="Close">✕</button>
        </header>

        <div className="perfsc-body">
          {/* ── Recordings ─────────────────────────────────────────────────────────────────────────────── */}
          <aside className="perfsc-runs">
            <div className="perfsc-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'local'} className={tab === 'local' ? 'on' : ''}
                onClick={() => { setTab('local'); }}>This machine</button>
              <button role="tab" aria-selected={tab === 'cloud'} className={tab === 'cloud' ? 'on' : ''}
                onClick={() => { setTab('cloud'); refreshCloud(); }}>Shared</button>
            </div>
            <div className="perfsc-runs-head">
              <h4>{tab === 'local' ? 'Recordings' : 'Shared recordings'}</h4>
              {tab === 'local' && runs.length > 0 && (
                <button className="perfsc-mini" onClick={() => { void clearRuns().then(refresh); }}>clear all</button>
              )}
              {tab === 'cloud' && (
                <button className="perfsc-mini" onClick={refreshCloud}>refresh</button>
              )}
            </div>
            {tab === 'cloud' ? (
              cloud === 'notReady' ? (
                <p className="perfsc-empty">
                  <b>Not set up yet.</b> The <code>perf_runs</code> table has not been created in Supabase.
                  Everything on <b>This machine</b> works without it — see <code>docs/performance.md</code>
                  {' '}for the four steps.
                </p>
              ) : cloud === null ? <p className="perfsc-empty">Loading…</p>
              : cloud.length === 0 ? (
                <p className="perfsc-empty">
                  Nothing shared yet. Dev clients upload automatically when you leave the tab, or press
                  {' '}<b>Share</b> on an open recording.
                </p>
              ) : cloud.map((r) => (
                <div key={r.id} className={`perfsc-run${cur?.meta?.id === r.id ? ' on' : ''}`}>
                  <button onClick={() => { void pickCloud(r); }}>
                    <b>{r.note && r.note !== 'auto' ? r.note : fmtDate(r.startedAt)}</b>
                    <span>{r.author || 'unknown'} · {r.seconds}s · {r.hz}Hz · worst {r.worstFrame.toFixed(1)}ms</span>
                    {r.build ? <i>{r.build}</i> : null}
                  </button>
                  <div className="perfsc-run-acts">
                    <button title="Compare the open recording against this one"
                      onClick={() => { void pickCloud(r, 'prev'); }}>vs</button>
                    {/* Only your own rows offer a delete — RLS refuses anyone else's, so showing the button
                        would be offering something that cannot work. */}
                    {r.mine && (
                      <button title="Delete this shared recording"
                        onClick={() => { void deleteCloudRun(r.id).then(refreshCloud); }}>✕</button>
                    )}
                  </div>
                </div>
              ))
            ) : null}
            {tab === 'local' && cur && !cur.meta && (
              <button className="perfsc-run on" onClick={() => { setCur({ meta: null, buckets: [...perfMonitor.history()], d: diagnose([...perfMonitor.history()]) }); }}>
                <b>Live recording</b>
                <span>{cur.d.seconds}s · in progress</span>
              </button>
            )}
            {tab === 'local' && runs.length === 0 && (
              <p className="perfsc-empty">
                No saved recordings yet. Turn the perf monitor on in the dev menu, play, then press <b>save</b>
                {' '}on the HUD.
              </p>
            )}
            {tab === 'local' && runs.map((r) => (
              <div key={r.id} className={`perfsc-run${cur?.meta?.id === r.id ? ' on' : ''}`}>
                <button onClick={() => { void pick(r.id, 'cur'); }}>
                  <b>{r.note || fmtDate(r.startedAt)}</b>
                  <span>{r.seconds}s · {r.hz}Hz · worst {r.worstFrame.toFixed(1)}ms</span>
                  {r.build ? <i>{r.build}</i> : null}
                </button>
                <div className="perfsc-run-acts">
                  <button title="Compare the open recording against this one"
                    onClick={() => { void pick(r.id, 'prev'); }}>vs</button>
                  <button title="Delete" onClick={() => { void deleteRun(r.id).then(refresh); }}>✕</button>
                </div>
              </div>
            ))}
          </aside>

          {/* ── Analysis ───────────────────────────────────────────────────────────────────────────────── */}
          <main className="perfsc-main">
            {!cur ? (
              <p className="perfsc-empty big">Pick a recording, or start the perf monitor and play.</p>
            ) : cur.d.thin ? (
              <p className="perfsc-empty big">
                Only {cur.d.seconds}s recorded — too thin to judge. Play a few waves with the monitor on.
              </p>
            ) : (
              <>
                <section className="perfsc-head">
                  <div className="perfsc-stat">
                    <b>{cur.d.fpsMed}</b><span>median fps</span>
                  </div>
                  <div className={`perfsc-stat ${cur.d.worstFrame > cur.d.thresholds.jankMs ? 'bad' : cur.d.worstFrame > cur.d.budgetMs ? 'warn' : 'ok'}`}>
                    <b>{cur.d.worstFrame.toFixed(1)}<i>ms</i></b><span>worst frame</span>
                  </div>
                  <div className="perfsc-stat"><b>{cur.d.jankFrames}</b><span>dropped frames</span></div>
                  <div className="perfsc-stat"><b>{cur.d.budgetMs}<i>ms</i></b><span>budget @ {cur.d.hz}Hz</span></div>
                  <div className="perfsc-stat"><b>{Math.round(cur.d.attribution * 100)}<i>%</i></b><span>time attributed</span></div>
                  <div className="perfsc-actions">
                    <button className="perfsc-copy" onClick={copy}>📋 Copy report for Claude</button>
                    <button className="perfsc-share" onClick={share} title="Upload this recording so the other machine can read it">⬆ Share</button>
                    {copied ? <span className="perfsc-copied">{copied}</span> : null}
                    {busy ? <span className="perfsc-copied">{busy}</span> : null}
                  </div>
                </section>

                <section>
                  <h4>Findings</h4>
                  {cur.d.verdicts.map((v) => (
                    <div key={v.id} className={`perfsc-verdict sev-${v.severity}`}>
                      <div className="perfsc-verdict-t">
                        <span aria-hidden="true">{SEV_ICON[v.severity]}</span>
                        <b>{v.title}</b>
                        <span className={`perfsc-conf ${v.confidence}`}>
                          {v.confidence === 'measured' ? 'measured' : 'possible lead'}
                        </span>
                      </div>
                      <p>{v.detail}</p>
                      <p className="perfsc-next"><b>Next:</b> {v.suggestion}</p>
                    </div>
                  ))}
                </section>

                {cur.d.phases.filter((p) => p.seconds >= 3).length > 1 && (
                  <section>
                    <h4>By phase</h4>
                    <table className="perfsc-table">
                      <thead>
                        <tr><th>phase</th><th>secs</th><th>fps</th><th>p95</th><th>worst</th><th>dropped/s</th></tr>
                      </thead>
                      <tbody>
                        {cur.d.phases.filter((p) => p.seconds >= 3).map((p) => (
                          <tr key={p.phase}>
                            <td>{p.phase}</td>
                            <td>{p.seconds}</td>
                            <td>{p.fpsMed}</td>
                            <td>{p.p95.toFixed(1)}</td>
                            <td className={p.overBudget ? 'bad' : 'ok'}>{p.worst.toFixed(1)}</td>
                            <td>
                              <span className="perfsc-bar" style={{ '--w': `${Math.min(100, p.jankRate * 20)}%` } as React.CSSProperties} />
                              {p.jankRate}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                )}

                <section>
                  <h4>Timeline <small>— click a second to inspect it</small></h4>
                  <Timeline buckets={cur.buckets} d={cur.d} picked={picked} onPick={setPicked} />
                  {picked !== null && live[picked]
                    ? <SecondDetail b={live[picked]!} d={cur.d} />
                    : <WorstList spikes={cur.d.spikes} budgetMs={cur.d.budgetMs} onPick={(t) => {
                      setPicked(live.findIndex((b) => b.t === t));
                    }} />}
                </section>

                {prev && (
                  <section>
                    <h4>vs {prev.meta ? (prev.meta.note || fmtDate(prev.meta.startedAt)) : 'earlier'}</h4>
                    {regs.length === 0
                      ? <p className="perfsc-empty">No change outside the noise floor (±15%).</p>
                      : (
                        <table className="perfsc-table">
                          <thead><tr><th>metric</th><th>before</th><th>after</th><th>change</th></tr></thead>
                          <tbody>
                            {regs.filter((r) => r.metric !== 'refresh').map((r) => (
                              <tr key={r.metric}>
                                <td>{r.metric}</td><td>{r.before}</td><td>{r.after}</td>
                                <td className={r.severity === 'info' ? 'ok' : 'bad'}>
                                  {r.delta > 0 ? `+${Math.round(r.delta * 100)}% worse` : `${Math.round(-r.delta * 100)}% better`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    {regs.find((r) => r.metric === 'refresh') && (
                      <p className="perfsc-warnline">⚠ {regs.find((r) => r.metric === 'refresh')!.note}</p>
                    )}
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

/** The worst seconds, as a shortlist you can jump into. Shown until a second is picked. */
function WorstList({ spikes, budgetMs, onPick }: {
  spikes: Spike[]; budgetMs: number; onPick: (t: number) => void;
}): JSX.Element {
  const over = spikes.filter((s) => s.worst > budgetMs);
  if (over.length === 0) return <p className="perfsc-empty">No second went over budget.</p>;
  return (
    <div className="perfsc-worst">
      {over.slice(0, 6).map((s) => (
        <button key={s.t} onClick={() => { onPick(s.t); }}>
          <b>{s.worst.toFixed(1)}ms</b>
          <span>{fmtTime(s.t)}{s.phase ? ` · ${s.phase}` : ''}</span>
          <i>{s.timings[0]?.label ?? s.marks[0]?.label ?? '—'}</i>
        </button>
      ))}
    </div>
  );
}
