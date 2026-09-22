import { SPEC } from './secondPowerConfig';
import { TunerPanel } from './TunerPanel';

/**
 * A live PREVIEW of Void's second-power button wearing the bronze ring, so the frame (size / X / Y) can be
 * tuned without Void in play — Void is out of the roster, so the real button can't be reached (owner ask
 * 2026-09-16). It renders the REAL `.heropanel2 .heropowerbtn .hpb-frame` markup + CSS, with a local `--u` so
 * the 128·--u button is a sensible panel size; the `--hp2frame-*` vars update it live as you drag. The block's
 * own X / Y / scale (its seat on the real screen) can't show in a panel — those stay as-is.
 */
function SecondPowerPreview(): JSX.Element {
  return (
    <div className="hp2prev">
      <div className="heropanel2">
        <button className="heropowerbtn" type="button" disabled aria-hidden="true">
          <span className="hpb-glyph">✦</span>
          <img
            decoding="sync"
            className="hpb-frame"
            src={`${import.meta.env.BASE_URL}frames/hero-power-frame.webp`}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </button>
      </div>
    </div>
  );
}

/**
 * DEV-only tuner for VOID'S SECOND POWER BUTTON seat (owner ask 2026-08-22) + the bronze ring around it (owner
 * ask 2026-09-16). Rendered through the shared `TunerPanel`, with a live preview of the button + ring so the
 * frame can be dialled even though Void is currently out of the roster.
 */
export function SecondPowerTuner(): JSX.Element {
  return <TunerPanel spec={{ ...SPEC, readout: () => <SecondPowerPreview /> }} />;
}
