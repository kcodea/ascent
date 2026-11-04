/**
 * THE SHELL's ONE NAV (party home prototype): mounted once by `Game` over every menu screen, so it never unmounts between pages.
 * A page still loading keeps the nav, and its highlight follows the store on the very next frame, whatever the page is doing. The
 * pages' own bars stay in their layout for spacing but are hidden (shell.css).
 */
import { anyPageOpen, useGame } from '../../store';
import { isPhone } from '../../deviceClass';
import { PhTopNav, type PhNavCurrent } from './PhTopNav';

function useCurrent(): PhNavCurrent {
  return useGame((s) => {
    // The page on top, in the order they stack. Someone else's Career lights nothing.
    if (s.settingsOpen) return 'settings';
    if (s.showPatchNotes) return 'patchnotes';
    if (s.showCollection) return 'collection';
    if (s.showCareer) return s.careerOf ? null : 'career';
    if (s.showLiveGames) return 'live';
    if (s.showRecentGames) return 'recent';
    if (s.showRankings) return 'rankings';
    return anyPageOpen(s) ? null : 'home';
  });
}

export default function PhSteadyNav() {
  const current = useCurrent();
  const home = current === 'home';
  const compact = document.documentElement.hasAttribute('data-ph-compact') || isPhone();
  return <div className="ph-navhost"><PhTopNav current={current} friendsDocked={home && !compact} ownDrawer={home} /></div>;
}
