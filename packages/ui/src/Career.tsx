import { useEffect, useMemo, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import type { BoardMinion, Tribe } from '@game/core';
import { getHero, TAG_INFO } from '@game/sim';
import { Card, type CardView } from './Card';
import { RunTrophies } from './RunTrophies';
import { avatarSrc, heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';
import { careerStats, ordinal, runVerdict, VERDICT_CLASS, VERDICT_LABEL, type RunHistoryEntry } from './runHistory';
import { fetchRunHistory } from './remoteBoards';

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

const TRIBE_LABEL: Record<Tribe, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral', kobold: 'Kobold', dwarf: 'Dwarf',
  celestial: 'Celestial',
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
  const careerOf = useGame((s) => s.careerOf); // null = your own career
  const careerVersion = useGame((s) => s.careerVersion);
  // The career lives on the SERVER now (owner call 2026-08-03), so this is a fetch rather than a synchronous
  // localStorage read. `careerVersion` bumps after a finished run or a career reset, re-fetching so an open
  // view never shows a stale log. `null` distinguishes "still loading / couldn't ask" from "no runs yet",
  // which the empty state below reads.
  const [entries, setEntries] = useState<RunHistoryEntry[] | null>(null);
  useEffect(() => {
    if (!show) return;
    let live = true;
    setEntries(null);
    // Viewing someone else reads THEIR rows by user_id. `careerOf` is in the deps so switching players from
    // the leaderboard refetches rather than showing the previous player's runs under the new name.
    void fetchRunHistory<RunHistoryEntry>(50, careerOf?.userId).then((rows) => { if (live) setEntries(rows ?? []); });
    return () => { live = false; };
  }, [show, careerVersion, careerOf?.userId]);
  const stats = useMemo(() => careerStats(entries ?? []), [entries]);
  // Any recorded placement means these are lobby results, and the course-shaped headline numbers below
  // (Completed / Flawless / the Oath-based Win Rate) would read as a flat 0 or as an answer to a question
  // the lobby never asks. Owner report 2026-08-08.
  const lobbyMode = stats.lobbyRuns > 0;
  const [open, setOpen] = useState<Set<number>>(() => new Set([0])); // newest run starts expanded
  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const toggle = (i: number): void => {
    sfx.pulse();
    setOpen((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  };

  // ── WHOSE numbers ───────────────────────────────────────────────────────────────────────────────────
  // Your own card reads the local `profile` (rating, Oath, highest). Another player's cannot: those live in
  // THEIR profile row, and all we were handed is the leaderboard line. So rating/games come from that row, and
  // "highest" is derived from their run history (`ratingAfter`) rather than invented — omitted when unknowable.
  const viewing = careerOf;
  const shownName = viewing ? viewing.author : (playerName || 'Unnamed Climber');
  const shownRating = viewing ? viewing.rating : profile.rating;
  const highestSeen = viewing
    ? (entries ?? []).reduce((m, e) => Math.max(m, e.ratingAfter ?? 0), 0) || null
    : profile.highestRating;

  const favHero = stats.perHero[0];
  const favHeroName = favHero ? getHero(favHero.heroId).name : '—';
  const favTribe = stats.topTribes[0] ? TRIBE_LABEL[stats.topTribes[0].tribe] : '—';
  const avatarChar = (shownName.trim()[0] ?? '').toUpperCase();
  // Avatars are stored locally today, so another player's is unknown — their initial stands in rather than
  // showing YOUR avatar over THEIR name, which would be actively misleading.
  const avatarImg = viewing ? undefined : avatarSrc(playerAvatar);

  return (
    <div className="lbpage">
      <div className="lbtopbar">
        <button className="lbback pressable" onClick={back}>← Back</button>
        <div className="lbtitle">
          <Icon name="taunt" />
          <div>
            <div className="esch disp">{viewing ? `${viewing.author}'s Career` : 'Career'}</div>
            <div className="lbsub">{viewing ? 'Their record of climbs' : 'Your record of climbs'}</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {(entries ?? []).length === 0 ? (
          <>
            <div className="lbempty">
              <div className="carempty-rating">Rating {shownRating}{viewing ? '' : ` · Oath ${profile.currentLine}`}</div>
              {viewing ? `No runs to show for ${viewing.author}.` : 'No runs yet — play a run to start your career.'}
            </div>
          </>
        ) : (
          <>
            <div className="carcols">
              {/* LEFT — Profile + Insights + Hero record (one full-height panel) */}
              <aside className="carcard carprofilecard">
                <div className="caravatar-wrap">
                  {/* Read-only when viewing someone else: a plain div, not a button, so the avatar picker is
                      unreachable rather than merely hidden. */}
                  {viewing ? (
                    <div className="caravatar">{avatarChar || <Icon name="anvil" />}</div>
                  ) : (
                    <button className="caravatar pressable" onClick={openAvatarPicker} title="Change your avatar">
                      {avatarImg ? <img src={avatarImg} alt="Your avatar" draggable={false} /> : avatarChar || <Icon name="anvil" />}
                    </button>
                  )}
                  {!viewing && <div className="caravatar-badge" title={`Oath ${profile.currentLine}`}>{profile.currentLine}</div>}
                </div>
                <div className="carpname">{shownName}</div>
                {/* Oath is a LOCAL run-profile value — another player's is simply not in the leaderboard row, so
                    it is omitted rather than shown as yours or faked as 0. Their games count comes from the row. */}
                <div className="carrank">
                  Rating {shownRating}{viewing ? ` · ${viewing.gamesPlayed} game${viewing.gamesPlayed === 1 ? '' : 's'}` : ` · Oath ${profile.currentLine}`}
                </div>
                <div className="carranksub">
                  {viewing
                    ? (highestSeen ? `Highest seen: Rating ${highestSeen}` : 'Highest: unknown')
                    : `Highest: Rating ${profile.highestRating} · Oath ${profile.highestLine}`}
                </div>
                {/* LOBBY vs COURSE (owner 2026-08-08): a lobby has no 17-round course and no Oath, so
                    "Completed" / "Flawless" are structurally 0 there and the line-based streak means nothing.
                    Once any lobby result exists, show the battle-royale trio instead — 1sts, top-4s, and a
                    top-4 streak — which is what those runs actually produced. */}
                <div className="carprofmeta">
                  {lobbyMode ? (
                    <>
                      <div><Icon name="sword" /><b>{stats.firsts}</b><span>1st Place</span></div>
                      <div><Icon name="shield" /><b>{stats.topFours}</b><span>Top 4</span></div>
                      <div><Icon name="flame" /><b>{stats.lobbyStreak}</b><span>Top-4 Streak</span></div>
                    </>
                  ) : (
                    <>
                      <div><Icon name="sword" /><b>{stats.completions}</b><span>Completed</span></div>
                      <div><Icon name="shield" /><b>{stats.flawless}</b><span>Flawless</span></div>
                      <div><Icon name="flame" /><b>{stats.streak}</b><span>Streak</span></div>
                    </>
                  )}
                </div>

                <div className="carsec">Insights</div>
                <div className="carinsights">
                  <Insight icon="refresh" label="Runs" value={String(stats.runs)} />
                  {lobbyMode ? (
                    <>
                      {/* Average placement is the genre's headline number, and "Top 4 %" is its win rate —
                          the old line-based Win Rate answered a question a lobby never asks. */}
                      <Insight icon="star" label="Avg. Placement" value={stats.avgPlacement !== null ? String(stats.avgPlacement) : '—'} />
                      <Insight icon="up" label="Top 4" value={`${stats.top4Rate}%`} />
                      <Insight icon="crown" label="Best Finish" value={stats.bestPlacement !== null ? ordinal(stats.bestPlacement) : '—'} />
                      <Insight icon="sword" label="Avg. Wins" value={String(stats.avgWins)} />
                    </>
                  ) : (
                    <>
                      <Insight icon="star" label="Best Run" value={stats.bestRun ? `${stats.bestRun.wins}–${stats.bestRun.losses}` : '—'} />
                      <Insight icon="up" label="Win Rate" value={`${stats.winRate}%`} />
                      <Insight icon="sword" label="Avg. Wins" value={String(stats.avgWins)} />
                    </>
                  )}
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

              {/* RIGHT — Recent Match History (the Board Log's per-round "winningest board" panel was
                  removed 2026-08-04, owner ask) */}
              <div className="carright">
                <section className="carcenter">
                  <div className="carsec carsec-ico"><Icon name="crown" />Recent Match History</div>
                  {(entries ?? []).slice(0, 25).map((e, i) => {
                    const expanded = open.has(i);
                    const verdict = runVerdict(e);
                    const wonRun = verdict !== 'defeat'; // the SCORE reads green for a top-4 too
                    const delta = e.ratingDelta;
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
                          </div>
                          {e.tags.length > 0 && (
                            <div className="cartags">{e.tags.map((t) => <span className="endtag" key={t}>{t}{TAG_INFO[t] && <span className="tagtip">{TAG_INFO[t]}</span>}</span>)}</div>
                          )}
                          <div className="carresult">
                            {/* Where you finished the lobby. Absent on pre-lobby entries, which have no
                                placement to report — those rows simply omit it rather than inventing one. */}
                            {e.placement !== undefined && (
                              <span className={`carplace${e.placement === 1 ? ' first' : ''}`}>{ordinal(e.placement)}</span>
                            )}
                            <span className={`carwl ${VERDICT_CLASS[verdict]}`}>{VERDICT_LABEL[verdict]}</span>
                            {/* The MMR move, beside the verdict. `0` is a real, meaningful value (a lobby that
                                rated you flat) so this tests for undefined rather than truthiness. */}
                            {delta !== undefined && (
                              <span className={`carmmr ${delta >= 0 ? 'up' : 'down'}`}>{delta >= 0 ? '+' : ''}{delta}</span>
                            )}
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
                                  {e.ratingDelta !== undefined && <div className="cso-row"><span className="cso-l">Rating</span><span className={`cso-v ${e.ratingDelta >= 0 ? 'up' : 'down'}`}>{e.ratingDelta >= 0 ? '+' : ''}{e.ratingDelta}</span></div>}
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
