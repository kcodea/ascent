/**
 * THE MENU SIDEBAR (owner ask 2026-09-21) — a ~240px column pinned to the left edge of every ladder page
 * (Career, Leaderboard, Hall of Champions, Recent Games) and of the title's mode picker + Learn hub, so the
 * player can jump between them without returning to the title. Since the WS-2 regroup (2026-10-16) the top of
 * the column is the ASCENT mark, which goes home to the main menu (it replaced the Back pill), then Play, then
 * the PROGRESS and COMMUNITY groups, with Settings at the foot (see `MenuSidebar` below). Since 2026-09-21 the TITLE folds the four ladder pages into one SOCIAL plaque (which
 * opens Career through `openCareer()`, NOT `goTo`, so it carries no hop stamp and the page fades in whole);
 * this sidebar is where the four are reached from, so it keeps them listed one by one. The current
 * screen's plaque wears the title's blue (`.active`) and `aria-current="page"`.
 *
 * Every hop goes through the store's `goTo`, which closes ALL four page flags before opening the destination
 * — the pages are z-470 siblings that stack in DOM order, so merely opening a flag would leave the current
 * page painted on top. Play opens the mode picker (`titleView: 'modes'`); Settings opens the Esc menu.
 *
 * Markup rules (pinned by Career.test / ladderPages.test): no `title=` attribute anywhere (the owner banned
 * native tooltips — the saved-run note rides a `data-tip` on a positioned wrapper, never on the pressable
 * plaque whose `::after` is the sheen), no `lb-` / `cv2-` classes, no `.lbtitle`, and no `scrollIntoView`.
 * No `cursor` on the plaques — the global `button` rule paints the gauntlet (CLAUDE.md).
 *
 * SOUND: every control here pulses once (the old Back left its sound to the host's close; Home is the
 * sidebar's own, so it pulses itself — exactly once).
 *
 * THE HOP FADE: every host wears a page-level `fadein`. A sidebar hop unmounts the source host and mounts the
 * destination in one store write, so that fade re-faded the sidebar itself and showed the title through it.
 * `SidebarHost` is the shell every host renders through: when it mounts within `HOP_WINDOW_MS` of the store's
 * `navHopAt` stamp it wears `.hop`, which turns the page fade off and fades only the content beside the
 * sidebar (see the `.hop` rules in styles.css).
 */
import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Crest, IconChest, IconHelm, IconTrophy } from './menuIcons';
import { cratesVisible, useProgression } from './progression/progressionStore';
import { sfx } from './sfx';
import { navClockNow, useGame, type MenuDest } from './store';
import { getTitleText } from './titleTextConfig';
import { TITLE_LOGO_SRC } from './AscentLogo';
import { withAbandonWarning } from './rank/ratedRun';
import { NewPill, useHasNewRewards } from './progression/NewRewardsPopup';
import { MenuBackdrop } from './MenuBackdrop';
import { useLiveCount, useWindowFocused } from './live/liveCount';
import { HALL_VISIBLE } from './hallFlag';

/** How long after a `goTo` a mounting host counts as "opened by the sidebar". A hop mounts its destination in
 *  the same event turn (a few ms); a title-plaque open or a row click carries no fresh stamp. */
const HOP_WINDOW_MS = 400;

/** True when the calling component mounted as the destination of a sidebar hop. Frozen at mount: a class that
 *  came and went later would restart the fade it exists to skip. */
export function useMountedFromHop(): boolean {
  const [hop] = useState(() => navClockNow() - useGame.getState().navHopAt < HOP_WINDOW_MS);
  return hop;
}

/** The shell a sidebar host renders as: the given classes plus `.hop` when the sidebar opened it. The ladder
 *  pages pass `lbpage …`, the title's picker / Learn hub `modepick sb-host`. */
export function SidebarHost({ className, children, ...rest }: HTMLAttributes<HTMLDivElement> & { className: string; children: ReactNode }) {
  const hop = useMountedFromHop();
  return <div className={`${className}${hop ? ' hop' : ''}`} {...rest}>{children}</div>;
}

/** The screen the sidebar is rendered on — its plaque is the blue one. */
export type SidebarCurrent = Exclude<MenuDest, 'menu'>;

interface Item { dest: SidebarCurrent; label: string; icon: ReactNode }

/**
 * THE RAIL, REGROUPED (UI refinement WS-2, 2026-10-16). Top to bottom:
 *   - the ASCENT mark: HOME, back to the main menu (it replaces the Back pill; every page Back used to reach is
 *     on the rail itself, so a separate Back was a second way to the same places);
 *   - PLAY, the one primary action: larger, and the gold-filled plaque (the gold rule: Play is the only bright
 *     filled gold on a menu screen; navigation stays navy with a bronze rim);
 *   - PROGRESS: Career, Collection;
 *   - COMMUNITY: Leaderboard, Hall of Champions, Recent Games, Live Games;
 *   - Settings, pinned to the foot.
 * Every destination is still one click from every page (Valorant 5.08 hid modes behind Play and had to revert).
 */
// Where the rail's selection bar last sat (stage px within the nav), so the next page's rail can slide it from there.
let lastIndicatorY: number | null = null;

export function MenuSidebar({ current }: { current: SidebarCurrent }) {
  const navRef = useRef<HTMLElement>(null);
  const indRef = useRef<HTMLSpanElement>(null);
  // THE SELECTION BAR (2026-10-16): measured ONCE per page (offsetTop, before paint), then a single transform
  // transition from the previous page's position. Nothing runs per frame; reduced motion just places it.
  useLayoutEffect(() => {
    const nav = navRef.current; const ind = indRef.current;
    if (!nav || !ind) return undefined;
    const act = nav.querySelector<HTMLElement>('.sbbtn.active');
    if (!act) { ind.classList.remove('on'); return undefined; }
    let y = 0; for (let el: HTMLElement | null = act; el && el !== nav; el = el.offsetParent as HTMLElement | null) y += el.offsetTop;
    ind.style.height = `${act.offsetHeight}px`;
    ind.classList.add('on');
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const from = lastIndicatorY;
    lastIndicatorY = y;
    if (from === null || from === y || reduced) { ind.style.transition = 'none'; ind.style.transform = `translateY(${y}px)`; return undefined; }
    ind.style.transition = 'none';
    ind.style.transform = `translateY(${from}px)`;
    const raf = requestAnimationFrame(() => {
      ind.style.transition = 'transform 0.24s cubic-bezier(0.4, 0, 0.2, 1)';
      ind.style.transform = `translateY(${y}px)`;
    });
    return () => cancelAnimationFrame(raf);
  }, [current]);
  const goTo = useGame((s) => s.goTo);
  const openSettings = useGame((s) => s.openSettings);
  const savedRun = useGame((s) => s.savedRun);
  const txt = getTitleText();
  // The Collection plaque shows once crates are live (always in DEV, so the screen and its tuner are reachable).
  const collectionOn = useProgression(cratesVisible) || import.meta.env.DEV;
  const newRewards = useHasNewRewards();
  const liveCount = useLiveCount();
  const focused = useWindowFocused();

  const progress: Item[] = [
    { dest: 'career', label: txt.career, icon: <IconHelm /> },
    ...(collectionOn ? [{ dest: 'collection' as const, label: 'Collection', icon: <IconChest /> }] : []),
  ];
  const community: Item[] = [
    { dest: 'rankings', label: txt.leaderboard, icon: <IconTrophy /> },
    // The Hall of Champions is hidden for now (owner 2026-10-16, hallFlag.ts): one switch brings the plaque back.
    ...(HALL_VISIBLE ? [{ dest: 'hall' as const, label: txt.champions, icon: <Icon name="crown" /> }] : []),
    { dest: 'recent', label: 'Recent Games', icon: <Icon name="clock" /> },
    { dest: 'live', label: 'Live Games', icon: <Icon name="sword" /> },
  ];

  const plaque = (it: Item, extra = ''): JSX.Element => {
    const active = it.dest === current;
    const fresh = it.dest === 'collection' && newRewards;
    // LIVE (owner 2026-10-16): the Live Games plaque breathes while ranked games are being played, with the count.
    const live = it.dest === 'live' && liveCount > 0;
    return (
      <button
        key={it.dest}
        className={`sbbtn${extra}${active ? ' active' : ''}${fresh ? ' hasnew' : ''}${live ? ` sb-live${focused ? '' : ' paused'}` : ''}`}
        aria-current={active ? 'page' : undefined}
        onClick={() => { sfx.pulse(); goTo(it.dest); }}
      >
        <span className="mbicon">{it.icon}</span>
        <span className="mblabel">{it.label}</span>
        {fresh && <NewPill />}
        {live && <span className="sb-livechip" aria-label={`${liveCount} live ${liveCount === 1 ? 'game' : 'games'}`}>{liveCount} live</span>}
      </button>
    );
  };

  const play = plaque({ dest: 'modes', label: txt.play, icon: <Crest /> }, ' sb-play');

  // The screen's painted backdrop rides along with the sidebar, so every host gets it (MenuBackdrop.tsx).
  return (
    <>
    <MenuBackdrop screen={current} />
    <aside className="msb" aria-label="Menu">
      {/* HOME: the brand mark, back to the main menu. The tip rides the button (no sheen on it, so no ::after
          clash); no native title. */}
      <button className="msb-home" onClick={() => { sfx.pulse(); goTo('menu'); }} aria-label="Main menu" data-tip="Main menu">
        <img className="msb-mark" src={TITLE_LOGO_SRC} alt="" draggable={false} decoding="sync" />
        <span className="msb-word">{txt.wordmark}</span>
      </button>
      <nav className="msb-nav" aria-label="Main menu" ref={navRef}>
        <span className="msb-ind" ref={indRef} aria-hidden="true" />
        {/* Play with a run saved: the same warning the title's Play carries, as a styled bubble on a WRAPPER
            (the plaque's own ::after is its sheen). Attribute text, not visible textContent. */}
        {savedRun
          ? <div className="msb-item" data-tip={withAbandonWarning('New run. Replaces your saved run.', savedRun)}>{play}</div>
          : play}
        <div className="msb-group" role="group" aria-label="Progress">
          <div className="msb-gh" aria-hidden="true">Progress</div>
          {progress.map((it) => plaque(it))}
        </div>
        <div className="msb-group" role="group" aria-label="Community">
          <div className="msb-gh" aria-hidden="true">Community</div>
          {community.map((it) => plaque(it))}
        </div>
      </nav>
      <button className="sbbtn msb-settings" onClick={() => { sfx.pulse(); openSettings(); }}>
        <span className="mbicon"><Icon name="gear" /></span>
        <span className="mblabel">{txt.settings}</span>
      </button>
    </aside>
    </>
  );
}
