import { useMemo, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import { getHero, metLine, TAG_INFO, type BoardMinion, type LineStatus, type Tribe } from '@game/sim';
import { Card, type CardView } from './Card';
import { RunTrophies } from './RunTrophies';
import { avatarSrc, heroArt } from './art';
import { BoardLog } from './BoardLog';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { careerStats, loadRunHistory } from './runHistory';

/** Read-only card view from a stored snapshot minion — mirrors the leaderboard / end screen. */
function cardViewOf(m: BoardMinion): CardView {
  const def = CARD_INDEX[m.cardId];
  return {
    name: def?.name ?? m.cardId, cardId: m.cardId, tribe: def?.tribe ?? 'neutral',
    tribe2: def?.tribe2 ?? m.addedTribes?.find((t) => t !== (def?.tribe ?? 'neutral')), // Anomaly Reactor: show the spell-added tribe badge
    attack: m.attack, health: m.health, keywords: m.keywords ?? [],
    // Prefer the live end-of-run text baked into the final-board snapshot; older entries fall back to printed.
    text: m.text ?? def?.text ?? '', goldenText: m.goldenText ?? def?.goldenText, golden: m.golden,
    tier: def?.tier ?? 1, baseAttack: def?.attack ?? m.attack, baseHealth: def?.health ?? m.health, buffs: m.buffs,
  };
}

const VERDICT: Record<LineStatus, string> = {
  flawless: 'Flawless', exceeded: 'Surpassed', covered: 'Fulfilled', missed: 'Fell Short', failed: 'Fallen',
};
const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral',
};

/** One row in the Insights rail — icon chip, label left, value right (mockup 2026-07-16). */
function Insight({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="carinsight">
      <span className="ci-ico"><Icon name={icon} /></span>
      <span className="ci-l">{label}</span>
      <span className="ci-v">{value}</span>
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
  const playerAvatar = useGame((s) => s.playerAvatar);
  const openAvatarPicker = useGame((s) => s.openAvatarPicker);
  const profile = useGame((s) => s.profile);
  const careerVersion = useGame((s) => s.careerVersion);
  // Load once per open (localStorage is synchronous + cheap; `show` gates the read). `careerVersion` re-reads
  // it after a career reset, so an open view drops its stale past games / insights / hero stats immediately.
  const entries = useMemo(() => (show ? loadRunHistory() : []), [show, careerVersion]);
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
  const avatarImg = avatarSrc(playerAvatar);

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
          <>
            {/* No local history yet — still show the remote board log full-width. */}
            <BoardLog />
            <div className="lbempty">
              <div className="carempty-rating">Renown {profile.rating} · Oath {profile.currentLine}</div>
              No runs yet — play a run to start your career.
            </div>
          </>
        ) : (
          <>
            <div className="carcols">
              {/* LEFT — Profile + Insights + Hero record (one full-height panel) */}
              <aside className="carcard carprofilecard">
                <div className="caravatar-wrap">
                  <button className="caravatar" onClick={openAvatarPicker} title="Change your avatar">
                    {avatarImg ? <img src={avatarImg} alt="Your avatar" draggable={false} /> : avatarChar || <Icon name="anvil" />}
                  </button>
                  <div className="caravatar-badge" title={`Oath ${profile.currentLine}`}>{profile.currentLine}</div>
                </div>
                <div className="carpname">{playerName || 'Unnamed Climber'}</div>
                <div className="carrank">Renown {profile.rating} · Oath {profile.currentLine}</div>
                <div className="carranksub">Highest: Renown {profile.highestRating} · Oath {profile.highestLine}</div>
                <div className="carprofmeta">
                  <div><Icon name="sword" /><b>{stats.completions}</b><span>Completed</span></div>
                  <div><Icon name="shield" /><b>{stats.flawless}</b><span>Flawless</span></div>
                  <div><Icon name="flame" /><b>{stats.streak}</b><span>Streak</span></div>
                </div>

                <div className="carsec">Insights</div>
                <div className="carinsights">
                  <Insight icon="refresh" label="Runs" value={String(stats.runs)} />
                  <Insight icon="star" label="Best Run" value={stats.bestRun ? `${stats.bestRun.wins}–${stats.bestRun.losses}` : '—'} />
                  <Insight icon="up" label="Win Rate" value={`${stats.winRate}%`} />
                  <Insight icon="sword" label="Avg. Wins" value={String(stats.avgWins)} />
                  <Insight icon="windfury" label="Avg. Actions / Round" value={String(stats.avgApt)} />
                  <Insight icon="ember" label="Avg. Gold Spent" value={String(stats.avgGold)} />
                  <Insight icon="crown" label="Favorite Hero" value={favHeroName} />
                  <Insight icon="paw" label="Favorite Tribe" value={favTribe} />
                  <Insight icon="sc" label="Favorite Mechanic" value={stats.favoriteMechanic ?? '—'} />
                  <Insight icon="heart" label="Favorite Minion" value={stats.favoriteMinion ?? '—'} />
                </div>

                {stats.perHero.length > 0 && (
                  <>
                    <div className="carsec">By hero · W–L</div>
                    <div className="carherorows">
                      {stats.perHero.map((h) => (
                        <div className="carherorow" key={h.heroId}>
                          <div className="carhero-portrait">
                            {heroArt(h.heroId) ? <img src={heroArt(h.heroId)} alt={getHero(h.heroId).name} draggable={false} /> : <Icon name="anvil" />}
                          </div>
                          <div className="carhero-name">{getHero(h.heroId).name}</div>
                          <div className="carhero-wl"><span className="chw-w">{h.lineWins}W</span>–<span className="chw-l">{h.lineLosses}L</span></div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </aside>

              {/* RIGHT — Winning Boards (remote fight records) over Recent Match History */}
              <div className="carright">
                <BoardLog />
                <section className="carcenter">
                  <div className="carsec carsec-ico"><Icon name="crown" />Recent Match History</div>
                  {entries.slice(0, 25).map((e, i) => {
                    const expanded = open.has(i);
                    const wonRun = metLine(e.lineStatus);
                    return (
                      <div className={`lbentry carmatch${expanded ? ' open' : ''}`} key={i}>
                        <button className="carmatch-head" onClick={() => toggle(i)}>
                          <div className="lbportrait">
                            {heroArt(e.heroId) ? <img src={heroArt(e.heroId)} alt={getHero(e.heroId).name} draggable={false} /> : <Icon name="anvil" />}
                          </div>
                          <div className="lbinfo">
                            <div className="lbname">
                              {getHero(e.heroId).name}
                              <span className={`carrec ${wonRun ? 'won' : 'lost'}`}>{e.wins}–{e.losses}</span>
                            </div>
                            <div className={`carverdict ${e.lineStatus}`}>Oath {e.line} · {VERDICT[e.lineStatus]}</div>
                            <div className="lbmeta">
                              {e.completed ? 'Ascended' : `Fallen on round ${e.wave}`}{e.date ? ` · ${e.date}` : ''}
                            </div>
                          </div>
                          {e.tags.length > 0 && (
                            <div className="cartags">{e.tags.map((t) => <span className="endtag" key={t}>{t}{TAG_INFO[t] && <span className="tagtip">{TAG_INFO[t]}</span>}</span>)}</div>
                          )}
                          <div className="carresult">
                            <span className={`carwl ${wonRun ? 'won' : 'lost'}`}>{wonRun ? 'Victory' : 'Defeat'}</span>
                            <span className={`carchev${expanded ? ' open' : ''}`} aria-hidden="true">▾</span>
                          </div>
                        </button>
                        {expanded && (
                          <div className="carmatch-body">
                            <div className="carstatstrip">
                              {e.goldSpent !== undefined && <div className="cst"><span className="cst-l">Gold Spent</span><span className="cst-v">{e.goldSpent}</span></div>}
                              {e.apt !== undefined && <div className="cst"><span className="cst-l">Avg. Actions</span><span className="cst-v">{e.apt}</span></div>}
                              {e.cardsPlayed !== undefined && <div className="cst"><span className="cst-l">Cards</span><span className="cst-v">{e.cardsPlayed}</span></div>}
                              {e.triples !== undefined && e.triples > 0 && <div className="cst"><span className="cst-l">Triples</span><span className="cst-v">{e.triples}</span></div>}
                              {e.mvp && <div className="cst cst-mvp"><span className="cst-l"><Icon name="crown" /> MVP</span><span className="cst-v">{e.mvp.name} <em>({e.mvp.damage})</em></span></div>}
                            </div>
                            <div className="carmatch-detail">
                              <div className="carmatch-boardcol">
                                {e.board && e.board.minions.length > 0 && (
                                  <div className="lbwarband">
                                    {e.board.minions.map((m, j) => <Card key={j} card={cardViewOf(m)} suppressPop />)}
                                  </div>
                                )}
                                <RunTrophies quests={e.board?.quests} runes={e.board?.runes} />
                              </div>
                              {(e.strongest || e.topMechanic || e.ratingDelta !== undefined) && (
                                <aside className="carstandout">
                                  <div className="cso-h">Standout Stats</div>
                                  {e.strongest && <div className="cso-row"><span className="cso-l">Strongest</span><span className="cso-v">{e.strongest.name} {e.strongest.attack}/{e.strongest.health}</span></div>}
                                  {e.topMechanic && <div className="cso-row"><span className="cso-l">Most</span><span className="cso-v">{e.topMechanic.name} ×{e.topMechanic.count}</span></div>}
                                  {e.ratingDelta !== undefined && <div className="cso-row"><span className="cso-l">Renown</span><span className={`cso-v ${e.ratingDelta >= 0 ? 'up' : 'down'}`}>{e.ratingDelta >= 0 ? '+' : ''}{e.ratingDelta}</span></div>}
                                </aside>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
