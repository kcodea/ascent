import { useEffect, useState } from 'react';
import { aggregatePlayerReport, type PlayerReport, type PlayerReportRow } from '@game/sim';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchRunTelemetry, remoteEnabled } from './remoteBoards';

/**
 * Balance Report (owner request 2026-07-13) — the REAL-PLAYER balance report, opened from the home screen. It
 * fetches recent finished-run telemetry (`run_telemetry`, reconstructed from each run's replay at run-end) and
 * aggregates it client-side into offer / pick / win / average tables for heroes, quests, runes, and minions. This
 * is PLAYER data, not simulation — the seeded greedy-bot report still lives at `npm run report` (CLI). Best-effort:
 * empty until the backend is configured + the `run_telemetry` table migrated (see schema.sql).
 */
type Col = 'offer' | 'pick' | 'win' | 'avgWins' | 'avgTurns' | 'n';
const COL_LABEL: Record<Col, string> = { offer: 'Offer', pick: 'Pick', win: 'Win', avgWins: 'Avg Wins', avgTurns: 'Avg Turns', n: 'n' };

const fmtPct = (n: number): string => (n < 0 ? '–' : `${n}%`);
const fmtNum = (n: number | null): string => (n === null ? '–' : String(n));
/** Win-rate → a coarse hue class so hot/cold entries pop. */
function heat(n: number): string {
  if (n < 0) return '';
  if (n >= 55) return ' hot';
  if (n >= 35) return ' warm';
  if (n >= 20) return ' cool';
  return ' cold';
}

function cellFor(r: PlayerReportRow, c: Col): { text: string; cls: string } {
  switch (c) {
    case 'offer': return { text: fmtPct(r.offerRate), cls: 'balnum' };
    case 'pick': return { text: fmtPct(r.pickRate), cls: 'balnum' };
    case 'win': return { text: fmtPct(r.winRate), cls: `balnum balwin${heat(r.winRate)}` };
    case 'avgWins': return { text: fmtNum(r.avgWins), cls: 'balnum' };
    case 'avgTurns': return { text: fmtNum(r.avgTurns), cls: 'balnum' };
    case 'n': return { text: String(r.games || r.picked), cls: 'balnum baldim' };
  }
}

function Table({ title, rows, cols }: { title: string; rows: PlayerReportRow[]; cols: Col[] }) {
  return (
    <div className="baltable" style={{ ['--balcols' as string]: cols.length }}>
      <div className="baltabletitle">{title} <span className="baldim">({rows.length})</span></div>
      <div className="balgrid" role="table">
        <div className="balrow balhead" role="row">
          <span role="columnheader">Name</span>
          {cols.map((c) => <span key={c} role="columnheader" className="balnum">{COL_LABEL[c]}</span>)}
        </div>
        {rows.map((r) => (
          <div className="balrow" role="row" key={r.id}>
            <span role="cell" className="balname" title={r.id}>{r.name}</span>
            {cols.map((c) => { const cell = cellFor(r, c); return <span key={c} role="cell" className={cell.cls}>{cell.text}</span>; })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BalancePanel() {
  const show = useGame((s) => s.showBalance);
  const close = useGame((s) => s.closeBalance);
  const [report, setReport] = useState<PlayerReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = (): void => {
    setLoading(true);
    setReport(null);
    void fetchRunTelemetry(1000).then((rows) => {
      setReport(aggregatePlayerReport(rows));
      setLoading(false);
    });
  };

  useEffect(() => { if (show) load(); }, [show]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const refresh = (): void => { sfx.pulse(); load(); };

  return (
    <div className="balpage">
      <div className="baltopbar">
        <button className="lbback" onClick={back}>← Back</button>
        <div className="baltitle">
          <div className="esch disp">Balance Report</div>
          <div className="balsub">Real player data · offer / pick / win rates from finished runs{report ? ` · ${report.totalRuns} runs` : ''}</div>
        </div>
        <div className="balcontrols">
          <button className="balrun" disabled={loading} onClick={refresh}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      <div className="balscroll">
        {!remoteEnabled() ? (
          <div className="balempty">Balance report unavailable — no backend configured.</div>
        ) : loading ? (
          <div className="balempty">Loading player data…</div>
        ) : report && report.totalRuns > 0 ? (
          <>
            <Table title="Heroes" rows={report.heroes} cols={['offer', 'pick', 'win', 'avgWins', 'n']} />
            <Table title="Quests" rows={report.quests} cols={['offer', 'pick', 'win', 'avgTurns', 'n']} />
            <Table title="Runes" rows={report.runes} cols={['offer', 'pick', 'win', 'n']} />
            <Table title="Minions" rows={report.minions} cols={['offer', 'pick', 'n']} />
          </>
        ) : (
          <div className="balempty">
            No player data yet. Finished runs upload their offers/picks/outcomes to <code>run_telemetry</code>; this report
            aggregates them once runs have been logged (and the <code>run_telemetry</code> migration has been run).
          </div>
        )}
      </div>
    </div>
  );
}
