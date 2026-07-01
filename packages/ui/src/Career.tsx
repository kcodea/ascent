import { useMemo } from 'react';
import { CARD_INDEX } from '@game/content';
import { getHero, type BoardMinion, type LineStatus, type Tribe } from '@game/sim';
import { Card, type CardView } from './Card';
import { heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { careerStats, loadRunHistory } from './runHistory';

/** Read-only card view from a stored snapshot minion — mirrors the leaderboard / end screen. */
function cardViewOf(m: BoardMinion): CardView {
  const def = CARD_INDEX[m.cardId];
  return {
    name: def?.name ?? m.cardId, cardId: m.cardId, tribe: def?.tribe ?? 'neutral', tribe2: def?.tribe2,
    attack: m.attack, health: m.health, keywords: m.keywords ?? [],
    text: def?.text ?? '', goldenText: def?.goldenText, golden: m.golden,
    tier: def?.tier ?? 1, baseAttack: def?.attack ?? m.attack, baseHealth: def?.health ?? m.health, buffs: m.buffs,
  };
}

const VERDICT: Record<LineStatus, string> = {
  flawless: 'Flawless', exceeded: 'Exceeded', covered: 'Covered', missed: 'Missed', failed: 'Failed',
};
const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral',
};

/**
 * Career (A7) — a full-page overlay of your LOCAL match history (persisted in `runHistory.ts`): a profile
 * strip (runs / best / avg / completed), per-hero stats, and the run list (record · line verdict · tags ·
 * final warband). Read-only; the story of your climbs. Rating is intentionally absent until the rating
 * system lands. Opened by the title's Career button; self-gates on `showCareer`.
 */
export function Career() {
  const show = useGame((s) => s.showCareer);
  const close = useGame((s) => s.closeCareer);
  // Load once per open (localStorage is synchronous + cheap; `show` gates the read).
  const entries = useMemo(() => (show ? loadRunHistory() : []), [show]);
  const stats = useMemo(() => careerStats(entries), [entries]);
  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };

  return (
    <div className="lbpage">
      <div className="lbtopbar">
        <button className="lbback" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="taunt" />
          <div>
            <div className="esch disp">Career</div>
            <div className="lbsub">Your record of climbs</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {entries.length === 0 ? (
          <div className="lbempty">No runs yet — play a run to start your career.</div>
        ) : (
          <>
            <div className="carprofile">
              <div className="carstat"><span className="cs-v">{stats.runs}</span><span className="cs-l">Runs</span></div>
              <div className="carstat"><span className="cs-v">{stats.bestWins}</span><span className="cs-l">Best wins</span></div>
              <div className="carstat"><span className="cs-v">{stats.avgWins}</span><span className="cs-l">Avg wins</span></div>
              <div className="carstat"><span className="cs-v">{stats.completions}</span><span className="cs-l">Completed</span></div>
              <div className="carstat"><span className="cs-v">{stats.flawless}</span><span className="cs-l">Flawless</span></div>
              <div className="carstat"><span className="cs-v">{stats.triples}</span><span className="cs-l">Triples</span></div>
              <div className="carstat"><span className="cs-v">{stats.avgGold}</span><span className="cs-l">Avg gold</span></div>
              <div className="carstat"><span className="cs-v">{stats.avgApt}</span><span className="cs-l">Avg APT</span></div>
            </div>

            {(stats.topTribes.length > 0 || stats.favoriteMechanic) && (
              <div className="cartop">
                {stats.topTribes.length > 0 && <>Top tribes: {stats.topTribes.map((t) => `${TRIBE_LABEL[t.tribe]} (${t.count})`).join(' · ')}</>}
                {stats.topTribes.length > 0 && stats.favoriteMechanic ? ' · ' : ''}
                {stats.favoriteMechanic && <>Favorite mechanic: {stats.favoriteMechanic}</>}
              </div>
            )}

            {stats.perHero.length > 0 && (
              <div className="carheroes">
                <div className="carsec">By hero</div>
                <div className="carherorows">
                  {stats.perHero.map((h) => (
                    <div className="carherorow" key={h.heroId}>
                      <div className="carhero-portrait">
                        {heroArt(h.heroId) ? <img src={heroArt(h.heroId)} alt={getHero(h.heroId).name} draggable={false} /> : <Icon name="anvil" />}
                      </div>
                      <div className="carhero-name">{getHero(h.heroId).name}</div>
                      <div className="carhero-meta">{h.runs} run{h.runs === 1 ? '' : 's'} · avg {h.avgWins} · best {h.bestWins} · {h.completions} completed</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="carsec">Match history · last {Math.min(25, entries.length)}</div>
            {entries.slice(0, 25).map((e, i) => (
              <div className="lbentry" key={i}>
                <div className="lbentry-head">
                  <div className="lbportrait">
                    {heroArt(e.heroId) ? <img src={heroArt(e.heroId)} alt={getHero(e.heroId).name} draggable={false} /> : <Icon name="anvil" />}
                  </div>
                  <div className="lbinfo">
                    <div className="lbname">
                      {getHero(e.heroId).name}
                      <span className={`carrec ${e.completed ? 'won' : 'lost'}`}>{e.wins}–{e.losses}</span>
                      <span className={`carverdict ${e.lineStatus}`}>Line {e.line} · {VERDICT[e.lineStatus]}</span>
                    </div>
                    <div className="lbmeta">
                      {e.completed ? 'Course complete' : `Fell on round ${e.wave}`}{e.date ? ` · ${e.date}` : ''}
                      {e.triples ? ` · ${e.triples} triples` : ''}
                      {e.goldSpent !== undefined ? ` · ${e.goldSpent} gold` : ''}
                      {e.mvp ? ` · MVP: ${e.mvp.name}` : ''}
                    </div>
                    {e.tags.length > 0 && (
                      <div className="cartags">{e.tags.map((t) => <span className="endtag" key={t}>{t}</span>)}</div>
                    )}
                  </div>
                </div>
                {e.board && e.board.minions.length > 0 && (
                  <div className="lbwarband">
                    {e.board.minions.map((m, j) => <Card key={j} card={cardViewOf(m)} suppressPop />)}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
