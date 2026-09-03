/**
 * The ASCENT brand lockup — the gold mark plus the wordmark — shared by every surface that shows it.
 *
 * Extracted from `Title.tsx` (2026-08-22) when hero select adopted the same logo in place of its plain
 * "THE ASCENT" heading: two copies of the markup would drift the moment the mark art or the wordmark text
 * changed, and the wordmark is owner-editable (`titleTextConfig`), so drift was a matter of when.
 *
 * Each surface passes its own `className` and owns ALL of its sizing/animation. Deliberately: the title's
 * `.titlelogo` is driven by the 🏔️ tuner's global `--title-*` vars (offset, float, mark size), and inheriting
 * those anywhere else would mean tuning the home screen silently dragged the hero-select logo with it.
 */
import { getTitleText } from './titleTextConfig';

// The brand mark (owner art, `Reference Art/Ascent Logo Fantasy.svg` — a raster logo, extracted to
// `frames/title-logo.png`). Public-folder art carries BASE_URL: itch serves from a CDN sub-path, so a
// root-absolute '/frames/…' 404s there.
const TITLE_LOGO_SRC = `${import.meta.env.BASE_URL}frames/title-logo.png`;

export function AscentLogo({ className, headingClass = 'disp titleword' }: { className: string; headingClass?: string }) {
  return (
    <div className={className}>
      <img decoding="sync" className="crest" src={TITLE_LOGO_SRC} alt="" aria-hidden="true" draggable={false} />
      <h1 className={headingClass}>{getTitleText().wordmark}</h1>
    </div>
  );
}
