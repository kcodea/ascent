/**
 * PATCH NOTES under the APP SHELL (party home prototype, DEV only; owner 2026-11-02: "all of these menus should get revamped
 * to work with the new setup", "take a lot of inspiration from valorant's menus"). PatchNotesPage.tsx swaps this in for
 * `PatchNotesBody` while the "Party home (prototype)" switch is on and the player is on the menus; off, or in a game, the
 * page is exactly as before.
 *
 * THE LAYOUT (Valorant's patch notes, a reading page): the header carries the Game / Systems tabs and the Summary / Detailed
 * switch. Under it, two columns: on the left a PATCH INDEX grouped by month (each patch: its day, its label, how many
 * changes this tab holds), on the right the FEED, one section per patch, newest first. A press on the index scrolls the
 * feed to that patch; the index follows the feed as it scrolls (one IntersectionObserver, no layout reads). A SEARCH box
 * narrows both to the changes that mention a word (a card, a hero, a rune), searching the details too.
 *
 * Everything the old body did is kept: the two tabs (remembered, the same storage key), Summary / Detailed, newest first,
 * only the tab's changes per patch, a patch with none hidden. Data: `patchNotes.ts`, through `notesForTab`.
 *
 * PERFORMANCE: static paint. 300+ patches mount once; each section is `content-visibility: auto`, so the browser only lays
 * out and paints the ones near the screen. The search filter is deferred (`useDeferredValue`).
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../sfx';
import { PATCH_CATEGORY_ORDER, type PatchCategory, type PatchChange, type PatchNote } from '../../patchNotes';
import { PATCH_TAB_LABEL, PATCH_TAB_STORAGE_KEY, notesForTab } from '../../PatchNotesBody';
import { PhChip, PhEmpty, PhPage, PhSearch, PhSegmented, PhTabs } from '../kit';
import './phPatchNotes.css';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-08-24" to its parts, with no timezone math (split the ISO string). */
function dateParts(iso: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d || !MONTHS[m - 1]) return null;
  return { y, m, d };
}
export function prettyDate(iso: string): string {
  const p = dateParts(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : iso;
}
function monthOf(iso: string): string {
  const p = dateParts(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : iso;
}

function readTab(): PatchCategory {
  try {
    const v = localStorage.getItem(PATCH_TAB_STORAGE_KEY);
    return v && (PATCH_CATEGORY_ORDER as string[]).includes(v) ? (v as PatchCategory) : 'Balance';
  } catch { return 'Balance'; }
}
function writeTab(t: PatchCategory): void {
  try { localStorage.setItem(PATCH_TAB_STORAGE_KEY, t); } catch { /* storage blocked: the tab still switches */ }
}

/** A patch label as a player reads it. Old labels were written for the team: "Balance 9/23: rune reworks B" reads as
 *  "Rune reworks", and a bare "Art Batch" says nothing the date doesn't, so it shows no label. */
export function playerLabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  const tidy = label.replace(/^Balance \d+\/\d+:\s*/, '').replace(/\s+(?:[A-HJ-Z]|round \d+)$/, '').trim();
  if (!tidy || /\bbatch\b/i.test(tidy)) return undefined;
  return tidy[0]!.toUpperCase() + tidy.slice(1);
}

/** Does `text` mention every word of `query` (any order, any case)? An empty query matches. */
export function matchesWords(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = text.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** One patch as a tab and a search see it. `key` is stable per patch (a date can carry two labelled blocks). */
export interface PatchEntry { key: string; note: PatchNote; items: PatchChange[] }

/** The tab's patches, narrowed to the changes whose summary or details mention every word of `query` (any order, any
 *  case). An empty query keeps everything. A change whose match is only in its details shows them even in Summary.
 *  Exported for the test. */
export function patchEntries(tab: PatchCategory, query: string, notes?: PatchNote[]): PatchEntry[] {
  const hit = (c: PatchChange): boolean => matchesWords(`${c.text} ${(c.details ?? []).join(' ')}`, query);
  const out: PatchEntry[] = [];
  notesForTab(tab, notes).forEach(({ note, items }, i) => {
    const kept = items.filter(hit);
    if (kept.length) out.push({ key: `${note.date}-${note.label ?? ''}-${i}`, note, items: kept });
  });
  return out;
}

const domId = (key: string): string => `phpn-${key.replace(/[^a-zA-Z0-9-]/g, '')}`;

export function PhPatchNotes() {
  const [tab, setTab] = useState<PatchCategory>(readTab);
  const [detailed, setDetailed] = useState(false);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search.trim());
  const entries = useMemo(() => patchEntries(tab, q), [tab, q]);
  const total = useMemo(() => entries.reduce((n, e) => n + e.items.length, 0), [entries]);
  const [active, setActive] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // The index follows the feed: the topmost patch section crossing the top band of the feed is the current one.
  useEffect(() => {
    const root = feedRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver((list) => {
      for (const e of list) seen.set((e.target as HTMLElement).dataset.key!, e.isIntersecting);
      const first = entries.find((x) => seen.get(x.key));
      if (first) setActive(first.key);
    }, { root, rootMargin: '0px 0px -70% 0px' });
    for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) io.observe(el);
    return () => io.disconnect();
  }, [entries]);
  // A new tab or search starts at the top of the feed, on its newest patch.
  useEffect(() => { setActive(entries[0]?.key ?? null); feedRef.current?.scrollTo?.({ top: 0 }); }, [entries]);

  const jump = (key: string): void => {
    sfx.tick();
    setActive(key);
    document.getElementById(domId(key))?.scrollIntoView?.({ block: 'start' });
  };
  const pickTab = (t: PatchCategory): void => { sfx.tick(); setTab(t); writeTab(t); };

  // The index, grouped by month (newest first, as the feed).
  const months = useMemo(() => {
    const out: { month: string; list: PatchEntry[] }[] = [];
    for (const e of entries) {
      const m = monthOf(e.note.date);
      if (out[out.length - 1]?.month !== m) out.push({ month: m, list: [] });
      out[out.length - 1]!.list.push(e);
    }
    return out;
  }, [entries]);

  return (
    <PhPage
      className="phpn"
      wide
      title="Patch Notes"
      tabs={<PhTabs label="Patch note sections" value={tab} onChange={pickTab}
        tabs={PATCH_CATEGORY_ORDER.map((t) => ({ id: t, label: PATCH_TAB_LABEL[t] }))} />}
      actions={
        <>
          <PhSearch className="phpn-search" placeholder="Search" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search the patch notes" />
          <PhSegmented value={detailed ? 'detailed' : 'summary'} onPick={(v) => { if ((v === 'detailed') !== detailed) { sfx.tick(); setDetailed(v === 'detailed'); } }}
            options={[{ value: 'summary', label: 'Summary' }, { value: 'detailed', label: 'Detailed' }]} />
        </>
      }
    >
      {entries.length === 0 ? (
        <PhEmpty title={q ? 'No changes match' : 'Nothing here yet'} sub={q ? `Nothing on this tab mentions "${q}".` : undefined} />
      ) : (
        <div className="phpn-cols">
          <nav className="phpn-index" aria-label="Patches">
            <div className="phpn-count">
              <b>{entries.length}</b> {entries.length === 1 ? 'patch' : 'patches'} <span aria-hidden="true">·</span> <b>{total}</b> {total === 1 ? 'change' : 'changes'}
            </div>
            {months.map((g) => (
              <div className="phpn-month" key={g.month}>
                <span className="phpn-monthname">{g.month}</span>
                {g.list.map((e) => {
                  const p = dateParts(e.note.date);
                  return (
                    <button key={e.key} type="button" className={`phpn-idx${active === e.key ? ' on' : ''}`} aria-current={active === e.key ? 'true' : undefined}
                      onClick={() => jump(e.key)} aria-label={`${prettyDate(e.note.date)}${playerLabel(e.note.label) ? `, ${playerLabel(e.note.label)}` : ''}, ${e.items.length} changes`}>
                      <span className="phpn-day">{p ? `${SHORT_MONTHS[p.m - 1]} ${p.d}` : e.note.date}</span>
                      <span className="phpn-idxlabel">{playerLabel(e.note.label) ?? ''}</span>
                      <span className="phpn-n">{e.items.length}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="phpn-feed" ref={feedRef} role="region" aria-label={`${PATCH_TAB_LABEL[tab]} changes`}>
            {entries.map((e) => (
              <article className="phpn-patch" key={e.key} id={domId(e.key)} data-key={e.key}>
                <header className="phpn-head">
                  <h2>{prettyDate(e.note.date)}</h2>
                  {playerLabel(e.note.label) && <PhChip tone="gold">{playerLabel(e.note.label)}</PhChip>}
                  <span className="phpn-headn">{e.items.length} {e.items.length === 1 ? 'change' : 'changes'}</span>
                </header>
                <ul className="phpn-list">
                  {e.items.map((c, j) => (
                    <li key={j}>
                      <span className="phpn-text">{c.text}</span>
                      {(detailed || (q !== '' && !matchesWords(c.text, q))) && c.details && c.details.length > 0 && (
                        <ul className="phpn-sub">{c.details.map((d, k) => <li key={k}>{d}</li>)}</ul>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      )}
    </PhPage>
  );
}

