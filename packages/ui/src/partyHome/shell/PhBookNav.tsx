/**
 * THE COMPENDIUM UNDER THE SHELL (party home prototype, DEV only): on the menus the Compendium opens as a page under the
 * top nav, not a modal over everything. The book keeps its own content (restyled on its own branch); this pins the nav
 * over it with the Compendium tab lit, and shell.css moves the book's layer below the nav.
 */
import { usePartyHome } from '../partyHomeFlag';
import { PhTopNav } from './PhTopNav';

export default function PhBookNav() {
  const on = usePartyHome();
  if (!on) return null;
  return <div className="ph-booknav"><PhTopNav current="compendium" /></div>;
}
