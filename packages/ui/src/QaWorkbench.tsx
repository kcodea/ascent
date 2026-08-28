/**
 * QA WORKBENCH — Doc Bot 2.0 WP G, blueprint §15 ("the platform needs a usable review surface, not only
 * CLI logs").
 *
 * DevMenu → 🔬 QA Workbench. Dev-server only, exactly like the Bug Board and Rulebook Triage it is modelled
 * on: the ledger and sweep artifacts are gitignored files, so they arrive through `workbenchPlugin`'s
 * read-only `/__workbench/*` endpoints, and a 404 degrades to a printed hint instead of a crash.
 *
 * The six §15 views, and where each one's data comes from:
 *   §15.1 Inbox        — the findings ledger (`npm run docbot:ledger`): every finding ever emitted, folded
 *                        by fingerprint, with first/last seen, occurrence count, and the five status
 *                        buckets. Filters by class · severity · confidence · lane · bucket · text.
 *   §15.2 Content      — printed text (CARD_INDEX/RUNE_INDEX) + the approved/extracted ContentContract +
 *                        its review status and per-aspect evidence + the text parser's verdict + open
 *                        findings + the interaction rows that cover it.
 *   §15.3 Rule review  — NOT duplicated. The board is RulebookTriage's fly-through; this tab points there.
 *   §15.4 Trace        — runs a finding's scenario IN-BROWSER through the real `runQaScenario` (the same
 *                        one engine Scene Builder uses) and renders the semantic trace with the FIRST
 *                        DIVERGENCE highlighted — the one thing no surface showed before.
 *   §15.5 Interactions — WP F's family coverage table (covered/failed/inapplicable/blocked) with
 *                        click-through from a row's members into the Content view.
 *   §15.6 Text queue   — WP E's verified mismatches first, then advisor recommendations, each with the
 *                        current text, the issue, and the suggestion. **Accept writes an owner decision
 *                        through the EXISTING `/__rulebook/decide` plugin — it never edits a content file**
 *                        (§23). That is the only write this surface makes.
 *
 * House rules honoured: inline styles only (no `cursor: pointer` anywhere — the global button rule paints
 * the gauntlet), pure helpers exported for the test, one `{ onClose }` prop.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { CARD_INDEX, QUEST_DEFS, RUNE_INDEX } from '@game/content';
import { allContracts } from '@game/rules/contracts';
import type { ContentContract } from '@game/rules/contracts/schema';
import { runQaScenario, type QaScenarioResult, type QaScenarioV1 } from '@game/sim';

// ── Wire shapes (mirrors of the JSON the plugin serves; deliberately loose — an old artifact must render) ──

export interface LedgerEntryView {
  fingerprint: string;
  id: string;
  lane: string;
  class?: string;
  severity: string;
  confidence: string;
  status: string;
  title: string;
  summary: string;
  contentIds: string[];
  ruleIds: string[];
  firstSeen: { date: string; source: string };
  lastSeen: { date: string; source: string };
  occurrences: number;
  linkedDecisionIds: string[];
  linkedReportIds: string[];
  linkedScenarioIds: string[];
}

export interface LedgerView { entries: LedgerEntryView[]; generatedAt?: string; sources?: string[] }

export interface InteractionRunView {
  family: string;
  tier: string;
  members: string[];
  verdict: string;
  evidence?: string;
}

export interface TextReviewView {
  buckets?: Record<string, number>;
  mismatches?: Array<{ contentId: string; taxonomy: string; expected: string; observed: string }>;
  unresolved?: Array<{ contentId: string; contentType: string; unresolved: string[] }>;
  recommendations?: Array<{ fingerprint: string; contentIds: string[]; ruleIds: string[]; title: string; summary: string; suggestedText: string | null }>;
}

export type Missing = { missing: true; hint: string };
const isMissing = (v: unknown): v is Missing =>
  typeof v === 'object' && v !== null && (v as { missing?: unknown }).missing === true;

// ── Pure helpers (the test's whole surface) ───────────────────────────────────────────────────────────────

/** §15.1 status buckets — the same derivation the CLI uses, restated here so the view never needs the CLI. */
export function bucketOfEntry(e: LedgerEntryView): string {
  if (e.linkedScenarioIds.some((id) => id.startsWith('regression-'))) return 'regression-protected';
  if (e.status === 'resolved') return 'fixed';
  if (e.linkedDecisionIds.length > 0 || e.status === 'excused') return 'ruled';
  if (e.status === 'known') return 'acknowledged';
  return 'new';
}

export interface InboxFilters {
  cls: string; severity: string; confidence: string; lane: string; bucket: string; q: string;
}

export const EMPTY_FILTERS: InboxFilters = { cls: '', severity: '', confidence: '', lane: '', bucket: '', q: '' };

/** Filter + sort the inbox. Deduplication is already done — the ledger IS keyed by fingerprint. */
export function filterInbox(entries: readonly LedgerEntryView[], f: InboxFilters): LedgerEntryView[] {
  const q = f.q.trim().toLowerCase();
  return entries
    .filter((e) => (!f.cls || (e.class ?? 'unclassified') === f.cls))
    .filter((e) => (!f.severity || e.severity === f.severity))
    .filter((e) => (!f.confidence || e.confidence === f.confidence))
    .filter((e) => (!f.lane || e.lane === f.lane))
    .filter((e) => (!f.bucket || bucketOfEntry(e) === f.bucket))
    .filter((e) => !q || `${e.title} ${e.summary} ${e.contentIds.join(' ')} ${e.ruleIds.join(' ')}`.toLowerCase().includes(q))
    .sort((a, b) => (a.lastSeen.date !== b.lastSeen.date
      ? (a.lastSeen.date < b.lastSeen.date ? 1 : -1)
      : (a.fingerprint < b.fingerprint ? -1 : 1)));
}

/** Every distinct value of one field, sorted — the filter dropdowns build themselves from the data. */
export const distinct = (entries: readonly LedgerEntryView[], pick: (e: LedgerEntryView) => string): string[] =>
  [...new Set(entries.map(pick).filter(Boolean))].sort();

/** Printed text for any content id — cards, runes and quests in one lookup (§15.2's first row). */
export function printedTextOf(contentId: string): { kind: string; name: string; text: string } | null {
  const card = CARD_INDEX[contentId];
  if (card) return { kind: `card · ${card.tribe} · tier ${card.tier}`, name: card.name, text: card.text };
  const rune = RUNE_INDEX[contentId];
  if (rune) return { kind: 'rune', name: rune.name, text: rune.text ?? '' };
  const quest = QUEST_DEFS.find((q) => q.id === contentId);
  // Quests have no printed body of their own — the objective + reward ARE the text a player reads.
  if (quest) return { kind: 'quest', name: quest.name, text: '' };
  return null;
}

/** Family coverage rolled up from the interaction runs — §15.5's table. */
export function familyCoverage(runs: readonly InteractionRunView[]): Array<{ family: string; verdicts: Record<string, number>; total: number }> {
  const by = new Map<string, Record<string, number>>();
  for (const r of runs) {
    const row = by.get(r.family) ?? {};
    row[r.verdict] = (row[r.verdict] ?? 0) + 1;
    by.set(r.family, row);
  }
  return [...by.entries()]
    .map(([family, verdicts]) => ({ family, verdicts, total: Object.values(verdicts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => (a.family < b.family ? -1 : 1));
}

/** The semantic trace of a scenario run, as rows the view renders. `divergentAt` is the index to highlight. */
export interface TraceRow { index: number; type: string; detail: string }
export function traceRowsOf(result: QaScenarioResult): TraceRow[] {
  const rows: TraceRow[] = [];
  result.events.forEach((e) => rows.push({ index: rows.length, type: e.type, detail: compactJson(e) }));
  (result.combatLog ?? []).forEach((e) => rows.push({ index: rows.length, type: e.type, detail: compactJson(e) }));
  return rows;
}

const compactJson = (v: unknown): string => {
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
};

// ── The surface ───────────────────────────────────────────────────────────────────────────────────────────

type Tab = 'inbox' | 'content' | 'trace' | 'interactions' | 'text';

const TABS: Array<{ id: Tab; label: string; note: string }> = [
  { id: 'inbox', label: '📥 Findings inbox', note: '§15.1 — every finding ever emitted, folded by fingerprint' },
  { id: 'content', label: '🃏 Content detail', note: '§15.2 — text · contract · review status · findings · coverage' },
  { id: 'trace', label: '🔎 Trace comparison', note: '§15.4 — run the scenario, highlight the first divergence' },
  { id: 'interactions', label: '🕸 Interaction matrix', note: '§15.5 — WP F family coverage, click through to content' },
  { id: 'text', label: '✍ Text review queue', note: '§15.6 — mismatches first, then wording recommendations' },
];

async function loadArtifact<T>(key: string): Promise<T | Missing | null> {
  try {
    const res = await fetch(`/__workbench/artifact?key=${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    return await res.json() as T | Missing;
  } catch {
    return null;
  }
}

export function QaWorkbench({ onClose }: { onClose: () => void }): JSX.Element {
  const [tab, setTab] = useState<Tab>('inbox');
  const [hint, setHint] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerView | Missing | null>(null);
  const [interactions, setInteractions] = useState<{ runs?: InteractionRunView[]; familyTotals?: Record<string, Record<string, number>> } | Missing | null>(null);
  const [text, setText] = useState<TextReviewView | Missing | null>(null);
  const [filters, setFilters] = useState<InboxFilters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<LedgerEntryView | null>(null);
  const [contentId, setContentId] = useState<string>('');
  const [scenarioId, setScenarioId] = useState<string>('');
  const [traceResult, setTraceResult] = useState<QaScenarioResult | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [l, i, t] = await Promise.all([
        loadArtifact<LedgerView>('ledger'),
        loadArtifact<{ runs?: InteractionRunView[] }>('interactions'),
        loadArtifact<TextReviewView>('text'),
      ]);
      if (!alive) return;
      if (l === null) { setHint('QA Workbench endpoints are dev-server-only — run the game via `npm run dev`.'); return; }
      setLedger(l); setInteractions(i); setText(t);
    })();
    return () => { alive = false; };
  }, []);

  const entries = useMemo(() => (ledger && !isMissing(ledger) ? ledger.entries : []), [ledger]);
  const rows = useMemo(() => filterInbox(entries, filters), [entries, filters]);
  const buckets = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries) m[bucketOfEntry(e)] = (m[bucketOfEntry(e)] ?? 0) + 1;
    return m;
  }, [entries]);

  const contracts = useMemo(() => allContracts(), []);
  const contractFor = (id: string): ContentContract | undefined => contracts.find((c) => c.contentId === id);

  const runTrace = async (id: string): Promise<void> => {
    setTraceError(null);
    setTraceResult(null);
    if (!id) { setTraceError('name a scenario id (a finding row\'s "replay" button fills it in)'); return; }
    try {
      const res = await fetch(`/__workbench/scenario?id=${encodeURIComponent(id)}`);
      const body = await res.json() as QaScenarioV1 | Missing | { error?: string };
      if (isMissing(body)) { setTraceError(body.hint); return; }
      if ('error' in body && typeof body.error === 'string') { setTraceError(body.error); return; }
      // The REAL runner — the same one engine (§4.1). The browser never recomputes an outcome of its own.
      setTraceResult(runQaScenario(body as QaScenarioV1));
    } catch {
      setTraceError('dev server unreachable — the workbench only reads while `npm run dev` is serving');
    }
  };

  /** §15.6 accept: an OWNER DECISION through the existing rulebook plugin. Never a content-file edit. */
  const decide = async (ruleId: string, decision: 'approve' | 'reject'): Promise<void> => {
    try {
      const res = await fetch('/__rulebook/decide', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: ruleId, decision }),
      });
      const body = await res.json() as { ok?: boolean; error?: string };
      setDecided((d) => ({ ...d, [ruleId]: res.ok ? decision : (body.error ?? 'failed') }));
    } catch {
      setDecided((d) => ({ ...d, [ruleId]: 'dev server unreachable' }));
    }
  };

  const openContent = (id: string): void => { setContentId(id); setTab('content'); };

  return (
    <div style={shell} data-testid="qa-workbench">
      <div style={header}>
        <strong style={{ fontSize: 16 }}>🔬 QA Workbench</strong>
        <span style={{ opacity: 0.75, fontSize: 13 }} data-testid="wb-buckets">
          {entries.length === 0 ? 'no ledger yet' : `${entries.length} findings · ${Object.entries(buckets).sort().map(([k, n]) => `${n} ${k}`).join(' · ')}`}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, opacity: 0.6 }}>
          §15.3 rule review lives on the Rulebook Triage fly-through board — not duplicated here.
        </span>
        <button onClick={onClose} style={btn('#6b3030')}>✕ Close</button>
      </div>

      <div style={tabBar}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} title={t.note}
            style={{ ...btn(tab === t.id ? '#3d4a6b' : '#2a2e40'), fontSize: 13 }} data-tab={t.id}>
            {t.label}
          </button>
        ))}
      </div>

      {hint && <div style={warn}>{hint}</div>}

      <div style={body}>
        {tab === 'inbox' && (
          <>
            {isMissing(ledger) && <div style={warn}>No findings ledger yet — {ledger.hint}.</div>}
            <div style={filterBar}>
              <span style={pillLabel}>filter</span>
              <Select label="class" value={filters.cls} onChange={(v) => setFilters((f) => ({ ...f, cls: v }))} options={distinct(entries, (e) => e.class ?? 'unclassified')} />
              <Select label="severity" value={filters.severity} onChange={(v) => setFilters((f) => ({ ...f, severity: v }))} options={distinct(entries, (e) => e.severity)} />
              <Select label="confidence" value={filters.confidence} onChange={(v) => setFilters((f) => ({ ...f, confidence: v }))} options={distinct(entries, (e) => e.confidence)} />
              <Select label="lane" value={filters.lane} onChange={(v) => setFilters((f) => ({ ...f, lane: v }))} options={distinct(entries, (e) => e.lane)} />
              <Select label="bucket" value={filters.bucket} onChange={(v) => setFilters((f) => ({ ...f, bucket: v }))} options={distinct(entries, bucketOfEntry)} />
              <input value={filters.q} placeholder="content / rule / words" onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} style={{ ...sel, minWidth: 200 }} />
              <button onClick={() => setFilters(EMPTY_FILTERS)} style={btn('#2a2e40')}>reset</button>
              <span style={{ fontSize: 12, opacity: 0.6 }}>{rows.length} of {entries.length}</span>
            </div>
            <div data-testid="wb-inbox">
              {rows.map((e) => (
                <div key={e.fingerprint} style={card}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={tag(bucketColour(bucketOfEntry(e)))}>{bucketOfEntry(e)}</span>
                    <span style={tag('#2a2e40')}>{e.class ?? 'unclassified'}</span>
                    <span style={tag('#2a2e40')}>{e.severity} · {e.confidence}</span>
                    <strong style={{ fontSize: 13 }}>{e.title}</strong>
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{e.summary}</div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
                    {e.lane} · seen ×{e.occurrences} · first {e.firstSeen.date} ({e.firstSeen.source}) · last {e.lastSeen.date} ({e.lastSeen.source}) · fp {e.fingerprint}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    {e.contentIds.map((id) => <button key={id} onClick={() => openContent(id)} style={btnTiny}>{id}</button>)}
                    {e.ruleIds.map((id) => <span key={id} style={tag('#3d4a6b')}>{id}</span>)}
                    {e.linkedScenarioIds.map((id) => (
                      <button key={id} onClick={() => { setScenarioId(id); setSelected(e); setTab('trace'); void runTrace(id); }} style={{ ...btnTiny, background: '#3d5a3d' }}>
                        ▶ replay {id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {rows.length === 0 && !isMissing(ledger) && <div style={{ opacity: 0.6, fontSize: 13 }}>nothing matches these filters.</div>}
            </div>
          </>
        )}

        {tab === 'content' && (
          <div data-testid="wb-content">
            <div style={filterBar}>
              <span style={pillLabel}>content id</span>
              <input value={contentId} onChange={(e) => setContentId(e.target.value)} placeholder="kennel" style={{ ...sel, minWidth: 220 }} />
            </div>
            {contentId === '' && <div style={{ opacity: 0.6, fontSize: 13 }}>Name a card, rune or quest id — or click one from a finding in the inbox.</div>}
            {contentId !== '' && <ContentDetail
              contentId={contentId}
              contract={contractFor(contentId)}
              entries={entries.filter((e) => e.contentIds.includes(contentId))}
              text={text && !isMissing(text) ? text : null}
              runs={(interactions && !isMissing(interactions) ? interactions.runs ?? [] : []).filter((r) => r.members.includes(contentId))}
            />}
          </div>
        )}

        {tab === 'trace' && (
          <div data-testid="wb-trace">
            <div style={filterBar}>
              <span style={pillLabel}>scenario</span>
              <input value={scenarioId} onChange={(e) => setScenarioId(e.target.value)} placeholder="regression-… or a curated scenario id" style={{ ...sel, minWidth: 320 }} />
              <button onClick={() => void runTrace(scenarioId)} style={btn('#3d5a3d')}>▶ Run</button>
              {selected && <span style={{ fontSize: 12, opacity: 0.7 }}>for finding {selected.fingerprint} — {selected.title}</span>}
            </div>
            {traceError && <div style={warn}>{traceError}</div>}
            {traceResult && <TraceView result={traceResult} />}
            {!traceResult && !traceError && <div style={{ opacity: 0.6, fontSize: 13 }}>
              Runs the scenario through the REAL `runQaScenario` — the same engine the CLI and Scene Builder use.
              An action trail with recorded rails reports its FIRST divergence; expectations report pass/fail.
            </div>}
          </div>
        )}

        {tab === 'interactions' && (
          <div data-testid="wb-interactions">
            {isMissing(interactions) && <div style={warn}>No interaction report yet — {interactions.hint}.</div>}
            {interactions && !isMissing(interactions) && (
              <>
                <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                  <thead><tr>{['family', 'covered', 'failed', 'inapplicable', 'blocked', 'total'].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {familyCoverage(interactions.runs ?? []).map((f) => (
                      <tr key={f.family}>
                        <td style={td}><strong>{f.family}</strong></td>
                        {['covered', 'failed', 'inapplicable', 'blocked'].map((v) => (
                          <td key={v} style={{ ...td, color: v === 'failed' && f.verdicts[v] ? '#e08585' : undefined }}>{f.verdicts[v] ?? 0}</td>
                        ))}
                        <td style={td}>{f.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>Rows — click a member to open its Content detail:</div>
                {(interactions.runs ?? []).slice(0, 200).map((r, i) => (
                  <div key={`${r.family}-${i}`} style={{ ...card, padding: '6px 10px' }}>
                    <span style={tag(verdictColour(r.verdict))}>{r.verdict}</span>{' '}
                    <span style={{ fontSize: 12, opacity: 0.8 }}>{r.family} · {r.tier}</span>{' '}
                    {r.members.map((m) => <button key={m} onClick={() => openContent(m)} style={btnTiny}>{m}</button>)}
                    {r.evidence && <div style={{ fontSize: 11, opacity: 0.6, marginTop: 3 }}>{r.evidence}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === 'text' && (
          <div data-testid="wb-text">
            {isMissing(text) && <div style={warn}>No text sweep artifact yet — {text.hint}.</div>}
            {text && !isMissing(text) && (
              <>
                <h3 style={h3}>Verified mismatches ({text.mismatches?.length ?? 0}) — these come first</h3>
                {(text.mismatches ?? []).map((m) => {
                  const printed = printedTextOf(m.contentId);
                  return (
                    <div key={`${m.contentId}-${m.taxonomy}`} style={card}>
                      <div><span style={tag('#6b3030')}>{m.taxonomy}</span> <button onClick={() => openContent(m.contentId)} style={btnTiny}>{m.contentId}</button></div>
                      {printed && <div style={quote}>{printed.text || '(no printed text)'}</div>}
                      <div style={{ fontSize: 12, marginTop: 4 }}>issue — expected <code>{m.expected}</code>, observed <code>{m.observed}</code></div>
                    </div>
                  );
                })}
                <h3 style={h3}>Wording recommendations ({text.recommendations?.length ?? 0}) — suggestions only, never applied</h3>
                {(text.recommendations ?? []).map((r) => {
                  const id = r.contentIds[0] ?? '';
                  const printed = id ? printedTextOf(id) : null;
                  const ruleId = r.ruleIds[0];
                  return (
                    <div key={r.fingerprint} style={card}>
                      <div><strong style={{ fontSize: 13 }}>{r.title}</strong></div>
                      {printed && <div style={quote}><em>current:</em> {printed.text || '(none)'}</div>}
                      <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>issue — {r.summary}</div>
                      {r.suggestedText && <div style={{ ...quote, borderLeftColor: '#3d5a3d' }}><em>suggestion:</em> {r.suggestedText}</div>}
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        {r.contentIds.map((c) => <button key={c} onClick={() => openContent(c)} style={btnTiny}>{c}</button>)}
                        {ruleId ? (
                          <>
                            <button onClick={() => void decide(ruleId, 'approve')} style={btn('#3d5a3d')}>✓ Accept (writes decisions.json)</button>
                            <button onClick={() => void decide(ruleId, 'reject')} style={btn('#6b3030')}>✕ Dismiss</button>
                            {decided[ruleId] && <span style={{ fontSize: 12, opacity: 0.8 }}>→ {decided[ruleId]}</span>}
                          </>
                        ) : (
                          <span style={{ fontSize: 12, opacity: 0.6 }}>no rule card yet — run `npm run docbot:text` to seed the Sitting-3 deck, then decide it on the triage board</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 10 }}>
                  Accepting records an OWNER DECISION in <code>decisions.json</code> through the same endpoint the
                  triage board uses. It never edits a card, rune or quest file (§23).
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-views ─────────────────────────────────────────────────────────────────────────────────────────────

function ContentDetail({ contentId, contract, entries, text, runs }: {
  contentId: string;
  contract: ContentContract | undefined;
  entries: LedgerEntryView[];
  text: TextReviewView | null;
  runs: InteractionRunView[];
}): JSX.Element {
  const printed = printedTextOf(contentId);
  const mismatch = text?.mismatches?.find((m) => m.contentId === contentId);
  const unresolved = text?.unresolved?.find((u) => u.contentId === contentId);
  return (
    <>
      <div style={card}>
        <h3 style={h3}>Printed text</h3>
        {printed
          ? <><div style={{ fontSize: 13 }}><strong>{printed.name}</strong> <span style={tag('#2a2e40')}>{printed.kind}</span></div><div style={quote}>{printed.text || '(vanilla — no text)'}</div></>
          : <div style={{ opacity: 0.6, fontSize: 13 }}>no card, rune or quest with id <code>{contentId}</code> in this checkout.</div>}
      </div>

      <div style={card}>
        <h3 style={h3}>Semantic contract</h3>
        {contract ? (
          <>
            <div style={{ fontSize: 12 }}>
              <span style={tag(contract.reviewStatus === 'approved' ? '#3d5a3d' : '#5a5030')}>{contract.reviewStatus}</span>{' '}
              revision {contract.revision} · {contract.contentType}
              {contract.extraction && <> · extracted by {contract.extraction.extractor ?? '?'} (confidence {contract.extraction.confidence})</>}
            </div>
            {contract.extraction?.unparsed?.length ? (
              <div style={{ fontSize: 12, marginTop: 4, color: '#e0c185' }}>
                unparsed (never a silent pass — §4.3): {contract.extraction.unparsed.join(' · ')}
              </div>
            ) : null}
            <div style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}>
              triggers {contract.triggers?.length ?? 0} · effects {contract.effects?.length ?? 0}
              {contract.keywords?.length ? ` · keywords ${contract.keywords.join(', ')}` : ''}
              {contract.relatedRuleIds?.length ? ` · rules ${contract.relatedRuleIds.join(', ')}` : ''}
            </div>
          </>
        ) : <div style={{ opacity: 0.6, fontSize: 13 }}>no contract for this id — a coverage gap (§12.1).</div>}
      </div>

      <div style={card}>
        <h3 style={h3}>Text parser verdict</h3>
        {mismatch && <div style={{ fontSize: 12 }}><span style={tag('#6b3030')}>{mismatch.taxonomy}</span> expected <code>{mismatch.expected}</code>, observed <code>{mismatch.observed}</code></div>}
        {unresolved && <div style={{ fontSize: 12, color: '#e0c185' }}>unresolved parse spans: {unresolved.unresolved.map((u) => `"${u}"`).join(' · ')}</div>}
        {!mismatch && !unresolved && <div style={{ opacity: 0.6, fontSize: 13 }}>parsed-equivalent, or the text sweep artifact is not loaded.</div>}
      </div>

      <div style={card}>
        <h3 style={h3}>Open findings ({entries.length})</h3>
        {entries.map((e) => (
          <div key={e.fingerprint} style={{ fontSize: 12, padding: '3px 0' }}>
            <span style={tag(bucketColour(bucketOfEntry(e)))}>{bucketOfEntry(e)}</span> {e.title} <span style={{ opacity: 0.55 }}>({e.lane} ×{e.occurrences})</span>
          </div>
        ))}
        {entries.length === 0 && <div style={{ opacity: 0.6, fontSize: 13 }}>none in the ledger.</div>}
      </div>

      <div style={card}>
        <h3 style={h3}>Interaction coverage ({runs.length} row{runs.length === 1 ? '' : 's'})</h3>
        {runs.map((r, i) => (
          <div key={`${r.family}-${i}`} style={{ fontSize: 12, padding: '3px 0' }}>
            <span style={tag(verdictColour(r.verdict))}>{r.verdict}</span> {r.family} · with {r.members.filter((m) => m !== contentId).join(', ') || '—'}
          </div>
        ))}
        {runs.length === 0 && <div style={{ opacity: 0.6, fontSize: 13 }}>no interaction rows cover this id yet.</div>}
      </div>
    </>
  );
}

function TraceView({ result }: { result: QaScenarioResult }): JSX.Element {
  const rows = traceRowsOf(result);
  const div = result.firstDivergence;
  return (
    <>
      <div style={card}>
        <div style={{ fontSize: 13 }}>
          <span style={tag(result.ok ? '#3d5a3d' : '#6b3030')}>{result.ok ? 'PASS' : 'FAIL'}</span>{' '}
          <strong>{result.scenarioId}</strong>
          {result.combatOutcome && <> · combat {result.combatOutcome}</>} · {rows.length} semantic events
        </div>
        <pre style={{ ...quote, whiteSpace: 'pre-wrap', fontSize: 11 }}>{result.summary}</pre>
        <div style={{ fontSize: 11, opacity: 0.7 }}>repro: <code>{result.repro}</code></div>
      </div>

      {div && (
        <div style={{ ...card, borderColor: '#8a4a4a', background: '#241417' }} data-testid="wb-divergence">
          <h3 style={h3}>⚠ First divergence — action #{div.actionIndex} ({div.actionType}), rail {div.rail}</h3>
          <div style={{ fontSize: 12 }}>expected <code>{div.expected}</code></div>
          <div style={{ fontSize: 12 }}>observed <code>{div.observed}</code></div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
            Everything before this action replayed exactly; this is the first point where the recording and this
            checkout disagree.
          </div>
        </div>
      )}

      <div style={card}>
        <h3 style={h3}>Expectations</h3>
        {result.expectationResults.map((r, i) => (
          <div key={i} style={{ fontSize: 12, padding: '2px 0', color: r.pass ? undefined : '#e08585' }}>
            {r.pass ? '✓' : '✗'} [{r.expectation.kind}] {r.detail}
          </div>
        ))}
        {result.needsRuling.map((q, i) => <div key={`nr${i}`} style={{ fontSize: 12, color: '#e0c185' }}>? {q}</div>)}
      </div>

      <div style={card}>
        <h3 style={h3}>Semantic trace</h3>
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {rows.map((r) => (
            <div key={r.index} style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', padding: '1px 0', opacity: 0.85 }}>
              <span style={{ opacity: 0.5 }}>#{r.index}</span> <strong>{r.type}</strong> {r.detail}
            </div>
          ))}
          {rows.length === 0 && <div style={{ opacity: 0.6, fontSize: 13 }}>this scenario emitted no events.</div>}
        </div>
      </div>
    </>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}): JSX.Element {
  return (
    <label style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span style={pillLabel}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={sel}>
        <option value="">all</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

// ── Styles (inline, BugBoard's palette; NEVER a bare `cursor: pointer` — the global rule paints the gauntlet) ──

const shell: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(10, 12, 20, 0.96)', color: '#e8e4d8',
  display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif',
};
const header: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
  borderBottom: '1px solid #3a3f55', flexWrap: 'wrap',
};
const tabBar: React.CSSProperties = {
  display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap', borderBottom: '1px solid #2a2e40',
};
const body: React.CSSProperties = { flex: 1, overflowY: 'auto', padding: '12px 16px' };
const filterBar: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10,
};
const card: React.CSSProperties = {
  background: '#161a28', border: '1px solid #2a2e40', borderRadius: 8, padding: '8px 12px', marginBottom: 8,
};
const quote: React.CSSProperties = {
  borderLeft: '3px solid #5a5030', paddingLeft: 8, margin: '6px 0', fontSize: 12, opacity: 0.9,
};
const warn: React.CSSProperties = {
  background: '#2a2010', border: '1px solid #5a5030', borderRadius: 6, padding: '6px 12px',
  margin: '8px 16px', fontSize: 12,
};
const h3: React.CSSProperties = { fontSize: 12, margin: '0 0 6px', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' };
const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #3a3f55', padding: '4px 8px', opacity: 0.7 };
const td: React.CSSProperties = { borderBottom: '1px solid #212434', padding: '3px 8px' };

/** House rule: never a bare `cursor: pointer` — the global button rule paints the gauntlet. */
const btn = (bg: string): React.CSSProperties => ({
  background: bg, color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 6,
  padding: '5px 12px', fontSize: 12,
});
const btnTiny: React.CSSProperties = {
  background: '#2a2e40', color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 4,
  padding: '1px 6px', fontSize: 11,
};
const sel: React.CSSProperties = {
  background: '#0e1120', color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 6,
  padding: '2px 6px', fontSize: 12,
};
const pillLabel: React.CSSProperties = { fontSize: 11, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.05em' };
const tag = (bg: string): React.CSSProperties => ({
  background: bg, borderRadius: 4, padding: '1px 6px', fontSize: 11, display: 'inline-block',
});

const bucketColour = (b: string): string =>
  b === 'regression-protected' ? '#3d5a3d' : b === 'fixed' ? '#2f4a3a' : b === 'ruled' ? '#3d4a6b' : b === 'acknowledged' ? '#5a5030' : '#6b3030';
const verdictColour = (v: string): string =>
  v === 'covered' ? '#3d5a3d' : v === 'failed' ? '#6b3030' : v === 'blocked' ? '#5a5030' : '#2a2e40';
