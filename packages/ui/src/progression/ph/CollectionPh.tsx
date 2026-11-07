/**
 * THE COLLECTION, IN THE PARTY HOME SHELL (DEV only, behind the "Party home (prototype)" switch; owner 2026-11-02: "all of
 * these menus should get revamped to work with the new setup", "take a lot of inspiration from valorant's menus").
 *
 * The SAME page as `CollectionScreen.tsx`: every number, list, rule and handler is computed there and handed over as one
 * `view`; this file only draws it, in the shell kit's language (navy plates, gold hairlines, the cut corner, white title
 * font names, muted secondary text). Valorant's collection is the model: a strict three-column grid under the top nav.
 *
 *   LEFT    the categories as one list (icon, name, owned / total with a thin bar, a NEW count, "Soon" when locked), then
 *           the CHEST BAY (always in view): the painted chest, the count, Open / Open all, the next chest's level with your
 *           XP toward it (the odds line lives in the shop, owner 2026-11-06).
 *   CENTRE  the rarity chips (the Show tabs, Show All / Owned / Missing, sit in the title row), then the album: one tile per item, in
 *           the page's stable order. Owned tiles are bright; missing ones dimmed with a lock (how to get one is in the detail column).
 *   RIGHT   the selected item, large (Valorant's big preview): its live preview, name, rarity, the facts, and Equip.
 *
 * Reuses the page's own pieces: `HeroPortraitRing`, `FramePreview`, `HeroAttackPreview`, `EmoteSlotRow`, `TitleBadge`,
 * `ChestPicture`, the painted category medallions. Static paint; hover is a colour or a one-shot transform; no native
 * tooltips; no own cursor.
 */
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import {
  ALL_COSMETIC_RARITIES, COSMETIC_CATEGORY_DEFS, RARITY_LABELS, crateLabel, isMasterTitle,
  type CosmeticCategory, type CosmeticDef, type CosmeticRarity, type levelProgress,
} from '@game/progression';
import { PhButton, PhChip, PhEmpty, PhMeter, PhPage, PhRow, PhSection, PhTabs, PhToggleChip } from '../../partyHome/kit';
import { takeCollectionIntent, usePhShell } from '../../partyHome/shell/shellStore';
import { MenuMedal } from '../../menuIcons';
import { sfx } from '../../sfx';
import { HeroPortraitRing } from '../../portraitFrame/HeroPortraitRing';
import { frameSrc } from '../../portraitFrame/portraitFrameConfig';
import { HeroAttackPreview } from '../../heroBlast/HeroAttackPreview';
import { TitleBadge } from '../../titles/TitleBadge';
import { emoteSrc } from '../../emotes/emoteArt';
import { defaultArtOf, skinArtOf } from '../../skins/skinArt';
import { previewAnnouncerPack, stopAnnouncerPreview } from '../../announcer';
import { announcerPackOf } from '../announcerPack';
import { CratesOfflinePh } from './CrateShopPh';
import { ChestPicture } from '../ChestPicture';
import { chestFloorOf, type ChestTier } from '../crateFx/chestTiers';
import type { CrateQueueItem } from '../CrateOpener';
import { COMING_BLURB, acquisitionText, albumOf, categoryLive, countOf, masteryText, skinTargetName, type RarityFilter, type ShowFilter } from '../collectionModel';
import { CategoryIcon, EmoteSlotRow, FramePreview, LockGlyph, PLATE_SAMPLE_CARD, plateLookOf } from '../CollectionScreen';
import { InlinePlateCard } from '../SkinCardPreview';
import { startEmoteDrag } from './emoteDrag';
import { usePhLayer } from '../../partyHome/shell/usePhLayer';
import './collectionPh.css';

type Count = { owned: number; total: number };

/** Everything the page computed, for this skin to draw. */
export interface CollectionPhView {
  reducedMotion?: boolean;
  anyNew: boolean; markAllSeen: () => void; total: Count;
  aetherOn: boolean; openShop: () => void; openShopFromNav: () => void;
  /** The account's mirror is here (the level and the next chest read it). */
  me: boolean; level: ReturnType<typeof levelProgress>;
  categories: readonly CosmeticCategory[]; category: CosmeticCategory; pickCategory: (c: CosmeticCategory) => void;
  owned: ReadonlySet<string>; newIn: (c: CosmeticCategory) => number; live: boolean;
  show: ShowFilter; setShow: (f: ShowFilter) => void; rarity: RarityFilter; setRarity: (r: RarityFilter) => void;
  albumCount: Count; byRarity: Readonly<Record<CosmeticRarity, Count>>; shown: readonly CosmeticDef[];
  hover: boolean; clearHover: () => void;
  selectedId: string | null; worn: (c: CosmeticDef) => boolean; fresh: (c: CosmeticDef) => boolean; onPick: (id: string) => void;
  onHover: (id: string | null, el?: HTMLElement, asDefault?: boolean) => void;
  selected: CosmeticDef | null; busy: boolean; error: string | null; playerName: string; showDefault: boolean;
  emoteMenu: readonly (string | null)[]; onPlaceEmote: (position: number) => void;
  /** Drag an owned emote tile onto a menu slot (owner 2026-11-06). */
  onDropEmote: (id: string, position: number) => void; onEquip: () => void; onTakeOff: () => void;
  /** Crates was asked for but the shop cannot be reached: the page shows the plain offline note. */
  shopOffline: boolean; closeShop: () => void;
  cratesOn: boolean; cratesLoading: boolean; sealed: readonly CrateQueueItem[]; bayTier: ChestTier; nextCrateLevel: number; guest: boolean;
  oddsLine: string; shopBusy: boolean; openBay: () => void; openAllBay: () => void; openAccount: () => void;
}

/** The categories whose tiles carry art (a taller tile, the art filling it). */
const ART_CATEGORIES: ReadonlySet<CosmeticCategory> = new Set(['hero_skin', 'minion_skin', 'portrait_frame', 'emote', 'card_plate']);

/** A tile's art: a skin's, a frame's ring, an emote's bubble, a plate's thumbnail; none for a title / attack / voice. */
function tileArt(c: CosmeticDef): string | undefined {
  if (c.category === 'portrait_frame') return frameSrc(c.id);
  if (c.category === 'emote') return emoteSrc(c.id);
  if (c.category === 'card_plate') return plateLookOf(c)?.thumb;
  return skinArtOf(c);
}

/** "Hero skin", "Card plate", ...: the item's kind, singular. */
function kindOf(item: CosmeticDef): string {
  switch (item.category) {
    case 'hero_skin': return 'Hero skin';
    case 'minion_skin': return 'Minion skin';
    case 'hero_attack': return 'Hero attack';
    case 'portrait_frame': return 'Portrait frame';
    case 'card_plate': return 'Card plate';
    default: return COSMETIC_CATEGORY_DEFS[item.category].label.replace(/s$/, '');
  }
}

/** The shell's compact frame (a phone, or a short window; Title.tsx owns the attribute): the detail is a sheet there. */
const subscribeCompact = (cb: () => void): (() => void) => {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ph-compact'] });
  return () => mo.disconnect();
};
const readCompact = (): boolean => document.documentElement.hasAttribute('data-ph-compact');

/** COMPACT: the sideways category rail says there is more with an edge fade. Two 1px end markers and an IntersectionObserver
 *  turn each fade on and off, so nothing runs per scroll frame and no layout is read. */
function useRailEdges(on: boolean): RefObject<HTMLElement> {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const rail = ref.current;
    if (!on || !rail || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) rail.toggleAttribute((e.target as HTMLElement).dataset.edge === 'end' ? 'data-more-r' : 'data-more-l', !e.isIntersecting);
    }, { root: rail });
    rail.querySelectorAll('.phc-railedge').forEach((el) => io.observe(el));
    return () => { io.disconnect(); rail.removeAttribute('data-more-l'); rail.removeAttribute('data-more-r'); };
  }, [on]);
  return ref;
}

export function CollectionPh({ view: v }: { view: CollectionPhView }): JSX.Element {
  // COMPACT: the album takes the full width and a tap opens the item in a sheet (round 10: the side column was cramped).
  const compact = useSyncExternalStore(subscribeCompact, readCompact, readCompact);
  const [sheet, setSheet] = useState(false);
  const railRef = useRailEdges(compact);
  const pageOnPick = v.onPick;
  const pick = useCallback((id: string) => { pageOnPick(id); setSheet(true); }, [pageOnPick]);
  const closeSheet = useCallback(() => { sfx.pulse(); setSheet(false); }, []);
  // The tiles are memoized, so they get one stable drop callback that reads the latest view.
  const dropRef = useRef(v.onDropEmote);
  dropRef.current = v.onDropEmote;
  const dropEmote = useCallback((id: string, position: number) => { dropRef.current(id, position); }, []);
  useEffect(() => { setSheet(false); }, [v.category]);
  const sheetUp = compact && sheet && v.live && !!v.selected;
  usePhLayer(sheetUp, () => setSheet(false));
  // Esc closes the sheet first (the shell's Esc would leave the page): the capture phase, claimed when it acts.
  useEffect(() => {
    if (!sheetUp) return undefined;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSheet(false); } };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [sheetUp]);
  // THE CRATES TAB (the shell's nav): it opens this page with the intent to land on the Chest Shop. Read once, on mount.
  const openShop = v.openShop;
  const openShopFromNav = v.openShopFromNav;
  useEffect(() => { if (takeCollectionIntent() === 'shop') openShopFromNav(); }, [openShopFromNav]);
  // ...and pressed again while this page is already open: every press bumps `cratesSeq`; a change since mount opens the shop.
  const cratesSeq = usePhShell((st) => st.cratesSeq);
  const seenSeq = useRef(cratesSeq);
  useEffect(() => {
    if (cratesSeq === seenSeq.current) return;
    seenSeq.current = cratesSeq;
    takeCollectionIntent();
    openShop();
  }, [cratesSeq, openShop]);
  if (v.shopOffline) return <CratesOfflinePh onBack={v.closeShop} />;
  return (
    <>
    <PhPage
      wide
      className="phc"
      eyebrow="Find, view and wear what you have earned"
      title="Collection"
      tabs={v.live ? (
        <PhTabs
          label="Show" value={v.show} onChange={(f) => { sfx.pulse(); v.setShow(f); }}
          tabs={[
            { id: 'all', label: 'Show All' },
            { id: 'owned', label: 'Owned' },
            { id: 'missing', label: 'Missing' },
          ]}
        />
      ) : undefined}
      actions={(
        <>
          {v.anyNew && <PhButton variant="ghost" size="s" onClick={v.markAllSeen}>Mark all as seen</PhButton>}
          <PhMeter className="phc-meter" label="Collected" value={v.total.owned} max={v.total.total} />
        </>
      )}
    >
      <div className={`phc-body${compact ? ' sheeted' : ''}`}>
        <aside ref={railRef} className="phc-rail" aria-label="Categories and chests">
          {compact && <span className="phc-railedge start" data-edge="start" aria-hidden />}
          {/* Top to bottom (owner 2026-11-06): sealed chests, the categories, then this category by rarity. */}
          <ChestBay v={v} />
          <CategoryList v={v} />
          {v.live && <RarityProgress v={v} />}
          {v.guest && (
            <div className="phc-guest">
              <span>Guest account. Save it to keep your collection.</span>
              <PhButton variant="plate" size="s" onClick={v.openAccount}>Create account</PhButton>
            </div>
          )}
          {compact && <span className="phc-railedge end" data-edge="end" aria-hidden />}
        </aside>

        <main className="phc-main">
          {v.live ? (
            <>
              <div className="phc-filters">
                <div className="phc-rarities" role="group" aria-label="Rarity">
                  <PhToggleChip className="phc-rchip" pressed={v.rarity === 'all'} onToggle={() => { sfx.pulse(); v.setRarity('all'); }}>Any rarity</PhToggleChip>
                  {ALL_COSMETIC_RARITIES.filter((r) => v.byRarity[r].total > 0).map((r) => (
                    <PhToggleChip key={r} className={`phc-rchip r-${r}`} pressed={v.rarity === r} onToggle={() => { sfx.pulse(); v.setRarity(r); }}>
                      <span className="phc-gem" aria-hidden />{RARITY_LABELS[r]}
                      <span className="phc-n">{v.byRarity[r].owned}/{v.byRarity[r].total}</span>
                    </PhToggleChip>
                  ))}
                </div>
              </div>

              <div className="phc-gridwrap" onScroll={v.hover ? v.clearHover : undefined}>
                {v.shown.length === 0 ? (
                  <PhEmpty
                    title={v.show === 'owned' && v.albumCount.owned === 0 ? 'You have none yet' : v.show === 'missing' && v.albumCount.owned === v.albumCount.total ? 'You have them all' : 'Nothing matches these filters'}
                    sub={v.show === 'owned' && v.albumCount.owned === 0 ? 'Open a chest to find one.' : undefined}
                    action={<PhButton variant="plate" size="s" onClick={() => { sfx.pulse(); v.setShow('all'); v.setRarity('all'); }}>Show all</PhButton>}
                  />
                ) : (
                  <ul className={`phc-grid${ART_CATEGORIES.has(v.category) ? ' art' : ''}`} aria-label={COSMETIC_CATEGORY_DEFS[v.category].label}>
                    {v.shown.map((c) => (
                      <li key={c.id}>
                        <Tile
                          id={c.id} name={c.name} rarity={c.rarity} art={tileArt(c)} contain={c.category === 'emote'} artTop={c.category === 'card_plate' || c.category === 'portrait_frame'}
                          target={skinTargetName(c) ?? undefined} owned={v.owned.has(c.id)} equipped={v.worn(c)} fresh={v.fresh(c)} selected={v.selectedId === c.id}
                          master={isMasterTitle(c.id)} onPick={pick} onDropEmote={c.category === 'emote' && v.owned.has(c.id) ? dropEmote : undefined}
                          onHover={c.target?.type === 'card' ? v.onHover : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <div className="phc-soon">
              <span className="phc-soon-icon" aria-hidden><CategoryIcon category={v.category} /></span>
              <PhEmpty title={`${COSMETIC_CATEGORY_DEFS[v.category].label} are coming soon`} sub={COMING_BLURB[v.category]} />
            </div>
          )}
        </main>

        {!compact && <aside className="phc-side" aria-label="Details">
          {v.live && v.selected ? <Detail v={v} item={v.selected} /> : (
            <PhSection className="phc-detail">
              <PhEmpty title={COSMETIC_CATEGORY_DEFS[v.category].label} sub="Coming in a later update." />
            </PhSection>
          )}
        </aside>}
      </div>
    </PhPage>
    {sheetUp && (
      <>
        <button type="button" className="phc-scrim" aria-label="Close details" onClick={closeSheet} />
        <div className="phc-sheet" role="dialog" aria-label="Details">
          <button type="button" className="phc-sheetx" aria-label="Close details" onClick={closeSheet}>✕</button>
          <Detail v={v} item={v.selected!} />
        </div>
      </>
    )}
    </>
  );
}

// ── The category list ──────────────────────────────────────────────────────────────────────────────────────

function CategoryList({ v }: { v: CollectionPhView }): JSX.Element {
  return (
    <div className="phc-cats" role="list" aria-label="Categories">
      {v.categories.map((c) => {
        const on = categoryLive(c);
        const cnt = on ? countOf(albumOf(c, undefined, v.owned), v.owned) : null;
        const freshCount = on ? v.newIn(c) : 0;
        const label = COSMETIC_CATEGORY_DEFS[c].label;
        return (
          <PhRow
            key={c} dense className={`phc-cat${on ? '' : ' locked'}`} selected={v.category === c}
            lead={<span className="phc-cat-icon" aria-hidden><CategoryIcon category={c} /></span>}
            title={label}
            count={on ? `${cnt!.owned} / ${cnt!.total}` : undefined}
            progress={on && cnt!.total > 0 ? cnt!.owned / cnt!.total : undefined}
            right={freshCount > 0 ? <span className="phc-cat-new" aria-hidden>{freshCount}</span> : !on ? <span className="phc-cat-lock" aria-hidden><LockGlyph />Soon</span> : undefined}
            label={on ? `${label}, ${cnt!.owned} of ${cnt!.total}${freshCount ? `, ${freshCount} new` : ''}${v.category === c ? ', selected' : ''}` : `${label}, coming soon`}
            onClick={() => v.pickCategory(c)}
          />
        );
      })}
    </div>
  );
}

// ── This category, by rarity (the rail's last box) ─────────────────────────────────────────────────────────────

/** What is left to find in the open category, rarity by rarity. It lived in the item's detail column, which it does not describe
 *  (owner 2026-11-06: "this section doesnt belong in the item section"); the phone's detail sheet still shows its own copy. */
function RarityProgress({ v }: { v: CollectionPhView }): JSX.Element {
  const label = COSMETIC_CATEGORY_DEFS[v.category].label;
  return (
    <section className="phc-progress phc-rarbox" aria-label={`${label} collected, by rarity`}>
      <span className="phc-sublbl">{label} collected</span>
      {ALL_COSMETIC_RARITIES.filter((r) => v.byRarity[r].total > 0).map((r) => (
        <div key={r} className={`phc-prow r-${r}`}>
          <span className="phc-prow-name"><span className="phc-gem" aria-hidden />{RARITY_LABELS[r]}</span>
          <span className="phc-bar" aria-hidden><span style={{ transform: `scaleX(${v.byRarity[r].owned / v.byRarity[r].total})` }} /></span>
          <span className="phc-prow-n">{v.byRarity[r].owned} / {v.byRarity[r].total}</span>
        </div>
      ))}
    </section>
  );
}

// ── The chest bay ──────────────────────────────────────────────────────────────────────────────────────────

function ChestBay({ v }: { v: CollectionPhView }): JSX.Element {
  const n = v.sealed.length;
  const ready = v.cratesOn && !v.cratesLoading && n > 0;
  return (
    <section className={`phc-bay${ready ? ' ready' : ''}`} aria-label="Sealed chests">
      <div className="phc-bay-top">
        <div className="phc-bay-art" aria-hidden>
          <ChestPicture tier={v.bayTier} className="phc-bay-chest" />
        </div>
        <div className="phc-bay-who">
          <span className="phc-bay-lbl">Sealed chests</span>
          {ready
            ? <span className="phc-bay-num"><b>{n}</b> ready</span>
            : <span className="phc-bay-sub">{!v.cratesOn ? 'Chests are unavailable right now.' : v.cratesLoading ? 'Loading' : `Next chest at Level ${v.nextCrateLevel}.`}</span>}
          {ready && <span className="phc-bay-sub">Next: {crateLabel({ ...v.sealed[0]!, floor: chestFloorOf(v.sealed[0]!.tier) })}</span>}
        </div>
      </div>
      {ready && (
        <>
          {v.guest && <div className="phc-bay-guest">Create a free account to open them.</div>}
          <div className="phc-bay-actions">
            <PhButton variant="primary" size="m" disabled={v.shopBusy} onClick={v.openBay} aria-label={v.guest ? 'Open (needs an account)' : undefined}>
              {v.guest && <LockGlyph />}Open
            </PhButton>
            {n > 1 && <PhButton variant="plate" size="m" disabled={v.shopBusy} onClick={v.openAllBay}>Open all ({n})</PhButton>}
          </div>
        </>
      )}
      {v.me && (
        <div className="phc-bay-level" role="group" aria-label={`Account Level ${v.level.level}`}>
          <span className="phc-bay-lvl">Level <b>{v.level.level}</b></span>
          <span className="phc-bar" aria-hidden><span style={{ transform: `scaleX(${v.level.fraction})` }} /></span>
          <span className="phc-bay-xp">{v.level.xpIntoLevel} / {v.level.xpForNextLevel} XP</span>
        </div>
      )}
    </section>
  );
}

// ── The album tile (memoized: primitive props + one stable callback) ────────────────────────────────────────

interface TileProps {
  id: string; name: string; rarity: CosmeticRarity; owned: boolean; equipped: boolean; fresh: boolean; selected: boolean; onPick: (id: string) => void;
  master?: boolean; art?: string; target?: string;
  /** A frame, plate or emote: the art is shown whole (contained), not cropped. */
  contain?: boolean;
  onHover?: (id: string | null, el?: HTMLElement) => void;
  /** An owned emote: drag it onto a slot of the emote menu to put it there (owner 2026-11-06). Stable callback. */
  onDropEmote?: (id: string, position: number) => void;
  /** Cover art pinned to its TOP (a card plate shows its top half, fading into the navy foot; owner 2026-11-06). */
  artTop?: boolean;
}

const Tile = memo(function Tile({ id, name, rarity, owned, equipped, fresh, selected, onPick, master, art, target, contain, artTop, onHover, onDropEmote }: TileProps): JSX.Element {
  const state = equipped ? 'equipped' : owned ? 'owned' : 'not owned';
  return (
    <button
      type="button"
      className={`phc-tile r-${rarity}${owned ? ' owned' : ' missing'}${equipped ? ' worn' : ''}${selected ? ' sel' : ''}${fresh ? ' fresh' : ''}${art ? ' hasart' : ''}${contain ? ' contain' : ''}${artTop ? ' arttop' : ''}`}
      aria-pressed={selected}
      aria-label={`${name}${target ? `, for ${target}` : ''}, ${RARITY_LABELS[rarity]}, ${state}${fresh ? ', new' : ''}`}
      onClick={() => onPick(id)}
      onPointerDown={onDropEmote ? (e) => { startEmoteDrag(e, art, (pos) => onDropEmote(id, pos)); } : undefined}
      onPointerEnter={onHover ? (e) => { if (e.pointerType !== 'touch') onHover(id, e.currentTarget); } : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      {art && <span className="phc-tile-art"><img src={art} alt="" draggable={false} decoding="sync" /></span>}
      <span className="phc-tile-text">
        {target && <span className="phc-tile-for">{target}</span>}
        <span className="phc-tile-name">{master ? <TitleBadge id={id} className="colls-titleplate" /> : name}</span>
        <span className="phc-tile-rar"><span className="phc-gem" aria-hidden />{RARITY_LABELS[rarity]}</span>
      </span>
      {!owned && <span className="phc-tile-lock" aria-hidden><LockGlyph /></span>}
      {(equipped || fresh) && <span className="phc-tile-tags" aria-hidden>{equipped ? <PhChip tone="gold">Equipped</PhChip> : <PhChip tone="teal">New</PhChip>}</span>}
    </button>
  );
});

// ── The detail column ──────────────────────────────────────────────────────────────────────────────────────

/** How many visual tiers a hero attack has, by its rarity (the owner's 2026-09-29 rule in heroAttackStyle.ts). */
function attackPatternCount(rarity: CosmeticDef['rarity']): number {
  return rarity === 'rare' ? 2 : rarity === 'epic' ? 3 : 4;
}

function Detail({ v, item }: { v: CollectionPhView; item: CosmeticDef }): JSX.Element {
  const owned = v.owned.has(item.id);
  const equipped = v.worn(item);
  const showDefault = v.showDefault;
  // The Preview toggle (owned card plates and portrait frames, on by default): a plate on Impossible Todd or alone, a frame
  // round your portrait or alone. The pick sticks while you browse (owner 2026-11-06).
  const [plateView, setPlateView] = useState<'card' | 'plate'>('card');
  const skinArt = skinArtOf(item);
  const art = showDefault ? defaultArtOf(item) ?? skinArt : skinArt;
  const cardSkin = item.target?.type === 'card';
  const target = skinTargetName(item);
  const skin = item.category === 'hero_skin' || item.category === 'minion_skin';
  const attack = item.category === 'hero_attack';
  const frame = item.category === 'portrait_frame';
  const voice = item.category === 'announcer';
  const emote = item.category === 'emote';
  const plate = item.category === 'card_plate';
  const title = item.category === 'title';
  // An announcer's sample stops when you look at another item or leave the screen.
  useEffect(() => (voice ? stopAnnouncerPreview : undefined), [voice, item.id]);
  const hoverIn = (e: React.PointerEvent<HTMLElement>): void => { if (e.pointerType !== 'touch') v.onHover(item.id, e.currentTarget, showDefault); };
  const hoverOut = (): void => v.onHover(null);

  const facts: [string, string][] = [];
  // No "For" row: the category already says what an item dresses (owner 2026-11-06).
  if (showDefault && !equipped) facts.push(['In use', frame ? 'Default frame' : plate ? 'Standard plate' : 'Default art']);
  // Every chest cosmetic says where it comes from, owned or not (owner 2026-11-06).
  if (owned || item.acquisition.type === 'crate') facts.push(['How to get', acquisitionText(item)]);
  // How many different looks the attack plays, by blow size: Rares have 2, Epics 3, Legendaries and Ancients 4 (heroAttackStyle.ts;
  // owner 2026-11-06).
  if (attack) facts.push(['Attack patterns', String(attackPatternCount(item.rarity))]);
  const mastery = masteryText(item);
  if (mastery) facts.push(['Mastery', mastery]);

  return (
    <section className={`phc-detail r-${item.rarity}${owned ? '' : ' missing'}`} aria-label="Details">
      <div className="phc-stage" aria-label={showDefault ? 'Preview, default' : 'Preview'}>
        {emote && emoteSrc(item.id) && <img className="phc-stage-img contain" src={emoteSrc(item.id)} alt="" draggable={false} decoding="sync" />}
        {frame && <FramePreview item={item} owned={owned} showDefault={showDefault} bare={!owned || plateView !== 'card'} />}
        {/* A card plate is shown ON a card: Impossible Todd wearing it (owned plates), in the box itself; no hover pop-up (owner 2026-11-06). */}
        {/* One card either way: Preview on shows it whole, off (and a locked plate) hides all but the plate, so the plate never
            changes size (owner 2026-11-06). */}
        {plate && <div className="phc-stage-card"><InlinePlateCard cardId={PLATE_SAMPLE_CARD} plate={showDefault && owned ? null : plateLookOf(item)} bare={!owned || plateView !== 'card'} /></div>}
        {(plate || frame) && owned && (
          <div className="phc-plateview">
            <PhToggleChip pressed={plateView === 'card'} onToggle={() => { setPlateView((p) => (p === 'card' ? 'plate' : 'card')); }}>
              <img className="phc-plateview-eye" src="/medallions/watcher.webp" alt="" draggable={false} decoding="sync" />Preview
            </PhToggleChip>
          </div>
        )}
        {attack && <HeroAttackPreview key={item.id} style={typeof item.assets.style === 'string' ? item.assets.style : ''} reducedMotion={v.reducedMotion} />}
        {item.category === 'hero_skin' && skinArt && <HeroPortraitRing art={art} alt="" className="colls-heroring phc-heroring" />}
        {item.category === 'minion_skin' && art && (
          <div className="phc-stage-hover" onPointerEnter={cardSkin ? hoverIn : undefined} onPointerLeave={cardSkin ? hoverOut : undefined}>
            <img className="phc-stage-img cover" src={art} alt="" draggable={false} decoding="sync" />
          </div>
        )}
        {title && (
          <div className="phc-stage-title">
            <span className="phc-stage-lbl">Preview</span>
            <span className="phc-stage-name">{v.playerName}</span>
            <span className="phc-stage-sub">{isMasterTitle(item.id) ? <TitleBadge id={item.id} className="colls-titleplate" /> : item.name}</span>
          </div>
        )}
        {voice && (
          <div className="phc-stage-title">
            <span className="phc-stage-icon" aria-hidden><MenuMedal name="announcers" /></span>
            <PhButton variant="plate" size="m" onClick={() => { previewAnnouncerPack(announcerPackOf(item)); }} aria-label={`Hear a line from ${item.name}`}>Hear a line</PhButton>
          </div>
        )}
        {showDefault && <span className="phc-stage-tag"><PhChip>{frame ? 'Default frame' : plate ? 'Standard plate' : 'Default art'}</PhChip></span>}
      </div>

      <div className="phc-name">
        <span className="phc-kindrow">
          <span className="phc-kind">{kindOf(item)}</span>
        </span>
        <h2>{isMasterTitle(item.id) ? <TitleBadge id={item.id} className="colls-titleplate colls-titleplate-lg" /> : item.name}</h2>
        <span className={`phc-rarity r-${item.rarity}`}><span className="phc-gem" aria-hidden />{RARITY_LABELS[item.rarity]}</span>
      </div>

      {/* No Status row: the Equipped / Equip / Not owned control above already says it (owner 2026-11-06). */}
      {facts.length > 0 && (
        <dl className="phc-facts">
          {facts.map(([k, val], i) => <div key={`${k}${i}`} className="phc-fact"><dt>{k}</dt><dd>{val}</dd></div>)}
        </dl>
      )}

      {/* THIS CATEGORY, by rarity (what is left to find): fills the column under the facts with something useful. */}
      <section className="phc-progress" aria-label={`${COSMETIC_CATEGORY_DEFS[item.category].label} collected, by rarity`}>
        <span className="phc-sublbl">{COSMETIC_CATEGORY_DEFS[item.category].label} collected</span>
        {ALL_COSMETIC_RARITIES.filter((r) => v.byRarity[r].total > 0).map((r) => (
          <div key={r} className={`phc-prow r-${r}`}>
            <span className="phc-prow-name"><span className="phc-gem" aria-hidden />{RARITY_LABELS[r]}</span>
            <span className="phc-bar" aria-hidden><span style={{ transform: `scaleX(${v.byRarity[r].owned / v.byRarity[r].total})` }} /></span>
            <span className="phc-prow-n">{v.byRarity[r].owned} / {v.byRarity[r].total}</span>
          </div>
        ))}
      </section>

      <div className="phc-actions">
        {emote && <p className="phc-emote-hint">Drag and drop any of your owned emotes to the<br />slot of your choosing to equip.</p>}
        {emote && <EmoteSlotRow item={item} owned={owned} busy={v.busy} slots={v.emoteMenu} onPlace={v.onPlaceEmote} />}
        {emote && v.busy && <div className="phc-equipping" role="status"><span className="phk-spinner" aria-hidden />Equipping</div>}
        {emote && owned ? null : !owned ? (
          // Not owned: the lock pill takes the Equip button's place, at its size (owner 2026-11-06).
          <PhChip className="phc-notowned"><LockGlyph />Not owned</PhChip>
        ) : equipped ? (
          <div className="phc-worn">
            <PhChip tone="gold">Equipped</PhChip>
            <PhButton
              variant="plate" size="m" disabled={v.busy} onClick={v.onTakeOff}
              aria-label={skin ? `Use the default art for ${target ?? 'this target'}` : attack ? 'Use the Classic hero attack' : frame ? 'Use the default portrait frame' : voice ? 'Use the default announcer' : plate ? 'Use the standard card plate' : `Take off ${item.name}`}
            >
              {skin ? 'Use default art' : attack ? 'Use Classic' : frame ? 'Use default frame' : voice ? 'Use default announcer' : plate ? 'Use Default' : 'Take off'}
            </PhButton>
          </div>
        ) : (
          <PhButton variant="primary" size="l" className="phc-equip" disabled={v.busy} onClick={v.onEquip} aria-label={`Equip ${item.name}`}>{v.busy ? 'Equipping' : 'Equip'}</PhButton>
        )}
        {v.error && <div className="phc-error" role="status">{v.error}</div>}
      </div>
    </section>
  );
}
