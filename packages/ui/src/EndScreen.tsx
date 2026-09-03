import { useMemo, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import type { BoardMinion } from '@game/core';
import { buildTags, CONFIG, getHero, isCalibrationRound, isPlayerAction, lineResult, metLine, replayRun, runMvp, runRecord, TAG_INFO, topMechanic, type LineStatus, playerLobbySeat, type RunState } from '@game/sim';
import { Card, type CardView } from './Card';
import { liveBoardView } from './instView';
import { heroArt } from './art';
import { Icon } from './Icon';
import { useGame } from './store';
import { startReplay } from './replay/replayPlayer';

/** A live `CardView` for a final-warband minion — shared with the final-board capture (see `liveBoardView`),
 *  so scaling cards show their *accumulated* magnitude at run's end, not the printed base. */
const boardView = liveBoardView;

/** A read-only view of a captured snapshot minion (a past round's board) — its stats ARE the real
 *  recruit-buffed values it fought with that wave; rule text falls back to the printed card text. */
function snapshotView(m: BoardMinion): CardView {
  const def = CARD_INDEX[m.cardId];
  return {
    name: def?.name ?? m.cardId, cardId: m.cardId, tribe: def?.tribe ?? 'neutral', tribe2: def?.tribe2,
    attack: m.attack, health: m.health, keywords: m.keywords ?? [],
    text: def?.text ?? '', goldenText: def?.goldenText, golden: m.golden,
    tier: def?.tier ?? 1, baseAttack: def?.attack ?? m.attack, baseHealth: def?.health ?? m.health, buffs: m.buffs,
  };
}

/**
 * End-of-run screen (both outcomes) — styled like the hero picker. Shows the title, the run's
 * round-by-round W-L-W summary, the final warband, and Play Again (→ hero picker).
 */
/** 1st, 2nd, 3rd, 4th… — the only number a lobby result is actually about. */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/**
 * The LOBBY end screen (owner ask 2026-07-29: "literally only show your placement and final board").
 *
 * The ordinary end screen is built entirely around the scored climb — Oath verdict, Rating delta, W–L record,
 * per-round pips, build tags, run stats. None of that exists in a lobby: there is no Oath, no course record and
 * no rating, and a per-round pip strip implies a fixed length the mode doesn't have. Rather than hide nine
 * sections one by one and leave the reader guessing which numbers still mean something, a lobby gets its own
 * screen with the two things that do: where you finished, and what you finished with.
 */
function LobbyEndScreen({ lobby, run, onPlayAgain }: {
  lobby: NonNullable<RunState['lobby']>;
  run: RunState;
  onPlayAgain: () => void;
}): JSX.Element {
  const seat = playerLobbySeat(lobby);
  const place = seat.placement ?? lobby.seats.filter((x) => x.alive).length;
  const won = place === 1;
  // The placement's rating change (the ladder's ONLY rating source since 2026-07-31) — lands a tick after the
  // phase flips, so this renders reactively: nothing, then the number counts in.
  const lastRating = useGame((s) => s.lastRating);
  // REPLAY VIEWER (v2): the just-finished run's state replay — stashed by the run-end block a tick after the
  // phase flips (same deferral as the rating), so the Rewatch button pops in once it lands.
  const lastReplay = useGame((s) => s.lastReplay);
  return (
    <div className={`heroselect endscreen lobbyend${won ? ' won' : ''}`}>
      <div className="hsbox endbox">
        <div className="endplace" aria-label={`Finished ${ordinal(place)} of ${lobby.seats.length}`}>
          <span className="endplace-num">{ordinal(place)}</span>
          <span className="endplace-of">of {lobby.seats.length}</span>
          {run.mode === 'practice' && <span className="endplace-practice">Practice — unrated</span>}
        </div>
        {run.mode === 'lobby' && lastRating && (
          <div className={`endmmr${lastRating.ratingDelta >= 0 ? ' up' : ' down'}`} aria-label="Rating change">
            <span className="endmmr-now">{lastRating.ratingAfter}</span>
            <span className="endmmr-delta">{lastRating.ratingDelta >= 0 ? '+' : ''}{lastRating.ratingDelta}</span>
            <span className="endmmr-label">Rating</span>
          </div>
        )}
        <div className="endboardlabel">Final warband</div>
        <div className="endboard">
          {run.board.length === 0
            ? <span className="endempty">— empty —</span>
            : run.board.map((m) => <Card key={m.uid} card={boardView(m, run)} suppressPop />)}
        </div>
        <button className="endplay pressable" onClick={onPlayAgain}>Play Again</button>
        {/* Watch back the run that just ended — exiting the replay restores this end screen untouched. */}
        {lastReplay && lastReplay.seed === run.seed && (
          <button className="endplay pressable ghost" onClick={() => startReplay(lastReplay)}>Rewatch</button>
        )}
      </div>
    </div>
  );
}

/**
 * TUTORIAL GRADUATION — the Learn Ascent course finishes on a note of "you've got this", not a placement.
 * A tutorial run carries a lobby (so it reaches the same end phase), but a rank-of-8 is meaningless here and a
 * "FALLEN" verdict would be actively discouraging — the point was to learn, and the player did. So the course
 * gets its own end card: a congratulation, the warband they built, and a single button into the real game.
 */
function TutorialGraduationScreen({ run, onDone }: { run: RunState; onDone: () => void }): JSX.Element {
  return (
    <div className="heroselect endscreen won tutgrad">
      <div className="hsbox endbox">
        <h1 className="disp hstitle">Tutorial Complete</h1>
        <div className="endboard">
          {run.board.length === 0
            ? <span className="endempty">— empty —</span>
            : run.board.map((m) => <Card key={m.uid} card={boardView(m, run)} suppressPop />)}
        </div>
        <button className="endplay pressable" onClick={onDone}>Enter Ascent</button>
      </div>
    </div>
  );
}

export function EndScreen({ won }: { won: boolean }) {
  const run = useGame((s) => s.run);
  const openTitle = useGame((s) => s.openTitle);
  const actions = useGame((s) => s.replayActions);
  // A lobby result is a placement, not a graded climb — its own screen, before any of the scored-run
  // derivations below (record, Oath verdict, rating, pips) which have no meaning in that mode.
  const lobby = run.lobby;
  // The rating change for this scored run (computed on run-end, a tick after the phase flips). null for
  // Practice or until it lands.
  const lastRating = useGame((s) => s.lastRating);
  const hero = getHero(run.heroId);
  const practice = run.mode === 'practice';
  // Build identity (A5/A6): the tags that describe what you built this run.
  const tags = practice ? [] : buildTags(run);
  // Run stats (polish): main tribe, triples, gold spent, actions/round, and the biggest final-board minion.
  const strongest = run.board.reduce<typeof run.board[number] | null>((b, m) => (!b || m.attack + m.health > b.attack + b.health ? m : b), null);
  const apt = Math.round((actions.filter(isPlayerAction).length / Math.max(1, run.wave)) * 10) / 10;
  const cardsPlayed = actions.filter((a) => a.type === 'play').length;
  // Round-board viewer: re-derive every round's board from the replay (deterministic), keyed by wave, so a
  // W/L pip can open the exact board you fought that round. Best-effort — a replay hiccup just leaves the
  // pips non-clickable. Memoized so it runs once (the action log is fixed on a finished run).
  // Ascent only: `replayRun` re-runs in ascent mode, so a practice replay (unlimited Resolve) wouldn't
  // reconstruct faithfully — leave practice pips non-clickable rather than show a wrong board.
  const boardsByWave = useMemo(() => {
    const map = new Map<number, BoardMinion[]>();
    if (practice) return map;
    try {
      for (const s of replayRun({ seed: run.seed, heroId: run.heroId, actions }).snapshots) map.set(s.wave, s.minions);
    } catch { /* replay is best-effort — leave pips non-clickable */ }
    return map;
  }, [practice, run.seed, run.heroId, actions]);
  const [viewWave, setViewWave] = useState<number | null>(null);
  const viewBoard = viewWave !== null ? boardsByWave.get(viewWave) : undefined;
  const mvp = runMvp(run.runDamage);
  const mech = topMechanic(run.runProcs);
  // Ascent: the score is the W–L record over the scored rounds (calibration rounds don't count).
  const rec = runRecord(run);
  // Practice has no calibration concept — count every round.
  const rawWins = run.history.filter((r) => r === 'win').length;
  const rawLosses = run.history.filter((r) => r === 'lose').length;
  // Par / line verdict (A2) — how the run graded against its target wins.
  const line = lineResult(run);
  // Par is the win condition: covering the line wins the run even if you then fell before the final
  // round. The `won` prop only tells us whether the course was *completed* (survived to the end).
  const completedCourse = won;
  const wonPar = metLine(line.status);
  // Verdict text sits after "Oath N", so it doesn't repeat the word — reads "Oath 9 · Fulfilled",
  // "Oath 9 · Surpassed +2", "Oath 9 · Fell Short -2". (Vocab pass 2026-07-16: Line→Oath, Covered→Fulfilled,
  // Exceeded→Surpassed, Missed→Fell Short; a death before round 17 reads "Fallen" in the headline.)
  const LINE_VERDICT: Record<LineStatus, string> = {
    flawless: 'Flawless',
    exceeded: `Surpassed +${line.delta}`,
    covered: 'Fulfilled',
    missed: `Fell Short ${line.delta}`,
    failed: `Fell Short ${line.delta}`,
  };
  const ratingSign = lastRating && lastRating.ratingDelta >= 0 ? '+' : '';
  // Tutorial graduates to its own screen (checked before the lobby branch — a tutorial run also carries a
  // lobby, but a placement/verdict is the wrong frame for a course you just LEARNED).
  if (run.mode === 'tutorial') return <TutorialGraduationScreen run={run} onDone={openTitle} />;
  if (lobby) return <LobbyEndScreen lobby={lobby} run={run} onPlayAgain={openTitle} />;
  return (
    <div className={`heroselect endscreen${wonPar ? ' won' : ''}`}>
      <div className="hsbox endbox">
        <div className="endhero">
          <div className="endhero-portrait">
            {heroArt(hero.id) ? (
              <img decoding="sync" className="endhero-img" src={heroArt(hero.id)} alt={hero.name} draggable={false} />
            ) : (
              <Icon name="anvil" />
            )}
          </div>
          <div className="endhero-name">{hero.name}</div>
        </div>
        <div className="eyebrow">
          {practice ? 'Practice complete' : wonPar ? (completedCourse ? 'The climb is complete' : 'You fulfilled your Oath') : ''}
        </div>
        <h1 className="disp hstitle">
          {practice ? 'PRACTICE' : wonPar ? (completedCourse ? 'ASCENDED' : 'OATH FULFILLED') : 'FALLEN'}
        </h1>
        <div className="endsub">
          {practice
            ? `${run.history.length} rounds · ${rawWins}W ${rawLosses}L`
            : completedCourse
              ? `Record ${rec.wins}–${rec.losses}${rec.draws ? ` · ${rec.draws}D` : ''}`
              : `Record ${rec.wins}–${rec.losses} · fell on round ${run.wave} of ${CONFIG.courseRounds}`}
        </div>
        {!practice && (
          <div className={`endline ${line.status}`}>
            <span className="endline-par">Oath {line.line}</span>
            <span className="endline-verdict">{LINE_VERDICT[line.status]}</span>
          </div>
        )}

        {!practice && lastRating && (
          <div className={`endrating${lastRating.ratingDelta >= 0 ? ' up' : ' down'}`} aria-label="Rating change">
            {lastRating.completionBonus > 0 && (
              <span className="endrating-bonus">Summit Bonus +{lastRating.completionBonus}</span>
            )}
            {lastRating.endgameBonus > 0 && (
              <span className="endrating-bonus win">End-game Push +{lastRating.endgameBonus}</span>
            )}
            {lastRating.finalWinBonus > 0 && (
              <span className="endrating-bonus win">Final Win +{lastRating.finalWinBonus}</span>
            )}
            <span className="endrating-delta">Rating {ratingSign}{lastRating.ratingDelta}</span>
            <span className="endrating-now">{lastRating.ratingAfter}</span>
            {lastRating.promoted && <span className="endrating-move promo">Promoted → Oath {lastRating.lineAfter}</span>}
            {lastRating.demoted && <span className="endrating-move demo">Demoted → Oath {lastRating.lineAfter}</span>}
          </div>
        )}

        {tags.length > 0 && (
          <div className="endtags" aria-label="Build identity">
            {tags.map((t) => (
              <span className="endtag" key={t}>{t}{TAG_INFO[t] && <span className="tagtip">{TAG_INFO[t]}</span>}</span>
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
              const wave = i + 1;
              const hasBoard = boardsByWave.has(wave);
              const label = `Round ${wave}: ${r}${cal ? ' (calibration — not scored)' : ''}${hasBoard ? ' · click to view this round’s board' : ''}`;
              const glyph = r === 'win' ? 'W' : r === 'lose' ? 'L' : 'D';
              return hasBoard ? (
                <button key={i} type="button" className={`endpip ${r}${cal ? ' cal' : ''} clickable${viewWave === wave ? ' active' : ''}`} title={label} onClick={() => setViewWave(viewWave === wave ? null : wave)}>
                  {glyph}
                </button>
              ) : (
                <span key={i} className={`endpip ${r}${cal ? ' cal' : ''}`} title={label}>{glyph}</span>
              );
            })}
          </div>
        )}

        {/* The board swaps in place: the final warband by default, or a chosen round's board (click a pip;
            click it again — or the label — to return). */}
        <div className="endboardlabel">
          {viewWave !== null ? (
            <button type="button" className="endboard-back pressable text" onClick={() => setViewWave(null)}>
              Round {viewWave} · {run.history[viewWave - 1] === 'win' ? 'Won' : run.history[viewWave - 1] === 'lose' ? 'Lost' : 'Draw'}
              <span className="endboard-backhint"> ↩ Final warband</span>
            </button>
          ) : 'Final warband'}
        </div>
        <div className="endboard">
          {viewBoard !== undefined ? (
            viewBoard.length === 0
              ? <span className="endempty">— empty —</span>
              : viewBoard.map((m, j) => <Card key={j} card={snapshotView(m)} suppressPop />)
          ) : run.board.length === 0 ? (
            <span className="endempty">— empty —</span>
          ) : (
            run.board.map((m) => <Card key={m.uid} card={boardView(m, run)} suppressPop />)
          )}
        </div>

        <button className="endplay pressable" onClick={() => openTitle()}>Play Again</button>
      </div>
    </div>
  );
}
