import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredFxDef } from '../defStore';
import {
  buildCatalog, buildCardRows, kindCoverage, codeCoverage, codeScanCaveat, callSitePath, callSitesLabel,
  FX_HUES, type FxHue, type FxUsage,
} from './catalog';
import { EMPTY_FILTER, applyFilter, groupByLook, groupByCard, type FxFilter, type FxUsageFilter, type FxCardRow } from './catalogView';
import { effectiveTables, setBinding, bindingsJson, type BindingKind } from '../../choreo/bindings';
import { saveBindings, saveDef } from '../defStore';
import { registerSavedDef } from '../fxDefs';
import { importFxSound } from '../../sfx';
import { CARD_EVENT_SLOTS } from './cardEventSlots';
import { Card } from '../../Card';
import { toView } from '../../MinionBook';
import { CARD_INDEX, SETS } from '@game/content';
import { playDef } from '../playDef';
import { pixiFx } from '../../pixiFx';

export interface LibraryBrowserProps {
  onLoad: (def: StoredFxDef) => void;
  onDuplicate: (def: StoredFxDef) => void;
  /** Play `id` in the preview stage; called on hover after the caller's own debounce. */
  onPreview: (id: string | null) => void;
  onClose: () => void;
}

type Lens = 'look' | 'event' | 'card';

/** Hover settle before a preview fires. Without it, dragging down a 20-row list starts 20 effects. */
const PREVIEW_DELAY_MS = 120;

/**
 * The three wiring states, in words an author can act on.
 *
 * "unbound" used to be the only non-bound label and it was read — correctly, until the pixiFx migration —
 * as "inert". Seven defs then started playing constantly with no binding, so the words matter: `code` says
 * PLAYS, `unused` says DOESN'T. Nothing here says "unbound", because that describes the wiring rather than
 * the thing the author is trying to find out.
 */
const USAGE_LABEL: Record<FxUsage, string> = {
  bound: 'bound',
  code: 'from code',
  unused: 'unused',
};

const USAGE_HELP: Record<FxUsageFilter, string> = {
  all: 'Every def in the library',
  bound: 'Plays because a moment kind or a card override names it (choreo/bindings.json)',
  code: 'Plays because packages/ui/src calls playDef() with this id — no binding involved',
  unused: 'Nothing binds it and nothing calls it: this one really does not play',
};

/**
 * One call site, as a path you can act on: click to copy it, then paste it into an editor.
 *
 * The library used to say only THAT a def was played from code, with the files in a tooltip — enough to know
 * the def is not inert, not enough to go and look. The path is the whole answer to "where does this fire",
 * so it is on the row rather than behind a hover, and copyable because the next thing anyone does with it is
 * open it somewhere else. Clipboard writes can be refused (permissions, insecure context); the label just
 * stays put rather than claiming a copy that did not happen — the path is still readable either way.
 */
function CallSite({ file }: { file: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const path = callSitePath(file);
  return (
    <button
      className="fxlib-callsite"
      title={`Copy ${path}`}
      onClick={() => {
        void navigator.clipboard?.writeText(path).then(
          () => setCopied(true),
          () => {},
        );
      }}
    >
      {copied ? `${path} ✓` : path}
    </button>
  );
}

export function LibraryBrowser({ onLoad, onDuplicate, onPreview, onClose }: LibraryBrowserProps): React.ReactElement {
  const [lens, setLens] = useState<Lens>('look');
  const [filter, setFilter] = useState<FxFilter>(EMPTY_FILTER);
  // Built once per open (the def registries don't change while the overlay is up) — except an in-browser sound
  // IMPORT registers a new def, so `catalogVersion` lets that one path re-derive the catalog so the new def is
  // immediately known (not flagged "missing") and shows in the autocomplete.
  const [catalogVersion, setCatalogVersion] = useState(0);
  const catalog = useMemo(() => buildCatalog(), [catalogVersion]);
  const coverage = useMemo(() => kindCoverage(), []);
  const codeRows = useMemo(() => codeCoverage(), []);
  const cardRows = useMemo(() => buildCardRows(), []);
  const shown = useMemo(() => applyFilter(catalog, filter), [catalog, filter]);
  const knownIds = useMemo(() => new Set(catalog.map((e) => e.def.id)), [catalog]);

  // "By card" binding editor state. `bindVersion` bumps after every write so the live-view memo below re-reads
  // the module-level table; `bindNote` is the transient save confirmation.
  const [bindVersion, setBindVersion] = useState(0);
  const [bindNote, setBindNote] = useState<string | null>(null);
  // The live PER-CARD overrides (tombstones stripped, so a cleared slot reads empty). One rebuild per render,
  // not one per card × slot. Re-read whenever a binding is written.
  const liveCardBindings = useMemo(() => effectiveTables().cards, [bindVersion]);
  // Def ids for the assign field's autocomplete — SOUND defs first (this lens is mostly for adding a play
  // sound), then the rest, each sorted.
  const defIds = useMemo(() => {
    const hasSound = (e: (typeof catalog)[number]): boolean => e.def.layers.some((l) => l.primitive === 'sound');
    const ids = (pred: (e: (typeof catalog)[number]) => boolean): string[] =>
      catalog.filter(pred).map((e) => e.def.id).sort((a, b) => a.localeCompare(b));
    return [...ids(hasSound), ...ids((e) => !hasSound(e))];
  }, [catalog]);

  // The "By card" lens shows ONE tribe at a time (picked in the left sidebar), each card rendered inline with
  // its bindable-event slots — so only a tribe's worth of `<Card>` mount at once (the compendium renders card
  // galleries the same way). `cardGroups`/`tribeList` are static (grouping is by tribe); `activeTribe` falls
  // back to the first tribe until one is picked.
  const cardGroups = useMemo(() => groupByCard(cardRows), [cardRows]);
  const tribeList = useMemo(() => cardGroups.map((g) => g.title), [cardGroups]);
  const [cardTribe, setCardTribe] = useState<string | null>(null);
  const activeTribe = cardTribe !== null && tribeList.includes(cardTribe) ? cardTribe : (tribeList[0] ?? null);
  // Set membership lives on the SET, not the card, so build a card→sets map once (a card can be in several).
  const setList = useMemo(() => Object.values(SETS).map((s) => ({ id: s.id, name: s.name })), []);
  const cardSetsMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of Object.values(SETS)) for (const card of s.own) m.set(card.id, [...(m.get(card.id) ?? []), s.id]);
    return m;
  }, []);
  // Extra facets that NARROW the shown cards (empty set = no constraint): tier (1–6) and set membership.
  const [tierFilter, setTierFilter] = useState<Set<number>>(new Set());
  const [chosenSets, setChosenSets] = useState<Set<string>>(new Set());
  const toggleIn = <T,>(set: Set<T>, v: T): Set<T> => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };
  // The top search box narrows the "By card" view: a non-empty term searches EVERY card (across tribes) by
  // name, id, or any effect def bound to it; an empty term shows the picked tribe. Tier/set facets then narrow
  // whichever base list is showing.
  const cardSearch = filter.search.trim().toLowerCase();
  const cardMatches = (c: FxCardRow): boolean =>
    c.name.toLowerCase().includes(cardSearch) ||
    c.cardId.toLowerCase().includes(cardSearch) ||
    Object.values(liveCardBindings[c.cardId] ?? {}).some((b) => b?.def.toLowerCase().includes(cardSearch));
  const passesFacets = (c: FxCardRow): boolean =>
    (tierFilter.size === 0 || tierFilter.has(CARD_INDEX[c.cardId]?.tier ?? 0)) &&
    (chosenSets.size === 0 || (cardSetsMap.get(c.cardId) ?? []).some((s) => chosenSets.has(s)));
  const baseCards = cardSearch
    ? cardRows.filter(cardMatches)
    : (cardGroups.find((g) => g.title === activeTribe)?.cards ?? []);
  const shownCards = baseCards.filter(passesFacets);
  const cardTitle = cardSearch
    ? `${shownCards.length} result${shownCards.length === 1 ? '' : 's'} for “${filter.search.trim()}”`
    : (activeTribe ?? '');

  // Re-read the table + persist to bindings.json (dev-only endpoint) after any binding write.
  const persist = (): void => {
    setBindVersion((n) => n + 1);
    void saveBindings(bindingsJson()).then((r) => {
      setBindNote(r.ok ? '✓ saved to bindings.json' : `save failed — ${r.error}`);
      window.setTimeout(() => setBindNote(null), 2600);
    });
  };

  // Assign a def to (card, event), PRESERVING the slot's other fields (its volume) — or, when the field is
  // cleared, write a TOMBSTONE (an explicit "plays nothing here") rather than a plain removal, which would fall
  // back to the file/kind default and not read as "cleared".
  const commitBinding = (cardId: string, kind: BindingKind, raw: string): void => {
    const v = raw.trim();
    const current = liveCardBindings[cardId]?.[kind];
    if (v === (current?.def ?? '')) return; // no change (also covers empty→empty)
    setBinding(cardId, kind, v === '' ? null : { ...current, def: v });
    persist();
  };

  // ▶ preview: a dedicated PREVIEW STAGE that renders the def OVER everything (owner ask). It plays in the
  // above-modal Pixi canvas — lifted above the workbench while the stage is open (see `body.fxlib-previewing`
  // in styles.css) — so ANY visual def shows here regardless of whether a game board is loaded. It LOOPS while
  // open so the effect stays visible; the effect below owns play + teardown. Scrim / ✕ / Esc close it.
  const [preview, setPreview] = useState<{ def: string; gain: number | undefined } | null>(null);
  const previewOnCard = (def: string, gain: number | undefined): void => setPreview({ def, gain });
  const closePreview = (): void => setPreview(null);

  useEffect(() => {
    if (preview === null) return;
    document.body.classList.add('fxlib-previewing');
    let stop: (() => void) | null = null;
    let cancelled = false;
    void pixiFx.ensureAboveSlot().then(() => {
      if (cancelled) return;
      const pt = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      stop = playDef(preview.def, { source: pt, target: pt, cursor: pt }, { slot: 'above', gain: preview.gain, loop: true }) ?? null;
    });
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setPreview(null); };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      stop?.();
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('fxlib-previewing');
    };
  }, [preview]);

  // The per-card volume (0–100 → a gain multiplier on the def's authored level; 100 → omitted default `1`).
  // Only meaningful when a def is bound, and preserves the def + other fields.
  const commitVolume = (cardId: string, kind: BindingKind, raw: string): void => {
    const current = liveCardBindings[cardId]?.[kind];
    if (!current) return; // nothing bound → nothing to level
    const n = Math.round(Number(raw));
    const pct = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
    const gain = pct / 100;
    if (gain === (current.gain ?? 1)) return;
    setBinding(cardId, kind, { ...current, gain: gain === 1 ? undefined : gain });
    persist();
  };

  // Import a WAV/MP3 as a card's sound (owner ask): the file becomes a committed clip + a minimal Sound def,
  // bound to that slot — one click to give a card its own sound. `importFxSound` saves + registers the clip for
  // this session; `registerSavedDef` makes the new def live (no reload); the binding is committed like any other.
  const importInputRef = useRef<HTMLInputElement>(null);
  const pendingImportRef = useRef<{ cardId: string; kind: BindingKind } | null>(null);
  const openImport = (cardId: string, kind: BindingKind): void => {
    pendingImportRef.current = { cardId, kind };
    importInputRef.current?.click();
  };
  const importSoundToSlot = async (cardId: string, kind: BindingKind, file: File): Promise<void> => {
    setBindNote('importing…');
    try {
      const { id: clipId, label } = await importFxSound(file); // fx/<slug>, saved + registered this session
      const defId = `sfx-${label}`;
      const def: StoredFxDef = {
        version: 1,
        id: defId,
        duration: 1000,
        layers: [{ primitive: 'sound', anchor: 'travel', at: 0, params: { clip: clipId } }],
      };
      const saved = await saveDef(def);
      if (!saved.ok) { setBindNote(`import failed — ${saved.error}`); window.setTimeout(() => setBindNote(null), 3500); return; }
      registerSavedDef(def);           // live this session, no reload
      setCatalogVersion((n) => n + 1); // so knownIds / the autocomplete see the new def
      setBinding(cardId, kind, { def: defId });
      setBindVersion((n) => n + 1);
      void saveBindings(bindingsJson());
      setBindNote(`✓ imported “${label}” and bound it`);
      window.setTimeout(() => setBindNote(null), 3500);
    } catch (e) {
      setBindNote(`import failed — ${(e as Error).message}`);
      window.setTimeout(() => setBindNote(null), 3500);
    }
  };

  // A ref, not state: the handle is only ever read inside handlers, so keeping it in state would re-render
  // the whole list on every hover and leave for no benefit.
  const hoverTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    // A pending preview must not fire after the overlay is gone.
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  const hover = (id: string | null): void => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    if (id === null) { onPreview(null); hoverTimerRef.current = null; return; }
    hoverTimerRef.current = window.setTimeout(() => onPreview(id), PREVIEW_DELAY_MS);
  };

  const load = (def: StoredFxDef): void => { hover(null); onLoad(def); onClose(); };

  const set = <K extends keyof FxFilter>(key: K, value: FxFilter[K]): void =>
    setFilter((f) => ({ ...f, [key]: value }));

  const toggleHue = (h: FxHue): void =>
    set('hues', filter.hues.includes(h) ? filter.hues.filter((x) => x !== h) : [...filter.hues, h]);

  return (
    <>
    <div className="fxlib-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="fxlib">
      <div className="fxlib-top">
        <span className="fxlib-title">FX Library</span>
        {(['look', 'event', 'card'] as Lens[]).map((l) => (
          <button key={l} className={`fxwb-btn${lens === l ? ' on' : ''}`} onClick={() => setLens(l)}>
            {l === 'look' ? 'By look' : l === 'event' ? 'By event' : 'By card'}
          </button>
        ))}
        <input
          className="fxlib-search"
          placeholder="Search name, tag, card…"
          value={filter.search}
          onChange={(e) => set('search', e.target.value)}
        />
        <button className="fxwb-btn" onClick={onClose}>Close</button>
      </div>

      <div className="fxlib-body">
        <div className="fxlib-facets">
          {lens === 'card' ? (
            /* The "By card" lens picks ONE tribe to view at a time (owner ask). */
            <>
              <div className="fxlib-facet-title">Tribe</div>
              {tribeList.map((t) => (
                <button
                  key={t}
                  className={`fxwb-btn fxlib-tribe-btn${activeTribe === t ? ' on' : ''}`}
                  onClick={() => setCardTribe(t)}
                >
                  {t}
                </button>
              ))}
              <div className="fxlib-facet-title">Tier</div>
              {/* 3-wide grid: 1–3 on row one, 4–6 on row two, and 7 alone on the row below (owner ask). */}
              <div className="fxlib-tiergrid">
                {[1, 2, 3, 4, 5, 6, 7].map((t) => (
                  <button
                    key={t}
                    className={`fxwb-btn fxlib-tier-btn${tierFilter.has(t) ? ' on' : ''}`}
                    title={`Tier ${t}`}
                    onClick={() => setTierFilter((s) => toggleIn(s, t))}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="fxlib-facet-title">Set</div>
              {setList.map((s) => (
                <button
                  key={s.id}
                  className={`fxwb-btn fxlib-tribe-btn${chosenSets.has(s.id) ? ' on' : ''}`}
                  onClick={() => setChosenSets((cur) => toggleIn(cur, s.id))}
                >
                  {s.name}
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="fxlib-facet-title">Colour</div>
              <div className="fxlib-hues">
                {FX_HUES.map((h) => (
                  <button
                    key={h}
                    className={`fxlib-hue ${h}${filter.hues.includes(h) ? ' on' : ''}`}
                    title={h}
                    onClick={() => toggleHue(h)}
                  />
                ))}
              </div>
              <div className="fxlib-facet-title">Motion</div>
              {(['travels', 'in place'] as const).map((m) => (
                <button
                  key={m}
                  className={`fxwb-btn${filter.motion === m ? ' on' : ''}`}
                  onClick={() => set('motion', filter.motion === m ? null : m)}
                >
                  {m}
                </button>
              ))}
              <div className="fxlib-facet-title">Wiring</div>
              {(['all', 'bound', 'code', 'unused'] as const).map((u) => (
                <button
                  key={u}
                  className={`fxwb-btn${filter.usage === u ? ' on' : ''}`}
                  title={USAGE_HELP[u]}
                  onClick={() => set('usage', u)}
                >
                  {u === 'all' ? 'all' : USAGE_LABEL[u]}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="fxlib-results">
          {lens === 'look' && groupByLook(shown).map((g) => (
            <div className="fxlib-group" key={g.title}>
              <div className="fxlib-group-title">{g.title}</div>
              {g.entries.map((e) => (
                <div
                  className="fxlib-row"
                  key={e.def.id}
                  onPointerEnter={() => hover(e.def.id)}
                  onPointerLeave={() => hover(null)}
                >
                  <span className={`fxlib-swatch ${e.facets.hue}`} />
                  <button className="fxlib-row-load" onClick={() => load(e.def)}>
                    <span className="fxlib-row-name">{e.def.label ?? e.def.id}</span>
                    <span className="fxlib-row-meta">
                      {e.facets.shape} · {e.facets.motion} · {e.def.layers.length} layers · {e.def.duration}ms
                    </span>
                  </button>
                  {/* Always rendered, all three states. A badge that appears only on the bad case teaches the
                      reader that no badge = fine, which is exactly how "unbound" came to mean "inert". */}
                  <span
                    className={`fxlib-wire ${e.usage}`}
                    title={e.usage === 'code' ? `Played from ${callSitesLabel(e.callSites)}` : USAGE_HELP[e.usage]}
                  >
                    {USAGE_LABEL[e.usage]}
                  </span>
                  <button title="Duplicate as a fresh template" onClick={() => onDuplicate(e.def)}>⧉</button>
                </div>
              ))}
            </div>
          ))}

          {lens === 'event' && (
            <>
            <div className="fxlib-group">
              <div className="fxlib-group-title">By moment kind</div>
              {coverage.map((c) => (
                <div className="fxlib-row" key={c.kind} onPointerEnter={() => hover(c.def)} onPointerLeave={() => hover(null)}>
                  <span className="fxlib-row-name">{c.kind}</span>
                  {c.def === null ? (
                    <span className="fxlib-gap">nothing bound</span>
                  ) : knownIds.has(c.def) ? (
                    <span className="fxlib-row-meta">{c.def}</span>
                  ) : (
                    // A binding naming a def that does not exist is a silent no-op at runtime. Saying so here
                    // is the whole reason this lens is worth building.
                    <span className="fxlib-missing">bound to {c.def} — missing</span>
                  )}
                </div>
              ))}
            </div>

            {/* The half of "what plays, when" that has no moment kind. Omitting it is what made seven live
                effects look inert: this lens reads as the complete map, so anything missing from it reads as
                something that never fires. */}
            <div className="fxlib-group">
              <div className="fxlib-group-title">Played from code (no moment kind)</div>
              {codeRows.map((r) => (
                <div className="fxlib-row" key={r.defId} onPointerEnter={() => hover(r.defId)} onPointerLeave={() => hover(null)}>
                  <span className="fxlib-row-name">{r.defId}</span>
                  {/* The call sites, as copyable repo paths rather than bare file names: this row answers
                      "what fires this", and the next question is always "where". */}
                  <span className="fxlib-row-meta">
                    {r.files.map((f) => <CallSite key={f} file={f} />)}
                  </span>
                  {!knownIds.has(r.defId) && <span className="fxlib-missing">def missing</span>}
                </div>
              ))}
              <div className="fxlib-note">{codeScanCaveat()}</div>
            </div>
            </>
          )}

          {lens === 'card' && (activeTribe !== null || cardSearch !== '') && (
            <>
              {/* One shared autocomplete list of every committed def id, sound defs first. */}
              <datalist id="fxlib-defids">
                {defIds.map((id) => <option key={id} value={id} />)}
              </datalist>
              {/* One shared hidden file input for the per-row ⭱ import; `pendingImportRef` remembers which slot. */}
              <input
                ref={importInputRef}
                type="file"
                accept=".wav,.mp3,audio/wav,audio/mpeg"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  const t = pendingImportRef.current;
                  pendingImportRef.current = null;
                  if (f && t) void importSoundToSlot(t.cardId, t.kind, f);
                }}
              />
              <div className="fxlib-note">
                Assign an effect (sound, visual, or a composed def with both) to a card's event. ▶ previews it,
                ✎ opens it in the workbench editor, the box is volume (0–100%). Search by card or effect above.
                Changes save to <code>bindings.json</code> and ship.
                {bindNote !== null && <span className="fxlib-bindnote"> · {bindNote}</span>}
              </div>
              <div className="fxlib-cardtribe-title">{cardTitle}</div>
              <div className="fxlib-cardgrid">
                {shownCards.map((c) => (
                  <div className="fxlib-cardcell" key={c.cardId}>
                    {CARD_INDEX[c.cardId] && (
                      <div className="fxlib-cardcell-art">
                        <Card card={toView(CARD_INDEX[c.cardId])} forceFull suppressPop plated />
                      </div>
                    )}
                    <div className="fxlib-cardcell-slots">
                      {CARD_EVENT_SLOTS.map((slot) => {
                        const kind = slot.kindFor(c);
                        if (kind === null) return null; // event doesn't apply to this card
                        const binding = liveCardBindings[c.cardId]?.[kind] ?? null;
                        const bound = binding?.def ?? null;
                        const pct = binding?.gain === undefined ? 100 : Math.round(binding.gain * 100);
                        const editable = bound !== null && knownIds.has(bound);
                        return (
                          <div className="fxlib-slot" key={slot.id} title={slot.blurb}>
                            <span className="fxlib-slot-label">{slot.label}</span>
                            <input
                              className="fxlib-slot-input"
                              list="fxlib-defids"
                              placeholder="sound / effect def…"
                              spellCheck={false}
                              // Uncontrolled + keyed on the live value so an external change re-seeds it while
                              // typing never fights a controlled value. Commit on blur (Enter blurs).
                              key={`${c.cardId}:${kind}:${bound ?? ''}:${bindVersion}`}
                              defaultValue={bound ?? ''}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              onBlur={(e) => commitBinding(c.cardId, kind, e.currentTarget.value)}
                              onPointerEnter={() => hover(bound)}
                              onPointerLeave={() => hover(null)}
                            />
                            {bound !== null && (
                              <>
                                <button
                                  className="fxlib-slot-play"
                                  title="Preview this effect (plays over everything)"
                                  onClick={() => previewOnCard(bound, binding?.gain)}
                                >▶</button>
                                <button
                                  className="fxlib-slot-edit"
                                  title={editable ? 'Open this def in the workbench editor' : 'This def does not exist yet'}
                                  disabled={!editable}
                                  onClick={() => {
                                    const def = catalog.find((e) => e.def.id === bound)?.def;
                                    if (def) load(def);
                                  }}
                                >✎</button>
                                <input
                                  className="fxlib-slot-vol"
                                  type="text"
                                  inputMode="numeric"
                                  title="Volume — 0 to 100% (scales the sound)"
                                  key={`vol:${c.cardId}:${kind}:${pct}:${bindVersion}`}
                                  defaultValue={String(pct)}
                                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                  onBlur={(e) => commitVolume(c.cardId, kind, e.currentTarget.value)}
                                />
                                <span className="fxlib-slot-pct">%</span>
                                <button
                                  className="fxlib-slot-clear"
                                  title="Clear this effect"
                                  onClick={() => commitBinding(c.cardId, kind, '')}
                                >×</button>
                              </>
                            )}
                            {bound !== null && !knownIds.has(bound) && (
                              <span className="fxlib-missing">missing</span>
                            )}
                            {/* Import a WAV/MP3 straight into this slot as the card's sound. Always available,
                                far right — a fresh sound even when nothing is bound yet. */}
                            <button
                              className="fxlib-slot-import"
                              title="Import a WAV/MP3 as this card’s sound"
                              onClick={() => openImport(c.cardId, kind)}
                            >⭱ import</button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
    {/* PREVIEW STAGE — a scrim + ✕ around the above-modal Pixi canvas (lifted while `body.fxlib-previewing`).
        The canvas is pointer-events:none, so a click anywhere but the ✕ lands on the scrim below and closes. */}
    {preview !== null && (
      <>
        <div className="fxlib-previewstage-scrim" onClick={closePreview} />
        <button className="fxlib-previewstage-close" onClick={closePreview} title="Close preview (Esc)">✕</button>
      </>
    )}
    </>
  );
}
