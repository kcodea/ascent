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
 *           XP toward it, the published odds.
 *   CENTRE  the Show tabs (All / Owned / Missing, with counts) and the rarity chips, then the album: one tile per item, in
 *           the page's stable order. Owned tiles are bright; missing ones dimmed with a lock and how to get them.
 *   RIGHT   the selected item, large (Valorant's big preview): its live preview, name, rarity, the facts, and Equip.
 *
 * Reuses the page's own pieces: `HeroPortraitRing`, `FramePreview`, `HeroAttackPreview`, `EmoteSlotRow`, `TitleBadge`,
 * `ChestPicture`, the painted category medallions. Static paint; hover is a colour or a one-shot transform; no native
 * tooltips; no own cursor.
 */
import { memo, useEffect } from 'react';
import {
  ALL_COSMETIC_RARITIES, COSMETIC_CATEGORY_DEFS, RARITY_LABELS, crateLabel, isMasterTitle,
  type CosmeticCategory, type CosmeticDef, type CosmeticRarity, type levelProgress,
} from '@game/progression';
import { PhButton, PhChip, PhEmpty, PhMeter, PhPage, PhRow, PhSection, PhTabs, PhToggleChip } from '../../partyHome/kit';
import { takeCollectionIntent } from '../../partyHome/shell/shellStore';
import { MenuMedal } from '../../menuIcons';
import { sfx } from '../../sfx';
import { touchText } from '../../touchInput';
import { HeroPortraitRing } from '../../portraitFrame/HeroPortraitRing';
import { frameSrc } from '../../portraitFrame/portraitFrameConfig';
import { HeroAttackPreview } from '../../heroBlast/HeroAttackPreview';
import { TitleBadge } from '../../titles/TitleBadge';
import { emoteSrc } from '../../emotes/emoteArt';
import { defaultArtOf, skinArtOf } from '../../skins/skinArt';
import { previewAnnouncerPack, stopAnnouncerPreview } from '../../announcer';
import { announcerPackOf } from '../announcerPack';
import { AetherIcon } from '../AetherIcon';
import { ChestPicture } from '../ChestPicture';
import { chestFloorOf, type ChestTier } from '../crateFx/chestTiers';
import type { CrateQueueItem } from '../CrateOpener';
import { COMING_BLURB, acquisitionText, albumOf, categoryLive, countOf, masteryText, missingHint, skinTargetName, type RarityFilter, type ShowFilter } from '../collectionModel';
import { CategoryIcon, EmoteSlotRow, FramePreview, LockGlyph, plateLookOf } from '../CollectionScreen';
import './collectionPh.css';

type Count = { owned: number; total: number };

/** Everything the page computed, for this skin to draw. */
export interface CollectionPhView {
  reducedMotion?: boolean;
  anyNew: boolean; markAllSeen: () => void; total: Count;
  aetherOn: boolean; openShop: () => void;
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
  emoteMenu: readonly (string | null)[]; onPlaceEmote: (position: number) => void; onEquip: () => void; onTakeOff: () => void;
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

export function CollectionPh({ view: v }: { view: CollectionPhView }): JSX.Element {
  // THE CRATES TAB (the shell's nav): it opens this page with the intent to land on the Chest Shop. Read once, on mount.
  const openShop = v.openShop;
  useEffect(() => { if (takeCollectionIntent() === 'shop') openShop(); }, [openShop]);
  return (
    <PhPage
      wide
      className="phc"
      eyebrow="Find, view and wear what you have earned"
      title="Collection"
      actions={(
        <>
          {v.anyNew && <PhButton variant="ghost" size="s" onClick={v.markAllSeen}>Mark all as seen</PhButton>}
          <PhMeter className="phc-meter" label="Collected" value={v.total.owned} max={v.total.total} />
          {v.aetherOn && (
            <PhButton variant="plate" size="m" className="phc-shopbtn" onClick={v.openShop}>
              <AetherIcon className="phc-aether" />Chest Shop
            </PhButton>
          )}
        </>
      )}
    >
      <div className="phc-body">
        <aside className="phc-rail" aria-label="Categories and chests">
          <CategoryList v={v} />
          <ChestBay v={v} />
          {v.guest && (
            <div className="phc-guest">
              <span>Guest account. Save it to keep your collection.</span>
              <PhButton variant="ghost" size="s" onClick={v.openAccount}>Create account</PhButton>
            </div>
          )}
        </aside>

        <main className="phc-main">
          {v.live ? (
            <>
              <div className="phc-filters">
                <PhTabs
                  label="Show" value={v.show} onChange={(f) => { sfx.pulse(); v.setShow(f); }}
                  tabs={[
                    { id: 'all', label: <>All <span className="phc-n">{v.albumCount.total}</span></> },
                    { id: 'owned', label: <>Owned <span className="phc-n">{v.albumCount.owned}</span></> },
                    { id: 'missing', label: <>Missing <span className="phc-n">{v.albumCount.total - v.albumCount.owned}</span></> },
                  ]}
                />
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
                          id={c.id} name={c.name} rarity={c.rarity} art={tileArt(c)} contain={c.category === 'portrait_frame' || c.category === 'card_plate' || c.category === 'emote'}
                          target={skinTargetName(c) ?? undefined} owned={v.owned.has(c.id)} equipped={v.worn(c)} fresh={v.fresh(c)} selected={v.selectedId === c.id}
                          master={isMasterTitle(c.id)} how={v.owned.has(c.id) ? undefined : acquisitionText(c)} onPick={v.onPick}
                          onHover={c.target?.type === 'card' || c.category === 'card_plate' ? v.onHover : undefined}
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

        <aside className="phc-side" aria-label="Details">
          {v.live && v.selected ? <Detail v={v} item={v.selected} /> : (
            <PhSection className="phc-detail">
              <PhEmpty title={COSMETIC_CATEGORY_DEFS[v.category].label} sub="Coming in a later update." />
            </PhSection>
          )}
        </aside>
      </div>
    </PhPage>
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
            : <span className="phc-bay-sub">{!v.cratesOn ? 'Chests are coming soon.' : v.cratesLoading ? 'Loading' : `None right now. Your next chest comes at Level ${v.nextCrateLevel}.`}</span>}
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
      {v.cratesOn && <div className="phc-bay-odds">Chest odds: {v.oddsLine}</div>}
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
  how?: string;
}

const Tile = memo(function Tile({ id, name, rarity, owned, equipped, fresh, selected, onPick, master, art, target, contain, onHover, how }: TileProps): JSX.Element {
  const state = equipped ? 'equipped' : owned ? 'owned' : 'not owned';
  return (
    <button
      type="button"
      className={`phc-tile r-${rarity}${owned ? ' owned' : ' missing'}${equipped ? ' worn' : ''}${selected ? ' sel' : ''}${fresh ? ' fresh' : ''}${art ? ' hasart' : ''}${contain ? ' contain' : ''}`}
      aria-pressed={selected}
      aria-label={`${name}${target ? `, for ${target}` : ''}, ${RARITY_LABELS[rarity]}, ${state}${fresh ? ', new' : ''}`}
      onClick={() => onPick(id)}
      onPointerEnter={onHover ? (e) => { if (e.pointerType !== 'touch') onHover(id, e.currentTarget); } : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      {art && <span className="phc-tile-art"><img src={art} alt="" draggable={false} decoding="sync" /></span>}
      <span className="phc-tile-text">
        {target && <span className="phc-tile-for">{target}</span>}
        <span className="phc-tile-name">{master ? <TitleBadge id={id} className="colls-titleplate" /> : name}</span>
        <span className="phc-tile-rar"><span className="phc-gem" aria-hidden />{RARITY_LABELS[rarity]}</span>
        {how && <span className="phc-tile-how">{how}</span>}
      </span>
      {!owned && <span className="phc-tile-lock" aria-hidden><LockGlyph /></span>}
      {(equipped || fresh) && <span className="phc-tile-tags" aria-hidden>{equipped ? <PhChip tone="gold">Equipped</PhChip> : <PhChip tone="teal">New</PhChip>}</span>}
    </button>
  );
});

// ── The detail column ──────────────────────────────────────────────────────────────────────────────────────

function Detail({ v, item }: { v: CollectionPhView; item: CosmeticDef }): JSX.Element {
  const owned = v.owned.has(item.id);
  const equipped = v.worn(item);
  const showDefault = v.showDefault;
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
  const plateArt = plate ? plateLookOf(item)?.thumb : undefined;
  const emotePosition = emote ? v.emoteMenu.indexOf(item.id) : -1;
  // An announcer's sample stops when you look at another item or leave the screen.
  useEffect(() => (voice ? stopAnnouncerPreview : undefined), [voice, item.id]);
  const hoverIn = (e: React.PointerEvent<HTMLElement>): void => { if (e.pointerType !== 'touch') v.onHover(item.id, e.currentTarget, showDefault); };
  const hoverOut = (): void => v.onHover(null);

  const facts: [string, string][] = [];
  if (target) facts.push(['For', target]);
  if (attack) facts.push(['For', 'Your hero, seen by the players you hit']);
  if (frame) facts.push(['For', 'Your hero portrait, seen by the players you meet']);
  if (voice) facts.push(['For', 'The voice calling your games. Only you hear it']);
  if (plate) facts.push(['For', 'Your cards, seen by the players you meet. Gilded cards keep their gold plate']);
  if (emote) facts.push(['For', `Your hero. ${touchText('Right-click', 'Tap and hold')} your portrait in a game to say it`]);
  if (showDefault && !equipped) facts.push(['In use', frame ? 'Default frame' : plate ? 'Standard plate' : 'Default art']);
  if (emote && emotePosition >= 0) facts.push(['In your menu', `Slot ${emotePosition + 1}`]);
  if (owned) facts.push(['How to get', acquisitionText(item)]);
  const mastery = masteryText(item);
  if (mastery) facts.push(['Mastery', mastery]);

  return (
    <section className={`phc-detail r-${item.rarity}${owned ? '' : ' missing'}`} aria-label="Details">
      <div className="phc-stage" aria-label={showDefault ? 'Preview, default' : 'Preview'}>
        {emote && emoteSrc(item.id) && <img className="phc-stage-img contain" src={emoteSrc(item.id)} alt="" draggable={false} decoding="sync" />}
        {frame && <FramePreview item={item} owned={owned} showDefault={showDefault} />}
        {plate && plateArt && (
          <div className="phc-stage-hover" onPointerEnter={owned ? hoverIn : undefined} onPointerLeave={owned ? hoverOut : undefined}>
            <img className="phc-stage-img contain" src={plateArt} alt="" draggable={false} decoding="sync" />
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
        {!owned && <span className="phc-stage-lock"><PhChip><LockGlyph />Not owned</PhChip></span>}
      </div>

      <div className="phc-name">
        <span className="phc-kind">{kindOf(item)}</span>
        <h2>{isMasterTitle(item.id) ? <TitleBadge id={item.id} className="colls-titleplate colls-titleplate-lg" /> : item.name}</h2>
        <span className={`phc-rarity r-${item.rarity}`}><span className="phc-gem" aria-hidden />{RARITY_LABELS[item.rarity]}</span>
      </div>

      <dl className="phc-facts">
        <div className="phc-fact"><dt>Status</dt><dd className={owned ? 'yes' : 'no'}>{equipped ? 'Equipped' : owned ? 'Owned' : 'Not owned'}</dd></div>
        {facts.map(([k, val], i) => <div key={`${k}${i}`} className="phc-fact"><dt>{k}</dt><dd>{val}</dd></div>)}
      </dl>

      <div className="phc-actions">
        {emote && <EmoteSlotRow item={item} owned={owned} busy={v.busy} slots={v.emoteMenu} onPlace={v.onPlaceEmote} />}
        {emote && owned ? null : !owned ? (
          <div className="phc-hint">{missingHint(item)}</div>
        ) : equipped ? (
          <div className="phc-worn">
            <PhChip tone="gold">Equipped</PhChip>
            <PhButton
              variant="plate" size="m" disabled={v.busy} onClick={v.onTakeOff}
              aria-label={skin ? `Use the default art for ${target ?? 'this target'}` : attack ? 'Use the Classic hero attack' : frame ? 'Use the default portrait frame' : voice ? 'Use the default announcer' : plate ? 'Use the standard card plate' : `Take off ${item.name}`}
            >
              {skin ? 'Use default art' : attack ? 'Use Classic' : frame ? 'Use default frame' : voice ? 'Use default announcer' : plate ? 'Use standard plate' : 'Take off'}
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
