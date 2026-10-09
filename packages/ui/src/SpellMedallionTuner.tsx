import { GIFT_MEDALLION_SRC, RUBY_MEDALLION_SRC, SPELL_MEDALLION_SRC } from './spellMedallion';
import { SPEC } from './spellMedallionConfig';
import { TunerPanel } from './TunerPanel';

/** Live preview of every medallion — the same art and the same `--smed-*` vars the cards read, so size, shadow and
 *  glow track as you drag (placement is judged on real cards, not this swatch). */
function SpellMedallionPreview(): JSX.Element {
  return (
    <div className="smedprev">
      <span className="smedprev-cell" data-med="spell">
        <img decoding="sync" className="smedprev-img" src={SPELL_MEDALLION_SRC} alt="" aria-hidden="true" />
      </span>
      <span className="smedprev-cell" data-med="ruby">
        <img decoding="sync" className="smedprev-img" src={RUBY_MEDALLION_SRC} alt="" aria-hidden="true" />
      </span>
      <span className="smedprev-cell" data-med="gift">
        <img decoding="sync" className="smedprev-img" src={GIFT_MEDALLION_SRC} alt="" aria-hidden="true" />
      </span>
    </div>
  );
}

/** DEV-only tuner for the 💠 SPELL / RUBY / GIFT MEDALLIONS — size, placement, drop shadow and glow, each medallion on its own. */
export function SpellMedallionTuner(): JSX.Element {
  return <TunerPanel spec={{ ...SPEC, readout: () => <SpellMedallionPreview /> }} />;
}
