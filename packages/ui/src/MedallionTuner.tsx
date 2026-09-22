import type { CSSProperties } from 'react';
import { SPEC } from './medallionConfig';
import { mechMedallionArtScale, mechMedallionSrc } from './mechMedallion';
import { TunerPanel } from './TunerPanel';

/** A handful of wired mechanics with authored PNG medallion art (see `MECH_MEDALLION_PNGS`), so the preview
 *  shows real art rather than the SVG glyph fallback. [mechanic id, display label]. */
const PREVIEW_MECHS: readonly [string, string][] = [
  ['shout', 'Shout'],
  ['echo', 'Echo'],
  ['rally', 'Rally'],
  ['crit', 'Crit'],
  ['spend', 'Spend'],
  ['watcher', 'Watcher'],
];

/**
 * A live preview of the medallion tuner, rendered with the REAL `.cgem`/`.cgem-img` markup — the same
 * PNG-or-SVG hybrid render `Card.tsx`/`MinionBook.tsx` use — so it reflects the tuner's CSS vars as you drag.
 * The swatches sit in `.medprev`, which neutralises `.cgem`'s in-card absolute positioning (see the `.msprev`
 * pattern in `styles.css`) so a handful can be judged side by side without a mock card.
 */
function MedallionPreview(): JSX.Element {
  return (
    <div className="medprev">
      <div className="medprev-row">
        {PREVIEW_MECHS.map(([id, label]) => {
          const src = mechMedallionSrc(id);
          return (
            <div key={id} className="medprev-item">
              <span className="cgem" aria-hidden="true">
                {src ? <><img decoding="sync" className="cgem-img" src={src} alt="" aria-hidden="true" style={{ '--cgem-art-mech': mechMedallionArtScale(id) } as CSSProperties} /><span className="cgem-tint" style={{ '--cgem-artsrc': `url("${src}")`, '--cgem-art-mech': mechMedallionArtScale(id) } as CSSProperties} aria-hidden="true" /></> : null}
              </span>
              <span className="medprev-label">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * DEV-only tuner for the 🎖️ MECHANIC MEDALLION — the card's primary-mechanic gem. One GLOBAL size/placement +
 * art-inset setting shared by every card (unlike the per-tier Milestone Badges), so a single "Medallion" group
 * of dials is enough.
 */
export function MedallionTuner(): JSX.Element {
  return <TunerPanel spec={{ ...SPEC, readout: () => <MedallionPreview /> }} />;
}
