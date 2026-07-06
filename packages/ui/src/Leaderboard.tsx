import { useEffect, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import { getHero, isCalibrationRound, type BoardMinion } from '@game/sim';
import { Card, type CardView } from './Card';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { fetchVictories, remoteEnabled, type VictoryRow } from './remoteBoards';

/** A read-only card view from a stored snapshot minion (the rest comes from the card def) — mirrors the
 *  end screen's final-warband render so the cards read identically (incl. full-text-on-hover). */
function cardViewOf(m: BoardMinion): CardView {
  const def = CARD_INDEX[m.cardId];
  return {
    name: def?.name ?? m.cardId, cardId: m.cardId, tribe: def?.tribe ?? 'neutral', tribe2: def?.tribe2,
    attack: m.attack, health: m.health, keywords: m.keywords ?? [],
    text: def?.text ?? '', goldenText: def?.goldenText, golden: m.golden,
    tier: def?.tier ?? 1, baseAttack: def?.attack ?? m.attack, baseHealth: def?.health ?? m.health,
    // Per-source buff breakdown (captured in the snapshot) → shown in the right-click inspect panel. Older
    // snapshots (captured before this shipped) carry none, so the panel just doesn't appear for them.
    buffs: m.buffs,
  };
}

/**
 * Leaderboard — a full "Hall of Champions" PAGE (not a modal): the latest 20 VICTORY runs from the shared
 * backend (`fetchVictories`), scrollable, with a Back button top-left. Each entry shows the champion (rank ·
 * hero · author · wave · date) and their final winning warband inline, rendered with the same `Card` as the
 * end screen (so cards size correctly + show full text on hover, on top). Read-only + best-effort.
 */
export function Leaderboard() {
  const show = useGame((s) => s.showLeaderboard);
  const close = useGame((s) => s.closeLeaderboard);
  const [rows, setRows] = useState<VictoryRow[] | null>(null);

  useEffect(() => {
    if (!show) return;
    setRows(null); // reset to the loading state each time it opens
    let alive = true;
    void fetchVictories(20).then((r) => { if (alive) setRows(r); });
    return () => { alive = false; };
  }, [show]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };

  return (
    <div className="lbpage">
      <div className="lbtopbar">
        <button className="lbback" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="crown" />
          <div>
            <div className="esch disp">Hall of Champions</div>
            <div className="lbsub">The latest 20 victory runs</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {!remoteEnabled() ? (
          <div className="lbempty">Leaderboard unavailable — no backend configured.</div>
        ) : rows === null ? (
          <div className="lbempty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="lbempty">No champions yet — be the first to summit.</div>
        ) : (
          rows.map((r, i) => {
            const hero = getHero(r.heroId);
            const art = heroArt(r.heroId);
            return (
              <div className="lbentry" key={i}>
                <div className="lbentry-head">
                  <div className="lbrank">{i + 1}</div>
                  <div className="lbportrait">
                    {art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
                  </div>
                  <div className="lbinfo">
                    <div className="lbname">{r.author || hero.name}</div>
                    <div className="lbmeta">{hero.name} · Wave {r.wave}{r.date ? ` · ${r.date}` : ''}</div>
                    {r.history && (
                      <div className="lbpips" aria-label="Round results">
                        {[...r.history].map((c, k) => {
                          const res = c === 'W' ? 'win' : c === 'L' ? 'lose' : 'draw';
                          const cal = isCalibrationRound(k + 1);
                          return (
                            <span
                              key={k}
                              className={`lbpip ${res}${cal ? ' cal' : ''}`}
                              title={`Round ${k + 1}: ${res}${cal ? ' (calibration — not scored)' : ''}`}
                            >
                              {c}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                {r.board && r.board.minions.length > 0 && (
                  <div className="lbwarband">
                    {r.board.minions.map((m, j) => <Card key={j} card={cardViewOf(m)} suppressPop />)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
