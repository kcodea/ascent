/**
 * HERO SELECT IN THE PARTY HOME's LANGUAGE (party home prototype, DEV only; the "Party home (prototype)" switch).
 *
 * Owner 2026-11-02: every menu moves to the party-first shell, "modern, whimsical, bubbly high fantasy". Hero select is
 * the screen right after START, so it wears the shell's ONE backdrop (the same painted ground as the home, so START
 * flows straight into the pick) and its look: the hero offers are banners like the party's (the painted rod, the navy
 * cloth with gold side trim, the swallowtail foot), heavy rounded type, pill buttons.
 *
 * This module is the skin only: it mounts the backdrop and carries the stylesheet (`heroSelectPh.css`, every rule
 * scoped under `.heroselect.phhs`). HeroSelect loads it lazily, so a production build never ships either. The screen's
 * markup, behaviour and ceremony are the shipped ones; with the switch off nothing here is loaded.
 */
import { PhBackdrop } from '../partyHome/shell/PhBackdrop';
import '../partyHome/partyHome.css';
import './heroSelectPh.css';

export default function HeroSelectPhSkin() {
  return <div className="hsph-bd" aria-hidden="true"><PhBackdrop /></div>;
}
