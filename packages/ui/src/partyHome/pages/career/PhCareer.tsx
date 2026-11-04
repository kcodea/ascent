/**
 * THE CAREER PAGE ON THE APP SHELL (party home prototype, DEV only; owner 2026-11-02: "all of these menus should get
 * revamped to work with the new setup ... take a lot of inspiration from valorant's menus").
 *
 * Career.tsx keeps every read, cache and handler; while the party home switch is on it hands its pieces here and this
 * lays them out in the shell's language (kit + `--ph-*` tokens), after Valorant's career screen:
 *
 *   HEADER   the shared PhPage head: "Career" / "Your Career" eyebrow, the player's name, the five view tabs in the
 *            middle (Match History, Heroes, Trends, Practice, Achievements) and the title + Add Friend on the right.
 *   STRIP    Recent Games' strip, one plate across the page (owner 2026-11-03: "the career page should probably be a bit
 *            cleaner"): who (portrait fading in, level + XP, favourite hero), the rank + MMR, the best Ranked Duos team
 *            (arrows step through them), the career numbers. Thin rules, no boxes.
 *   BODY     the open view at full width. Match History and Practice wear Recent Games' list + detail (../gameView.tsx);
 *            Heroes is a grid of portrait cards (Valorant's agent grid); Trends has the room the old column never gave it.
 *
 * Nothing is lost from the old page: Performance Trends moved from the right column into its own tab (judgement call,
 * flagged in the PR). Static paint; no looping animation; no layout reads.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { getHero } from '@game/sim';
import { RankBar } from '../../../rank/RankBar';
import { scalarCaption } from '../../../rank/rankFormat';
import type { RankPosition } from '../../../rank/types';
import { remoteEnabled } from '../../../remoteBoards';
import { sfx } from '../../../sfx';
import { useSocial } from '../../../socialCache';
import { handleOf, sortDuosTeams } from '../../../versus/DuosBoards';
import { versusRemote, type DuosTeamOfRow } from '../../../versus/versusRemote';
import { MenuMedal } from '../../../menuIcons';
import { MenuSidebar, SidebarHost } from '../../../MenuSidebar';
import { HERO_SORTS, HERO_SORT_LABEL, TREND_WINDOWS, trendWindowLabel, type HeroCareer, type HeroSort, type TrendWindow } from '../../../careerData';
import { PhButton, PhEmpty, PhPage, PhSegmented, PhStat, PhTabs } from '../../kit';
import { GameSplitGhost, GameSplitPh, type GameSplitView } from '../gameView';
import './phCareer.css';

/** A whole-view state (loading, offline, signed out, empty). */
export interface PhState { title: string; body: string; action?: { label: string; onClick: () => void }; busy?: boolean }

export type PhCareerTab = 'history' | 'heroes' | 'trends' | 'practice' | 'achievements';

export interface PhCareerProps {
  own: boolean;
  name: string;
  /** A cold read of the games: the final layout with its contents held by ghosts. */
  loading: boolean;
  /** The equipped title, already rendered (rarity chip or the master plate). */
  title: ReactNode;
  addFriend: ReactNode;
  /** A whole-page state instead of the career (no backend, signed out, loading, offline). */
  pageState: PhState | null;
  profileArt: string | undefined;
  favoriteHero: string;
  /** The account level. Null until progression is on. */
  level: { level: number; into: number; next: number; fraction: number } | null;
  /** Your own page as a guest: the way to an account. */
  onCreateAccount: (() => void) | null;
  stats: { games: number; firsts: number; top4Pct: number | null; losses: number; avgPlacement: number | null; tribe: string | null; tribeMedal?: ReactNode };
  rank: RankPosition | null;
  /** The bare number when no rank exists. */
  mmr: number;
  /** A viewed player's rank is still being read. */
  rankPending: boolean;
  userId: string | null;
  tab: PhCareerTab;
  onTab: (t: PhCareerTab) => void;
  achievementsOn: boolean;
  /** "Last 50 runs" / "36 heroes played" ... */
  tabSub: string;
  history: { filter: { name: string; clear: () => void; back: () => void } | null; state: PhState | null; view: GameSplitView | null };
  heroes: { list: readonly HeroCareer[]; sort: HeroSort; onSort: (s: HeroSort) => void; onPick: (heroId: string) => void; art: (heroId: string) => string | undefined; state: PhState | null };
  trends: { window: TrendWindow; onWindow: (w: TrendWindow) => void; body: ReactNode };
  practice: { state: PhState | null; view: GameSplitView | null };
  achievements: ReactNode;
}

/** The player's Ranked Duos teams, best first: one quiet cell, the arrow steps through them. Nothing with no team. */
function DuosCell({ userId }: { userId: string | null }) {
  const rows = useSocial<DuosTeamOfRow[]>(userId && remoteEnabled() ? `career:duos:${userId}` : null, () => versusRemote.duosTeamsOf(userId!).catch(() => [])) ?? null;
  const teams = useMemo(() => (rows ? sortDuosTeams(rows) : []), [rows]);
  const [at, setAt] = useState(0);
  if (teams.length === 0) return null;
  const t = teams[at % teams.length]!;
  const partner = `With ${handleOf(t.partner).replace(/#\d+$/, '')}`;
  return (
    <div className="phc-cell" role="group" aria-label="Ranked Duos teams">
      <RankBar position={{ divisionIndex: t.division, points: t.points }} size="row" showGate={false} />
      <span className="phc-duosteam" aria-live="polite">
        <b>{t.name ?? 'Ranked Duos'}</b>
        <span>{partner}, {t.games} game{t.games === 1 ? '' : 's'}</span>
      </span>
      {teams.length > 1 && <button type="button" className="phc-duosnext" aria-label={`Next team, ${(at % teams.length) + 1} of ${teams.length}`} onClick={() => { sfx.pulse(); setAt((a) => a + 1); }}>›</button>}
    </div>
  );
}

const HERO_GHOSTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

function StateView({ s }: { s: PhState }) {
  return (
    <div className="phc-state" role={s.busy ? 'status' : undefined} aria-busy={s.busy || undefined}>
      <PhEmpty title={s.title} sub={s.body} action={s.action ? <PhButton variant="primary" onClick={s.action.onClick}>{s.action.label}</PhButton> : undefined} />
    </div>
  );
}

/** One hero on the Heroes grid: the portrait fading into the navy, the name, games played and the three numbers. */
function HeroCard({ h, art, onPick }: { h: HeroCareer; art: string | undefined; onPick: (heroId: string) => void }) {
  const name = getHero(h.heroId).name;
  const games = `${h.runs} game${h.runs === 1 ? '' : 's'}`;
  const net = h.ratedGames > 0 ? h.netMmr : null;
  return (
    <button type="button" className="phc-hero" onClick={() => onPick(h.heroId)} aria-label={`${name}: ${games} played. Show ${name} games`}>
      {art && <img className="phc-heroart" src={art} alt="" draggable={false} decoding="sync" loading="lazy" />}
      <span className="phc-herobody">
        <span className="phc-heroname">{name}</span>
        <span className="phc-herogames">{games}</span>
        <span className="phc-heronums" aria-hidden="true">
          <span><b>{h.winRate === null ? '-' : `${h.winRate}%`}</b>Top 4</span>
          <span><b>{h.avgPlacement === null ? '-' : h.avgPlacement}</b>Avg</span>
          <span><b className={net === null || net === 0 ? undefined : net > 0 ? 'up' : 'down'}>{net === null ? '-' : net > 0 ? `+${net}` : net}</b>Net MMR</span>
        </span>
      </span>
    </button>
  );
}

export function PhCareer(p: PhCareerProps) {
  const tabs: { id: PhCareerTab; label: string }[] = [
    { id: 'history', label: 'Match History' },
    { id: 'heroes', label: 'Heroes' },
    { id: 'trends', label: 'Trends' },
    { id: 'practice', label: 'Practice' },
    ...(p.achievementsOn ? [{ id: 'achievements' as const, label: 'Achievements' }] : []),
  ];
  const scope = !p.pageState && (p.tab === 'history' || p.tab === 'practice') ? p.tabSub : '';
  const actions = (
    <>
      {scope && <span className="phc-scope">{scope}</span>}
      {p.title}{p.addFriend}
      {p.onCreateAccount && (
        <span className="gtip" data-tip="Playing as a guest. Create an account to save your progress.">
          <PhButton size="s" onClick={p.onCreateAccount}>Create account</PhButton>
        </span>
      )}
    </>
  );
  const { stats } = p;

  // An empty or loading view is a plate sized to its message, not a screen-tall panel (a phone would push the words below the fold).
  const stateShown = (p.tab === 'history' && !!p.history.state) || (p.tab === 'practice' && !!p.practice.state) || (p.tab === 'heroes' && !!p.heroes.state);
  // Fades in only after a wait: seen data paints as it is.
  const waited = useRef(p.loading);
  if (p.loading) waited.current = true;
  const fade = waited.current && !p.loading ? ' fadein' : '';
  const ghostLabel = `Loading ${p.own ? 'your' : `${p.name}'s`} games`;
  let view: ReactNode;
  if (p.tab === 'heroes' && p.loading) {
    view = <div className="phc-view phc-heroesview"><div className="phc-toolbar" /><div className="phc-herogrid" role="status" aria-busy="true" aria-label={ghostLabel}>{HERO_GHOSTS.map((i) => <div key={i} className="phc-hero phc-heroghost" />)}</div></div>;
  } else if (p.tab === 'trends' && p.loading) {
    view = <div className="phc-view phc-trendsview"><div className="phc-toolbar" /><div className="phc-trends phc-trendsghost" role="status" aria-busy="true" aria-label={ghostLabel} /></div>;
  } else if (p.tab === 'heroes') {
    view = p.heroes.state ? <StateView s={p.heroes.state} /> : (
      <div className="phc-view phc-heroesview">
        <div className="phc-toolbar">
          <span className="phc-sub">{p.tabSub}</span>
          <PhSegmented label="Sort by" value={p.heroes.sort} onPick={p.heroes.onSort} options={HERO_SORTS.map((k) => ({ value: k, label: HERO_SORT_LABEL[k] }))} />
        </div>
        <div className="phc-herogrid" aria-label="Heroes played">
          {p.heroes.list.map((h) => <HeroCard key={h.heroId} h={h} art={p.heroes.art(h.heroId)} onPick={p.heroes.onPick} />)}
        </div>
      </div>
    );
  } else if (p.tab === 'trends') {
    view = (
      <div className="phc-view phc-trendsview">
        <div className="phc-toolbar">
          <span className="phc-sub">Performance over time</span>
          <PhSegmented label="Window" value={p.trends.window} onPick={p.trends.onWindow} options={TREND_WINDOWS.map((w) => ({ value: w, label: trendWindowLabel(w) }))} />
        </div>
        <div className="phc-trends cv2-trends">{p.trends.body}</div>
      </div>
    );
  } else if (p.tab === 'practice') {
    view = p.practice.state ? <StateView s={p.practice.state} /> : (
      <div className="phc-view phc-splitview">
        {p.practice.view ? <GameSplitPh view={p.practice.view} /> : <GameSplitGhost label={ghostLabel} />}
      </div>
    );
  } else if (p.tab === 'achievements') {
    view = <div className="phc-view phc-achview cv2-list cv2-achlist">{p.achievements}</div>;
  } else {
    const f = p.history.filter;
    view = (
      <div className="phc-view phc-splitview">
        {f && (
          <div className="phc-toolbar">
            <span className="phc-filter">
              <span className="phc-sub">Showing</span>
              <PhButton size="s" variant="plate" onClick={f.clear} aria-label={`Show every hero, not just ${f.name}`}>{f.name}<span className="phc-x" aria-hidden="true">✕</span></PhButton>
              <PhButton size="s" variant="ghost" onClick={f.back}>Back to Heroes</PhButton>
            </span>
          </div>
        )}
        {p.history.state ? <StateView s={p.history.state} /> : p.history.view ? <GameSplitPh view={p.history.view} /> : <GameSplitGhost label={ghostLabel} />}
      </div>
    );
  }

  return (
    <SidebarHost className="lbpage cv2-page phc-page">
      <MenuSidebar current="career" />
      <PhPage
        wide
        className="phc-pg rgp"
        eyebrow={p.own ? 'Your Career' : 'Career'}
        title={p.name}
        tabs={p.pageState ? undefined : <PhTabs tabs={tabs} value={p.tab} onChange={p.onTab} label="Career view" />}
        actions={actions}
      >
        {p.pageState ? <StateView s={p.pageState} /> : (
          <>
            <section className={`rgp-strip phc-strip${p.loading ? ' loading' : ''}`} aria-label="Profile">
              <div className="rgp-most phc-who">
                {p.profileArt && <img className="rgp-mostart" src={p.profileArt} alt="" draggable={false} decoding="sync" />}
                {/* The name is the page title just above: the strip does not say it twice. */}
                <span className="rgp-mostname">{p.level ? `Level ${p.level.level}` : p.name}</span>
                <span className="rgp-mostsub">Favorite hero {p.favoriteHero}</span>
                {p.level && (
                  <span className="phc-xprow">
                    <span className="phc-xp" aria-hidden="true"><i style={{ transform: `scaleX(${p.level.fraction})` }} /></span>
                    <span className="phc-xpnum">{p.level.into} / {p.level.next} XP</span>
                  </span>
                )}
              </div>
              <div className="phc-cell" role="group" aria-label="Seasonal Ranked">
                {p.rank ? <RankBar position={p.rank} size="row" /> : p.rankPending ? <span className="phc-wait" aria-busy="true" aria-label="Loading rank" /> : null}
                {!p.rankPending && <span className="phc-mmr"><b>{p.rank ? scalarCaption(p.rank) : p.mmr}</b>MMR</span>}
              </div>
              <DuosCell userId={p.userId} />
              <div className="rgp-stats">
                <PhStat label="Games" value={stats.games} />
                <PhStat label="1st Place" value={stats.firsts} tone="gold" />
                <PhStat label="Top 4" value={<span className="phc-sv"><MenuMedal name="top4" />{stats.top4Pct === null ? '-' : `${stats.top4Pct}%`}</span>} />
                <PhStat label="Losses" value={<span className="phc-sv"><MenuMedal name="losses" />{stats.losses}</span>} />
                <PhStat label="Avg Place" value={<span className="phc-sv"><MenuMedal name="avgplacement" />{stats.avgPlacement === null ? '-' : stats.avgPlacement}</span>} />
                <PhStat label="Tribe" value={<span className="phc-sv">{stats.tribeMedal}{stats.tribe ?? '-'}</span>} />
              </div>
            </section>
            <section className={`phc-main${stateShown ? ' fit' : ''}${fade}`} aria-label={tabs.find((t) => t.id === p.tab)?.label} role="tabpanel">{view}</section>
          </>
        )}
      </PhPage>
    </SidebarHost>
  );
}
