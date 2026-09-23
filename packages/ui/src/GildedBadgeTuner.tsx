import { SPEC } from './gildedBadgeConfig';
import { TunerPanel } from './TunerPanel';

const GILDED_BADGE_SRC = `${import.meta.env.BASE_URL}frames/gilded.webp`;

/** Live preview of the gilded badge — the same art the card shows, reading the tuner's `--gcrown-*` vars, so
 *  size/placement track as you drag (the `.medprev` pattern). */
function GildedBadgePreview(): JSX.Element {
  return (
    <div className="gcrownprev">
      <img decoding="sync" className="gcrownprev-img" src={GILDED_BADGE_SRC} alt="" aria-hidden="true" />
    </div>
  );
}

/** DEV-only tuner for the 👑 GILDED BADGE — the golden/tripled corner marker. Size + placement, global. */
export function GildedBadgeTuner(): JSX.Element {
  return <TunerPanel spec={{ ...SPEC, readout: () => <GildedBadgePreview /> }} />;
}
