import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { CardDef, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import type { RunState } from '@game/sim';
import { Card, type CardView } from '../Card';
import { toView } from '../MinionBook';
import { relatedCardIds, relatedPickOneIds } from '../cardRefs';
import { stabilizeRefMap, stabilizeViewMap } from '../cardViewEqual';
import { artFor } from '../art';
import { FadeImg } from '../FadeImg';
import { lastPointerWasTouch } from '../touchInput';
import { rectToStage, stageHost } from '../stage';
import { useFitRefPopup, type RefPopupPos } from '../useFitRefPopup';
import { tribeInk, type Guide } from './guides';

/**
 * THE SHARED GUIDE PIECES (owner ask 2026-10-09: the Compendium's Guides tab shows "the same guides from the rail but
 * in an expanded/full view"). The lobby rail (`LobbyGuides`) and the Compendium (`CompendiumGuides`) both build a
 * guide out of these, so the art icon, the tribe line, the write-up with its hoverable card names and the Core /
 * Enablers portrait rows can never drift between the two. Each surface only owns its own frame and sizing (the rail's
 * fold + Detailed / Simple button; the Compendium's always-open grid), set in CSS off the same `lobbyguide-*` classes.
 */

export const TRIBE_NAME: Partial<Record<Tribe, string>> = {
  beast: 'Beasts', dragon: 'Dragons', undead: 'Undead', mech: 'Mechs', demon: 'Demons', kobold: 'Kobolds', dwarf: 'Dwarves',
  spirit: 'Spirits', celestial: 'Celestials', neutral: 'Neutral',
};

/** The tribe chips a guide wears: its own tribes, plus a crossover tribe only when it is in `tribes` too (the lobby's,
 *  or the set the Compendium shows). A tribe-less guide wears Neutral. */
export function guideChips(guide: Guide, tribes: readonly Tribe[]): Tribe[] {
  return guide.tribes.length ? [...guide.tribes, ...(guide.pairsWith ?? []).filter((t) => tribes.includes(t))] : ['neutral'];
}

/** The `--gc` / `--gc2` tribe accent vars a guide's frame reads (a crossover runs from one tribe's ink to the other). */
export const guideAccent = (chips: readonly Tribe[]): CSSProperties =>
  ({ '--gc': tribeInk(chips[0]!), '--gc2': tribeInk(chips[chips.length - 1]!) }) as CSSProperties;

/** The guide's ART icon: its signature card's illustration in a round, tribe-rimmed frame. */
export function GuideEmblem({ guide, chips }: { guide: Guide; chips: readonly Tribe[] }): JSX.Element {
  return (
    <span className={`lobbyguide-emblem${chips.length > 1 ? ' duo' : ''}`} aria-hidden="true">
      <FadeImg className="lobbyguide-art" src={artFor(guide.iconCard)} alt="" />
    </span>
  );
}

/** The tribe names in tribe ink ("Kobolds + Dwarves"), optionally followed by the tagline. */
export function GuideTribes({ chips, tagline }: { chips: readonly Tribe[]; tagline?: string }): JSX.Element {
  return (
    <>
      {chips.map((t, i) => (
        <Fragment key={t}>{i > 0 && ' + '}<span className="lobbyguide-tribename" style={{ color: tribeInk(t) }}>{TRIBE_NAME[t]}</span></Fragment>
      ))}
      {tagline && <><span className="lobbyguide-dot"> · </span>{tagline}</>}
    </>
  );
}

/** Every card a guide names (core, enablers, mentions), in data order. */
export const guideCardIds = (guide: Guide): string[] => [...guide.core, ...guide.enablers, ...(guide.mentions ?? [])];

/** Card views + hover-preview chains for a set of card ids. Stabilized so `Card`'s memo holds across run updates.
 *  `run` prints live values (the rail always passes the game's run; the Compendium only while it shows that run). */
export function useGuideViews(ids: readonly string[], run: RunState | undefined): { views: Map<string, CardView>; refs: Map<string, CardView[]> } {
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

/** The write-up paragraph, its card names highlighted and hoverable. */
export function GuideText({ guide, ids, views, refs }: {
  guide: Guide; ids: readonly string[]; views: Map<string, CardView>; refs: Map<string, CardView[]>;
}): JSX.Element {
  return <p className="lobbyguide-text">{linkCardNames(guide.body, ids, views, refs, guide.aliases)}</p>;
}

/** A row of board-style portraits: the real compact `Card`, so hover opens the game's own preview chain. */
export function GuideUnits({ label, ids, views, refs }: {
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
 *  owner's "Edward Keg-Hands" finds the card "Edward Keg-hands"). A guide's `aliases` add shorter names ("Oona"). */
function linkCardNames(text: string, ids: readonly string[], views: Map<string, CardView>, refs: Map<string, CardView[]>,
  aliases?: Readonly<Record<string, string>>): ReactNode[] {
  const byName = new Map<string, string>();
  for (const id of ids) { const v = views.get(id); if (v) byName.set(v.name.toLowerCase(), id); }
  for (const [word, id] of Object.entries(aliases ?? {})) if (views.has(id)) byName.set(word.toLowerCase(), id);
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
 *  measured pass (`useFitRefPopup`, one measure per open), which flips it to whichever side fits. */
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
      // Open LEFT first (the rail sits at the stage's right edge); the measured pass corrects it to the real size.
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
