/**
 * THE SHELL's ONE NAV (party home prototype): mounted once by `Game` over every menu screen, so it never unmounts between pages.
 * A page still loading keeps the nav, and its highlight follows the store on the very next frame, whatever the page is doing. The
 * pages' own bars stay in their layout for spacing but are hidden (shell.css).
 */
import { useEffect } from 'react';
import { anyPageOpen, useGame } from '../../store';
import { isPhone } from '../../deviceClass';
import { phAttach, phPagePushed, phTakeReloadPage, phTakeReturn } from './phHistory';
import { closeSceneBuilderPanel } from '../../sceneBuilderPanel';
import { PhTopNav, type PhNavCurrent } from './PhTopNav';
import { leaveCrates, openCrates, usePhShell } from './shellStore';

/** Bring a page on screen: every overlay comes off, then that page is there. */
function showPage(page: string): void {
  const st = useGame.getState();
  if (page === 'settings') { if (st.showBook) st.closeBook(); st.openSettings(); return; }
  if (page === 'compendium') { if (st.settingsOpen) st.closeSettings(); if (!st.showBook) st.toggleBook(); return; }
  if (st.settingsOpen) st.closeSettings();
  if (st.showBook) st.closeBook();
  if (st.careerOf) st.closeCareer();
  if (page === 'crates') { openCrates(); st.goTo('collection'); return; }
  leaveCrates();
  st.goTo(page === 'home' ? 'menu' : (page as Parameters<typeof st.goTo>[0]));
}

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
  const book = useGame((s) => s.showBook);
  const crates = usePhShell((s) => s.crates);
  const entry = book ? 'compendium' : current === 'collection' && crates ? 'crates' : current ?? 'other';
  useEffect(() => { phPagePushed(entry); }, [entry]);
  useEffect(() => phAttach(showPage), []);
  // A reload on a page comes back to that page (the first mount only, on the home; a game restores itself).
  useEffect(() => { const p = phTakeReloadPage(); if (p && current === 'home') showPage(p); }, []);
  // Back from a Scene Builder game: the panel goes, the saved game shows at once, and the page you left it from returns.
  useEffect(() => {
    closeSceneBuilderPanel();
    const back = phTakeReturn();
    if (!back) return;
    if (back.saved) useGame.setState({ savedRun: back.saved as ReturnType<typeof useGame.getState>['savedRun'] });
    if (back.page !== 'home') showPage(back.page);
  }, []);
  const compact = document.documentElement.hasAttribute('data-ph-compact') || isPhone();
  return <div className="ph-navhost"><PhTopNav current={current} friendsDocked={home && !compact} ownDrawer={home} /></div>;
}
