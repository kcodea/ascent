import { compareRuns, diagnose, type Diagnosis } from './perfDiagnose';
import { displaySubject, phaseName } from './perfNames';
import type { PerfRunMeta } from './perfStore';
import type { PerfBucket } from './perfMonitor';

/**
 * THE REPORT — one block of text, written to be pasted straight into a conversation with Claude.
 *
 * Owner ask (2026-08-29): *"then we can send reports to claude from there to further diagnose and
 * confirm/deny issues."* So the audience is a reader who was not there, has no access to the machine, and
 * has to decide what to look at next. That shapes every choice here:
 *
 * · **Markdown, not JSON.** A 2400-entry bucket array is unreadable and blows the context window for no
 *   gain. What travels is the reasoning and the evidence behind it.
 * · **Confidence is carried, not flattened.** A correlated lead and a measured attribution look identical
 *   once they are both bullet points, and that is exactly how an afternoon gets spent on the wrong thing.
 *   Measured findings are labelled `MEASURED`, leads `possible lead`.
 * · **The refresh and the budget lead.** Every millisecond below is meaningless without them — 10 ms is
 *   fine at 60 Hz and 3.6× over budget at 360.
 * · **Absence is reported.** "Nothing was over budget" and "nothing is attributable" are both findings; a
 *   report that only lists problems reads as broken when a run is clean.
 */

const bar = (n: number, max: number, width = 12): string => {
  if (max <= 0) return '·'.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((n / max) * width)));
  return '█'.repeat(filled) + '·'.repeat(width - filled);
};
const ms = (n: number): string => `${n.toFixed(1)}ms`;

/** How a spike's second is described — the annotation that makes it triageable rather than just big. */
function spikeLine(s: Diagnosis['spikes'][number], budgetMs: number): string {
  // In-game words, not internal phase ids (owner ask 2026-08-30): "Shop, wave 4" reads as a moment in a game;
  // "recruit 4" reads as a log line you still have to decode.
  const where = [s.phase ? phaseName(s.phase) : null, s.wave !== undefined ? `wave ${s.wave}` : null]
    .filter(Boolean).join(', ');
  const parts: string[] = [`- **${ms(s.worst)}** (${(s.worst / budgetMs).toFixed(1)}× budget) at ${(s.t / 1000).toFixed(0)}s${where ? ` — ${where}` : ''}`];
  if (s.task > 0) parts.push(`  - longest blocking task: ${ms(s.task)}`);
  if (s.timings.length) {
    parts.push(`  - measured: ${s.timings.map((t) => `\`${t.label}\` ${ms(t.max)} worst of ${t.n}`).join(', ')}`);
  }
  if (s.marks.length) parts.push(`  - fired: ${s.marks.map((m) => `${m.label}×${m.n}`).join(', ')}`);
  if (s.counts.length) parts.push(`  - live: ${s.counts.map((c) => `${c.label} ${c.n}`).join(', ')}`);
  return parts.join('\n');
}

export interface ReportInput {
  buckets: readonly PerfBucket[];
  meta?: Partial<PerfRunMeta> & { note?: string };
  /** An earlier run to compare against, if the reader picked one. */
  previous?: { meta: PerfRunMeta; buckets: readonly PerfBucket[] };
}

/** The full report. Markdown, self-contained, safe to paste anywhere. */
export function buildReport(input: ReportInput): string {
  const d = diagnose(input.buckets, displaySubject);
  const L: string[] = [];
  const m = input.meta ?? {};

  L.push('# ASCENT perf report');
  L.push('');
  if (d.thin) {
    L.push(`Only **${d.seconds}s** of live recording — too thin to draw conclusions from. Record a few waves (a shop phase, a combat, an End of Turn) and export again.`);
    return L.join('\n');
  }

  // ── Context first. Every number below is read against these. ───────────────────────────────────────────
  L.push(`**${d.seconds}s** recorded at **${d.hz} Hz** → budget **${d.budgetMs}ms per frame**.`);
  const ctx = [
    m.build ? `build \`${m.build}\`` : null,
    m.mode ? `mode ${m.mode}` : null,
    m.heroId ? `hero ${m.heroId}` : null,
    m.note ? `note: "${m.note}"` : null,
  ].filter(Boolean);
  if (ctx.length) L.push(ctx.join(' · '));
  L.push('');
  L.push(`| median fps | worst frame | frames > ${ms(d.thresholds.longFrameMs)} | frames > ${ms(d.thresholds.jankMs)} | time attributed |`);
  L.push('|---|---|---|---|---|');
  L.push(`| ${d.fpsMed} | ${ms(d.worstFrame)} | ${d.longFrames} | ${d.jankFrames} | ${Math.round(d.attribution * 100)}% |`);
  L.push('');
  L.push('> fps is a **ceiling**, not a score — rAF is capped at the refresh, so a steady number means nothing dropped, not that there is headroom. Judge on worst frame first.');
  L.push('');

  // ── Findings. ──────────────────────────────────────────────────────────────────────────────────────────
  L.push('## Findings');
  L.push('');
  for (const v of d.verdicts) {
    const tag = v.severity === 'critical' ? '🔴' : v.severity === 'warn' ? '🟠' : '⚪';
    const conf = v.confidence === 'measured' ? '**MEASURED**' : '*possible lead — correlation only*';
    L.push(`### ${tag} ${v.title}`);
    L.push('');
    L.push(`${v.detail} ${conf}`);
    L.push('');
    L.push(`**Next:** ${v.suggestion}`);
    L.push('');
  }

  // ── Phases. The single most useful table when something IS wrong. ──────────────────────────────────────
  const phases = d.phases.filter((p) => p.seconds >= 3);
  if (phases.length > 1) {
    const maxRate = Math.max(...phases.map((p) => p.jankRate));
    L.push('## By phase');
    L.push('');
    L.push('| phase | seconds | median fps | p95 | worst | dropped/s | |');
    L.push('|---|---|---|---|---|---|---|');
    for (const p of phases) {
      L.push(`| ${phaseName(p.phase)} | ${p.seconds} | ${p.fpsMed} | ${ms(p.p95)} | ${ms(p.worst)}${p.overBudget ? ' ⚠' : ''} | ${p.jankRate} | \`${bar(p.jankRate, maxRate)}\` |`);
    }
    L.push('');
  }

  // ── The worst moments, annotated. ──────────────────────────────────────────────────────────────────────
  const spikes = d.spikes.filter((s) => s.worst > d.budgetMs).slice(0, 5);
  if (spikes.length) {
    L.push('## Worst moments');
    L.push('');
    for (const s of spikes) L.push(spikeLine(s, d.budgetMs));
    L.push('');
  }

  // ── Comparison, when one was picked. ───────────────────────────────────────────────────────────────────
  if (input.previous) {
    const prev = diagnose(input.previous.buckets, displaySubject);
    const regs = compareRuns(prev, d);
    L.push(`## Compared with ${new Date(input.previous.meta.startedAt).toISOString().slice(0, 16).replace('T', ' ')}`);
    if (input.previous.meta.note) L.push(`_(that run: "${input.previous.meta.note}")_`);
    L.push('');
    if (regs.length === 0) {
      L.push('No change outside the noise floor (±15%).');
    } else {
      L.push('| metric | before | after | change | |');
      L.push('|---|---|---|---|---|');
      for (const r of regs) {
        if (r.metric === 'refresh') continue;
        const dir = r.delta > 0 ? `+${Math.round(r.delta * 100)}% worse` : `${Math.round(-r.delta * 100)}% better`;
        L.push(`| ${r.metric} | ${r.before} | ${r.after} | ${dir} | ${r.severity === 'info' ? '✅' : '⚠'} |`);
      }
      const note = regs.find((r) => r.metric === 'refresh');
      if (note) { L.push(''); L.push(`> ⚠ ${note.note}`); }
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('_Recorded by the in-game perf monitor. Thresholds are derived from the measured refresh, not fixed milliseconds — see `docs/performance.md`._');
  return L.join('\n');
}
