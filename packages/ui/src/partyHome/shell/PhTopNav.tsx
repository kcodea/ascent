/**
 * THE APP SHELL's TOP NAV (party home prototype, owner 2026-11-02: "the new party home's TOP NAV becomes the app shell for
 * every menu page: the left sidebar goes away"). DEV only, behind the "Party home (prototype)" switch.
 *
 * One bar across the top of the party home AND of every menu page (Career, Collection, Leaderboard, Recent Games, Live
 * Games, Patch Notes, Settings). On a page it stands in for the left `MenuSidebar` (MenuSidebar.tsx swaps it in), so the
 * same bar sits in the same place on every screen and a hop between them only changes the content under it.
 *
 * Left: the brand (home). Tabs: Play (the party home), then the pages. Right: Aether, your level, Settings.
 * The rail language (uiTheme.css `--pill-*`): a flat navy bar with a gold hairline foot; the current tab is white with a
 * gold underline, the rest muted. Static paint; hover is a colour change.
 */
import { levelProgress } from '@game/progression';
import { TITLE_LOGO_SRC } from '../../AscentLogo';
import { MenuMedal, type MenuMedalName } from '../../menuIcons';
import { AetherIcon } from '../../progression/AetherIcon';
import { aetherVisible, cratesVisible, mirrorFor, useProgression } from '../../progression/progressionStore';
import { useHasNewRewards } from '../../progression/NewRewardsPopup';
import { sfx } from '../../sfx';
import { useGame, type MenuDest } from '../../store';
import { getTitleText } from '../../titleTextConfig';
import './shell.css';

/** Where the bar is drawn: the party home, or one of the pages. */
export type PhNavCurrent = 'home' | Exclude<MenuDest, 'menu' | 'friends'> | null;

type PageDest = 'career' | 'collection' | 'rankings' | 'recent' | 'live' | 'patchnotes';

export function PhTopNav({ current, extra }: { current: PhNavCurrent; extra?: React.ReactNode }) {
  const goTo = useGame((s) => s.goTo);
  const toggleBook = useGame((s) => s.toggleBook);
  const userId = useGame((s) => s.account.userId);
  const progressionOn = useProgression((s) => s.capability === 'on');
  const mirror = useProgression((s) => mirrorFor(userId, s.mirror));
  const aetherOn = useProgression(aetherVisible);
  const collectionOn = useProgression(cratesVisible) || import.meta.env.DEV;
  const newRewards = useHasNewRewards();
  const lv = progressionOn && mirror ? levelProgress(mirror.accountXp) : null;
  const txt = getTitleText();
  const home = current === 'home' || current === 'modes';

  const tabs: { dest: PageDest; label: string; icon: MenuMedalName; dot?: boolean }[] = [
    { dest: 'career', label: txt.career, icon: 'career' },
    ...(collectionOn ? [{ dest: 'collection' as const, label: 'Collection', icon: 'collection' as const, dot: newRewards }] : []),
    { dest: 'rankings', label: txt.leaderboard, icon: 'leaderboard' },
    { dest: 'recent', label: 'Recent Games', icon: 'recent' },
    { dest: 'live', label: 'Live Games', icon: 'live' },
    { dest: 'patchnotes', label: 'Patch Notes', icon: 'patchnotes' },
  ];
  const hop = (dest: PageDest | 'settings'): void => { if (dest === current) return; sfx.pulse(); goTo(dest); };
  const toHome = (): void => { if (home) return; sfx.pulse(); goTo('menu'); };

  return (
    <header className="ph-top" aria-label="Menu">
      <button type="button" className="ph-brand" aria-label="Home" onClick={toHome}>
        <img src={TITLE_LOGO_SRC} alt="" draggable={false} decoding="sync" />
        <span>{txt.wordmark}</span>
      </button>
      <nav className="ph-nav" aria-label="Pages">
        <button type="button" className={`ph-navtab${home ? ' on' : ''}`} aria-current={home ? 'page' : undefined} onClick={toHome}>
          <MenuMedal name="play" className="menumedal ph-navicon" /><span>{txt.play}</span>
        </button>
        {tabs.map((t) => (
          <button key={t.dest} type="button" className={`ph-navtab${current === t.dest ? ' on' : ''}`} aria-current={current === t.dest ? 'page' : undefined}
            onClick={() => hop(t.dest)}>
            <MenuMedal name={t.icon} className="menumedal ph-navicon" /><span>{t.label}</span>
            {t.dot && <i className="ph-dot" aria-label="New" />}
          </button>
        ))}
        <button type="button" className="ph-navtab" onClick={() => { sfx.pulse(); toggleBook(); }}>
          <MenuMedal name="glossary" className="menumedal ph-navicon" /><span>Compendium</span>
        </button>
      </nav>
      <div className="ph-wallet">
        {aetherOn && mirror && (
          <span className="ph-coin" aria-label={`${mirror.aether ?? 0} Aether`}><AetherIcon className="ph-aether" /><b>{mirror.aether ?? 0}</b></span>
        )}
        {lv && (
          <span className="ph-lv" aria-label={`Level ${lv.level}, ${lv.xpIntoLevel} of ${lv.xpForNextLevel} XP`}>
            <span className="ph-lvnum"><small>Lv</small>{lv.level}</span>
            <span className="ph-lvbar" aria-hidden="true"><span style={{ transform: `scaleX(${lv.fraction})` }} /></span>
          </span>
        )}
        {extra}
        <button type="button" className={`ph-iconbtn${current === 'settings' ? ' on' : ''}`} aria-label={txt.settings} aria-current={current === 'settings' ? 'page' : undefined}
          onClick={() => hop('settings')}>
          <MenuMedal name="settings" className="menumedal ph-navicon" />
        </button>
      </div>
    </header>
  );
}
