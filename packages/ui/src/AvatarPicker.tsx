import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CARD_INDEX } from '@game/content';
import { TRIBES, type Tribe } from '@game/core';
import { TRIBE_LABEL } from './careerData';
import { getHero } from '@game/sim';
import { RARITY_LABELS, withStarterCosmetics, type CosmeticDef, type CosmeticRarity } from '@game/progression';
import { AVATAR_ART, avatarSrc, type AvatarArt } from './art';
import { useGame } from './store';
import { PhBanner, PhBannerName, PhButton, PhEmpty, PhSearch, PhSelect, PhTabs } from './partyHome/kit';
import { usePhLayer } from './partyHome/shell/usePhLayer';
import { HeroPortraitRing } from './portraitFrame/HeroPortraitRing';
import { mirrorFor, useProgression } from './progression/progressionStore';
import { albumOf, ownedIds, skinTargetName } from './progression/collectionModel';
import { skinArtOf } from './skins/skinArt';
import './avatarPicker.css';

/**
 * THE PORTRAIT WINDOW (2026-11-19 rebuild, owner: "this portrait select menu is so extremely outdated"): choose the
 * picture on your banner, your Career and the Leaderboard. Built from the party home kit (the dialog veil, tabs, search,
 * buttons, the banner) so it reads as one with the shell.
 *
 *   TABS      My Skins (every hero / minion skin you OWN), Heroes, Minions, Hero Powers. Each tab shows its count; while
 *             a search is typed the counts are the matches, so you can see which tab holds what you are looking for.
 *   FILTER    a dropdown beside the search, per tab: Minions by tribe or tier, My Skins by kind or rarity. Minions are
 *             sorted and grouped by tribe, then tier.
 *   GRID      round tiles, the gold edge painted over the art; a skin's edge is its rarity colour (Ancient glows). Only this list scrolls. A press SELECTS (it no longer
 *             picks and closes); a double press applies at once. The tile in use wears an "In use" tag.
 *   PREVIEW   the selection inside YOUR equipped portrait frame, its name, and your banner wearing it.
 *   ACTIONS   "Use portrait" applies and closes; "Reset to default" selects the plain default.
 *
 * A skin portrait is saved as `skin:<art key>` (art.ts resolves it for every viewer). Ownership is checked here only,
 * like every other portrait: the choice is cosmetic and the profile row takes any id.
 *
 * Openable from the Title portrait and the party home banner menu (one `avatarPickerOpen` store flag).
 */

type TabId = 'skins' | 'hero' | 'minion' | 'power';
/** `tags`: what the tab's filter dropdown matches (`tribe:beast`, `tier:3`, `kind:hero`, `rarity:epic`). `order`: the
 *  sort key inside a tab (minions: tribe, then tier). */
interface Entry { id: string; src: string; name: string; sub: string; find: string; rarity?: CosmeticRarity; group?: string; tags?: string[]; order?: number }

const heroName = (key: string): string => { try { return getHero(key).name; } catch { return key; } };

/** Tribe order for the Minions tab: the tribes as the game lists them, Neutral last, art with no card after that. */
const TRIBE_ORDER: readonly Tribe[] = [...TRIBES.filter((t) => t !== 'neutral'), 'neutral'];

function baseEntry(a: AvatarArt): Entry {
  if (a.kind !== 'minion') {
    const name = heroName(a.key);
    return { id: a.id, src: a.src, name, sub: a.kind === 'hero' ? 'Hero' : 'Hero Power', find: name.toLowerCase() };
  }
  const card = CARD_INDEX[a.key];
  const name = card?.name ?? a.key;
  if (!card) return { id: a.id, src: a.src, name, sub: 'Minion', find: name.toLowerCase(), group: 'Other', order: 1e6 };
  const tribes = [card.tribe, ...(card.tribe2 ? [card.tribe2] : [])];
  return {
    id: a.id, src: a.src, name, sub: `Tier ${card.tier} ${tribes.map((t) => TRIBE_LABEL[t]).join(' / ')}`, find: name.toLowerCase(),
    group: TRIBE_LABEL[card.tribe], tags: [...tribes.map((t) => `tribe:${t}`), `tier:${card.tier}`],
    order: TRIBE_ORDER.indexOf(card.tribe) * 100 + card.tier,
  };
}

/** The bundled portraits by tab, built once on first open (hundreds of rows; never at load). Minions are sorted by
 *  tribe, then tier, then name (owner 2026-11-19: "sort minions by tribe and by tier"). */
let BASE: Record<Exclude<TabId, 'skins'>, Entry[]> | null = null;
function baseEntries(): Record<Exclude<TabId, 'skins'>, Entry[]> {
  if (BASE) return BASE;
  const of = (kind: AvatarArt['kind']): Entry[] => AVATAR_ART.filter((a) => a.kind === kind).map(baseEntry);
  BASE = { hero: of('hero'), minion: of('minion').sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || x.name.localeCompare(y.name)), power: of('power') };
  return BASE;
}

/** One choice in a tab's filter dropdown. */
interface FilterOption { value: string; label: string }
const RARITY_ORDER: readonly CosmeticRarity[] = ['secret', 'ancient', 'legendary', 'epic', 'rare', 'common'];
/** The filter dropdown of a tab: only choices that some portrait in it matches. Heroes and Hero Powers have no
 *  category to filter by, so they get none (an empty list hides the dropdown). */
export function filterOptions(tab: TabId, rows: readonly Entry[]): FilterOption[] {
  const has = (tag: string): boolean => rows.some((e) => e.tags?.includes(tag));
  if (tab === 'minion') return [
    { value: 'all', label: 'All minions' },
    ...TRIBE_ORDER.filter((t) => has(`tribe:${t}`)).map((t) => ({ value: `tribe:${t}`, label: TRIBE_LABEL[t] })),
    ...[1, 2, 3, 4, 5, 6, 7].filter((n) => has(`tier:${n}`)).map((n) => ({ value: `tier:${n}`, label: `Tier ${n}` })),
  ];
  if (tab === 'skins' && rows.length) return [
    { value: 'all', label: 'All skins' },
    ...(['hero', 'minion'] as const).filter((k) => has(`kind:${k}`)).map((k) => ({ value: `kind:${k}`, label: k === 'hero' ? 'Hero skins' : 'Minion skins' })),
    ...RARITY_ORDER.filter((r) => has(`rarity:${r}`)).map((r) => ({ value: `rarity:${r}`, label: RARITY_LABELS[r] })),
  ];
  return [];
}

/** The skins this account owns, hero skins first: live, with art in the bundle. */
export function ownedSkinEntries(owned: ReadonlySet<string>): Entry[] {
  const rows = (category: 'hero_skin' | 'minion_skin', group: string): Entry[] =>
    albumOf(category, undefined, owned).filter((c) => owned.has(c.id)).flatMap((c: CosmeticDef): Entry[] => {
      const src = skinArtOf(c);
      if (!src) return [];
      const target = skinTargetName(c);
      return [{ id: `skin:${c.assets.art}`, src, name: c.name, sub: target ? `${target} skin` : 'Skin', find: `${c.name} ${target ?? ''}`.toLowerCase(), rarity: c.rarity, group,
        tags: [`kind:${category === 'hero_skin' ? 'hero' : 'minion'}`, `rarity:${c.rarity}`] }];
    });
  return [...rows('hero_skin', 'Hero skins'), ...rows('minion_skin', 'Minion skins')];
}

const EMPTY: readonly string[] = [];

/** A tab's label with its count as a quiet number (the kit's count pill reads as an alert; this is only a size). */
const tabLabel = (name: string, n: number): JSX.Element => <><span className="avp-tabname">{name}</span><span className="avp-n">{n}</span></>;

export function AvatarPicker() {
  const open = useGame((s) => s.avatarPickerOpen);
  // The picker is only reachable from the Title portrait and the banner menu, so it must only ever render on those
  // surfaces, never over gameplay (a defensive gate so a lingering flag can't cover the game).
  const onTitle = useGame((s) => s.showTitle);
  const onCareer = useGame((s) => s.showCareer);
  // Guests cannot change their portrait (owner 2026-09-29): the Title shows the portrait sign-in gate instead, and
  // this refuses to render for a guest too, so no other path can open the picker around that gate.
  const anonymous = useGame((s) => s.account.anonymous);
  if (!open || !(onTitle || onCareer) || anonymous) return null;
  return <PortraitWindow />;
}

function PortraitWindow() {
  const close = useGame((s) => s.closeAvatarPicker);
  const current = useGame((s) => s.playerAvatar);
  const setAvatar = useGame((s) => s.setPlayerAvatar);
  const openCollection = useGame((s) => s.openCollection);
  const playerName = useGame((s) => s.playerName);
  const userId = useGame((s) => s.account.userId);
  const mirror = useProgression((s) => s.mirror);
  const catalogEpoch = useProgression((s) => s.catalogEpoch);
  const me = mirrorFor(userId, mirror);

  const skins = useMemo(() => ownedSkinEntries(new Set(withStarterCosmetics(me ? ownedIds(me) : EMPTY))), [me, catalogEpoch]);
  const all = useMemo<Record<TabId, Entry[]>>(() => ({ skins, ...baseEntries() }), [skins]);
  const byId = useMemo(() => new Map(Object.values(all).flat().map((e) => [e.id, e] as const)), [all]);

  const [sel, setSel] = useState<string | null>(current);
  const [tab, setTab] = useState<TabId>(() => {
    const home = (Object.keys(all) as TabId[]).find((t) => all[t].some((e) => e.id === current));
    return home ?? (skins.length ? 'skins' : 'hero');
  });
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo<Record<TabId, Entry[]>>(() => {
    if (!q) return all;
    const f = (rows: Entry[]): Entry[] => rows.filter((e) => e.find.includes(q));
    return { skins: f(all.skins), hero: f(all.hero), minion: f(all.minion), power: f(all.power) };
  }, [all, q]);

  // Esc closes the window (and nothing under it); on the shell it is also the top layer of the one Back path.
  usePhLayer(true, close);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // An open filter list takes Esc first (it closes itself); the window stays.
      if (e.key !== 'Escape' || document.querySelector('.phk-selectlayer')) return;
      e.preventDefault(); e.stopImmediatePropagation(); close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  // Open with the portrait in use in view.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.querySelector<HTMLElement>('.avp-tile.on')?.scrollIntoView?.({ block: 'center' }); }, []);

  const apply = useCallback((id: string | null): void => { setAvatar(id); close(); }, [setAvatar, close]);
  const pick = useCallback((id: string): void => setSel(id), []);

  // The hovered tile's name, written straight to the caption line: a hover never re-renders the grid.
  const capRef = useRef<HTMLSpanElement>(null);
  const caption = (text: string): void => { if (capRef.current) capRef.current.textContent = text; };

  // THE FILTER: one dropdown per tab, remembered per tab while the window is open. It narrows the grid only; the tab
  // counts keep following the search.
  const [filters, setFilters] = useState<Partial<Record<TabId, string>>>({});
  const options = useMemo(() => filterOptions(tab, all[tab]), [tab, all]);
  const filter = options.some((o) => o.value === filters[tab]) ? filters[tab]! : 'all';
  const rows = useMemo(() => (filter === 'all' ? shown[tab] : shown[tab].filter((e) => e.tags?.includes(filter))), [shown, tab, filter]);
  const chosen = sel ? byId.get(sel) : undefined;
  const chosenSrc = chosen?.src ?? avatarSrc(sel);
  const unchanged = sel === current;
  const groups = [...new Set(rows.map((e) => e.group ?? ''))];

  return (
    <div className="phk-dialog ph-tokens avatarpick avp" role="dialog" aria-modal="true" aria-label="Choose your portrait">
      <div className="phk-veil" aria-hidden="true" onClick={() => {
        const el = document.activeElement;
        if (el instanceof HTMLInputElement) { el.blur(); return; }
        close();
      }} />
      <div className="avp-box">
        <header className="avp-head">
          <div className="avp-titles">
            <span className="phk-eyebrow">Profile</span>
            <h2 className="avp-title">Choose your portrait</h2>
          </div>
          <PhButton variant="ghost" size="s" className="avp-close" aria-label="Close" onClick={close}>✕</PhButton>
        </header>
        <div className="avp-bar">
          <PhTabs<TabId> label="Portrait kind" value={tab} onChange={setTab} tabs={[
            { id: 'skins', label: tabLabel('My Skins', shown.skins.length) },
            { id: 'hero', label: tabLabel('Heroes', shown.hero.length) },
            { id: 'minion', label: tabLabel('Minions', shown.minion.length) },
            { id: 'power', label: tabLabel('Hero Powers', shown.power.length) },
          ]} />
          {options.length > 0 && (
            <PhSelect<string> className="avp-filter" label="Filter portraits" value={filter} options={options}
              onChange={(v) => setFilters((f) => ({ ...f, [tab]: v }))} />
          )}
          <PhSearch className="avp-search" placeholder="Search by name" aria-label="Search portraits by name" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="avp-body">
          <div className="avp-main">
            <div ref={scrollRef} className="avp-scroll"
              onPointerOver={(e) => { const t = (e.target as HTMLElement).closest<HTMLElement>('.avp-tile'); if (t) caption(t.dataset.name ?? ''); }}
              onPointerLeave={() => caption('')}>
              {rows.length === 0 && (all[tab].length > 0
                ? <PhEmpty title="No matches" sub="Try another name or filter, or look in another tab." />
                : <PhEmpty title="No skins yet" sub="Open chests to unlock hero and minion skins. Any skin you own can be your portrait."
                    action={<PhButton onClick={() => { close(); openCollection(); }}>Go to Collection</PhButton>} />)}
              {rows.length > 0 && groups.map((g) => (
                <div key={g} className="avp-group">
                  {g && <div className="avp-grouplbl">{g}</div>}
                  <div className="avp-grid">
                    {rows.filter((e) => (e.group ?? '') === g).map((e) => (
                      <Tile key={e.id} e={e} on={sel === e.id} used={current === e.id} onPick={pick} onApply={apply} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="avp-caption" aria-hidden="true">
              <span ref={capRef} className="avp-capname" />
              <span className="avp-capdef">{rows.length === 1 ? '1 portrait' : `${rows.length} portraits`}</span>
            </div>
          </div>
          <aside className="avp-side" aria-live="polite">
            <HeroPortraitRing art={chosenSrc} alt="" className="avp-ring" />
            <div className="avp-name">{chosen?.name ?? (sel ? 'Portrait' : 'Default')}</div>
            <div className={`avp-sub${chosen?.rarity ? ` r-${chosen.rarity}` : ''}`}>
              {chosen?.rarity && <span className="avp-rarname">{RARITY_LABELS[chosen.rarity]}</span>}
              <span>{chosen ? chosen.sub : sel ? '' : 'No picture'}</span>
            </div>
            <div className="avp-banner" aria-hidden="true" {...{ inert: '' }}>
              <span className="avp-lbl">On your banner</span>
              <PhBanner art={chosenSrc} width={92} label="Banner preview"><PhBannerName>{playerName || 'You'}</PhBannerName></PhBanner>
            </div>
            <div className="avp-actions">
              <PhButton variant="primary" size="l" className="avp-use" disabled={unchanged} onClick={() => apply(sel)}>{unchanged ? 'In use' : 'Use portrait'}</PhButton>
              <PhButton variant="ghost" size="s" className="avp-reset" disabled={sel === null} onClick={() => setSel(null)}>Reset to default</PhButton>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

const Tile = memo(function Tile({ e, on, used, onPick, onApply }: { e: Entry; on: boolean; used: boolean; onPick: (id: string) => void; onApply: (id: string) => void }) {
  return (
    <button type="button" className={`avp-tile${on ? ' on' : ''}${used ? ' used' : ''}${e.rarity ? ` r-${e.rarity}` : ''}`} data-name={e.name}
      aria-pressed={on} aria-label={`${e.name}, ${e.rarity ? `${RARITY_LABELS[e.rarity]} ` : ''}${e.sub}${used ? ', in use' : ''}`}
      onClick={() => onPick(e.id)} onDoubleClick={() => onApply(e.id)}>
      <span className="avp-art"><img src={e.src} alt="" draggable={false} loading="lazy" /></span>
      {used && <span className="avp-used" aria-hidden="true">In use</span>}
    </button>
  );
});
