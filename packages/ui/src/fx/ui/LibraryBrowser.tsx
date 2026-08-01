import { useEffect, useMemo, useRef, useState } from 'react';
import type { StoredFxDef } from '../defStore';
import {
  buildCatalog, buildCardRows, kindCoverage, codeCoverage, codeScanCaveat, callSitePath, callSitesLabel,
  FX_HUES, type FxHue, type FxUsage,
} from './catalog';
import { EMPTY_FILTER, applyFilter, groupByLook, groupByCard, type FxFilter, type FxUsageFilter } from './catalogView';

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
  // Built once per open: the catalog is derived from module-level registries that cannot change while the
  // overlay is up, and rebuilding per keystroke would re-derive every facet for every def on every filter edit.
  const catalog = useMemo(() => buildCatalog(), []);
  const coverage = useMemo(() => kindCoverage(), []);
  const codeRows = useMemo(() => codeCoverage(), []);
  const cardRows = useMemo(() => buildCardRows(), []);
  const shown = useMemo(() => applyFilter(catalog, filter), [catalog, filter]);
  const knownIds = useMemo(() => new Set(catalog.map((e) => e.def.id)), [catalog]);

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

          {lens === 'card' && groupByCard(cardRows).map((g) => (
            <div className="fxlib-group" key={g.title}>
              <div className="fxlib-group-title">{g.title}</div>
              {g.cards.map((c) => (
                <div className="fxlib-row" key={c.cardId} onPointerEnter={() => hover(c.defId)} onPointerLeave={() => hover(null)}>
                  <span className="fxlib-row-name">{c.name}</span>
                  {c.defId === null ? (
                    <span className="fxlib-row-meta">uses defaults</span>
                  ) : knownIds.has(c.defId) ? (
                    <span className="fxlib-row-meta">{c.defId}</span>
                  ) : (
                    <span className="fxlib-missing">{c.defId} — missing</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
