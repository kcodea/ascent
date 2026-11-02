/**
 * THE APP SHELL's TOP NAV (party home prototype, owner 2026-11-02: "the new party home's TOP NAV becomes the app shell for
 * every menu page: the left sidebar goes away"). DEV only, behind the "Party home (prototype)" switch.
 *
 * One bar across the top of the party home AND of every menu page (Career, Collection, Leaderboard, Recent Games, Live
 * Games, Patch Notes, Settings) and the Compendium. On a page it stands in for the left `MenuSidebar` (MenuSidebar.tsx
 * swaps it in), so the same bar sits in the same place on every screen and a hop only changes the content under it.
 *
 * Left: the brand (home). Tabs: Play (the party home), the pages, Crates (the Collection's crate shop) and the
 * Compendium. Right: Aether, your level, Friends (the one friends list; docked on the party home at desktop size, a
 * drawer elsewhere) and Settings. EVERY destination lives here once: the old corner buttons are hidden under the shell.
 * On a phone the tabs are icons only. Static paint; hover is a colour change.
 */
import { lazy, Suspense, type ReactNode } from 'react';
import { levelProgress } from '@game/progression';
import { TITLE_LOGO_SRC } from '../../AscentLogo';
import { MenuMedal, type MenuMedalName } from '../../menuIcons';
import { AetherIcon } from '../../progression/AetherIcon';
import { aetherVisible, cratesVisible, mirrorFor, useProgression } from '../../progression/progressionStore';
import { useHasNewRewards } from '../../progression/NewRewardsPopup';
import { sfx } from '../../sfx';
import { useGame, type MenuDest } from '../../store';
import { getTitleText } from '../../titleTextConfig';
import { pulseFriends, setCollectionIntent, toggleFriends, usePhShell } from './shellStore';
import './shell.css';

const PhFriends = lazy(() => import('./PhFriends').then((m) => ({ default: m.PhFriends })));

/** Where the bar is drawn: the party home, one of the pages, or the Compendium. */
export type PhNavCurrent = 'home' | 'compendium' | Exclude<MenuDest, 'menu' | 'friends'> | null;

type PageDest = 'career' | 'collection' | 'rankings' | 'recent' | 'live' | 'patchnotes';

export function PhTopNav({ current: given, friendsDocked = false, extra }: { current: PhNavCurrent; friendsDocked?: boolean; extra?: ReactNode }) {
  const goTo = useGame((s) => s.goTo);
  const showBook = useGame((s) => s.showBook);
  const toggleBook = useGame((s) => s.toggleBook);
  const closeBook = useGame((s) => s.closeBook);
  const userId = useGame((s) => s.account.userId);
  const progressionOn = useProgression((s) => s.capability === 'on');
  const mirror = useProgression((s) => mirrorFor(userId, s.mirror));
  const aetherOn = useProgression(aetherVisible);
  const collectionOn = useProgression(cratesVisible) || import.meta.env.DEV;
  const newRewards = useHasNewRewards();
  const friendsOpen = usePhShell((s) => s.friendsOpen);
  const lv = progressionOn && mirror ? levelProgress(mirror.accountXp) : null;
  const txt = getTitleText();
  const current: PhNavCurrent = showBook ? 'compendium' : given;
  const home = current === 'home' || current === 'modes';
  // Aether: the balance once known; 0 in a DEV build without the online service (so the bar's layout reads as shipped).
  const aether = aetherOn && mirror ? mirror.aether ?? 0 : import.meta.env.DEV ? 0 : null;

  const medal = (n: MenuMedalName): ReactNode => <MenuMedal name={n} className="menumedal ph-navicon" />;
  const tabs: { dest: PageDest | 'crates'; label: string; icon: ReactNode; dot?: boolean }[] = [
    { dest: 'career', label: txt.career, icon: medal('career') },
    ...(collectionOn ? [{ dest: 'collection' as const, label: 'Collection', icon: medal('collection'), dot: newRewards }] : []),
    // CRATES: the Collection's crate shop (its prices are Aether, so it wears the Aether crystal).
    ...(collectionOn ? [{ dest: 'crates' as const, label: 'Crates', icon: <AetherIcon className="ph-navicon" /> }] : []),
    { dest: 'rankings', label: txt.leaderboard, icon: medal('leaderboard') },
    { dest: 'recent', label: 'Recent Games', icon: medal('recent') },
    { dest: 'live', label: 'Live Games', icon: medal('live') },
    { dest: 'patchnotes', label: 'Patch Notes', icon: medal('patchnotes') },
  ];
  const hop = (dest: PageDest | 'crates' | 'settings'): void => {
    if (dest === current) return;
    sfx.pulse();
    if (showBook) closeBook();
    if (dest === 'crates') { setCollectionIntent('shop'); goTo('collection'); return; }
    setCollectionIntent(null);
    goTo(dest);
  };
  const toHome = (): void => { if (home) return; sfx.pulse(); if (showBook) closeBook(); goTo('menu'); };
  const onBook = (): void => { if (current === 'compendium') return; sfx.pulse(); toggleBook(); };

  return (
    <>
      <header className="ph-top" aria-label="Menu">
        <button type="button" className="ph-brand" aria-label="Home" onClick={toHome}>
          <img src={TITLE_LOGO_SRC} alt="" draggable={false} decoding="sync" />
          <span>{txt.wordmark}</span>
        </button>
        <nav className="ph-nav" aria-label="Pages">
          <button type="button" className={`ph-navtab${home ? ' on' : ''}`} aria-current={home ? 'page' : undefined} aria-label={txt.play} onClick={toHome}>
            <MenuMedal name="play" className="menumedal ph-navicon" /><span className="ph-navlbl">{txt.play}</span>
          </button>
          {tabs.map((t) => (
            <button key={t.dest} type="button" className={`ph-navtab${current === t.dest ? ' on' : ''}`} aria-current={current === t.dest ? 'page' : undefined}
              aria-label={t.label} onClick={() => hop(t.dest)}>
              {t.icon}<span className="ph-navlbl">{t.label}</span>
              {t.dot && <i className="ph-dot" aria-hidden="true" />}
            </button>
          ))}
          <button type="button" className={`ph-navtab${current === 'compendium' ? ' on' : ''}`} aria-current={current === 'compendium' ? 'page' : undefined}
            aria-label="Compendium" onClick={onBook}>
            <MenuMedal name="glossary" className="menumedal ph-navicon" /><span className="ph-navlbl">Compendium</span>
          </button>
        </nav>
        <div className="ph-wallet">
          {aether !== null && (
            <span className="ph-coin" aria-label={`${aether} Aether`}><AetherIcon className="ph-aether" /><b>{aether}</b></span>
          )}
          {lv && (
            <span className="ph-lv" aria-label={`Level ${lv.level}, ${lv.xpIntoLevel} of ${lv.xpForNextLevel} XP`}>
              <span className="ph-lvnum"><small>Lv</small>{lv.level}</span>
              <span className="ph-lvbar" aria-hidden="true"><span style={{ transform: `scaleX(${lv.fraction})` }} /></span>
            </span>
          )}
          {extra}
          <button type="button" className={`ph-iconbtn ph-friendsbtn${friendsOpen ? ' on' : ''}`} aria-label="Friends" aria-expanded={friendsOpen}
            onClick={() => { sfx.pulse(); if (friendsDocked) pulseFriends(); else toggleFriends(); }}>
            <MenuMedal name="friends" className="menumedal ph-navicon" />
          </button>
          <button type="button" className={`ph-iconbtn${current === 'settings' ? ' on' : ''}`} aria-label={txt.settings} aria-current={current === 'settings' ? 'page' : undefined}
            onClick={() => hop('settings')}>
            <MenuMedal name="settings" className="menumedal ph-navicon" />
          </button>
        </div>
      </header>
      {/* The friends drawer: everywhere the list is not docked (menu pages, the Compendium, phones). */}
      {friendsOpen && !friendsDocked && <Suspense fallback={null}><PhFriends docked={false} /></Suspense>}
    </>
  );
}
