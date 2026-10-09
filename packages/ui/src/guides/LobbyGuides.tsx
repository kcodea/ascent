import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CardDef, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { Card, type CardView } from '../Card';
import { toView } from '../MinionBook';
import { relatedCardIds, relatedPickOneIds } from '../cardRefs';
import { stabilizeRefMap, stabilizeViewMap } from '../cardViewEqual';
import { artFor } from '../art';
import { FadeImg } from '../FadeImg';
import { Icon } from '../Icon';
import { lastPointerWasTouch } from '../touchInput';
import { rectToStage, stageHost, toStage } from '../stage';
import { useFitRefPopup, type RefPopupPos } from '../useFitRefPopup';
import { useGame } from '../store';
import { tribeInk, type Guide, type GuidesMode } from './guides';
import './lobbyGuides.css';

const TRIBE_NAME: Partial<Record<Tribe, string>> = {
  beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs', demon: 'Demons', kobold: 'Kobolds', dwarf: 'Dwarves',
  spirit: 'Spirits', celestial: 'Celestials', neutral: 'Neutral',
};

/** The open guide, kept per run for the session (the rail can remount; a new game starts collapsed). */
let openMemo: { run: string; id: string | null } = { run: '', id: null };

/**
 * THE GUIDES VIEW of the lobby rail (owner ask 2026-10-09). One collapsed card per guide, styled like an opponent
 * row; clicking one expands it DOWNWARD in place (pushing the cards below), clicking again collapses it. One open at
 * a time. The expansion animates `grid-template-rows` (0fr -> 1fr) as a one-shot transition, so nothing is measured.
 * A guide's body mounts the first time it opens and stays mounted, so collapsing can animate too.
 */
export const LobbyGuides = memo(function LobbyGuides({ guides, tribes, runKey, mode, onMode }: {
  guides: readonly Guide[]; tribes: readonly Tribe[]; runKey: string;
  /** SIMPLE: the normal-width rail, portraits only. FULL: the wide rail, with the tagline and the write-up. */
  mode: GuidesMode;
  /** The open card's Detailed / Simple button (owner 2026-10-09: per card, not a header pill). */
  onMode: (m: GuidesMode) => void;
}): JSX.Element {
  const [open, setOpen] = useState<string | null>(() => (openMemo.run === runKey ? openMemo.id : null));
  useEffect(() => { openMemo = { run: runKey, id: open }; }, [runKey, open]);
  // CENTRE ON EXPAND (owner ask 2026-10-09: "when a card is expanded, the rail should center around it so you dont
  // need to scroll as much"). Once the fold has settled (its transition ends), measure the card ONCE and scroll the
  // rail so it sits in the middle of the visible area, or so its top shows if it is taller than the rail. Smooth,
  // instant under reduced motion. Only on a user's open, never on mount (a remembered open card stays put).
  const listRef = useRef<HTMLDivElement | null>(null);
  const userOpened = useRef(false);
  useEffect(() => {
    if (!open || !userOpened.current) return;
    userOpened.current = false;
    // Settled = the fold's `grid-template-rows` transition ended (fallback: a timer a little past its 220ms).
    const fold = listRef.current?.querySelector<HTMLElement>(`[data-guide="${open}"] .lobbyguide-fold`);
    let done = false;
    const run = (): void => { if (done) return; done = true; centreGuide(listRef.current, open); };
    const onEnd = (e: TransitionEvent): void => { if (e.target === fold) run(); };
    fold?.addEventListener('transitionend', onEnd);
    const t = window.setTimeout(run, 400);
    return () => { done = true; window.clearTimeout(t); fold?.removeEventListener('transitionend', onEnd); };
  }, [open]);
  // SIMPLE: THREE PORTRAITS ACROSS (owner 2026-10-09: "make the simple view fit 3 minions wide"). The rail's width
  // depends on the window's side margin (it grows right into it), so the portrait scale that fits three is measured,
  // not guessed: a hidden probe row (same insets + gap as a real one) and a probe card box (board width) are read
  // when the list resizes (ResizeObserver: on a window resize, never per frame) and the fit is written straight onto
  // the list as `--lgu-fit` (no React render). CSS takes the smaller of it and the tuner's cap.
  const probeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const list = listRef.current, probe = probeRef.current;
    if (!list || !probe || typeof ResizeObserver === 'undefined') return;
    const fit = (): void => {
      const card = probe.querySelector<HTMLElement>('.lobbyguide-unitscale');
      const w = probe.offsetWidth, cw = card?.offsetWidth ?? 0;
      if (w <= 0 || cw <= 0) return;
      const gap = parseFloat(getComputedStyle(probe).columnGap) || 0;
      list.style.setProperty('--lgu-fit', String(Math.max(0.2, (w - 2 * gap - 1) / (3 * 1.2 * cw))));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(list);
    return () => ro.disconnect();
  }, [guides.length]);
  // A mode switch reflows the open card (the rail widens / narrows): re-centre it once the widen has played.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) { firstMode.current = false; return; }
    if (!open) return;
    const t = window.setTimeout(() => centreGuide(listRef.current, open), 300);
    return () => window.clearTimeout(t);
  }, [mode]);
  if (guides.length === 0) return <div className="lobbyguides"><div className="lobbyguides-empty">No guides for this game yet.</div></div>;
  return (
    <div className="lobbyguides" ref={listRef}>
      <div className="lobbyguide-unitrow lobbyguides-probe" ref={probeRef} aria-hidden="true"><div className="lobbyguide-unit"><div className="lobbyguide-unitscale" /></div></div>
      {/* Data order keeps each tribe's builds together; the tribe itself is on each card (owner 2026-10-09: no group
          headings, "we reference the tribes in the card"). */}
      {guides.map((g) => (
        <GuideRow key={g.id} guide={g} tribes={tribes} open={open === g.id} full={mode === 'full'} onMode={onMode}
          onToggle={() => { userOpened.current = open !== g.id; setOpen((o) => (o === g.id ? null : g.id)); }} />
      ))}
    </div>
  );
});

/** Scroll the guides list (or, in the Classic look, the rail itself) so the open card is centred in view; a card
 *  taller than the view aligns its top. Two rect reads, once per open. */
function centreGuide(list: HTMLElement | null, id: string): void {
  if (!list) return;
  const card = list.querySelector<HTMLElement>(`[data-guide="${id}"]`);
  if (!card) return;
  const scroller = list.scrollHeight > list.clientHeight + 1 ? list : (list.closest('.lobbyrail') as HTMLElement | null);
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 1) return;
  const sr = scroller.getBoundingClientRect();
  const cr = card.getBoundingClientRect();
  // Screen px -> the scroller's own px (stage.ts): scrollTop lives in layout px.
  const cardTop = scroller.scrollTop + toStage(cr.top - sr.top);
  const cardH = toStage(cr.height);
  const viewH = scroller.clientHeight;
  const top = cardH >= viewH ? cardTop : cardTop - (viewH - cardH) / 2;
  let reduce = false;
  try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* no matchMedia */ }
  scroller.scrollTo({ top: Math.max(0, Math.min(top, scroller.scrollHeight - viewH)), behavior: reduce ? 'auto' : 'smooth' });
}

function GuideRow({ guide, tribes, open, full, onMode, onToggle }: {
  guide: Guide; tribes: readonly Tribe[]; open: boolean; full: boolean; onMode: (m: GuidesMode) => void; onToggle: () => void;
}): JSX.Element {
  const [mounted, setMounted] = useState(open);
  useEffect(() => { if (open) setMounted(true); }, [open]);
  // The chips: the guide's own tribes, plus a crossover tribe only when it is in this lobby too.
  const chips: Tribe[] = guide.tribes.length ? [...guide.tribes, ...(guide.pairsWith ?? []).filter((t) => tribes.includes(t))] : ['neutral'];
  const bodyId = `lobbyguide-body-${guide.id}`;
  return (
    <div className={`lobbyguide${open ? ' open' : ''}`} data-guide={guide.id}
      style={{ '--gc': tribeInk(chips[0]!), '--gc2': tribeInk(chips[chips.length - 1]!) } as CSSProperties}>
      <button type="button" className="lobbyguide-head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        {/* The guide's ART icon: its signature card's illustration in a round, tribe-rimmed frame (a crossover guide's
            rim runs from one tribe's colour to the other's). */}
        <span className={`lobbyguide-emblem${chips.length > 1 ? ' duo' : ''}`} aria-hidden="true">
          <FadeImg className="lobbyguide-art" src={artFor(guide.iconCard)} alt="" />
        </span>
        <span className="lobbyguide-title">{guide.title}</span>
        <span className="lobbyguide-tag">
          {chips.map((t, i) => (
            <Fragment key={t}>{i > 0 && ' + '}<span className="lobbyguide-tribename" style={{ color: tribeInk(t) }}>{TRIBE_NAME[t]}</span></Fragment>
          ))}
          {full && <><span className="lobbyguide-dot"> · </span>{guide.tagline}</>}
        </span>
        <span className="lobbyguide-chev" aria-hidden="true"><Icon name="chevron" /></span>
      </button>
      <div className="lobbyguide-fold" id={bodyId} role="region" aria-label={guide.title} aria-hidden={!open}>
        <div className="lobbyguide-foldin">
          {mounted && <GuideBody guide={guide} full={full} onMode={onMode} />}
        </div>
      </div>
    </div>
  );
}

/** Every card a guide names, as views + hover-preview chains. Stabilized so `Card`'s memo holds across run updates. */
function useGuideViews(ids: readonly string[]): { views: Map<string, CardView>; refs: Map<string, CardView[]> } {
  const run = useGame((st) => st.run);
  const viewCache = useRef(new Map<string, CardView>());
  const refCache = useRef(new Map<string, CardView[]>());
  return useMemo(() => {
    const views = new Map<string, CardView>();
    const refs = new Map<string, CardView[]>();
    const def = (id: string): CardDef | undefined => CARD_INDEX[id];
    for (const id of ids) {
      const d = def(id);
      if (!d) continue;
      views.set(id, toView(d, false, run));
      const r = [
        ...relatedCardIds(id).map(def).filter((x): x is CardDef => !!x).map((x) => toView(x, false, run)),
        ...relatedPickOneIds(id).map(def).filter((x): x is CardDef => !!x).map((x) => ({ ...toView(x, false, run), refPick: true })),
      ];
      if (r.length) refs.set(id, r);
    }
    viewCache.current = stabilizeViewMap(views, viewCache.current);
    refCache.current = stabilizeRefMap(refs, refCache.current);
    return { views: viewCache.current, refs: refCache.current };
  }, [ids, run]);
}

function GuideBody({ guide, full, onMode }: { guide: Guide; full: boolean; onMode: (m: GuidesMode) => void }): JSX.Element {
  const ids = useMemo(() => [...guide.core, ...guide.enablers], [guide]);
  const { views, refs } = useGuideViews(ids);
  return (
    <div className="lobbyguide-body">
      {full && <p className="lobbyguide-text">{linkCardNames(guide.body, ids, views, refs)}</p>}
      <GuideUnits label="Core" ids={guide.core} views={views} refs={refs} />
      {guide.enablers.length > 0 && <GuideUnits label="Enablers" ids={guide.enablers} views={views} refs={refs} />}
      {/* DETAILED / SIMPLE, per open card: Detailed widens the rail to the left and adds the write-up; Simple folds
          back to the normal rail. The choice is remembered (LobbyPanel). */}
      <button type="button" className="lobbyguide-modebtn"
        aria-label={full ? 'Simple view: portraits only, normal rail width' : 'Detailed view: wider rail with the write-up'}
        onClick={() => onMode(full ? 'simple' : 'full')}>
        {full ? 'Simple' : 'Detailed'}
      </button>
    </div>
  );
}

/** A row of small board-style portraits: the real compact `Card`, so hover opens the game's own preview chain. */
function GuideUnits({ label, ids, views, refs }: {
  label: string; ids: readonly string[]; views: Map<string, CardView>; refs: Map<string, CardView[]>;
}): JSX.Element {
  return (
    <div className="lobbyguide-units">
      <div className="lobbyguide-unitslabel">{label}</div>
      <div className="lobbyguide-unitrow">
        {ids.map((id) => {
          const v = views.get(id);
          return v ? <div className="lobbyguide-unit" key={id}><div className="lobbyguide-unitscale"><Card card={v} forceCompact suppressPop refCards={refs.get(id)} /></div></div> : null;
        })}
      </div>
    </div>
  );
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The body paragraph with every named guide card turned into a hoverable highlight (case-insensitive, so the
 *  owner's "Edward Keg-Hands" finds the card "Edward Keg-hands"). */
function linkCardNames(text: string, ids: readonly string[], views: Map<string, CardView>, refs: Map<string, CardView[]>): ReactNode[] {
  const byName = new Map<string, string>();
  for (const id of ids) { const v = views.get(id); if (v) byName.set(v.name.toLowerCase(), id); }
  if (byName.size === 0) return [text];
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(escapeRe);
  const re = new RegExp(`(${names.join('|')})`, 'gi');
  return text.split(re).map((part, i) => {
    const id = i % 2 === 1 ? byName.get(part.toLowerCase()) : undefined;
    const v = id ? views.get(id) : undefined;
    return v ? <GuideCardLink key={i} view={v} refs={refs.get(id!)}>{part}</GuideCardLink> : <Fragment key={i}>{part}</Fragment>;
  });
}

/** A card name in the guide text. Hover opens the same `.cardref` preview chain a card does, placed by the shared
 *  measured pass (`useFitRefPopup`, one measure per open). */
function GuideCardLink({ view, refs, children }: { view: CardView; refs?: CardView[]; children: ReactNode }): JSX.Element {
  const [pos, setPos] = useState<RefPopupPos | null>(null);
  const [pick, setPick] = useState(0);
  const popRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  useFitRefPopup(popRef, pos, setPos);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const fixed = refs?.filter((c) => !c.refPick) ?? [];
  const pool = refs?.filter((c) => c.refPick) ?? [];
  const cards = [view, ...fixed, ...(pool.length ? [pool[pick % pool.length]!] : [])];
  const show = (el: HTMLElement): void => {
    if (timer.current) window.clearTimeout(timer.current);
    if (pool.length > 1) setPick(Math.floor(Math.random() * pool.length)); // presentation only, like Card's
    timer.current = window.setTimeout(() => {
      const r = rectToStage(el.getBoundingClientRect()); // one read per open
      // The rail is at the stage's right edge: open LEFT; the measured pass corrects it to the real size.
      setPos({ left: Math.max(6, r.left - 10 - 320 * cards.length), top: r.top, origin: 'right', anchorLeft: r.left, anchorRight: r.right, prefTop: r.top });
    }, 100);
  };
  const hide = (): void => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } setPos(null); };
  return (
    <span className="lobbyguide-name"
      onMouseEnter={(e) => { if (!lastPointerWasTouch()) show(e.currentTarget); }}
      onMouseLeave={hide}>
      {children}
      {pos && createPortal(
        <div className="cardref" ref={popRef} style={{ left: pos.left, top: pos.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${pos.origin} center` } as CSSProperties}>
            {cards.map((c, i) => <Card key={`${c.cardId ?? i}-${i}`} card={c} forceFull plated />)}
          </div>
        </div>,
        stageHost(),
      )}
    </span>
  );
}
