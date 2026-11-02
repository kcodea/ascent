/**
 * THE PATCH NOTES PAGE (owner 2026-10-29, R-PATCHNOTES-PAGE-01: "patch notes should also be a page"). A sidebar page
 * exactly like Settings: the menu rail on the left with Patch Notes current, the page title, then the changelog. It
 * opens from the title's Patch Notes button and from the rail, on the menus and inside the in-game menu alike (one
 * component, both places). It was a centred overlay with its own close; the rail's Home, Escape, Resume or a press on
 * the dimmed game now close it, the same as every other page.
 *
 * The changelog itself (`PatchNotesBody`, ~400 KB of text) is its own chunk, fetched on first open; the shell paints at
 * once, so a hop from another page never shows the screen underneath while it loads.
 */
import { lazy, Suspense } from 'react';
import { useGame } from './store';
import { MenuMedal } from './menuIcons';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { retryImport } from './retryImport';
import { usePartyHome } from './partyHome/partyHomeFlag';

const PatchNotesBody = lazy(() => retryImport(() => import('./PatchNotesBody')).then((m) => ({ default: m.PatchNotesBody })));
/** The app shell's version of the page (party home prototype, DEV only; lazy and null in production, like the top nav). */
const PhPatchNotes = import.meta.env.DEV ? lazy(() => import('./partyHome/pages/PhPatchNotes').then((m) => ({ default: m.PhPatchNotes }))) : null;

export function PatchNotesPage() {
  const show = useGame((s) => s.showPatchNotes);
  const inGame = useGame((s) => s.gameMenuOpen);
  const shell = usePartyHome() && !inGame && !!PhPatchNotes;
  if (!show) return null;
  // THE APP SHELL (party home prototype, DEV switch): the top nav (MenuSidebar swaps it in) over the shell's own page.
  if (shell && PhPatchNotes) {
    return (
      <SidebarHost className="lbpage pn-page ph-shellpage">
        <MenuSidebar current="patchnotes" />
        <Suspense fallback={null}><PhPatchNotes /></Suspense>
      </SidebarHost>
    );
  }
  return (
    <SidebarHost className="lbpage pn-page">
      <MenuSidebar current="patchnotes" />
      <div className="lbtopbar">
        <div className="lbtitle">
          <MenuMedal name="patchnotes" />
          <span className="esch disp">Patch Notes</span>
        </div>
      </div>
      <Suspense fallback={<div className="lbscroll pnscroll" />}>
        <PatchNotesBody />
      </Suspense>
    </SidebarHost>
  );
}
