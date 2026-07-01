import { CARD_INDEX } from '@game/content';
import { buildTags, CONFIG, getHero, isCalibrationRound, lineResult, runMvp, runRecord, topMechanic, type BoardCard, type LineStatus } from '@game/sim';
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
  const contributed = useGame((s) => s.lastRunBoards);
  const actions = useGame((s) => s.replayActions);
  const hero = getHero(run.heroId);
  const practice = run.mode === 'practice';
  // Build identity (A5/A6): the tags that describe what you built this run.
  const tags = practice ? [] : buildTags(run);
  // Run stats (polish): main tribe, triples, gold spent, actions/round, and the biggest final-board minion.
  const strongest = run.board.reduce<typeof run.board[number] | null>((b, m) => (!b || m.attack + m.health > b.attack + b.health ? m : b), null);
  const apt = Math.round((actions.length / Math.max(1, run.wave)) * 10) / 10;
  const cardsPlayed = actions.filter((a) => a.type === 'play').length;
  const mvp = runMvp(run.runDamage);
  const mech = topMechanic(run.runProcs);
  // Ascent: the score is the W–L record over the scored rounds (calibration rounds don't count).
  const rec = runRecord(run);
  // Practice has no calibration concept — count every round.
  const rawWins = run.history.filter((r) => r === 'win').length;
  const rawLosses = run.history.filter((r) => r === 'lose').length;
  // Par / line verdict (A2) — how the run graded against its target wins.
  const line = lineResult(run);
  const LINE_VERDICT: Record<LineStatus, string> = {
    flawless: 'Flawless — line destroyed',
    exceeded: `Exceeded (+${line.delta})`,
    covered: 'Line covered',
    missed: `Missed (${line.delta})`,
    failed: 'Course failed',
  };
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
        {!practice && (
          <div className={`endline ${line.status}`}>
            <span className="endline-par">Line {line.line}</span>
            <span className="endline-verdict">{LINE_VERDICT[line.status]}</span>
          </div>
        )}

        {tags.length > 0 && (
          <div className="endtags" aria-label="Build identity">
            {tags.map((t) => (
              <span className="endtag" key={t}>{t}</span>
            ))}
          </div>
        )}

        {!practice && (
          <div className="endstats" aria-label="Run stats">
            <span className="endstat"><b>{run.triplesMade}</b> triples</span>
            <span className="endstat"><b>{run.goldSpent}</b> gold spent</span>
            <span className="endstat"><b>{apt}</b> actions/round</span>
            <span className="endstat"><b>{cardsPlayed}</b> cards played</span>
            {mvp && <span className="endstat">MVP: <b>{mvp.name}</b> ({mvp.damage} dmg)</span>}
            {mech && <span className="endstat">Most: <b>{mech.name}</b> ({mech.count})</span>}
            {strongest && <span className="endstat">Strongest: <b>{CARD_INDEX[strongest.cardId]?.name ?? strongest.cardId}</b> {strongest.attack}/{strongest.health}</span>}
          </div>
        )}

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

        {!practice && contributed > 0 && (
          <div className="endcontrib" title="Snapshots of your boards, added to the shared opponent pool — other players may face them.">
            Added {contributed} board{contributed === 1 ? '' : 's'} to the pool
          </div>
        )}

        <button className="endplay" onClick={() => openTitle()}>Play Again</button>
      </div>
    </div>
  );
}
