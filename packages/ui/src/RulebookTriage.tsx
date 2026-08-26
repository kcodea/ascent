import { useMemo, useState } from 'react';
import { allRules, type ResolvedRule } from '@game/rules';

/**
 * RULEBOOK TRIAGE — the owner's clickable ruling board (DEV MENU → Rulebook).
 *
 * One card per pending rule, seeded from Doc Bot's queues (`npm run rules:seed`): the statement, what the
 * game does today, and Claude's recommendation. Three clicks — Approve / Revise… / Reject — POST to the dev
 * server (`rulebookPlugin`), which writes `packages/rules/src/registry/decisions.json`: a click becomes a
 * git-tracked ruling with no file editing. Revise opens a note box (the owner's wording IS the rule).
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
};

export function RulebookTriage({ onClose }: { onClose: () => void }): JSX.Element {
  const [rules, setRules] = useState<ResolvedRule[]>(() => allRules());
  const [queue, setQueue] = useState<string>('all');
  const [showDecided, setShowDecided] = useState(false);
  const [revising, setRevising] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const queues = useMemo(() => {
    const qs = new Map<string, number>();
    for (const r of rules) if (r.sourceQueue && r.effective === 'needs-ruling') qs.set(r.sourceQueue, (qs.get(r.sourceQueue) ?? 0) + 1);
    return [...qs.entries()].sort((a, b) => b[1] - a[1]);
  }, [rules]);

  const visible = useMemo(() => rules.filter((r) =>
    (showDecided || r.effective === 'needs-ruling')
    && r.status !== 'approved' // hand-approved registry rules aren't triage work
    && (queue === 'all' || r.sourceQueue === queue)), [rules, queue, showDecided]);

  const decidedCount = rules.filter((r) => r.status === 'needs-ruling' && r.effective !== 'needs-ruling').length;
  const pendingCount = rules.filter((r) => r.effective === 'needs-ruling').length;

  const decide = async (id: string, decision: 'approve' | 'revise' | 'reject', noteText?: string): Promise<void> => {
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
    } catch {
      setError('dev server unreachable — the board only writes while `npm run dev` is serving');
    }
  };

  const clear = async (id: string): Promise<void> => {
    await fetch('/__rulebook/decide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clear: id }) });
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, effective: 'needs-ruling', decision: undefined } : r)));
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(10, 12, 20, 0.96)', color: '#e8e4d8',
      display: 'flex', flexDirection: 'column', fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid #3a3f55' }}>
        <strong style={{ fontSize: 16 }}>📜 Rulebook triage</strong>
        <span style={{ opacity: 0.75, fontSize: 13 }}>{pendingCount} pending · {decidedCount} decided this backlog</span>
        <label style={{ marginLeft: 'auto', fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showDecided} onChange={(e) => setShowDecided(e.target.checked)} /> show decided
        </label>
        <button onClick={onClose} style={btn('#6b3030')}>✕ Close</button>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap', borderBottom: '1px solid #2a2e40' }}>
        <button onClick={() => setQueue('all')} style={btn(queue === 'all' ? '#3d5a3d' : '#2a2e40')}>All ({pendingCount})</button>
        {queues.map(([q, n]) => (
          <button key={q} onClick={() => setQueue(q)} style={btn(queue === q ? '#3d5a3d' : '#2a2e40')}>
            {QUEUE_LABELS[q] ?? q} ({n})
          </button>
        ))}
      </div>

      {error && <div style={{ padding: '6px 16px', color: '#ff9d9d', fontSize: 13 }}>{error}</div>}

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
            <div style={{ fontSize: 13, margin: '6px 0', lineHeight: 1.45 }}>{r.statement}</div>
            {r.currentBehaviour && <div style={{ fontSize: 12, opacity: 0.7 }}>Today: {r.currentBehaviour}</div>}
            {r.recommendation && <div style={{ fontSize: 12, color: '#a9c6a9', marginTop: 3 }}>Claude recommends: {r.recommendation}</div>}

            {r.effective === 'needs-ruling' ? (
              revising === r.id ? (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <input
                    autoFocus value={note} onChange={(e) => setNote(e.target.value)}
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
    </div>
  );
}

/** House rule: never a bare `cursor: pointer` — the global button rule paints the gauntlet. */
const btn = (bg: string): React.CSSProperties => ({
  background: bg, color: '#e8e4d8', border: '1px solid #3a3f55', borderRadius: 6,
  padding: '5px 12px', fontSize: 12,
});
