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
import { Icon } from './Icon';
import { MenuSidebar, SidebarHost } from './MenuSidebar';
import { retryImport } from './retryImport';

const PatchNotesBody = lazy(() => retryImport(() => import('./PatchNotesBody')).then((m) => ({ default: m.PatchNotesBody })));

export function PatchNotesPage() {
  const show = useGame((s) => s.showPatchNotes);
  if (!show) return null;
  return (
    <SidebarHost className="lbpage pn-page">
      <MenuSidebar current="patchnotes" />
      <div className="lbtopbar">
        <div className="lbtitle">
          <Icon name="clock" />
          <span className="esch disp">Patch Notes</span>
        </div>
      </div>
      <Suspense fallback={<div className="lbscroll pnscroll" />}>
        <PatchNotesBody />
      </Suspense>
    </SidebarHost>
  );
}
