import { CARD_INDEX } from '@game/content';
import { CONFIG, getHero, isCalibrationRound, runRecord, type BoardCard } from '@game/sim';
import { Card, type CardView } from './Card';
import { heroArt } from './art';
import { Icon } from './Icon';
import { useGame } from './store';

/** A read-only view of a board minion for the end-screen final-warband display. */
function boardView(m: BoardCard): CardView {
  const def = CARD_INDEX[m.cardId];
  return {
    name: def.name, cardId: m.cardId, tribe: m.tribe, tribe2: def.tribe2,
    attack: m.attack, health: m.health, keywords: m.keywords,
    text: def.text, goldenText: def.goldenText, golden: m.golden,
    tier: def.tier, baseAttack: def.attack, baseHealth: def.health, buffs: m.buffs,
  };
}

/**
 * End-of-run screen (both outcomes) — styled like the hero picker. Shows the title, the run's
 * round-by-round W-L-W summary, the final warband, and Play Again (→ hero picker).
 */
export function EndScreen({ won }: { won: boolean }) {
  const run = useGame((s) => s.run);
  const openTitle = useGame((s) => s.openTitle);
  const hero = getHero(run.heroId);
  const practice = run.mode === 'practice';
  // Ascent: the score is the W–L record over the scored rounds (calibration rounds don't count).
  const rec = runRecord(run);
  // Practice has no calibration concept — count every round.
  const rawWins = run.history.filter((r) => r === 'win').length;
  const rawLosses = run.history.filter((r) => r === 'lose').length;
  return (
    <div className={`heroselect endscreen${won ? ' won' : ''}`}>
      <div className="hsbox endbox">
        <div className="endhero">
          <div className="endhero-portrait">
            {heroArt(hero.id) ? (
              <img className="endhero-img" src={heroArt(hero.id)} alt={hero.name} draggable={false} />
            ) : (
              <Icon name="anvil" />
            )}
          </div>
          <div className="endhero-name">{hero.name}</div>
        </div>
        <div className="eyebrow">{practice ? 'Practice complete' : won ? 'The climb is complete' : 'The tide takes you'}</div>
        <h1 className="disp hstitle">{practice ? 'PRACTICE' : won ? 'COURSE COMPLETE' : 'FALLEN'}</h1>
        <div className="endsub">
          {practice
            ? `${run.history.length} rounds · ${rawWins}W ${rawLosses}L`
            : won
              ? `Record ${rec.wins}–${rec.losses}${rec.draws ? ` · ${rec.draws}D` : ''}`
              : `Record ${rec.wins}–${rec.losses} · fell on round ${run.wave} of ${CONFIG.courseRounds}`}
        </div>

        {run.history.length > 0 && (
          <div className="endpips" aria-label="Round results">
            {run.history.map((r, i) => {
              const cal = !practice && isCalibrationRound(i + 1);
              return (
                <span key={i} className={`endpip ${r}${cal ? ' cal' : ''}`} title={`Round ${i + 1}: ${r}${cal ? ' (calibration — not scored)' : ''}`}>
                  {r === 'win' ? 'W' : r === 'lose' ? 'L' : 'D'}
                </span>
              );
            })}
          </div>
        )}

        <div className="endboardlabel">Final warband</div>
        <div className="endboard">
          {run.board.length === 0 ? (
            <span className="endempty">— empty —</span>
          ) : (
            run.board.map((m) => <Card key={m.uid} card={boardView(m)} suppressPop />)
          )}
        </div>

        <button className="endplay" onClick={() => openTitle()}>Play Again</button>
      </div>
    </div>
  );
}
