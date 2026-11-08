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
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { levelProgress } from '@game/progression';
import { TITLE_LOGO_SRC } from '../../AscentLogo';
import { MenuMedal, type MenuMedalName } from '../../menuIcons';
import { AetherIcon } from '../../progression/AetherIcon';
import { aetherVisible, cratesVisible, mirrorFor, useProgression } from '../../progression/progressionStore';
import { useHasNewRewards } from '../../progression/NewRewardsPopup';
import { sfx } from '../../sfx';
import { PAGES_CLOSED, useGame, type MenuDest } from '../../store';
import { phRememberPage } from './phHistory';
import { openSceneBuilderPanel } from '../../sceneBuilderPanel';
import { getTitleText } from '../../titleTextConfig';
import { warmPhPages } from './phWarm';
import { clearDevToolsSlot, setDevToolsSlot } from './devToolsSlot';
import { leaveCrates, openCrates, setFriendsOpen, toggleFriends, usePhShell, pulseFriends } from './shellStore';
import { unreadLabel, useFriendsBadge } from './friendsBadge';
import './shell.css';

const PhFriends = lazy(() => import('./PhFriends').then((m) => ({ default: m.PhFriends })));

/** Where the bar is drawn: the party home, one of the pages, or the Compendium. */
export type PhNavCurrent = 'home' | 'compendium' | Exclude<MenuDest, 'menu' | 'friends'> | null;

type PageDest = 'career' | 'collection' | 'rankings' | 'recent' | 'live' | 'patchnotes';

export function PhTopNav({ current: given, friendsDocked = false, ownDrawer = false, extra }: {
  current: PhNavCurrent; friendsDocked?: boolean;
  /** The screen draws its own drawer (the party home's side panel): the Friends button toggles it, the nav draws none. */
  ownDrawer?: boolean; extra?: ReactNode;
}) {
  const goTo = useGame((s) => s.goTo);
  const showBook = useGame((s) => s.showBook);
  const toggleBook = useGame((s) => s.toggleBook);
  const closeBook = useGame((s) => s.closeBook);
  const userId = useGame((s) => s.account.userId);
  // Signed out (a guest or an anonymous session): the bar's top-right offers Sign in (owner 2026-11-07, R-PH-SIGNIN-NAV-01).
  const signedIn = useGame((s) => !s.account.anonymous && !!s.account.email);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const progressionOn = useProgression((s) => s.capability === 'on');
  const mirror = useProgression((s) => mirrorFor(userId, s.mirror));
  const aetherOn = useProgression(aetherVisible);
  const collectionOn = useProgression(cratesVisible) || import.meta.env.DEV;
  const friendsBadge = useFriendsBadge();
  const newRewards = useHasNewRewards();
  const friendsOpen = usePhShell((s) => s.friendsOpen);
  const drawerIsMode = usePhShell((s) => s.drawerIsMode);
  const lv = progressionOn && mirror ? levelProgress(mirror.accountXp) : null;
  const txt = getTitleText();
  const cratesOn = usePhShell((s) => s.crates);
  const current: PhNavCurrent | 'crates' = showBook ? 'compendium' : given === 'collection' && cratesOn ? 'crates' : given;
  // Lit on the home and on a legacy mode view (Versus rooms, ...); only the home itself makes Play a no-op.
  const home = current === 'home' || current === 'modes';
  const atHome = current === 'home';
  // Aether: the balance once known; 0 in a DEV build without the online service (so the bar's layout reads as shipped).
  const aether = aetherOn && mirror ? mirror.aether ?? 0 : import.meta.env.DEV ? 0 : null;

  const medal = (n: MenuMedalName): ReactNode => <MenuMedal name={n} className="menumedal ph-navicon" />;
  // The bar's order, left to right around Play (owner 2026-11-05): Shop, Collection, Patch Notes, Compendium | PLAY | Career,
  // Leaderboard, Recent Games, Live Games.
  const tabs: { dest: PageDest | 'crates' | 'compendium'; label: string; icon: ReactNode; dot?: boolean }[] = [
    // SHOP: the Collection's crate shop (its prices are Aether, so it wears the Aether crystal).
    ...(collectionOn ? [{ dest: 'crates' as const, label: 'Shop', icon: <AetherIcon className="ph-navicon" /> }] : []),
    ...(collectionOn ? [{ dest: 'collection' as const, label: 'Collection', icon: medal('collection'), dot: newRewards }] : []),
    { dest: 'patchnotes', label: 'Patch Notes', icon: medal('patchnotes') },
    { dest: 'compendium', label: 'Compendium', icon: medal('glossary') },
    { dest: 'career', label: txt.career, icon: medal('career') },
    { dest: 'rankings', label: txt.leaderboard, icon: medal('leaderboard') },
    { dest: 'recent', label: 'Recent Games', icon: medal('recent') },
    { dest: 'live', label: 'Live Games', icon: medal('live') },
  ];
  // A press changes the page in the click itself, never waiting on a frame (no view transition: its update waits for a
  // rendering opportunity, and it cost frames: 2026-11-04).
  const hop = (dest: PageDest | 'crates' | 'settings'): void => {
    setFriendsOpen(false); // a page switch closes the friends drawer
    // Settings opens OVER the page, like the Compendium: the gear toggles it, and the page under keeps its place.
    if (dest === 'settings') {
      const st = useGame.getState();
      sfx.pulse();
      if (st.settingsOpen) { st.closeSettings(); return; }
      if (showBook) closeBook();
      st.openSettings();
      return;
    }
    if (dest === 'crates') {
      // Crates: the Collection page on its crate shop (a press on Collection's page switches it there too).
      if (current === 'crates') return;
      sfx.pulse(); if (showBook) closeBook(); openCrates(); if (given !== 'collection') goTo('collection');
      return;
    }
    // The Career tab always means your own Career, even from another player's.
    if (dest === 'career' && useGame.getState().careerOf) { sfx.pulse(); leaveCrates(); goTo('career'); return; }
    if (dest === current) return;
    sfx.pulse();
    if (showBook) closeBook();
    leaveCrates();
    goTo(dest);
  };
  const toHome = (): void => { setFriendsOpen(false); if (atHome) return; sfx.pulse(); if (showBook) closeBook(); leaveCrates(); goTo('menu'); };
  const onBook = (): void => { setFriendsOpen(false); if (current === 'compendium') return; sfx.pulse(); toggleBook(); };
  useEffect(() => { warmPhPages(); }, []);
  // The friends drawer slides away on close (owner 2026-11-06: "when clicking it again, it should slide away. currently it instantly
  // disappears"): it stays drawn for its 0.18s exit slide (shell.css `.ph-fclosing`), then unmounts.
  const [drawerUp, setDrawerUp] = useState(friendsOpen);
  const [drawerClosing, setDrawerClosing] = useState(false);
  useEffect(() => {
    if (friendsOpen) { setDrawerUp(true); setDrawerClosing(false); return undefined; }
    setDrawerClosing(true);
    const t = window.setTimeout(() => { setDrawerUp(false); setDrawerClosing(false); }, 180);
    return () => window.clearTimeout(t);
  }, [friendsOpen]);
  const devSlotRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = devSlotRef.current;
    // Only the bar that paints takes the slot: a page's own bar under the shell is a hidden place-holder (shell.css, THE ONE NAV).
    if (!el || el.closest('.lbpage, .modepick, .ph, .ph-booknav')) return undefined;
    setDevToolsSlot(el);
    return () => clearDevToolsSlot(el);
  }, []);
  // Everything before Career goes left of Play; Career and after go right.
  const splitAt = tabs.findIndex((t) => t.dest === 'career');
  const tab = (t: (typeof tabs)[number]): ReactNode => (
    <button key={t.dest} type="button" role="tab" aria-selected={current === t.dest} className={`ph-navtab${current === t.dest ? ' on' : ''}`} aria-current={current === t.dest ? 'page' : undefined}
      aria-label={t.label} onClick={() => { if (t.dest === 'compendium') onBook(); else hop(t.dest); }}>
      {t.icon}<span className="ph-navlbl" data-text={t.label}>{t.label}</span>
      {t.dot && <i className="ph-dot" aria-hidden="true" />}
    </button>
  );

  return (
    <>
      <header className="ph-top" aria-label="Menu">
        <button type="button" className="ph-brand" aria-label="Home" onClick={toHome}>
          <img src={TITLE_LOGO_SRC} alt="" draggable={false} decoding="sync" />
          <span>{txt.wordmark}</span>
        </button>
        {/* PLAY sits at the exact centre of the screen (owner 2026-11-05: "put the Play button in the dead center and make it
            larger with a yellow background"): the sections before Career on its left, the rest on its right, the
            split that keeps both sides inside the bar at 1920. The order is set in `tabs` above. */}
        <nav className="ph-nav" aria-label="Pages" role="tablist">
          <div className="ph-navgrp l" role="presentation">{tabs.slice(0, splitAt).map(tab)}</div>
          <button type="button" role="tab" aria-selected={home} className={`ph-navtab ph-play${home ? ' on' : ''}`} aria-current={home ? 'page' : undefined} aria-label={txt.play} onClick={toHome}>
            <MenuMedal name="play" className="menumedal ph-navicon" /><span className="ph-navlbl" data-text={txt.play}>{txt.play}</span>
          </button>
          <div className="ph-navgrp r" role="presentation">{tabs.slice(splitAt).map(tab)}</div>
        </nav>
        <div className="ph-wallet">
          {aether !== null && (
            collectionOn ? (
              // The Aether count is a way into the shop (owner 2026-11-06: "make the aether count clickable, link it to shop").
              <button type="button" className={`ph-coin ph-coinbtn${aetherOn ? '' : ' offline'}`} onClick={() => hop('crates')}
                aria-label={aetherOn ? `${aether} Aether. Open the shop` : 'Aether, offline. Open the shop'} data-tip={aetherOn ? 'Aether: open the shop' : 'Aether (offline)'}>
                <AetherIcon className="ph-aether" /><b>{aether}</b>
              </button>
            ) : (
              <span className={`ph-coin${aetherOn ? '' : ' offline'}`} aria-label={aetherOn ? `${aether} Aether` : 'Aether, offline'} data-tip={aetherOn ? 'Aether' : 'Aether (offline)'}>
                <AetherIcon className="ph-aether" /><b>{aether}</b>
              </span>
            )
          )}
          {lv && (
            <span className="ph-lv" aria-label={`Level ${lv.level}, ${lv.xpIntoLevel} of ${lv.xpForNextLevel} XP`}>
              <span className="ph-lvnum"><small>Lv</small>{lv.level}</span>
              <span className="ph-lvbar" aria-hidden="true"><span style={{ transform: `scaleX(${lv.fraction})` }} /></span>
            </span>
          )}
          {extra}
          {/* SIGN IN (owner 2026-11-07: "put this in the top right of the main navigation bar when someone is not signed in"):
              the gold pill in Play's paint, last in the bar. The account panel is app-wide and paints over any page. */}
          {!signedIn && (
            <button type="button" className="ph-signin" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Sign in</button>
          )}
          {/* Settings + Friends dock bottom-left, stacked in a small navy box (owner 2026-11-05). On a phone it stays in the bar. */}
          <div className="ph-dock">
            {/* DEV TOOLS (owner 2026-11-06): the Scene Builder and the Dev tuner (DevMenu renders its button into the slot). */}
            {import.meta.env.DEV && (
              <div className="ph-devtools" role="group" aria-label="Dev Tools">
                <span className="ph-docklbl" aria-hidden="true">Dev Tools</span>
                <div className="ph-devrow">
                  <button type="button" className="ph-iconbtn ph-scenebtn" aria-label="Scene Builder" onClick={() => {
                    // The DEV menu's own route; the page you are on comes back when the game ends.
                    sfx.pulse(); phRememberPage(useGame.getState().savedRun); setFriendsOpen(false); if (showBook) closeBook(); leaveCrates();
                    useGame.setState(PAGES_CLOSED); openSceneBuilderPanel(); useGame.getState().startSceneBuilder();
                  }}>Scene</button>
                  <span ref={devSlotRef} className="ph-devslot" />
                </div>
              </div>
            )}
            <button type="button" className={`ph-iconbtn${current === 'settings' ? ' on' : ''}`} aria-label={txt.settings} aria-current={current === 'settings' ? 'page' : undefined}
              onClick={() => hop('settings')}>
              {/* The painted Settings medallion (owner 2026-11-05: "use the settings medallion instead of that default cog"). */}
              <MenuMedal name="settings" className="menumedal ph-navicon" />
            </button>
            {/* Friends: last in the row on every page, so the currency and the gear hold still. Where the list is docked beside
                the party it brings the panel's Friends tab forward. */}
            <button type="button" className={`ph-iconbtn ph-friendsbtn${friendsOpen && !drawerIsMode ? ' on' : ''}${friendsBadge.online ? ' f-online' : ''}`}
              aria-label={friendsBadge.unread ? `Friends, ${friendsBadge.unread} unread` : 'Friends'} aria-expanded={friendsDocked ? undefined : friendsOpen}
              onClick={() => { sfx.pulse(); if (friendsDocked) pulseFriends(); else toggleFriends(); }}>
              <MenuMedal name="friends" className="menumedal ph-navicon" />
              {/* Unread messages: a green bubble with the count (R-PH-FRIENDS-BADGE-01). */}
              {friendsBadge.unread > 0 && <span className="ph-funread" aria-hidden="true">{unreadLabel(friendsBadge.unread)}</span>}
            </button>
          </div>
        </div>
      </header>
      {/* The friends drawer: everywhere the list is not docked (menu pages, the Compendium, phones). */}
      {drawerUp && !friendsDocked && !ownDrawer && (
        <div className={`ph-fslot${drawerClosing ? ' ph-fclosing' : ''}`}><Suspense fallback={null}><PhFriends docked={false} /></Suspense></div>
      )}
    </>
  );
}
