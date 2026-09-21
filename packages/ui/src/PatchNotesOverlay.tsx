import { useState } from 'react';
import { useGame } from './store';
import { sfx } from './sfx';
import { PATCH_NOTES, PATCH_CATEGORY_ORDER, type PatchCategory, type PatchChange } from './patchNotes';

/** A category → CSS-class-suffix map, so each tag wears its own hue (defined in styles.css): Balance in the
 *  warm gold, Systems in the neutral ink (owner's two buckets, 2026-09-21). */
const CAT_CLASS: Record<PatchCategory, string> = {
  Balance: 'balance',
  Systems: 'systems',
};

/** Group a patch's flat change list by category, in the fixed display order, so a patch reads
 *  "Balance … then Systems" rather than in authoring order. Carries each change whole
 *  (text + optional details) so the Detailed view can expand the sub-bullets. */
function grouped(changes: PatchChange[]): { category: PatchCategory; items: PatchChange[] }[] {
  const byCat = new Map<PatchCategory, PatchChange[]>();
  for (const c of changes) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
  return PATCH_CATEGORY_ORDER.filter((c) => byCat.has(c)).map((category) => ({ category, items: byCat.get(category)! }));
}

/** A readable date: "August 24, 2026" from "2026-08-24" (no timezone math — split the ISO string). */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (!y || !m || !d || !MONTHS[m - 1]) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * PATCH NOTES — the gameplay changelog, opened from the title screen only (owner ask 2026-08-24). A scrolling,
 * newest-first list of patches; each patch is a dated header + its changes grouped by category. Data lives in
 * `patchNotes.ts`; this is a pure renderer over it.
 */
export function PatchNotes() {
  const show = useGame((s) => s.showPatchNotes);
  const close = useGame((s) => s.closePatchNotes);
  // Two reading levels (owner ask 2026-08-24): Summary (headlines only) vs Detailed (every change's specifics).
  const [detailed, setDetailed] = useState(false);
  if (!show) return null;
  return (
    <div className="pnov" onPointerDown={() => { sfx.tick(); close(); }}>
      <div className="pnpanel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="pnhead">
          <span className="pntitle disp">Patch Notes</span>
          {/* Summary ↔ Detailed. A single pill toggle: the pressed side is the active view. */}
          <div className="pntoggle" role="group" aria-label="Detail level">
            <button
              className={`pntoggle-btn${detailed ? '' : ' on'}`}
              aria-pressed={!detailed}
              onPointerDown={() => { sfx.tick(); setDetailed(false); }}
            >Summary</button>
            <button
              className={`pntoggle-btn${detailed ? ' on' : ''}`}
              aria-pressed={detailed}
              onPointerDown={() => { sfx.tick(); setDetailed(true); }}
            >Detailed</button>
          </div>
          <button className="pnclose pressable" onPointerDown={() => { sfx.tick(); close(); }} aria-label="Close patch notes">✕</button>
        </div>
        <div className="pnscroll">
          {PATCH_NOTES.map((note, i) => (
            <section className="pnpatch" key={`${note.date}-${i}`}>
              <div className="pnpatchhead">
                <span className="pndate">{prettyDate(note.date)}</span>
                {note.label && <span className="pnlabel">{note.label}</span>}
              </div>
              {grouped(note.changes).map(({ category, items }) => (
                <div className="pngroup" key={category}>
                  <span className={`pntag pntag-${CAT_CLASS[category]}`}>{category}</span>
                  <ul className="pnlist">
                    {items.map((change, j) => (
                      <li key={j}>
                        {change.text}
                        {/* Detailed view: expand this change's granular sub-bullets, when it has any. */}
                        {detailed && change.details && change.details.length > 0 && (
                          <ul className="pnsublist">
                            {change.details.map((d, k) => <li key={k}>{d}</li>)}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
