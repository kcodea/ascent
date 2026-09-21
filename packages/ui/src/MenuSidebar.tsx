/**
 * THE MENU SIDEBAR (owner ask 2026-09-21) — a ~240px column pinned to the left edge of every ladder page
 * (Career, Leaderboard, Hall of Champions, Recent Games) and of the title's mode picker + Learn hub, so the
 * player can jump between them without returning to the title. Back sits top-left (each host keeps its own
 * Back semantics: a page closes itself, so a Career opened from the Leaderboard still returns there; the
 * mode picker backs out to the main menu, the Learn hub to the picker), and the menu plaques stack
 * vertically centred in the remaining height: Play · Career · Leaderboard · Hall of Champions · Recent
 * Games · Settings. Since 2026-09-21 the TITLE folds the four ladder pages into one SOCIAL plaque (which
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
 * SOUND: the plaques pulse here; Back does NOT — the host's `onBack` owns the click sound along with the
 * close (every page's `back` already pulses; a second pulse from the sidebar doubled the clip — review
 * 2026-09-21).
 *
 * THE HOP FADE: every host wears a page-level `fadein`. A sidebar hop unmounts the source host and mounts the
 * destination in one store write, so that fade re-faded the sidebar itself and showed the title through it.
 * `SidebarHost` is the shell every host renders through: when it mounts within `HOP_WINDOW_MS` of the store's
 * `navHopAt` stamp it wears `.hop`, which turns the page fade off and fades only the content beside the
 * sidebar (see the `.hop` rules in styles.css).
 */
import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Crest, IconHelm, IconTrophy } from './menuIcons';
import { sfx } from './sfx';
import { navClockNow, useGame, type MenuDest } from './store';
import { getTitleText } from './titleTextConfig';

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

export function MenuSidebar({ current, onBack }: { current: SidebarCurrent; onBack: () => void }) {
  const goTo = useGame((s) => s.goTo);
  const openSettings = useGame((s) => s.openSettings);
  const savedRun = useGame((s) => s.savedRun);
  const txt = getTitleText();

  const items: Item[] = [
    { dest: 'modes', label: txt.play, icon: <Crest /> },
    { dest: 'career', label: txt.career, icon: <IconHelm /> },
    { dest: 'rankings', label: txt.leaderboard, icon: <IconTrophy /> },
    { dest: 'hall', label: txt.champions, icon: <Icon name="crown" /> },
    { dest: 'recent', label: 'Recent Games', icon: <Icon name="clock" /> },
  ];

  return (
    <aside className="msb" aria-label="Menu">
      <button className="lbback pressable msb-back" onClick={onBack}>← Back</button>
      <nav className="msb-nav" aria-label="Main menu">
        {items.map((it) => {
          const active = it.dest === current;
          const btn = (
            <button
              key={it.dest}
              className={`sbbtn${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => { sfx.pulse(); goTo(it.dest); }}
            >
              <span className="mbicon">{it.icon}</span>
              <span className="mblabel">{it.label}</span>
            </button>
          );
          // Play with a run saved: the same warning the title's Play carries, as a styled bubble on a WRAPPER
          // (the plaque's own ::after is its sheen). Attribute text, not visible textContent.
          return it.dest === 'modes' && savedRun
            ? <div key={it.dest} className="msb-item" data-tip="New run. Replaces your saved run.">{btn}</div>
            : btn;
        })}
        <button className="sbbtn" onClick={() => { sfx.pulse(); openSettings(); }}>
          <span className="mbicon"><Icon name="gear" /></span>
          <span className="mblabel">{txt.settings}</span>
        </button>
      </nav>
    </aside>
  );
}
