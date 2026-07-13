import { useCallback, useRef, useState } from 'react';
import {
  createReportAccumulator, finalizeReport, mixReportSeed, pickableReportHeroes, playAndRecordInto,
  type BalanceReport, type ReportRow,
} from '@game/sim';
import { sfx } from './sfx';
import { useGame } from './store';

/**
 * DEV-only balance panel (owner request 2026-07-13) — the in-app face of `npm run report`. It runs the same
 * seeded greedy-bot report (`@game/sim` shares the sim with the CLI, so the numbers match exactly), but
 * hero-by-hero on a `setTimeout` yield so the main thread never locks up and a progress bar can tick. Results
 * are the five ranked offer/pick/win tables. Mounted only under `import.meta.env.DEV`; never ships to players.
 */
const GAME_CHOICES = [5, 10, 20, 30];

const fmtPct = (n: number): string => (n < 0 ? '–' : `${n}%`);
/** Win-rate → a coarse hue class so hot/cold cards pop (red under 30, green over 60). */
function heat(n: number): string {
  if (n < 0) return '';
  if (n >= 60) return ' hot';
  if (n >= 40) return ' warm';
  if (n >= 25) return ' cool';
  return ' cold';
}

function Table({ title, rows, showOffer }: { title: string; rows: ReportRow[]; showOffer: boolean }) {
  return (
    <div className="baltable">
      <div className="baltabletitle">{title} <span className="baldim">({rows.length})</span></div>
      <div className="balgrid" role="table">
        <div className="balrow balhead" role="row">
          <span role="columnheader">Name</span>
          {showOffer && <span role="columnheader" className="balnum">Offer</span>}
          <span role="columnheader" className="balnum">Pick</span>
          <span role="columnheader" className="balnum">Win</span>
          <span role="columnheader" className="balnum">n</span>
        </div>
        {rows.map((r) => (
          <div className="balrow" role="row" key={r.id}>
            <span role="cell" className="balname" title={r.id}>{r.name}</span>
            {showOffer && <span role="cell" className="balnum">{fmtPct(r.offerRate)}</span>}
            <span role="cell" className="balnum">{fmtPct(r.pickRate)}</span>
            <span role="cell" className={`balnum balwin${heat(r.winRate)}`}>{fmtPct(r.winRate)}</span>
            <span role="cell" className="balnum baldim">{r.games}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BalancePanel() {
  const show = useGame((s) => s.showBalance);
  const close = useGame((s) => s.closeBalance);
  const [games, setGames] = useState(10);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1 over heroes
  const [report, setReport] = useState<BalanceReport | null>(null);
  const cancelRef = useRef(false);

  const run = useCallback((gamesPerHero: number) => {
    sfx.pulse();
    setRunning(true);
    setProgress(0);
    setReport(null);
    cancelRef.current = false;
    const acc = createReportAccumulator();
    const heroes = pickableReportHeroes();
    // One hero per macrotask: play all its games, tick the bar, yield so the UI stays responsive.
    const step = (h: number): void => {
      if (cancelRef.current) { setRunning(false); return; }
      if (h >= heroes.length) {
        setReport(finalizeReport(acc, gamesPerHero));
        setProgress(1);
        setRunning(false);
        return;
      }
      for (let g = 0; g < gamesPerHero; g++) playAndRecordInto(acc, mixReportSeed(h + 1, g + 1), heroes[h]!.id);
      setProgress((h + 1) / heroes.length);
      setTimeout(() => step(h + 1), 0);
    };
    setTimeout(() => step(0), 0);
  }, []);

  if (!show) return null;

  const back = (): void => { cancelRef.current = true; sfx.pulse(); close(); };

  return (
    <div className="balpage">
      <div className="baltopbar">
        <button className="lbback" onClick={back}>← Back</button>
        <div className="baltitle">
          <div className="esch disp">Balance Report</div>
          <div className="balsub">Seeded greedy-bot runs · offer / pick / win rates · matches <code>npm run report</code></div>
        </div>
        <div className="balcontrols">
          <span className="baldim">games/hero</span>
          {GAME_CHOICES.map((g) => (
            <button key={g} className={`balchip${games === g ? ' on' : ''}`} disabled={running} onClick={() => setGames(g)}>{g}</button>
          ))}
          <button className="balrun" disabled={running} onClick={() => run(games)}>{running ? 'Running…' : 'Run'}</button>
        </div>
      </div>

      {running && (
        <div className="balprogress" aria-label="Report progress">
          <div className="balprogfill" style={{ transform: `scaleX(${progress})` }} />
          <span className="balprogtxt">{Math.round(progress * 100)}%</span>
        </div>
      )}

      <div className="balscroll">
        {report === null && !running ? (
          <div className="balempty">
            Runs {games} games for each of {pickableReportHeroes().length} heroes ({games * pickableReportHeroes().length} runs) in the
            browser. Higher counts = steadier numbers but a longer wait. Read <b>Offer</b> + <b>Win</b> as signal; <b>Pick</b> is the
            greedy bot&rsquo;s (dumb) policy. Card win rate is correlational (credits the whole final board).
          </div>
        ) : report ? (
          <>
            <Table title="Heroes" rows={report.heroes} showOffer={false} />
            <Table title="Quests" rows={report.quests} showOffer />
            <Table title="Runes" rows={report.runes} showOffer />
            <Table title="Minions" rows={report.minions} showOffer />
            <Table title="Spells" rows={report.spells} showOffer />
          </>
        ) : null}
      </div>
    </div>
  );
}
