import { EPIC_MEDALLION_SRC } from './epicMedallion';
import { SPEC } from './epicMedallionConfig';
import { TunerPanel } from './TunerPanel';

/** Live preview of the epic medallion — the same art the card shows, reading the tuner's `--epic-*` vars. */
function EpicMedallionPreview(): JSX.Element {
  return (
    <div className="epicprev">
      <img decoding="sync" className="epicprev-img" src={EPIC_MEDALLION_SRC} alt="" aria-hidden="true" />
    </div>
  );
}

/** DEV-only tuner for the ✴️ EPIC MEDALLION — the separate badge on epic units. Size + placement, global. */
export function EpicMedallionTuner(): JSX.Element {
  return <TunerPanel spec={{ ...SPEC, readout: () => <EpicMedallionPreview /> }} />;
}
