import { memo, useEffect, useLayoutEffect, useMemo, useState, type CSSProperties } from 'react';
import type { CardDef, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { GameScroll } from '../GameScroll';
import { LazyRootProvider } from '../bookLazy';
import { BookCardCell } from '../MinionBook';
import { locationArt, type LocationDef } from '../locationReveal/locations';
import { sfx } from '../sfx';
import { useGame } from '../store';
import { requestGuideEdit } from './guidesStore';
import { guideMissingIds, tribeInk, type Guide } from './guides';
import { GuideEmblem, GuideText, GuideTribes, guideAccent, guideCardIds, guideChips, useGuideViews } from './GuideParts';
import '../quickBook/quickBook.css';
import './guidesBook.css';

/** The guide being read, kept per run for the session (the overlay remounts every time it opens). */
let pickMemo: { run: string; id: string | null } = { run: '', id: null };

const cardDef = (id: string): CardDef | undefined => (Object.hasOwn(CARD_INDEX, id) ? CARD_INDEX[id] : undefined);

/**
 * THE GUIDES OVERLAY (owner 2026-11-27: "Make the guides overlay look like the new in game compendium overlay", then "give
 * the guide appearance an overhaul so it looks more like the in game compendium a bit. make it the "full/detailed" look and
 * information as well, taking up more space"; R-GUIDES-QUICKLOOK-01).
 *
 * It is the quick Compendium (QuickBook.tsx), built from its own classes, with the guides where its parchments are: the
 * game dims, the place opens dark along the right, and the guides of this game hang down the right edge as its tabs. The
 * page beside them is the guide being read, always in full: its name written in light with its tribes and tagline, the
 * line of light in its tribe's colour, the write-up with every card name hoverable, then its Core and Enablers as the
 * Compendium's own card cells (the full card art). Another guide switches the page (Up and Down walk them, as the
 * parchments); Esc, the key, the X or a press outside closes it. There is no Simple view any more: there is room for all
 * of it.
 *
 * PERFORMANCE. Every motion is a one-shot transform / opacity from quickBook.css (the open, the title, the wash, the line,
 * the cards coming across). Cards mount lazily (LazyCell, the book's own). Nothing loops.
 */
export const GuidesBook = memo(function GuidesBook({ guides, mine, bookmarked, canEdit, tribes, runKey, count, closing, place, keyLabel, onClose }: {
  guides: readonly Guide[];
  /** The player's own guides for this game, after Team Ascent's. */
  mine: readonly Guide[];
  /** The guides this player bookmarked, for this game, last. Never editable from here. */
  bookmarked: readonly Guide[];
  canEdit: (g: Guide) => boolean;
  tribes: readonly Tribe[]; runKey: string;
  /** "11 guides". */
  count: string;
  /** Fading away (then unmounted). */
  closing: boolean;
  /** The game's place, painted dark behind it. */
  place: LocationDef | null;
  keyLabel: string;
  onClose: () => void;
}): JSX.Element {
  const all = useMemo(() => [...guides, ...mine, ...bookmarked], [guides, mine, bookmarked]);
  const [picked, setPicked] = useState<string | null>(() => (pickMemo.run === runKey && pickMemo.id ? pickMemo.id : null));
  const guide = all.find((g) => g.id === picked) ?? all[0] ?? null;
  useEffect(() => { pickMemo = { run: runKey, id: guide?.id ?? null }; }, [runKey, guide?.id]);
  const pick = (id: string): void => { if (id === guide?.id) return; sfx.tick(); setPicked(id); };
  // Up and Down walk the guides (the quick Compendium's parchments do the same).
  useEffect(() => {
    if (closing || all.length < 2) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.ctrlKey || e.altKey || e.metaKey) return;
      if (useGame.getState().inspect) return;
      e.preventDefault();
      const i = Math.max(0, all.findIndex((g) => g.id === guide?.id));
      const next = all[(i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length]!;
      sfx.tick();
      setPicked(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closing, all, guide?.id]);

  const chips = guide ? guideChips(guide, tribes) : [];
  const colour = chips.length ? tribeInk(chips[0]!) : '#fbe6a6';
  const tab = (g: Guide): JSX.Element => {
    const c = guideChips(g, tribes);
    const on = g.id === guide?.id;
    return (
      <div className={`lobbyguide${on ? ' open' : ''}`} key={g.id} data-guide={g.id} style={guideAccent(c)}>
        <button type="button" className="lobbyguide-head" aria-pressed={on} onClick={() => pick(g.id)}>
          <GuideEmblem guide={g} chips={c} />
          <span className="lobbyguide-title">{g.title}</span>
          <span className="lobbyguide-tag"><GuideTribes chips={c} /></span>
        </button>
      </div>
    );
  };

  return (
    <div className={`guidesdock qb ph-tokens game${place ? '' : ' plain'}${closing ? ' closing' : ''}`} role="dialog"
      aria-label={`Build guides. Press Esc${keyLabel ? ` or ${keyLabel}` : ''} to close.`} style={{ '--c': colour } as CSSProperties}>
      <div className="qb-dim" onClick={onClose} />
      <div className="qb-place" aria-hidden="true">
        <div className="qb-pic" style={place ? { backgroundImage: `url(${locationArt(place.id, 'blur')})` } : undefined} />
        <div className="qb-tint" key={guide?.id ?? 'none'} />
        <div className="qb-wash" key={`wash-${guide?.id ?? 'none'}`} />
      </div>
      {guide ? <GuidePage key={guide.id} guide={guide} chips={chips} editable={canEdit(guide)} onClose={onClose} />
        : (
          <section className="qb-panel gdbook-page">
            <header className="qb-head">
              <div className="qb-title"><h2>Guides</h2></div>
              <button type="button" className="qb-x" onClick={onClose} aria-label="Close">✕</button>
            </header>
            <div className="qb-line" aria-hidden="true" />
            <div className="qb-empty">No guides for this game yet.</div>
          </section>
        )}
      <nav className="gdbook-list" aria-label="Guides">
        <div className="gdbook-listhead">
          <span className="guidesdock-title">Guides</span>
          <span className="guidesdock-count">{count}</span>
        </div>
        <GameScroll className="lobbyguides" outerClassName="lobbyguides-wrap">
          {guides.map(tab)}
          {mine.length > 0 && <div className="lobbyguides-sec" role="presentation">Your guides</div>}
          {mine.map(tab)}
          {bookmarked.length > 0 && <div className="lobbyguides-sec" role="presentation">Bookmarked</div>}
          {bookmarked.map(tab)}
        </GameScroll>
      </nav>
    </div>
  );
});

/** The guide being read: the quick Compendium's page, with the guide's write-up and its cards. */
function GuidePage({ guide, chips, editable, onClose }: { guide: Guide; chips: readonly Tribe[]; editable: boolean; onClose: () => void }): JSX.Element {
  const run = useGame((st) => st.run);
  const ids = useMemo(() => guideCardIds(guide), [guide]);
  const { views, refs } = useGuideViews(ids, run);
  const missing = useMemo(() => guideMissingIds(guide, run.setId), [guide, run.setId]);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => { if (root) root.scrollTop = 0; }, [root]);
  // The cards wait a frame behind the page, as the quick Compendium's do.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let id = 0;
    id = requestAnimationFrame(() => { id = requestAnimationFrame(() => setReady(true)); });
    return () => cancelAnimationFrame(id);
  }, []);
  const row = (label: string, list: readonly string[], from: number): JSX.Element => (
    <section className="gdbook-sec" aria-label={label}>
      <div className="gdbook-seclabel lobbyguide-unitslabel">{label}</div>
      <div className="book-grid qb-grid gdbook-grid">
        {list.map((id, i) => {
          const def = cardDef(id);
          if (!def || missing.has(id)) {
            return (
              <div className="book-cell gdbook-missing" key={`${id}-${i}`} role="img" aria-label={def ? `${def.name}: missing or removed` : 'Missing or removed card'}>
                <span>Missing or removed</span>
              </div>
            );
          }
          return <BookCardCell key={`${id}-${i}`} card={def} gilded={false} liveRun={run} eager={from + i < 10} press />;
        })}
      </div>
    </section>
  );
  return (
    <section className="qb-panel gdbook-page" aria-label={guide.title} data-guide={guide.id}>
      <header className="qb-head">
        <div className="qb-title">
          <h2>{guide.title}</h2>
          <span className="qb-count gdbook-tribes"><GuideTribes chips={chips} /></span>
        </div>
        {editable && guide.rowId && (
          <nav className="qb-more" aria-label="More">
            {/* EDIT: opens the Compendium on this guide in the editor. */}
            <button type="button" className="qb-tab lobbyguide-editbtn" aria-label={`Edit ${guide.title} in the Compendium`}
              onClick={() => { requestGuideEdit(guide.rowId!); const st = useGame.getState(); if (!st.showBook) st.toggleBook(); }}>
              Edit
            </button>
          </nav>
        )}
        <button type="button" className="qb-x" onClick={onClose} aria-label="Close">✕</button>
      </header>
      <div className="qb-line" aria-hidden="true" />
      <GameScroll outerClassName="qb-scroller" className="qb-scroll book gdbook-scroll" viewRef={setRoot}>
        <LazyRootProvider root={root} lookahead="80%">
          {guide.tagline && <p className="gdbook-tagline">{guide.tagline}</p>}
          <GuideText guide={guide} ids={ids} views={views} refs={refs} missing={missing} />
          {ready && row('Core', guide.core, 0)}
          {ready && guide.enablers.length > 0 && row('Enablers', guide.enablers, guide.core.length)}
        </LazyRootProvider>
      </GameScroll>
    </section>
  );
}
