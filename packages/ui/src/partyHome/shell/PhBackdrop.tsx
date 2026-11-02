/**
 * THE SHELL's ONE BACKDROP (party home prototype, DEV only): the same painted ground under the party home AND every menu
 * page, so it never changes from tab to tab. The DEV switch picks it: the Mode screen's hall (the tavern, `MenuBackdrop`,
 * the default) or the title's citadel, pre-blurred and darkened at build time (a 960 px file; no runtime filter).
 */
import { MenuBackdrop } from '../../MenuBackdrop';
import { usePartyBackdrop } from '../partyHomeFlag';

const CITADEL_BLUR = `${import.meta.env.BASE_URL}backdrops/citadel-blur.webp`;

export function PhBackdrop() {
  const backdrop = usePartyBackdrop();
  return (
    <>
      {backdrop === 'hall'
        ? <MenuBackdrop screen="modes" />
        : <div className="ph-citadel" style={{ backgroundImage: `url(${CITADEL_BLUR})` }} aria-hidden="true" />}
      <div className="ph-veil" aria-hidden="true" />
    </>
  );
}
