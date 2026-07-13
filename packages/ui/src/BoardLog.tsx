import { useEffect, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import { CONFIG, type BoardMinion } from '@game/sim';
import { Card, type CardView } from './Card';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchPlayerRoundBoards, remoteEnabled, type RoundBoard } from './remoteBoards';

/** Read-only card view from a stored snapshot minion — mirrors the leaderboard / Career. Pool boards carry the
 *  printed rule text (only the leaderboard/Career FINAL board bakes live text), so scaling cards read at base. */
function cardViewOf(m: BoardMinion): CardView {
  const def = CARD_INDEX[m.cardId];
  return {
    name: def?.name ?? m.cardId, cardId: m.cardId, tribe: def?.tribe ?? 'neutral',
    tribe2: def?.tribe2 ?? m.addedTribes?.find((t) => t !== (def?.tribe ?? 'neutral')), // Anomaly Reactor: show the spell-added tribe badge
    attack: m.attack, health: m.health, keywords: m.keywords ?? [],
    text: m.text ?? def?.text ?? '', goldenText: m.goldenText ?? def?.goldenText, golden: m.golden,
    tier: def?.tier ?? 1, baseAttack: def?.attack ?? m.attack, baseHealth: def?.health ?? m.health, buffs: m.buffs,
  };
}

// A board must have been fought at least this many times to count as your "winningest" for the round — a single
// lucky 1-of-1 shouldn't outrank a battle-tested board. Below the threshold we fall back to the best available.
const MIN_FIGHTS = 3;

/**
 * Career "Board Log" — click through rounds 1–17 to see YOUR winningest board at each round (best win-rate, with
 * a small min-fights threshold), its full fight record, and the board itself. Powered by the shared fight ledger
 * (`board_results`) joined to your uploaded boards; read-only + best-effort. Empty until you've uploaded boards
 * that others have fought (and the backend has the `board_results` table).
 */
export function BoardLog() {
  const playerName = useGame((s) => s.playerName);
  const [data, setData] = useState<Map<number, RoundBoard[]> | null>(null);
  const [round, setRound] = useState(1);

  useEffect(() => {
    let alive = true;
    setData(null);
    void fetchPlayerRoundBoards(playerName).then((m) => {
      if (!alive) return;
      setData(m);
      // Open on the round with your best-fought board, else your deepest round, else round 1.
      let pick = 0, bestFights = -1;
      for (const [r, arr] of m) {
        const f = arr[0]?.stats.fights ?? 0;
        if (f > bestFights || (f === bestFights && r > pick)) { bestFights = f; pick = r; }
      }
      if (pick > 0) setRound(pick);
    });
    return () => { alive = false; };
  }, [playerName]);

  const roundsWithData = data ? new Set(data.keys()) : new Set<number>();
  const boardsThisRound = data?.get(round) ?? [];
  // Winningest = best-record board with enough fights; fall back to the top-sorted board (already win-rate desc).
  const best = boardsThisRound.find((b) => b.stats.fights >= MIN_FIGHTS) ?? boardsThisRound[0];

  return (
    <div className="carcard boardlog">
      <div className="carsec">Board Log — your winningest board each round</div>
      {!remoteEnabled() ? (
        <div className="bl-empty">Board log unavailable — no backend configured.</div>
      ) : !playerName ? (
        <div className="bl-empty">Set a player name (title screen) to track your boards' records.</div>
      ) : data === null ? (
        <div className="bl-empty">Loading…</div>
      ) : (
        <>
          {/* Round 1–17 selector — a lit dot marks rounds you have a board for. */}
          <div className="bl-rounds" role="group" aria-label="Round selector">
            {Array.from({ length: CONFIG.courseRounds }, (_, i) => i + 1).map((r) => (
              <button
                key={r}
                className={`bl-round${r === round ? ' on' : ''}${roundsWithData.has(r) ? ' has' : ''}`}
                onClick={() => { sfx.pulse(); setRound(r); }}
                title={`Round ${r}${roundsWithData.has(r) ? '' : ' — no board yet'}`}
              >
                {r}
              </button>
            ))}
          </div>

          {best ? (
            <div className="bl-detail">
              <div className="bl-record" title="This board's record when served as an opponent at this round">
                <span className="bl-stat"><b>{best.stats.fights}</b> Fights</span>
                <span className="bl-stat w"><b>{best.stats.wins}</b> Wins</span>
                <span className="bl-stat t"><b>{best.stats.ties}</b> Ties</span>
                <span className="bl-stat l"><b>{best.stats.losses}</b> Losses</span>
                <span className="bl-wr"><Icon name="crown" />{best.stats.winRate}% win rate</span>
              </div>
              {best.stats.fights === 0 && (
                <div className="bl-note">No fights logged for round {round} yet — showing your board there.</div>
              )}
              <div className="bl-warband">
                {best.board.minions.map((m, j) => <Card key={j} card={cardViewOf(m)} suppressPop />)}
              </div>
              {boardsThisRound.length > 1 && (
                <div className="bl-note">{boardsThisRound.length} boards at round {round} — showing your winningest.</div>
              )}
            </div>
          ) : (
            <div className="bl-empty">No board recorded at round {round} yet.</div>
          )}
        </>
      )}
    </div>
  );
}
