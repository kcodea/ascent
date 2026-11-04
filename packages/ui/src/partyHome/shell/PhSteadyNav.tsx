/**
 * THE SHELL's ONE NAV (party home prototype): mounted once by `Game` over every menu screen, so it never unmounts between pages.
 * A page still loading keeps the nav, and its highlight follows the store on the very next frame, whatever the page is doing. The
 * pages' own bars stay in their layout for spacing but are hidden (shell.css).
 */
import { useEffect } from 'react';
import { anyPageOpen, useGame } from '../../store';
import { isPhone } from '../../deviceClass';
import { phPagePushed, phPopped, phTakeReturnPage } from './phHistory';
import { PhTopNav, type PhNavCurrent } from './PhTopNav';
import { leaveCrates, openCrates, usePhShell } from './shellStore';

/** A popped history entry: an overlay on top closes (it returns to what is under it), anything else opens that page. */
function showPage(page: string): void {
  const st = useGame.getState();
  if (st.settingsOpen) { st.closeSettings(); return; }
  if (st.showBook) { st.closeBook(); return; }
  if (st.careerOf) { st.closeCareer(); return; }
  if (page === 'crates') { openCrates(); st.goTo('collection'); return; }
  leaveCrates();
  if (page === 'home' || page === 'other') { st.goTo('menu'); return; }
  st.goTo(page as Parameters<typeof st.goTo>[0]);
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
  // Back from a Scene Builder game: the page you left it from.
  useEffect(() => { const p = phTakeReturnPage(); if (p && p !== 'home') showPage(p); }, []);
  useEffect(() => {
    const onPop = (e: PopStateEvent): void => { phPopped((e.state as { phPage?: string } | null)?.phPage ?? 'home', showPage); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const compact = document.documentElement.hasAttribute('data-ph-compact') || isPhone();
  return <div className="ph-navhost"><PhTopNav current={current} friendsDocked={home && !compact} ownDrawer={home} /></div>;
}
