import { useMemo, useState } from 'react';
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

/** One row in the right-hand Insights rail — an icon + label + value. */
function Insight({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="carinsight">
      <span className="ci-ico"><Icon name={icon} /></span>
      <div className="ci-text">
        <span className="ci-l">{label}</span>
        <span className="ci-v">{value}</span>
      </div>
    </div>
  );
}

/**
 * Career (A7) — a full-page overlay of your LOCAL match history (persisted in `runHistory.ts`), laid out as
 * a **stats bar** (runs · best run · avg wins · win rate) over three columns: a **Profile Card** (avatar,
 * name, an "Unranked" placeholder until the rating system lands), the **Recent Match History** (large
 * click-to-expand cards), and an **Insights** rail (favorite hero / tribe / mechanic, win rate, streak).
 * Read-only; the story of your climbs. Opened by the title's Career button; self-gates on `showCareer`.
 */
export function Career() {
  const show = useGame((s) => s.showCareer);
  const close = useGame((s) => s.closeCareer);
  const playerName = useGame((s) => s.playerName);
  // Load once per open (localStorage is synchronous + cheap; `show` gates the read).
  const entries = useMemo(() => (show ? loadRunHistory() : []), [show]);
  const stats = useMemo(() => careerStats(entries), [entries]);
  const [open, setOpen] = useState<Set<number>>(() => new Set([0])); // newest run starts expanded
  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const toggle = (i: number): void => {
    sfx.pulse();
    setOpen((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  };

  const favHero = stats.perHero[0];
  const favHeroName = favHero ? getHero(favHero.heroId).name : '—';
  const favTribe = stats.topTribes[0] ? TRIBE_LABEL[stats.topTribes[0].tribe] : '—';
  const avatarChar = (playerName.trim()[0] ?? '').toUpperCase();

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
            <div className="carprofile carbar">
              <div className="carstat"><span className="cs-v">{stats.runs}</span><span className="cs-l">Runs</span></div>
              <div className="carstat"><span className="cs-v">{stats.bestRun ? `${stats.bestRun.wins}–${stats.bestRun.losses}` : '—'}</span><span className="cs-l">Best Run</span></div>
              <div className="carstat"><span className="cs-v">{stats.avgWins}</span><span className="cs-l">Avg Wins</span></div>
              <div className="carstat"><span className="cs-v">{stats.winRate}%</span><span className="cs-l">Win Rate</span></div>
            </div>

            <div className="carcols">
              {/* LEFT — Profile Card */}
              <aside className="carcard carprofilecard">
                <div className="carsec">Profile</div>
                <div className="caravatar">{avatarChar || <Icon name="anvil" />}</div>
                <div className="carpname">{playerName || 'Unnamed Climber'}</div>
                <div className="carrank">Unranked</div>
                <div className="carprofmeta">
                  <div><b>{stats.completions}</b><span>Completed</span></div>
                  <div><b>{stats.flawless}</b><span>Flawless</span></div>
                  <div><b>{stats.streak}</b><span>Streak</span></div>
                </div>
              </aside>

              {/* CENTER — Recent Match History (expandable cards) */}
              <section className="carcenter">
                <div className="carsec">Recent Match History · last {Math.min(25, entries.length)}</div>
                {entries.slice(0, 25).map((e, i) => {
                  const expanded = open.has(i);
                  return (
                    <div className={`lbentry carmatch${expanded ? ' open' : ''}`} key={i}>
                      <button className="carmatch-head" onClick={() => toggle(i)}>
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
                          </div>
                          {e.tags.length > 0 && (
                            <div className="cartags">{e.tags.map((t) => <span className="endtag" key={t}>{t}</span>)}</div>
                          )}
                        </div>
                        <span className={`carchev${expanded ? ' open' : ''}`} aria-hidden="true">▾</span>
                      </button>
                      {expanded && (
                        <div className="carmatch-body">
                          <div className="carmatchstats">
                            {e.triples ? <span><b>{e.triples}</b> triples</span> : null}
                            {e.goldSpent !== undefined && <span><b>{e.goldSpent}</b> gold</span>}
                            {e.apt !== undefined && <span><b>{e.apt}</b> APT</span>}
                            {e.cardsPlayed !== undefined && <span><b>{e.cardsPlayed}</b> cards</span>}
                            {e.mvp && <span>MVP: <b>{e.mvp.name}</b> ({e.mvp.damage})</span>}
                            {e.topMechanic && <span>Most: <b>{e.topMechanic.name}</b> ({e.topMechanic.count})</span>}
                            {e.strongest && <span>Strongest: <b>{e.strongest.name}</b> {e.strongest.attack}/{e.strongest.health}</span>}
                          </div>
                          {e.board && e.board.minions.length > 0 && (
                            <div className="lbwarband">
                              {e.board.minions.map((m, j) => <Card key={j} card={cardViewOf(m)} suppressPop />)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>

              {/* RIGHT — Insights */}
              <aside className="carcard carinsights">
                <div className="carsec">Insights</div>
                <Insight icon="crown" label="Favorite Hero" value={favHeroName} />
                <Insight icon="paw" label="Favorite Tribe" value={favTribe} />
                <Insight icon="sc" label="Favorite Mechanic" value={stats.favoriteMechanic ?? '—'} />
                <Insight icon="up" label="Win Rate" value={`${stats.winRate}%`} />
                <Insight icon="star" label="Current Streak" value={stats.streak > 0 ? `${stats.streak} on line` : '—'} />
              </aside>
            </div>

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
          </>
        )}
      </div>
    </div>
  );
}
