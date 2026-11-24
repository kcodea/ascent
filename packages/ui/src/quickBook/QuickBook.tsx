/**
 * THE QUICK COMPENDIUM (owner 2026-11-24: "2 versions of the compendium ... one from the main menu view and another that is like
 * an overlay that is more minimal and easier to navigate while in game ... the version that should launch from the scrolls";
 * R-COMPENDIUM-QUICK-01). In a game and at hero select the book is this: the place's torn parchments down the right edge ARE its
 * tabs, hanging exactly where hero select hangs them, and the place itself opens behind them, dark, with that tribe's cards on it,
 * lowest tier first. Nothing is a box and nothing lunges: one light lies behind the parchment being read and slides to the next one,
 * and its colour washes over the page. Press another scroll to switch, the same one (or anywhere outside) to close. The full Compendium is the menus', and one press away here.
 *
 * It reads the same pools, card cells and search as the full book (MinionBook.tsx); only what is asked of the player is smaller.
 */
import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { inRunTribes, type CardDef, type Tribe } from '@game/core';
import { activeSet, duosPoolFor, EPIC_RUNES, poolFor, RUNES, SETS, type SetId } from '@game/content';
import { runTribesForSeed } from '@game/sim';
import { GameScroll } from '../GameScroll';
import { LazyCell, LazyRootProvider } from '../bookLazy';
import { BookCardCell, CAT_META, makeSearchMatcher, poolIds } from '../MinionBook';
import { keyLabelOf } from '../keybinds/keybinds';
import { PosterSheet } from '../locationReveal/LocationPosters';
import { locationArt, locationOfSet, type LocationDef } from '../locationReveal/locations';
import { pendingLocation, pendingTribes } from '../locationReveal/pendingLocation';
import { RuneCard } from '../RuneCard';
import { openRuneInspect } from '../runeInspectStore';
import { sfx } from '../sfx';
import { stageHost } from '../stage';
import { isPreRun, useGame } from '../store';
import { useVersus } from '../versus/versusStore';
import { matchesTab, quickTabs, runeFits, runeOnPage, type QuickTab } from './quickBookModel';
import './quickBook.css';

const NOOP = (): void => {};
const TIERS = [1, 2, 3, 4, 5, 6, 7] as const;
const tint = (t: QuickTab): string => (t === 'spells' ? 'var(--acc)' : t === 'runes' ? '#b078e6' : `var(--t-${t})`);
/** The tab it was last left on, this session: opening it again in the middle of a game goes back to it. */
let lastTab: QuickTab | null = null;

/** A still of the page, fading where it was. */
function fadeAway(el: HTMLElement): void {
  if (typeof el.animate !== 'function') return;
  const still = el.cloneNode(true) as HTMLElement;
  still.className += ' going';
  still.removeAttribute('role');
  still.setAttribute('aria-hidden', 'true');
  const at = el.querySelector('.qb-scroll')?.scrollTop ?? 0;
  stageHost().appendChild(still);
  const s = still.querySelector('.qb-scroll');
  if (s) s.scrollTop = at;
  still.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 190, easing: 'ease-out', fill: 'forwards' }).finished.then(() => still.remove(), () => still.remove());
}

/** What game it is about: the run on screen, or the one being picked for. */
function scopeNow(): { setId: SetId; tribes: Tribe[]; location: LocationDef | null; duos: boolean } {
  const g = useGame.getState();
  if (!isPreRun(g) && g.heroChoices === null) {
    const setId: SetId = g.run.setId ?? 'set1';
    return { setId, tribes: [...g.run.tribes], location: locationOfSet(setId), duos: !!g.run.duos };
  }
  const v = useVersus.getState();
  if (g.pendingMode === 'versus' && v.match) {
    const setId = v.match.set_id as SetId;
    const mine = v.priv?.match_id === v.match.id ? runTribesForSeed(Number(v.priv.run_seed), setId) : [...SETS[setId].tribes];
    return { setId, tribes: mine, location: locationOfSet(setId), duos: false };
  }
  const location = pendingLocation(g);
  const setId = location?.setId ?? activeSet().id;
  const tribes = pendingTribes(g);
  return { setId, tribes: tribes.length > 0 ? tribes : [...SETS[setId].tribes], location, duos: false };
}

export function QuickBook(): JSX.Element {
  const closeBook = useGame((s) => s.closeBook);
  const asked = useGame((s) => s.bookTribe);
  const inRun = useGame((s) => !isPreRun(s) && s.heroChoices === null);
  const run = useGame((s) => s.run);
  const [scope] = useState(scopeNow);
  const tabs = useMemo(() => quickTabs(scope.tribes, scope.location?.posters ?? null), [scope]);
  const [picked, setTab] = useState<QuickTab>(() => asked?.tribe ?? (lastTab && tabs.some((t) => t.id === lastTab) ? lastTab : tabs[0]!.id));
  // The light moves at once; the page (cards to mount) follows a frame behind it, under motion the browser runs on its own.
  const tab = useDeferredValue(picked);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(() => setReady(true)); });
    return () => cancelAnimationFrame(id);
  }, []);
  const [tiers, setTiers] = useState<ReadonlySet<number>>(() => new Set());
  const [gilded, setGilded] = useState(false);
  const [epic, setEpic] = useState(false);
  const [runeTribe, setRuneTribe] = useState<Tribe | null>(null);
  const [search, setSearch] = useState('');
  const q = useDeferredValue(search);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  useEffect(() => { lastTab = picked; }, [picked]);
  // Hover previews portal to <body>: they lift over this layer while it is up. Going, it leaves a picture of itself that fades (the
  // book is unmounted at once, whatever closed it).
  const box = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-qb', '');
    const el = box.current;
    return () => {
      document.documentElement.removeAttribute('data-qb');
      if (el && !useGame.getState().bookFull) fadeAway(el);
    };
  }, []);
  useLayoutEffect(() => { if (root) root.scrollTop = 0; }, [root, tab, q, tiers, epic, runeTribe]);

  const pick = (t: QuickTab): void => {
    sfx.tick();
    if (t === picked && !search) { closeBook(); return; }
    setSearch('');
    setTab(t);
  };
  // Up and Down walk the scrolls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.ctrlKey || e.altKey || e.metaKey) return;
      if (useGame.getState().inspect) return;
      e.preventDefault();
      const i = tabs.findIndex((t) => t.id === picked);
      const next = tabs[(i + (e.key === 'ArrowDown' ? 1 : -1) + tabs.length) % tabs.length]!;
      sfx.tick();
      setSearch('');
      setTab(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picked, tabs]);

  const cards = useMemo(() => {
    const pool = scope.duos ? duosPoolFor(scope.setId) : poolFor(scope.setId);
    const ids = poolIds(scope.setId, scope.duos);
    const minions = [...pool.buyable, ...ids.evolutions].filter((c) => inRunTribes(c, scope.tribes));
    return { minions, spells: [...pool.spells, ...ids.rubies] };
  }, [scope]);
  const query = q.trim();
  const shown: CardDef[] = useMemo(() => {
    const m = makeSearchMatcher(q);
    // A search looks through the whole game, whatever the tab: in a game the question is "where is that card".
    const from = query ? [...cards.minions, ...cards.spells].filter((c) => m(c.name) || m(c.text ?? '') || m(c.goldenText ?? ''))
      : tab === 'runes' ? [] : tab === 'spells' ? cards.spells : cards.minions.filter((c) => matchesTab(c, tab));
    const seen = new Set<string>();
    return from.filter((c) => !seen.has(c.id) && !!seen.add(c.id)).filter((c) => tiers.size === 0 || tiers.has(c.tier))
      .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }, [cards, tab, q, query, tiers]);
  const runes = useMemo(() => {
    if (!query && tab !== 'runes') return [];
    const m = makeSearchMatcher(q);
    const from = query ? [...RUNES, ...EPIC_RUNES].filter((r) => m(r.name) || m(r.text)) : (epic ? EPIC_RUNES : RUNES).filter((r) => runeOnPage(r, runeTribe));
    return from.filter((r) => runeFits(r, scope)).sort((a, b) => a.name.localeCompare(b.name));
  }, [tab, q, query, scope, epic, runeTribe]);
  const live = inRun ? run : undefined;
  const label = query ? 'Search' : CAT_META[tab].label;
  const count = shown.length + runes.length;
  const toggleTier = (t: number): void => setTiers((prev) => { const n = new Set(prev); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const key = keyLabelOf('compendium');
  const runePage = tab === 'runes' && !query;
  // Over hero select it hangs its parchments exactly where the screen's own are (smaller in Duos).
  const [atSelect] = useState(() => document.querySelector('.heroselect .hs-posters') !== null);
  const [smallRail] = useState(() => document.querySelector('.heroselect .hs-posters.duos') !== null);

  const sheets = tabs.filter((t) => t.sheet);
  const at = query ? -1 : sheets.findIndex((t) => t.id === picked);
  const colour = query ? '#fbe6a6' : tint(tab);
  const page = query ? 'search' : tab;

  return (
    <div className={`qb ph-tokens${atSelect ? '' : ' game'}${scope.location ? '' : ' plain'}`} ref={box} role="dialog" aria-label={`Compendium. Press Esc${key ? ` or ${key}` : ''} to close.`} style={{ '--c': colour } as CSSProperties}>
      <div className="qb-dim" onClick={closeBook} />
      <div className="qb-place" aria-hidden="true">
        <div className="qb-pic" style={scope.location ? { backgroundImage: `url(${locationArt(scope.location.id, 'blur')})` } : undefined} />
        <div className="qb-tint" key={page} />
        <div className="qb-wash" key={`wash-${page}`} />
      </div>
      <section className="qb-panel">
        <header className="qb-head">
          <div className="qb-title" key={page}>
            <h2>{label}</h2>
            <span className="qb-count">{count}</span>
          </div>
          <nav className="qb-more" aria-label="More">
            {tabs.filter((t) => !t.sheet).map((t) => (
              <button key={t.id} type="button" className={`qb-tab${!query && t.id === picked ? ' on' : ''}`} aria-pressed={!query && t.id === picked} onClick={() => pick(t.id)}>{CAT_META[t.id].label}</button>
            ))}
          </nav>
          <input className="qb-search" type="search" placeholder="Find a card" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a card by name or text" />
          <button type="button" className="qb-x" onClick={closeBook} aria-label="Close">✕</button>
        </header>
        <div className="qb-line" key={`line-${page}`} aria-hidden="true" />
        <div className="qb-filters" role="group" aria-label={runePage ? 'Runes' : 'Tiers'}>
          {runePage ? (
            <>
              {([['Basic', false], ['Epic', true]] as const).map(([name, e]) => (
                <button key={name} type="button" className={`qb-pill${epic === e ? ' on' : ''}`} aria-pressed={epic === e} onClick={() => { sfx.tick(); setEpic(e); }}>{name}</button>
              ))}
              <span className="qb-gap" />
              {tabs.map((t) => t.id).filter((t): t is Tribe => t !== 'spells' && t !== 'runes').map((t) => (
                <button key={t} type="button" className={`qb-pill qb-tribe${runeTribe === t ? ' on' : ''}`} style={{ '--tc': tint(t) } as CSSProperties} aria-pressed={runeTribe === t} onClick={() => { sfx.tick(); setRuneTribe((r) => (r === t ? null : t)); }}>{CAT_META[t].label}</button>
              ))}
            </>
          ) : (
            <>
              <span className="qb-axis">Tier</span>
              {TIERS.map((t) => (
                <button key={t} type="button" className={`qb-tier${tiers.has(t) ? ' on' : ''}`} aria-pressed={tiers.has(t)} aria-label={`Tier ${t}`} onClick={() => { sfx.tick(); toggleTier(t); }}>{t}</button>
              ))}
              <span className="qb-gap" />
              <button type="button" className={`qb-pill${gilded ? ' on' : ''}`} aria-pressed={gilded} onClick={() => { sfx.tick(); setGilded((g) => !g); }}>Gilded</button>
            </>
          )}
          <button type="button" className="qb-full" onClick={() => { sfx.tick(); useGame.getState().expandBook(); }}>Full Compendium</button>
        </div>
        <GameScroll outerClassName="qb-scroller" className="qb-scroll book" viewRef={setRoot} key={page}>
          <LazyRootProvider root={root} lookahead="80%">
            {ready && shown.length > 0 && (
              <div className="book-grid qb-grid">
                {shown.map((c, i) => <BookCardCell key={c.id} card={c} gilded={gilded} liveRun={live} eager={i < 15} press />)}
              </div>
            )}
            {ready && runes.length > 0 && (
              <div className="book-grid is-runes qb-grid qb-runes">
                {runes.map((r, i) => <LazyCell key={r.id} eager={i < 10}>{() => <RuneCard rune={r} affordable onBuy={() => openRuneInspect({ rune: r, affordable: false, pick: NOOP, fromBook: true })} />}</LazyCell>)}
              </div>
            )}
            {count === 0 && <div className="qb-empty">{query ? 'Nothing in this game matches that.' : 'Nothing here.'}</div>}
          </LazyRootProvider>
        </GameScroll>
      </section>
      {scope.location && sheets.length > 0 && (
        <nav className={`hs-posters qb-rail${smallRail ? ' duos' : ''}${at >= 0 ? ' lit' : ''}`} aria-label="Tribes" style={{ '--n': sheets.length, '--at': Math.max(0, at) } as CSSProperties}>
          <div className="qb-halo" aria-hidden="true" />
          {sheets.map((t, i) => (
            <PosterSheet key={t.id} location={scope.location!} tribe={t.id as Tribe} index={i} on={i === at} label={`${CAT_META[t.id].label}${i === at ? '. Close' : ''}`} onPress={() => pick(t.id)} />
          ))}
        </nav>
      )}
    </div>
  );
}
