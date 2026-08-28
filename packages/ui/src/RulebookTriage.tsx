import { useCallback, useEffect, useMemo, useState } from 'react';
import { allRules, type ResolvedRule } from '@game/rules';

/**
 * RULEBOOK TRIAGE — the owner's clickable ruling board (DEV MENU → Rulebook).
 *
 * One card per pending rule, seeded from Doc Bot's queues (`npm run rules:seed` + the WP B convention deck
 * from `npm run contracts:extract`): the statement, what the game does today, and Claude's recommendation.
 * Approve / Revise… / Reject POST to the dev server (`rulebookPlugin`), which writes
 * `packages/rules/src/registry/decisions.json`: a click becomes a git-tracked ruling with no file editing.
 * Revise opens a note box (the owner's wording IS the rule).
 *
 * TWO VIEWS over the same worklist, same writes (owner-review-pipeline.md §4 — the 2–5s bar):
 *  · LIST — the original scrolling board, for browsing.
 *  · FLY-THROUGH — one question per screen, big buttons AND keys: Y/Enter approve · N reject · E/R revise ·
 *    S/→ skip (requeues to the sitting's tail) · U/Backspace undo last · Esc leave. A progress bar tracks
 *    `answered / total · est. remaining`; the sitting is whatever the current queue chip filters to. Every
 *    keypress is the SAME durable POST as a list click — no batch step that could lose a sitting.
 *
 * Dev-only (mounted from DevMenu, stripped from production). Filters are plain state, no persistence —
 * the durable artifact is decisions.json, not the view.
 */

const QUEUE_LABELS: Record<string, string> = {
  factoryPhase: 'Phase gaps',
  spellPowerFolding: 'Spell power',
  runeRewardDifferential: 'Rune 2nd copies',
  combatDifferential: 'Combat inert',
  'combatDifferential.golden': 'Golden-flat',
  combatModLane: 'Combat mods',
  heroPowerLane: 'Hero powers',
  playDifferential: 'Play inert',
  'playDifferential.watchers': 'Watchers',
  'playDifferential.refused': 'Refused spells',
  'contracts.conventions': 'Conventions',
};

/** Seconds per answer the estimate assumes (the owner's own 2–5s bar, middled). */
const SECS_PER_CARD = 4;
const estimate = (n: number): string => {
  const s = n * SECS_PER_CARD;
  return s < 60 ? `~${s}s` : `~${Math.round(s / 60)} min`;
};

export function RulebookTriage({ onClose, rules: injected }: {
  onClose: () => void;
  /** TEST SEAM (repo convention: ruleImpact/enforcementErrors/bugs backend are all injectable). The board
   *  reads the live registry in the app; a test supplies its own worklist so the UI suite does not depend on
   *  how much triage the owner has finished — the 2026-08-28 sitting emptied the board and broke it once. */
  rules?: ResolvedRule[];
}): JSX.Element {
  const [rules, setRules] = useState<ResolvedRule[]>(() => injected ?? allRules());
  const [queue, setQueue] = useState<string>('all');
  const [showDecided, setShowDecided] = useState(false);
  const [revising, setRevising] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // ── fly-through state ──
  const [fly, setFly] = useState(false);
  const [sitting, setSitting] = useState<string[]>([]); // rule ids, skip moves to tail
  const [skipped, setSkipped] = useState<string[]>([]);
  const [lastDecided, setLastDecided] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false);

  const queues = useMemo(() => {
    const qs = new Map<string, number>();
    for (const r of rules) if (r.sourceQueue && r.effective === 'needs-ruling') qs.set(r.sourceQueue, (qs.get(r.sourceQueue) ?? 0) + 1);
    return [...qs.entries()].sort((a, b) => b[1] - a[1]);
  }, [rules]);

  const worklist = useMemo(() => rules.filter((r) =>
    r.effective === 'needs-ruling'
    && r.status !== 'approved' // hand-approved registry rules aren't triage work
    && (queue === 'all' || r.sourceQueue === queue)), [rules, queue]);

  const visible = useMemo(() => rules.filter((r) =>
    (showDecided || r.effective === 'needs-ruling')
    && r.status !== 'approved'
    && (queue === 'all' || r.sourceQueue === queue)), [rules, queue, showDecided]);

  const decidedCount = rules.filter((r) => r.status === 'needs-ruling' && r.effective !== 'needs-ruling').length;
  const pendingCount = rules.filter((r) => r.effective === 'needs-ruling').length;

  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const stillPending = useCallback((id: string): boolean => byId.get(id)?.effective === 'needs-ruling', [byId]);
  const flyRemaining = sitting.filter(stillPending);
  const flyCurrent = flyRemaining.length ? byId.get(flyRemaining[0]!) : undefined;
  const flyAnswered = sitting.length - flyRemaining.length;

  const decide = useCallback(async (id: string, decision: 'approve' | 'revise' | 'reject', noteText?: string): Promise<void> => {
    setError(null);
    try {
      const res = await fetch('/__rulebook/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, decision, ...(noteText ? { note: noteText } : {}) }),
      });
      if (!res.ok) { setError((await res.json() as { error?: string }).error ?? 'write failed'); return; }
      setRules((rs) => rs.map((r) => (r.id === id
        ? { ...r, effective: decision === 'approve' ? 'approved' : decision === 'revise' ? 'revised' : 'rejected', decision: { decision, note: noteText, decidedAt: new Date().toISOString() } }
        : r)));
      setRevising(null);
      setNote('');
      setLastDecided(id);
      setShowMore(false);
    } catch {
      setError('dev server unreachable — the board only writes while `npm run dev` is serving');
    }
  }, []);

  const clear = useCallback(async (id: string): Promise<void> => {
    await fetch('/__rulebook/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clear: id }) });
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, effective: 'needs-ruling', decision: undefined } : r)));
  }, []);

  const startFly = (): void => {
    setSitting(worklist.map((r) => r.id));
    setSkipped([]);
    setLastDecided(null);
    setShowMore(false);
    setFly(true);
  };

  const skipCurrent = useCallback((): void => {
    if (!flyCurrent) return;
    const id = flyCurrent.id;
    setSitting((s) => [...s.filter((x) => x !== id), id]); // requeue to the sitting's tail
    setSkipped((s) => (s.includes(id) ? s : [...s, id]));
    setShowMore(false);
  }, [flyCurrent]);

  const undoLast = useCallback((): void => {
    if (!lastDecided) return;
    const id = lastDecided;
    void clear(id);
    setSitting((s) => [id, ...s.filter((x) => x !== id)]); // back to the front for a fresh decision
    setLastDecided(null);
  }, [lastDecided, clear]);

  // ── the keyboard half of the 2–5s bar (Y/N/E/S/U, arrows, Esc) ──
  useEffect(() => {
    if (!fly) return undefined;
    const onKey = (ev: KeyboardEvent): void => {
      if (revising) {
        if (ev.key === 'Escape') { setRevising(null); setNote(''); ev.preventDefault(); }
        return; // the note input owns every other key while open
      }
      const id = flyCurrent?.id;
      switch (ev.key) {
        case 'y': case 'Y': case 'Enter':
          if (id) void decide(id, 'approve');
          break;
        case 'n': case 'N':
          if (id) void decide(id, 'reject');
          break;
        case 'e': case 'E': case 'r': case 'R':
          if (id) setRevising(id);
          break;
        case 's': case 'S': case 'ArrowRight':
          skipCurrent();
          break;
        case 'u': case 'U': case 'Backspace':
          undoLast();
          break;
        case 'Escape':
          setFly(false);
          break;
        default:
          return;
      }
      ev.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fly, revising, flyCurrent, decide, skipCurrent, undoLast]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(10, 12, 20, 0.96)', color: '#e8e4d8',
      display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #3a3f55' }}>
        <strong style={{ fontSize: 16 }}>📜 Rulebook triage</strong>
        <span style={{ opacity: 0.75, fontSize: 13 }}>{pendingCount} pending · {decidedCount} decided this backlog</span>
        {!fly && worklist.length > 0 && (
          <button onClick={startFly} style={btn('#3d4a6b')} title="One question per screen · Y approve · N reject · E revise · S skip · U undo · Esc leave">
            ⚡ Fly through ({worklist.length} · {estimate(worklist.length)})
          </button>
        )}
        {fly && <button onClick={() => setFly(false)} style={btn('#2a2e40')}>Esc · back to list</button>}
        <label style={{ marginLeft: 'auto', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} /> show decided
        </label>
        <button onClick={onClose} style={btn('#6b3030')}>✕ Close</button>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap', borderBottom: '1px solid #2a2e40' }}>
        <button onClick={() => { setQueue('all'); setFly(false); }} style={btn(queue === 'all' ? '#3d5a3d' : '#2a2e40')}>All ({pendingCount})</button>
        {queues.map(([q, n]) => (
          <button key={q} onClick={() => { setQueue(q); setFly(false); }} style={btn(queue === q ? '#3d5a3d' : '#2a2e40')} title={`Sitting: ${n} questions, ${estimate(n)}`}>
            {QUEUE_LABELS[q] ?? q} ({n})
          </button>
        ))}
      </div>

      {error && <div style={{ padding: '6px 16px', color: '#ff9d9d', fontSize: 13 }}>{error}</div>}

      {fly ? (
        <div data-fly style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', overflowY: 'auto', padding: '18px 16px' }}>
          {/* progress: n of N · skips shown separately so a sitting ends honestly */}
          <div style={{ width: 'min(760px, 100%)' }}>
            <div data-fly-progress style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>
              {flyAnswered} of {sitting.length} answered · {skipped.filter(stillPending).length} skipped · {estimate(flyRemaining.length)} remaining
            </div>
            <div style={{ height: 6, background: '#22263a', borderRadius: 3, marginBottom: 18 }}>
              <div style={{ height: 6, width: `${sitting.length ? Math.round((flyAnswered / sitting.length) * 100) : 100}%`, background: '#5a8a5a', borderRadius: 3 }} />
            </div>
          </div>

          {flyCurrent ? (
            <div data-fly-card style={{ width: 'min(760px, 100%)', border: '1px solid #3a3f55', borderRadius: 10, padding: '18px 22px', background: '#161a28' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 8 }}>
                <strong style={{ fontSize: 17 }}>{flyCurrent.title}</strong>
                <code style={{ fontSize: 11, opacity: 0.55 }}>{flyCurrent.id}</code>
                <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 'auto' }}>{QUEUE_LABELS[flyCurrent.sourceQueue ?? ''] ?? flyCurrent.sourceQueue}</span>
              </div>
              {flyCurrent.cardText && (
                <div style={{ fontSize: 13, margin: '6px 0 8px', padding: '8px 12px', borderLeft: '3px solid #b8963f', background: '#1d1a10', borderRadius: 4, lineHeight: 1.5, color: '#e6d9a8', maxHeight: 180, overflowY: 'auto' }}>
                  {flyCurrent.cardText}
                </div>
              )}
              <div style={{ fontSize: 14.5, margin: '8px 0', lineHeight: 1.55 }}>{flyCurrent.statement}</div>
              {flyCurrent.example && <div style={{ fontSize: 13, opacity: 0.85, fontStyle: 'italic', marginBottom: 6 }}>{flyCurrent.example}</div>}

              {(flyCurrent.currentBehaviour ?? flyCurrent.recommendation) && (
                <div style={{ marginBottom: 8 }}>
                  <button onClick={() => setShowMore((m) => !m)} style={btn('#22263a')}>{showMore ? 'less' : 'more…'}</button>
                  {showMore && (
                    <div style={{ marginTop: 6 }}>
                      {flyCurrent.currentBehaviour && <div style={{ fontSize: 12.5, opacity: 0.75 }}>Today: {flyCurrent.currentBehaviour}</div>}
                      {flyCurrent.recommendation && <div style={{ fontSize: 12.5, color: '#a9c6a9', marginTop: 3 }}>Claude recommends: {flyCurrent.recommendation}</div>}
                    </div>
                  )}
                </div>
              )}

              {revising === flyCurrent.id ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <input
                    autoFocus value={note} onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) void decide(flyCurrent.id, 'revise', note); }}
                    placeholder="Your wording — this becomes the rule (Enter saves · Esc cancels)"
                    style={{ flex: 1, background: '#0e1120', color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 6, padding: '10px 12px', fontSize: 14 }}
                  />
                  <button onClick={() => void decide(flyCurrent.id, 'revise', note)} style={bigBtn('#5a5030')}>Save revision</button>
                  <button onClick={() => { setRevising(null); setNote(''); }} style={bigBtn('#2a2e40')}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                  <button onClick={() => void decide(flyCurrent.id, 'approve')} style={bigBtn('#3d5a3d')}>✓ Approve <kbd style={kbd}>Y</kbd></button>
                  <button onClick={() => setRevising(flyCurrent.id)} style={bigBtn('#5a5030')}>✎ Revise <kbd style={kbd}>E</kbd></button>
                  <button onClick={() => void decide(flyCurrent.id, 'reject')} style={bigBtn('#6b3030')}>✕ Reject <kbd style={kbd}>N</kbd></button>
                  <button onClick={skipCurrent} style={bigBtn('#2a2e40')}>⏭ Skip <kbd style={kbd}>S</kbd></button>
                  {lastDecided && <button onClick={undoLast} style={bigBtn('#22263a')}>↩ Undo <kbd style={kbd}>U</kbd></button>}
                </div>
              )}
            </div>
          ) : (
            <div data-fly-done style={{ textAlign: 'center', padding: 40 }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>Sitting complete 🎉</div>
              <div style={{ opacity: 0.8, fontSize: 14 }}>answered {flyAnswered}, skipped {skipped.filter(stillPending).length} — every answer already written to decisions.json</div>
              <button onClick={() => setFly(false)} style={{ ...bigBtn('#2a2e40'), marginTop: 16 }}>Back to list</button>
            </div>
          )}
        </div>
      ) : (
      <div style={{ overflowY: 'auto', flex: 1, padding: '10px 16px' }}>
        {visible.map((r) => (
          <div key={r.id} style={{
            border: '1px solid #3a3f55', borderRadius: 8, padding: '10px 14px', marginBottom: 10,
            background: r.effective === 'needs-ruling' ? '#161a28' : r.effective === 'approved' ? '#14231a' : r.effective === 'revised' ? '#20202e' : '#241618',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <strong style={{ fontSize: 14 }}>{r.title}</strong>
              <code style={{ fontSize: 11, opacity: 0.55 }}>{r.id}</code>
              <span style={{ fontSize: 11, opacity: 0.55, marginLeft: 'auto' }}>{QUEUE_LABELS[r.sourceQueue ?? ''] ?? r.sourceQueue}</span>
            </div>
            {r.cardText && (
              <div style={{ fontSize: 12.5, margin: '6px 0 2px', padding: '6px 10px', borderLeft: '3px solid #b8963f', background: '#1d1a10', borderRadius: 4, lineHeight: 1.45, color: '#e6d9a8' }}>
                {r.cardText}
              </div>
            )}
            <div style={{ fontSize: 13, margin: '6px 0', lineHeight: 1.5 }}>{r.statement}</div>
            {r.example && <div style={{ fontSize: 12, opacity: 0.8, fontStyle: 'italic', marginBottom: 3 }}>{r.example}</div>}
            {r.currentBehaviour && <div style={{ fontSize: 12, opacity: 0.7 }}>Today: {r.currentBehaviour}</div>}
            {r.recommendation && <div style={{ fontSize: 12, color: '#a9c6a9', marginTop: 3 }}>Claude recommends: {r.recommendation}</div>}

            {r.effective === 'needs-ruling' ? (
              revising === r.id ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input
                    autoFocus value={note} onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) void decide(r.id, 'revise', note); }}
                    placeholder="Your wording — this becomes the rule"
                    style={{ flex: 1, background: '#0e1120', color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
                  />
                  <button onClick={() => void decide(r.id, 'revise', note)} style={btn('#5a5030')}>Save revision</button>
                  <button onClick={() => { setRevising(null); setNote(''); }} style={btn('#2a2e40')}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button onClick={() => void decide(r.id, 'approve')} style={btn('#3d5a3d')}>✓ Approve</button>
                  <button onClick={() => setRevising(r.id)} style={btn('#5a5030')}>✎ Revise…</button>
                  <button onClick={() => void decide(r.id, 'reject')} style={btn('#6b3030')}>✕ Reject</button>
                </div>
              )
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 12 }}>
                <span style={{ opacity: 0.85 }}>
                  {r.effective === 'approved' ? '✓ approved' : r.effective === 'revised' ? `✎ revised: “${r.decision?.note}”` : '✕ rejected'}
                </span>
                <button onClick={() => void clear(r.id)} style={btn('#2a2e40')}>undo</button>
              </div>
            )}
          </div>
        ))}
        {visible.length === 0 && <div style={{ opacity: 0.6, padding: 30, textAlign: 'center' }}>Nothing left in this queue. 🎉</div>}
      </div>
      )}
    </div>
  );
}

/** House rule: never a bare `cursor: pointer` — the global button rule paints the gauntlet. */
const btn = (bg: string): React.CSSProperties => ({
  background: bg, color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 6,
  padding: '5px 12px', fontSize: 12,
});

/** Fly-through's thumb-sized twins — every key has a visible button. Same no-cursor rule. */
const bigBtn = (bg: string): React.CSSProperties => ({
  background: bg, color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 8,
  padding: '12px 22px', fontSize: 15,
});

const kbd: React.CSSProperties = {
  marginLeft: 6, padding: '1px 6px', borderRadius: 4, border: '1px solid #4a4f65',
  background: '#10131f', fontSize: 11, opacity: 0.85,
};
