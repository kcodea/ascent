/**
 * THE CAREER PAGE ON THE APP SHELL (party home prototype, DEV only; owner 2026-11-02: "all of these menus should get
 * revamped to work with the new setup ... take a lot of inspiration from valorant's menus").
 *
 * Career.tsx keeps every read, cache and handler; while the party home switch is on it hands its pieces here and this
 * lays them out in the shell's language (kit + `--ph-*` tokens), after Valorant's career screen:
 *
 *   HEADER   the shared PhPage head: "Career" / "Your Career" eyebrow, the player's name, the five view tabs in the
 *            middle (Match History, Heroes, Trends, Practice, Achievements) and the title + Add Friend on the right.
 *   LEFT     the PROFILE column (it scrolls on its own): the chosen portrait fading into the navy with the name, title
 *            and favourite hero on it; the account level; Seasonal Ranked; Ranked Duos; the career numbers as tiles.
 *   RIGHT    the open view. Match History and Practice wear Recent Games' list + detail (../gameView.tsx); Heroes is a
 *            grid of portrait cards (Valorant's agent grid); Trends gets the full width the charts never had in the
 *            old right column.
 *
 * Nothing is lost from the old page: Performance Trends moved from the right column into its own tab (judgement call,
 * flagged in the PR). Static paint; no looping animation; no layout reads.
 */
import type { ReactNode } from 'react';
import { getHero } from '@game/sim';
import { MenuMedal } from '../../../menuIcons';
import { MenuSidebar, SidebarHost } from '../../../MenuSidebar';
import { HERO_SORTS, HERO_SORT_LABEL, TREND_WINDOWS, trendWindowLabel, type HeroCareer, type HeroSort, type TrendWindow } from '../../../careerData';
import { PhButton, PhEmpty, PhPage, PhSegmented, PhStat, PhTabs } from '../../kit';
import { GameSplitPh, type GameSplitView } from '../gameView';
import './phCareer.css';

/** A whole-view state (loading, offline, signed out, empty). */
export interface PhState { title: string; body: string; action?: { label: string; onClick: () => void }; busy?: boolean }

export type PhCareerTab = 'history' | 'heroes' | 'trends' | 'practice' | 'achievements';

export interface PhCareerProps {
  own: boolean;
  name: string;
  /** The equipped title, already rendered (rarity chip or the master plate). */
  title: ReactNode;
  addFriend: ReactNode;
  /** A whole-page state instead of the career (no backend, signed out, loading, offline). */
  pageState: PhState | null;
  profileArt: string | undefined;
  favoriteHero: string;
  /** The account level card (level, XP, Collection, the guest's Create account). Null until progression is on. */
  accountLevel: ReactNode;
  level: number | null;
  stats: { games: number; firsts: number; top4Pct: number | null; losses: number; avgPlacement: number | null; tribe: string | null; tribeMedal?: ReactNode };
  rank: ReactNode;
  duos: ReactNode;
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
  const actions = (p.title || p.addFriend) ? <>{p.title}{p.addFriend}</> : undefined;
  const { stats } = p;

  let view: ReactNode;
  if (p.tab === 'heroes') {
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
      <div className="phc-view phc-splitview rgp">
        <div className="phc-toolbar"><span className="phc-sub">{p.tabSub}</span></div>
        {p.practice.view && <GameSplitPh view={p.practice.view} />}
      </div>
    );
  } else if (p.tab === 'achievements') {
    view = <div className="phc-view phc-achview cv2-list cv2-achlist">{p.achievements}</div>;
  } else {
    const f = p.history.filter;
    view = (
      <div className="phc-view phc-splitview rgp">
        <div className="phc-toolbar">
          {f ? (
            <span className="phc-filter">
              <span className="phc-sub">Showing</span>
              <PhButton size="s" variant="plate" onClick={f.clear} aria-label={`Show every hero, not just ${f.name}`}>{f.name}<span className="phc-x" aria-hidden="true">✕</span></PhButton>
              <PhButton size="s" variant="ghost" onClick={f.back}>Back to Heroes</PhButton>
            </span>
          ) : null}
          <span className="phc-sub phc-count">{p.tabSub}</span>
        </div>
        {p.history.state ? <StateView s={p.history.state} /> : p.history.view && <GameSplitPh view={p.history.view} />}
      </div>
    );
  }

  return (
    <SidebarHost className="lbpage cv2-page phc-page">
      <MenuSidebar current="career" />
      <PhPage
        wide
        className="phc-pg"
        eyebrow={p.own ? 'Your Career' : 'Career'}
        title={p.name}
        tabs={p.pageState ? undefined : <PhTabs tabs={tabs} value={p.tab} onChange={p.onTab} label="Career view" />}
        actions={actions}
      >
        {p.pageState ? <StateView s={p.pageState} /> : (
          <div className="phc-grid">
            <aside className="phc-profile" aria-label="Profile">
              <section className="phc-id">
                {p.profileArt && <img className="phc-idart" src={p.profileArt} alt="" draggable={false} decoding="sync" />}
                {p.level !== null && <span className="phc-idlv" aria-label={`Level ${p.level}`}><small>Lv</small>{p.level}</span>}
                <span className="phc-idwho">
                  <span className="phc-idname">{p.name}</span>
                  <span className="phc-idfav"><span>Favorite hero</span> {p.favoriteHero}</span>
                </span>
              </section>
              {p.accountLevel && <div className="phc-acct">{p.accountLevel}</div>}
              <div className="phc-card">
                <h2 className="phc-h">Seasonal Ranked</h2>
                {p.rank}
              </div>
              <div className="phc-card">
                <h2 className="phc-h">Career Stats</h2>
                <div className="phc-stats">
                  <PhStat size="s" label="Games" value={stats.games} />
                  <PhStat size="s" label="1st Place Wins" value={stats.firsts} tone="gold" />
                  <PhStat size="s" label="Top 4 Finish" value={<span className="phc-sv"><MenuMedal name="top4" />{stats.top4Pct === null ? '-' : `${stats.top4Pct}%`}</span>} />
                  <PhStat size="s" label="Losses" value={<span className="phc-sv"><MenuMedal name="losses" />{stats.losses}</span>} />
                  <PhStat size="s" label="Avg Placement" value={<span className="phc-sv"><MenuMedal name="avgplacement" />{stats.avgPlacement === null ? '-' : stats.avgPlacement}</span>} />
                  <PhStat size="s" label="Favorite Tribe" value={<span className="phc-sv">{stats.tribeMedal}{stats.tribe ?? '-'}</span>} />
                </div>
              </div>
              {/* Ranked Duos last: the career numbers stay on screen at 1080; the teams scroll in under them. */}
              {p.duos && <div className="phc-card phc-duos">{p.duos}</div>}
            </aside>
            <section className="phc-main" aria-label={tabs.find((t) => t.id === p.tab)?.label} role="tabpanel">{view}</section>
          </div>
        )}
      </PhPage>
    </SidebarHost>
  );
}
