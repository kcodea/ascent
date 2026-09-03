import { useEffect, useMemo, useRef, useState } from 'react';
import type { Tribe } from '@game/core';
import { getHero, TAG_INFO } from '@game/sim';
import { Card } from './Card';
import { storedCardView } from './storedBoardView';
import { RunTrophies } from './RunTrophies';
import { avatarSrc, heroArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame, syncProfileFromServer, tempHandle, type CareerFocus } from './store';
import { careerStats, ordinal, runVerdict, VERDICT_CLASS, VERDICT_LABEL, type RunHistoryEntry } from './runHistory';
import { fetchRunHistory, fetchReplayForSeed, historyEntryWatchable } from './remoteBoards';
import { startReplay } from './replay/replayPlayer';


/** "When this run was played" for the match row. Prefers the full `at` datetime (date + time); falls back to
 *  the day-only `date` on older entries (no time then). Empty string if neither parses. */
function playedAtText(e: Pick<RunHistoryEntry, 'at' | 'date'>): string {
  if (e.at) {
    const d = new Date(e.at);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  if (e.date) {
    // Parse the day-only string as LOCAL midnight — `new Date('YYYY-MM-DD')` is UTC and shifts a day back in
    // negative-offset zones.
    const d = new Date(`${e.date}T00:00:00`);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return '';
}

/** A run's played-time as an epoch (ms), preferring the full `at` datetime, falling back to the day-only
 *  `date`. NaN when neither parses — the focus matcher then leans on the identity fields instead. */
function runTimeMs(e: Pick<RunHistoryEntry, 'at' | 'date'>): number {
  if (e.at) { const t = Date.parse(e.at); if (!Number.isNaN(t)) return t; }
  if (e.date) { const t = Date.parse(`${e.date}T00:00:00`); if (!Number.isNaN(t)) return t; }
  return NaN;
}

/**
 * Match a Recent-Games focus to the run_history entry it names, so opening a game from the feed expands the
 * right run. run_telemetry (the feed) and run_history (the career) are separate rows written from the same
 * run-end flow, so there is no shared id to join on — but both stamp the run's END TIME within seconds, so the
 * NEAREST timestamp among the player's same-hero runs is the reliable key. (The two rows' `wins` can even
 * disagree — they're tallied by different paths — so identity fields are only a fallback tiebreaker when no
 * usable timestamps exist, never a hard filter.) Returns -1 when the hero appears in neither.
 */
function matchRunIndex(entries: RunHistoryEntry[], f: CareerFocus): number {
  const sameHero = entries.map((e, i) => ({ e, i })).filter((x) => x.e.heroId === f.heroId);
  if (sameHero.length === 0) return -1;
  if (sameHero.length === 1) return sameHero[0].i;
  // Multiple same-hero runs — prefer the one closest in time to the clicked game.
  const ft = f.createdAt ? Date.parse(f.createdAt) : NaN;
  if (Number.isFinite(ft)) {
    let best = -1, bestScore = Infinity;
    for (const { e, i } of sameHero) {
      const et = runTimeMs(e);
      if (!Number.isFinite(et)) continue;
      const score = Math.abs(et - ft);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    if (best >= 0) return best;
  }
  // No usable timestamps — lean on identity (wins + placement), else the newest same-hero run.
  const ident = sameHero.find((x) => x.e.wins === f.wins
    && (f.placement == null || x.e.placement == null || x.e.placement === f.placement));
  return (ident ?? sameHero[0]).i;
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
  const myId = useGame((s) => s.account.userId);
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
    // …and re-read YOUR OWN rating from the server while we're here (owner ask 2026-08-19). The profile is a
    // local MIRROR of the `profiles` row; without this it is only refreshed at launch, so a rating edited (or
    // a row deleted) server-side didn't show until a full restart. Own career only — another player's rating
    // comes from the leaderboard row we were handed, not from our profile. Best-effort: offline keeps the
    // mirror, silently.
    if (!careerOf) syncProfileFromServer(playerName);
    return () => { live = false; };
  }, [show, careerVersion, careerOf?.userId, careerOf, playerName]);
  const stats = useMemo(() => careerStats(entries ?? []), [entries]);
  // Any recorded placement means these are lobby results, and the course-shaped headline numbers below
  // (Completed / Flawless / the Oath-based Win Rate) would read as a flat 0 or as an answer to a question
  // the lobby never asks. Owner report 2026-08-08.
  const lobbyMode = stats.lobbyRuns > 0;
  const [open, setOpen] = useState<Set<number>>(() => new Set([0])); // newest run starts expanded
  // ── Watch (owner ask 2026-08-19): play back a listed run's uploaded v2 replay ────────────────────────────
  // Index-keyed like `open`; both reset when the entries refetch so a stale index can't point at the wrong run.
  const [watching, setWatching] = useState<number | null>(null); // row index whose replay is loading
  const [noReplay, setNoReplay] = useState<number | null>(null); // row index whose fetch came back empty
  useEffect(() => { setWatching(null); setNoReplay(null); }, [entries]);

  // ── Focus: opened from a specific game (a Recent Games row) ────────────────────────────────────────────
  // Expand + scroll to the run the feed row named. Matched once entries land; index -1 = no focus / no match
  // (then the default newest-expanded view stands). Recomputed if the player or their runs change.
  const focus: CareerFocus | undefined = careerOf?.focus;
  const focusIndex = useMemo(
    () => (focus && entries && entries.length > 0 ? matchRunIndex(entries, focus) : -1),
    [focus, entries],
  );
  const focusRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (focusIndex < 0) return;
    setOpen((prev) => new Set(prev).add(focusIndex));
    // Scroll after the expanded body has painted, so we centre on the full card, not the collapsed head.
    const id = requestAnimationFrame(() => focusRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    return () => cancelAnimationFrame(id);
  }, [focusIndex]);

  if (!show) return null;

  const back = (): void => { sfx.pulse(); close(); };
  const toggle = (i: number): void => {
    sfx.pulse();
    setOpen((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  };

  // ── WHOSE numbers ───────────────────────────────────────────────────────────────────────────────────
  // Your own card reads the local `profile` (rating, highest). Another player's cannot: those live in
  // THEIR profile row, and all we were handed is the leaderboard line. So rating/games come from that row, and
  // "highest" is derived from their run history (`ratingAfter`) rather than invented — omitted when unknowable.
  const viewing = careerOf;
  // A player who never set a name shows a stable temp handle keyed on their account id (never null — that
  // crashed `.trim()`; owner ask 2026-08-10: show a randomized name rather than "Unnamed Climber").
  const shownName = viewing ? (viewing.author || tempHandle(viewing.userId)) : (playerName || tempHandle(myId));
  const shownRating = viewing ? viewing.rating : profile.rating;
  const highestSeen = viewing
    ? (entries ?? []).reduce((m, e) => Math.max(m, e.ratingAfter ?? 0), 0) || null
    : profile.highestRating;

  // Watch a listed run back: map the row to its uploaded telemetry replay by SEED (the only key the two rows
  // share — see fetchReplayForSeed) and hand it to the viewer. `startReplay` closes this overlay itself and
  // restores it on exit (Phase B), so nothing here touches `showCareer`. A row whose fetch comes back empty
  // (pre-upload loss, deleted row, offline) degrades to "No replay" instead of a broken viewer.
  const watchRun = (ev: React.MouseEvent, e: RunHistoryEntry, i: number): void => {
    ev.stopPropagation();
    if (watching !== null) return;
    sfx.pulse();
    setNoReplay(null);
    setWatching(i);
    void fetchReplayForSeed(e.seed, { userId: viewing?.userId ?? myId })
      .then((rep) => {
        if (rep) startReplay(rep, { authorName: shownName || undefined });
        else setNoReplay(i);
      })
      .finally(() => setWatching(null));
  };

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
            <div className="esch disp">{viewing ? `${shownName}'s Career` : 'Career'}</div>
            <div className="lbsub">{viewing ? 'Their record of climbs' : 'Your record of climbs'}</div>
          </div>
        </div>
      </div>

      <div className="lbscroll">
        {(entries ?? []).length === 0 ? (
          <>
            <div className="lbempty">
              <div className="carempty-rating">Rating {shownRating}</div>
              {viewing ? `No runs to show for ${shownName}.` : 'No runs yet — play a run to start your career.'}
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
                      {avatarImg ? <img decoding="sync" src={avatarImg} alt="Your avatar" draggable={false} /> : avatarChar || <Icon name="anvil" />}
                    </button>
                  )}
                </div>
                <div className="carpname">{shownName}</div>
                {/* Oath dropped from this card entirely (owner 2026-08-17) — the course modes it belonged to are
                    no longer reachable, so it was a number nothing produced. Rating is the whole line now; a
                    viewed player still shows their games count, which does come from the leaderboard row. */}
                <div className="carrank">
                  Rating {shownRating}{viewing ? ` · ${viewing.gamesPlayed} game${viewing.gamesPlayed === 1 ? '' : 's'}` : ''}
                </div>
                <div className="carranksub">
                  {viewing
                    ? (highestSeen ? `Highest seen: Rating ${highestSeen}` : 'Highest: unknown')
                    : `Highest: Rating ${profile.highestRating}`}
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
                            {heroArt(h.heroId) ? <img decoding="sync" src={heroArt(h.heroId)} alt={getHero(h.heroId).name} draggable={false} /> : <Icon name="anvil" />}
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
                    // Watch is offered only where a replay can actually exist (seed + lobby + post-dates v2
                    // capture — historyEntryWatchable): rows that can't map get NO button rather than one
                    // that always answers "No replay". The head is a div[role=button] (not a <button>)
                    // because a button can't nest the Watch button — same shape as the Recent Games rows.
                    const watchable = historyEntryWatchable(e);
                    return (
                      <div
                        className={`lbentry carmatch${expanded ? ' open' : ''}${i === focusIndex ? ' carmatch-focus' : ''}`}
                        key={i}
                        ref={i === focusIndex ? focusRef : undefined}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          className="carmatch-head"
                          onClick={() => toggle(i)}
                          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(i); } }}
                        >
                          <div className="lbportrait">
                            {heroArt(e.heroId) ? <img decoding="sync" src={heroArt(e.heroId)} alt={getHero(e.heroId).name} draggable={false} /> : <Icon name="anvil" />}
                          </div>
                          <div className="lbinfo">
                            <div className="lbname">
                              {getHero(e.heroId).name}
                              <span className={`carrec ${wonRun ? 'won' : 'lost'}`}>{e.wins}–{e.losses}</span>
                            </div>
                            {/* The round the run ended on + when it was played (owner ask 2026-08-11). Round
                                comes from the reached wave; the timestamp prefers the full `at`, falling back to
                                the day-only `date` on older entries. */}
                            <div className="carsub">
                              <span className="carsub-round">Round {e.wave}</span>
                              {playedAtText(e) && <><span className="carsub-dot">·</span><span className="carsub-when">{playedAtText(e)}</span></>}
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
                            {watchable && (
                              <button
                                type="button"
                                className="matchwatch carwatch pressable"
                                onClick={(ev) => watchRun(ev, e, i)}
                                disabled={watching === i}
                                title={noReplay === i ? 'This replay is unavailable' : 'Watch this run back'}
                              >
                                {watching === i ? '…' : noReplay === i ? 'No replay' : '▶ Watch'}
                              </button>
                            )}
                            <span className={`carchev${expanded ? ' open' : ''}`} aria-hidden="true">▾</span>
                          </div>
                        </div>
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
                                    {e.board.minions.map((m, j) => <Card key={j} card={storedCardView(m)} suppressPop />)}
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
