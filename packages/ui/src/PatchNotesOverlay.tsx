import { useState, type KeyboardEvent } from 'react';
import { useGame } from './store';
import { sfx } from './sfx';
import { PATCH_NOTES, PATCH_CATEGORY_ORDER, type PatchCategory, type PatchChange, type PatchNote } from './patchNotes';

/** The two tabs (owner ask 2026-09-23): "tabs that carry game related balance/cards/heroes etc and then a
 *  systems tab that carries dev updates and systems changes." Each tab IS one `PatchCategory`; only the label
 *  the player reads differs (the `Balance` bucket reads as "Game"). Order = `PATCH_CATEGORY_ORDER`. */
export const PATCH_TAB_LABEL: Record<PatchCategory, string> = {
  Balance: 'Game',
  Systems: 'Systems',
};

/** localStorage key remembering the last tab the player was on. Read/written inside try/catch: storage may be
 *  blocked (private mode, cleared site data) and the viewer must still open. */
export const PATCH_TAB_STORAGE_KEY = 'ascent.patchnotes.tab';

const DEFAULT_TAB: PatchCategory = 'Balance';

const isTab = (v: unknown): v is PatchCategory => typeof v === 'string' && (PATCH_CATEGORY_ORDER as string[]).includes(v);

function readStoredTab(): PatchCategory {
  try {
    const v = localStorage.getItem(PATCH_TAB_STORAGE_KEY);
    return isTab(v) ? v : DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB;
  }
}

function writeStoredTab(tab: PatchCategory): void {
  try { localStorage.setItem(PATCH_TAB_STORAGE_KEY, tab); } catch { /* storage blocked: the tab still switches */ }
}

/** The dated entries as one tab sees them: each entry keeps only the changes of that tab's category, and an
 *  entry with none of them is hidden on that tab. Exported so the render test can assert against the same
 *  projection the viewer paints. */
export function notesForTab(tab: PatchCategory, notes: PatchNote[] = PATCH_NOTES): { note: PatchNote; items: PatchChange[] }[] {
  const out: { note: PatchNote; items: PatchChange[] }[] = [];
  for (const note of notes) {
    const items = note.changes.filter((c) => c.category === tab);
    if (items.length > 0) out.push({ note, items });
  }
  return out;
}

/** A readable date: "August 24, 2026" from "2026-08-24" (no timezone math — split the ISO string). */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (!y || !m || !d || !MONTHS[m - 1]) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const tabDomId = (tab: PatchCategory): string => `pntab-${tab.toLowerCase()}`;
const panelDomId = (tab: PatchCategory): string => `pnpanel-${tab.toLowerCase()}`;

/**
 * PATCH NOTES — the gameplay changelog, opened from the title screen only (owner ask 2026-08-24). Two tabs
 * (owner ask 2026-09-23): **Game** (every `Balance` change: cards, heroes, runes, equipment, economy, rules)
 * and **Systems** (every `Systems` change: screens, effects, information, dev updates). Each tab is a
 * scrolling, newest-first list of the dated patches that have at least one change of its category, showing
 * only those changes; the per-change category chip is gone because the tab already says it. The Summary /
 * Detailed toggle is independent of the tab. The last tab is remembered in localStorage. Data lives in
 * `patchNotes.ts`; this is a pure renderer over it.
 */
export function PatchNotes() {
  const show = useGame((s) => s.showPatchNotes);
  const close = useGame((s) => s.closePatchNotes);
  // Two reading levels (owner ask 2026-08-24): Summary (headlines only) vs Detailed (every change's specifics).
  const [detailed, setDetailed] = useState(false);
  // Which bucket is open. Lazily read from storage so a blocked localStorage never throws during render.
  const [tab, setTab] = useState<PatchCategory>(readStoredTab);
  if (!show) return null;

  const pickTab = (next: PatchCategory): void => {
    if (next === tab) return;
    sfx.tick();
    setTab(next);
    writeStoredTab(next);
  };

  // Roving-focus tablist: Left/Right step, Home/End jump. The tab that lands is selected as it takes focus.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    const i = PATCH_CATEGORY_ORDER.indexOf(tab);
    let next: PatchCategory | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = PATCH_CATEGORY_ORDER[(i + 1) % PATCH_CATEGORY_ORDER.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = PATCH_CATEGORY_ORDER[(i - 1 + PATCH_CATEGORY_ORDER.length) % PATCH_CATEGORY_ORDER.length];
    else if (e.key === 'Home') next = PATCH_CATEGORY_ORDER[0];
    else if (e.key === 'End') next = PATCH_CATEGORY_ORDER[PATCH_CATEGORY_ORDER.length - 1];
    if (!next) return;
    e.preventDefault();
    pickTab(next);
    (e.currentTarget.parentElement?.querySelector(`#${tabDomId(next)}`) as HTMLButtonElement | null)?.focus();
  };

  const entries = notesForTab(tab);

  return (
    <div className="pnov" onPointerDown={() => { sfx.tick(); close(); }}>
      <div className="pnpanel" onPointerDown={(e) => e.stopPropagation()}>
        <div className="pnhead">
          <span className="pntitle disp">Patch Notes</span>
          <button className="pnclose pressable" onPointerDown={() => { sfx.tick(); close(); }} aria-label="Close patch notes">✕</button>
        </div>
        <div className="pnbar">
          {/* Game ↔ Systems. Pill tabs in the same track language as the Summary/Detailed segment. */}
          <div className="pntabs" role="tablist" aria-label="Patch note sections">
            {PATCH_CATEGORY_ORDER.map((t) => (
              <button
                key={t}
                id={tabDomId(t)}
                className={`pntab${t === tab ? ' on' : ''}`}
                role="tab"
                aria-selected={t === tab}
                aria-controls={panelDomId(t)}
                tabIndex={t === tab ? 0 : -1}
                onClick={() => pickTab(t)}
                onKeyDown={onTabKey}
              >{PATCH_TAB_LABEL[t]}</button>
            ))}
          </div>
          {/* Summary ↔ Detailed. A single pill toggle: the pressed side is the active view. Independent of the tab. */}
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
        </div>
        <div className="pnscroll" role="tabpanel" id={panelDomId(tab)} aria-labelledby={tabDomId(tab)}>
          {entries.length === 0 && <p className="pnempty">Nothing here yet.</p>}
          {entries.map(({ note, items }, i) => (
            <section className="pnpatch" key={`${note.date}-${i}`}>
              <div className="pnpatchhead">
                <span className="pndate">{prettyDate(note.date)}</span>
                {note.label && <span className="pnlabel">{note.label}</span>}
              </div>
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
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
