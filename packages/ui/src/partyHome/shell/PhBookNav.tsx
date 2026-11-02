/**
 * THE COMPENDIUM UNDER THE SHELL (party home prototype, DEV only): on the menus the Compendium is a page under the top
 * nav (the Compendium tab lit), not a modal over everything. When the Compendium builder has registered its page content
 * (shellStore `setCompendiumPage`), it mounts here in a page host and the book's modal is hidden (shell.css); until then
 * the book itself shows below the pinned nav.
 */
import { usePartyHome } from '../partyHomeFlag';
import { PhBackdrop } from './PhBackdrop';
import { PhTopNav } from './PhTopNav';
import { usePhShell } from './shellStore';

export default function PhBookNav() {
  const on = usePartyHome();
  const Page = usePhShell((s) => s.compendiumPage);
  if (!on) return null;
  if (Page) {
    return (
      <div className="ph-bookpage" role="region" aria-label="Compendium">
        <div className="ph-pagebd" aria-hidden="true"><PhBackdrop /></div>
        <div className="ph-booknav"><PhTopNav current="compendium" /></div>
        <Page />
      </div>
    );
  }
  return <div className="ph-booknav"><PhTopNav current="compendium" /></div>;
}
