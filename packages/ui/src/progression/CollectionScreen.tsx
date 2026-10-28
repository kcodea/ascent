import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, CRATE_TIER_FLOOR, EMOTE_SLOT_COUNT, MILESTONE_CRATE_TIER, RARITY_LABELS, cosmeticOf, crateLabel, crateOddsLine,
  isMasterTitle, levelProgress,
  milestoneLevelOfSource, tierOddsPercent, withStarterCosmetics,
  type CosmeticCategory, type CosmeticDef, type CosmeticRarity, type CrateRow,
} from '@game/progression';
import { tempHandle, useGame } from '../store';
import { sfx } from '../sfx';
import { MenuSidebar, SidebarHost } from '../MenuSidebar';
import { IconChest } from '../menuIcons';
import { CrateOpener, type CrateQueueItem } from './CrateOpener';
import { chestFloorOf, chestTierOf, type ChestTier } from './crateFx/chestTiers';
import { warmChestArt } from './crateFx/chestArt';
import {
  aetherBalance, aetherVisible, cratesVisible, equipCosmetic, equipTitle, markCosmeticsSeen, mirrorFor, refreshCrates, useProgression, type CrateOpenOutcome,
} from './progressionStore';
import {
  COMING_BLURB, acquisitionText, albumOf, categoryLive, collectibleItems, collectionCategories, countOf, filterAlbum, hasSeenBaseline,
  isEquipped, isNew, loadSeen, masteryText, missingHint, ownedIds, rarityCounts, skinTargetName, type RarityFilter, type ShowFilter,
} from './collectionModel';
import { defaultArtOf, skinArtOf } from '../skins/skinArt';
import { HeroPortraitRing } from '../portraitFrame/HeroPortraitRing';
import { frameSrc } from '../portraitFrame/portraitFrameConfig';
import { avatarSrc, heroArt } from '../art';
import { HEROES } from '@game/sim';
import { rectToStage, type StageRect } from '../stage';
import { SkinCardPreview } from './SkinCardPreview';
import { HeroAttackPreview } from '../heroBlast/HeroAttackPreview';
import { NewRewardsPopup } from './NewRewardsPopup';
import { AetherIntroPopup, aetherIntroSeen } from './AetherIntroPopup';
import { CrateSignInGate } from './CrateSignInGate';
import { CrateShop } from './CrateShop';
import { ChestPicture } from './ChestPicture';
import { AetherIcon } from './AetherIcon';
import { TitleBadge } from '../titles/TitleBadge';
import { previewAnnouncerPack, stopAnnouncerPreview } from '../announcer';
import { announcerPackOf } from './announcerPack';
import { emoteSrc } from '../emotes/emoteArt';
import { EmptyEmoteSlot } from '../emotes/EmptyEmoteSlot';
import { CARD_PLATE_LOOKS, type CardPlateLook } from '../cardPlate/cardPlateLook';
import { clearLocalEmotes, equipEmoteLocally, useEmoteSlots } from '../emotes/emoteLoadout';
import '../emotes/emotes.css';
import './collection.css';
import { touchText } from '../touchInput';

/**
 * THE COLLECTION SCREEN (owner ask 2026-09-28: "make the collection screen separate"; relaid out the same day:
 * "i think the layout is horrible. research best in class collection screens and mimic them").
 *
 * The shape, and where each idea comes from (the PR body has the full research notes):
 *   HEADER      the page title, overall completion ("6 / 16 collected", Marvel Snap's always-visible progress) and
 *               the Account Level with its XP bar.
 *   CATEGORIES  a tab strip (Legends of Runeterra's one hub with sub-tabs; the menu sidebar is already the left
 *               rail, so a second rail beside it would crowd the page). Each tab carries its icon, its owned /
 *               total count and a NEW dot (Fortnite's per-category unseen marker). The switched-off categories
 *               are locked tabs that open a tasteful "coming soon" view, not a text strip.
 *   FILTERS     Show (All / Owned / Missing) and Rarity, each with counts (Hearthstone's filter bar).
 *   ALBUM       every item of the category, owned or not, in a STABLE order (Hearthstone / Snap). Owned tiles are
 *               bright in a rarity frame; missing tiles are dimmed with the rarity still readable (Clash Royale's
 *               rarity-coloured frame; Fortnite's players asked for rarity colour back). Equipped wears a
 *               full-tile gold ring and a ribbon, not a corner tick (Fortnite). NEW until selected, or until you
 *               leave the tab; never on the equipped item; saved on the account (owner 2026-10-11). See `seenFor`.
 *               While anything is NEW the header carries "Mark all as seen", which clears every badge on every tab.
 *   DETAIL      the selected item large on a nameplate (Valorant's big preview), with a preview of it under your
 *               name, how it is found, and Equip / Take off.
 *   CRATE BAY   sealed crates always in view, whatever tab is open: the crate, the count, Open and Open all, and
 *               the next crate's level when none are sealed. It mounts the crate theatre (`CrateOpener`) as-is.
 *   SKINS       (2026-09-28) Heroes and Minions are live tabs. Their tiles show the skin's art (dimmed and blurred
 *               until owned, like a title's name) with the hero / minion it is for; the detail panel shows the art
 *               large, and Equip / "Use default art" wear it on that one target (Default is always selectable).
 *               A RETIRED item (the kill switch) is not in the album at all; see collectionModel.ts.
 *               (2026-09-30, owner: "show the default skin when the player hits use default", "add a mouseover
 *               preview of what minions/spells would look like in game", "for heroes the preview image is off")
 *               "Use default art" flips the preview to the target's DEFAULT art at once (and keeps that item
 *               selected); a hero skin previews in the in-game portrait ring (`HeroPortraitRing`); hovering a
 *               card skin's tile or art floats the real in-game `Card` wearing it (`SkinCardPreview`).
 *
 *   FRAMES      (2026-10-01, owner: "we're adding portrait skins ... we want this to replace the default portrait png
 *               when a skin is applied") Portrait Frames is a live tab. A tile shows the ring (dimmed and blurred until
 *               owned, like a skin); an OWNED frame previews around your current hero portrait (your avatar), an
 *               unowned one only as the blurred ring ("do not allow preview if you do not own the art"). Equip wears
 *               it account-wide; "Use default frame" puts the default ring back and previews it at once.
 *
 *   AETHER      (2026-10-18, spec docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md: "An Aether balance is
 *               always visible") The wallet, the Chest Shop button and every purchase only while `aetherVisible`; with it
 *               off the page has none of them, but the bay still draws its sealed chest's painted picture. The header
 *               carries the wallet chip; the Crate Shop (`CrateShop.tsx`) is its own full-screen page (2026-10-20): a Chest Shop button at the top of the sidebar
 *               swaps it in for the header and the body (the menu rail and every overlay stay), and a purchase plays straight in
 *               the theatre with the answer it already has. The bay draws its first sealed chest's painted picture (`ChestPicture`). A MILESTONE crate opens in the bay like any
 *               other earned crate, in Open and in Open all (owner 2026-10-20: milestone chests are Epic and "you cannot
 *               focus those ones specifically", which retired the focus step they used to open through). With level
 *               crates retired, the bay names the next milestone level, and its odds are the first sealed crate's (its
 *               rarity floor's; none sealed, the next milestone chest's).
 *               While a purchase runs (`shopBusy`) nothing here can start a second theatre: the bay's Open and Open
 *               all, and `begin`, hold until it answers.
 *
 * A guest sees a slim save-progress row, and (owner 2026-09-29, a HARD gate) cannot open a crate: every Open goes
 * through `begin`, which shows the sign-in gate (`CrateSignInGate.tsx`) instead. Sealed crates stay in view. A guest
 * sees their Aether too, and every spend in the shop shows the same gate (R-PROG-AETHER-02).
 * Sizes are layout px (the stage scales the page on a small screen); no native tooltips; buttons take the global gauntlet cursor. Tiles are memoized with primitive props; the only
 * loops are the crate's float (transform) and two glows that breathe by OPACITY over a static paint.
 */

export function CollectionScreen(): JSX.Element | null {
  const show = useGame((s) => s.showCollection);
  return show ? <CollectionPage /> : null;
}

const EMPTY: readonly string[] = [];
/** Today's milestone floor (Epic since 2026-10-20): the next milestone chest's, and a milestone crate's that sent none. */
const MILESTONE_FLOOR: CosmeticRarity = CRATE_TIER_FLOOR[MILESTONE_CRATE_TIER];

/** A sealed crate's rarity floor: its own (shop, milestone), else today's milestone floor for a milestone crate, else
 *  Common (a level or Gauntlet crate rolls every rarity at the published odds). */
const floorOf = (c: CrateRow): CosmeticRarity => c.floor ?? (milestoneLevelOfSource(c.source) !== null ? MILESTONE_FLOOR : 'common');

/** The odds a floor shows in the bay, in the bay's own format ("Common 35%, Rare 31%, ..."): only what it can drop. */
function floorOddsLine(floor: CosmeticRarity): string {
  const odds = tierOddsPercent(floor);
  return COSMETIC_RARITIES.filter((r) => odds[r] > 0).map((r) => `${RARITY_LABELS[r]} ${odds[r]}%`).join(', ');
}

type OpenFn = (crateId: string) => Promise<CrateOpenOutcome>;

export function CollectionPage({ reducedMotion }: { reducedMotion?: boolean }): JSX.Element {
  const mirror = useProgression((s) => s.mirror);
  const crateList = useProgression((s) => s.crateList);
  const cratesOn = useProgression(cratesVisible);
  const aetherOn = useProgression(aetherVisible);
  const balance = useProgression(aetherBalance);
  const milestoneEvery = useProgression((s) => s.economy.milestoneEvery);
  const anonymous = useGame((s) => s.account.anonymous);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const userId = useGame((s) => s.account.userId);
  const playerName = useGame((s) => s.playerName);
  const me = mirrorFor(userId, mirror);
  // INTRODUCING AETHER (owner 2026-10-19, R-PROG-AETHER-05): the first visit once Aether is live opens with the
  // announcement (the server has paid this account's 1,000 by the time its profile exists, so it waits for `me`).
  // It goes first; the New Rewards summary (the backdated milestone chests, say) waits until it is closed.
  const wantsIntro = aetherOn && !!userId && !!me && !aetherIntroSeen(userId);
  const [introFor, setIntroFor] = useState<string | null>(null);
  useEffect(() => { if (wantsIntro && userId) setIntroFor(userId); }, [wantsIntro, userId]);
  const introUp = wantsIntro || introFor !== null;
  // STARTER items are everyone's, signed in or not (since 2026-10-15 just Zen Brian, the one starter emote).
  const ownedList = useMemo(() => withStarterCosmetics(me ? ownedIds(me) : EMPTY), [me]);
  // The emote menu by position, as the game will show it (the server's rows, this device's layer, owned emotes filling in).
  const emoteMenu = useEmoteSlots();
  const worn = useCallback((c: CosmeticDef): boolean => (c.category === 'emote' ? emoteMenu.includes(c.id) : isEquipped(c, me)), [emoteMenu, me]);
  const owned = useMemo(() => new Set(ownedList), [ownedList]);
  // The server's kill switch can retire an item or a category while the page is open: every list re-derives.
  const catalogEpoch = useProgression((s) => s.catalogEpoch);
  const categories = useMemo(() => collectionCategories(), [catalogEpoch]);

  // Lands on Titles (the page's first and largest shelf) while it is live; else the first live category.
  const [category, setCategory] = useState<CosmeticCategory>(() => (categoryLive('title') ? 'title' : collectionCategories()[0]!));
  const [show, setShow] = useState<ShowFilter>('all');
  const [rarity, setRarity] = useState<RarityFilter>('all');
  // NEW (owner 2026-10-11: "whenever i load the game, all of my stuff that i already own shows up as 'new'", then
  // "i want to save the 'seen' on the account level"). The list lives on the ACCOUNT; this device keeps a copy.
  // `seen` is a SNAPSHOT of that copy, taken when the page opens, when the account changes and on a tab switch.
  // The tab you are on is marked seen (device + account) while you look, but the snapshot is not touched, so its
  // badges stay for this visit and are gone the next time, on every device. The account's own answer (`seenKnown`)
  // is laid over the snapshot, so a page opened before it arrived corrects itself. Re-read during render, never in
  // an effect: a mount effect would run after the view effect (twice under StrictMode) and wipe the badges.
  const seenKnown = useProgression((s) => s.seenKnown);
  const known = seenKnown && seenKnown.userId === userId ? seenKnown.ids : null;
  const readSeen = (): { ids: Set<string>; ready: boolean } => ({ ids: loadSeen(userId), ready: hasSeenBaseline(userId) });
  const [seenFor, setSeenFor] = useState(() => ({ userId, ...readSeen() }));
  if (seenFor.userId !== userId) setSeenFor({ userId, ...readSeen() });
  const seen = seenFor.ids;
  // No badge at all until this device knows what the account has seen: an empty copy means "not asked yet".
  const seenReady = seenFor.ready || known !== null;
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The crate theatre. `open` (Aether): where it asks for the reward; a shop purchase passes the answer it already has. */
  const [theatre, setTheatre] = useState<{ queue: CrateQueueItem[]; openAll: boolean; open?: OpenFn } | null>(null);
  const [gate, setGate] = useState(false);
  /** A Crate Shop purchase is in flight. */
  const [shopBusy, setShopBusy] = useState(false);
  /** The Chest Shop screen is open (Aether on only: see `shopShown`). It starts closed on every visit to the page. */
  const [shopOpen, setShopOpen] = useState(false);
  /** The skin whose target was just put back in its default art: its preview shows that default (owner 2026-09-30). */
  const [defaultShown, setDefaultShown] = useState<string | null>(null);
  /** The card-skin preview under the pointer: the card, the art to wear (undefined = default), and the anchor
   *  rect, read ONCE on pointer enter (stage px). */
  const [hover, setHover] = useState<{ cardId: string; art: string | undefined; rect: StageRect; plate?: CardPlateLook | null } | null>(null);
  const closeGate = useCallback(() => setGate(false), []);
  const openGate = useCallback(() => setGate(true), []);
  const openShop = useCallback(() => { sfx.pulse(); setShopOpen(true); }, []);
  const closeShop = useCallback(() => setShopOpen(false), []);
  /** A shop purchase, already bought and opened: the theatre plays it. */
  const playBought = useCallback((item: CrateQueueItem, open: OpenFn) => { setTheatre({ queue: [item], openAll: false, open }); }, []);

  useEffect(() => { void refreshCrates(); }, []);
  // PHONES (R-PHONE-MENUS-03): the categories are one row that scrolls sideways (phoneMenus.css), so the picked one is
  // brought to the row's start (a whole chip, never a fragment under the fade). A no-op on desktop: the categories are a grid that never scrolls.
  useEffect(() => {
    if (!document.documentElement.hasAttribute('data-page-scale')) return;
    document.querySelector('.colls-tabs .colls-tab.on')?.scrollIntoView?.({ block: 'nearest', inline: 'start' });
  }, [category]);
  // Aether switched off under an open shop: back to the Collection, and it stays there if Aether returns.
  useEffect(() => { if (!aetherOn) setShopOpen(false); }, [aetherOn]);
  const shopShown = shopOpen && aetherOn;

  const sealedRows: CrateRow[] = useMemo(() => (crateList ?? []).filter((c) => c.state === 'sealed'), [crateList]);
  const sealed: CrateQueueItem[] = useMemo(
    // Each crate opens as its tier's chest (tiered chest openings, 2026-10-19): the bay, Open all and the pop-up all read it.
    () => sealedRows.map((c) => ({ crateId: c.crateId, earnedLevel: c.earnedLevel, source: c.source, tier: chestTierOf(floorOf(c)) })),
    [sealedRows],
  );
  // Every sealed tier's chest art starts loading while the bay is on screen, so no opening loads it cold (none under
  // reduced motion: its opening never draws the art).
  useEffect(() => { if (!reducedMotion) for (const t of new Set(sealed.map((c) => c.tier))) warmChestArt(t); }, [sealed, reducedMotion]);
  // The bay's chest picture: the first sealed chest's tier; none sealed, the chest the next one will be (a milestone Epic
  // with Aether on, today's Standard chest with it off). The nothing-sealed chest is drawn dimmed (collection.css).
  const bayTier: ChestTier = sealed[0]?.tier ?? (aetherOn ? chestTierOf(MILESTONE_FLOOR) : 'standard');
  const firstFloor = sealedRows[0] ? floorOf(sealedRows[0]) : null;
  // Aether: the first sealed crate's odds; none sealed, the next crate is a milestone chest (Epic). Off: today's line.
  const oddsLine = useMemo(() => (aetherOn ? floorOddsLine(firstFloor ?? MILESTONE_FLOOR) : crateOddsLine()), [aetherOn, firstFloor]);

  const sealedIds = useMemo(() => (crateList ? new Set(sealed.map((c) => c.crateId)) : null), [crateList, sealed]);
  // The Titles album shows each hero title once (its golden master once owned), so both lists read ownership.
  const everything = useMemo(() => collectibleItems(undefined, owned), [catalogEpoch, owned]);
  const total = useMemo(() => countOf(everything, owned), [everything, owned]);
  const album = useMemo(() => albumOf(category, undefined, owned), [category, catalogEpoch, owned]);
  const wornId = album.find((c) => worn(c))?.id ?? null;
  const shown = useMemo(() => filterAlbum(album, owned, show, rarity), [album, owned, show, rarity]);
  const byRarity = useMemo(() => rarityCounts(album, owned), [album, owned]);
  const albumCount = useMemo(() => countOf(album, owned), [album, owned]);

  // CLEAR ON VIEW: everything you own on the open tab is marked seen (the snapshot keeps its badges up for now).
  useEffect(() => {
    if (seenReady) markCosmeticsSeen(userId, album.filter((c) => owned.has(c.id)).map((c) => c.id));
  }, [seenReady, userId, album, owned]);

  // The selected item: the one you picked, else what you wear, else your first owned item, else the album's first.
  // A default selection never clears a badge on screen: a PICK does at once, the rest go when you leave the tab.
  const selectedId = picked && album.some((c) => c.id === picked) ? picked
    : wornId
    ?? album.find((c) => owned.has(c.id))?.id ?? album[0]?.id ?? null;
  const selected = album.find((c) => c.id === selectedId) ?? null;

  /** Hover a card skin (its tile, or the detail panel's art): float the in-game card wearing it. Mouse / pen only
   *  (a tap is a pick), and the anchor's rect is read once here, never per frame. */
  const onHover = useCallback((id: string | null, el?: HTMLElement, asDefault?: boolean) => {
    const item = id ? cosmeticOf(id) : null;
    // OWNED SKINS ONLY (owner 2026-10-01: "do not allow preview if you do not own the art"): an unowned skin keeps its
    // locked, blurred tile and never floats its art on a card.
    // A CARD PLATE (2026-10-14) floats a sample card wearing it (owned only, the same rule), or wearing the standard
    // plate after "Use standard plate".
    if (item && owned.has(item.id) && item.category === 'card_plate') {
      setHover(el ? { cardId: PLATE_SAMPLE_CARD, art: undefined, rect: rectToStage(el.getBoundingClientRect()), plate: asDefault ? null : plateLookOf(item) } : null);
      return;
    }
    const cardId = item && owned.has(item.id) && item.target?.type === 'card' ? item.target.id : null;
    setHover(cardId && el ? { cardId, art: asDefault ? undefined : skinArtOf(item), rect: rectToStage(el.getBoundingClientRect()) } : null);
  }, [owned]);
  const clearHover = useCallback(() => setHover(null), []);

  const markSeen = useCallback((id: string) => {
    markCosmeticsSeen(userId, [id]);
    setSeenFor((prev) => (prev.ids.has(id) ? prev : { ...prev, ids: new Set(prev.ids).add(id) }));
  }, [userId]);

  const onPick = useCallback((id: string) => {
    sfx.pulse();
    setPicked(id);
    setDefaultShown(null);
    setError(null);
    // Only an OWNED item is marked seen: a missing one you peeked at still wears NEW the day a crate gives it.
    if (owned.has(id)) markSeen(id);
  }, [markSeen, owned]);

  /** Wear `item`, or (`on` false) take it off: a title clears the title slot; a skin puts its hero / minion back in
   *  its default art; a hero attack goes back to Classic. The server checks ownership and the target either way. */
  const onEquip = async (item: CosmeticDef, on: boolean): Promise<void> => {
    sfx.pulse();
    setBusy(true);
    setError(null);
    const skin = item.category === 'hero_skin' || item.category === 'minion_skin';
    const attack = item.category === 'hero_attack';
    const frame = item.category === 'portrait_frame';
    const voice = item.category === 'announcer';
    const plate = item.category === 'card_plate';
    // Taking a skin (or a frame, or a plate) off shows the DEFAULT art at once and keeps this item selected (it would
    // otherwise jump to the next worn item); wearing one shows the skin again. A failed call puts the preview back.
    if (skin || frame || plate) { setPicked(item.id); setDefaultShown(on ? null : item.id); }
    const ok = attack || frame || voice || plate
      ? await equipCosmetic(item.category as 'hero_attack' | 'portrait_frame' | 'announcer' | 'card_plate', '', on ? item.id : null)
      : skin && item.target
      ? await equipCosmetic(item.category as 'hero_skin' | 'minion_skin', item.target.id, on ? item.id : null)
      : await equipTitle(on ? item.id : null);
    setBusy(false);
    if (!ok && (skin || frame || plate)) setDefaultShown(on ? item.id : null);
    if (!ok) setError(plate ? 'Could not change your card plate. Try again.' : voice ? 'Could not change your announcer. Try again.' : attack ? 'Could not change your hero attack. Try again.' : frame ? 'Could not change your portrait frame. Try again.' : skin ? 'Could not change your skin. Try again.' : 'Could not change your title. Try again.');
  };

  /** EMOTES (owner 2026-10-13: "Players equip up to 4 in Collections"): put an emote in a menu position (1 to 8 on
   *  screen, 0 to 7 in the loadout). The server takes it when it can; when it cannot (signed out, offline, or the
   *  emote SQL not run yet) the position is kept on this device, so it always works. The same emote leaves any other
   *  position (a swap). */
  const onPlaceEmote = async (item: CosmeticDef, position: number): Promise<void> => {
    sfx.pulse();
    setBusy(true);
    setError(null);
    const ok = await equipCosmetic('emote', String(position), item.id);
    if (ok) clearLocalEmotes(); else equipEmoteLocally(position, item.id);
    setBusy(false);
  };

  /** EVERY player-facing crate open comes through here (the bay's Open / Open all, the New rewards pop-up). A guest
   *  gets the sign-in gate instead (owner 2026-09-29); `anonymous` is read fresh each render, so the first Open
   *  after the account is created goes straight through. */
  const begin = (openAll: boolean, queue: CrateQueueItem[] = sealed): void => {
    if (!queue.length || shopBusy) return; // a purchase in flight owns the theatre next
    sfx.pulse();
    if (anonymous) { setGate(true); return; }
    setTheatre({ queue: [...queue], openAll });
  };

  /** The single Open and Open all (the bay's AND the New rewards pop-up's): every sealed crate, milestone crates
   *  included, in the bay's order (owner 2026-10-20: a milestone crate is never focused, so it needs no step of its own).
   *  Every guest gets the gate through `begin`. */
  const openBay = (): void => { begin(false); };
  const openAllBay = (): void => { begin(true); };

  const pickCategory = (c: CosmeticCategory): void => {
    sfx.pulse(); setCategory(c); setPicked(null); setDefaultShown(null); setHover(null); setError(null);
    setSeenFor((prev) => ({ ...prev, ...readSeen() })); // the tab you are leaving has been seen
  };
  const lp = levelProgress(me?.accountXp ?? 0);
  // Aether retires the per-level crate: the next one comes at the next milestone level (every `milestoneEvery`th).
  const nextCrateLevel = aetherOn ? (Math.floor(lp.level / milestoneEvery) + 1) * milestoneEvery : lp.level + 1;
  const name = playerName || tempHandle(userId);
  const live = categoryLive(category);
  /** NEW: owned, not seen yet (on this device or, per the account, on any other), and not the item you are wearing. */
  const fresh = (c: CosmeticDef): boolean => seenReady && isNew(c.id, owned, seen) && !known?.has(c.id) && !worn(c);
  const newIn = (c: CosmeticCategory): number => albumOf(c, undefined, owned).filter(fresh).length;
  const anyNew = everything.some(fresh);
  /** MARK ALL AS SEEN (owner 2026-10-11: "when a player clicks that, all 'new' pills go away"): everything you own,
   *  on every tab, at once. Unlike the view effect it also updates the snapshot, so the badges leave now. */
  const markAllSeen = (): void => {
    sfx.pulse();
    const ids = everything.filter((c) => owned.has(c.id)).map((c) => c.id);
    markCosmeticsSeen(userId, ids);
    setSeenFor((prev) => ({ ...prev, ids: new Set([...prev.ids, ...ids]) }));
  };

  return (
    <SidebarHost className={`lbpage colls-page${reducedMotion ? ' colls-still' : ''}`}>
      <MenuSidebar current="collection" />
      {shopShown ? (
        <CrateShop guest={anonymous} onGuest={openGate} onOpen={playBought} onBusy={setShopBusy} onBack={closeShop} reducedMotion={reducedMotion} />
      ) : (
        <>
      <div className="lbtopbar colls-top">
        <div className="lbtitle">
          <IconChest />
          <div>
            <div className="esch disp">Collection</div>
            <div className="lbsub">Find, view and wear what you have earned</div>
          </div>
        </div>
        <div className="colls-meters">
          {anyNew && <button type="button" className="colls-quiet colls-markall pressable quiet" onClick={markAllSeen}>Mark all as seen</button>}
          <div className="colls-meter" role="group" aria-label={`${total.owned} of ${total.total} collected`}>
            <div className="colls-meter-num"><b>{total.owned}</b> / {total.total}</div>
            <div className="colls-meter-lbl">Collected</div>
            <div className="colls-bar" aria-hidden><div className="colls-bar-fill" style={{ transform: `scaleX(${total.total ? total.owned / total.total : 0})` }} /></div>
          </div>
          {aetherOn && (
            <div className="colls-meter colls-wallet" role="group" aria-label="Aether balance">
              <div className="colls-meter-num"><AetherIcon className="colls-wallet-gem" /><b>{balance}</b> Aether</div>
            </div>
          )}
          {me && (
            <div className="colls-meter colls-level" role="group" aria-label={`Account Level ${lp.level}`}>
              <span className="colls-lvbadge" aria-hidden><span>Lv</span>{lp.level}</span>
              <div className="colls-level-body">
                <div className="colls-meter-lbl">Account Level {lp.level}</div>
                <div className="colls-bar colls-bar-xp" aria-hidden><div className="colls-bar-fill" style={{ transform: `scaleX(${lp.fraction})` }} /></div>
                <div className="colls-level-xp">{lp.xpIntoLevel} / {lp.xpForNextLevel} XP</div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="colls-body">
        <main className="colls-main">
          <div className="colls-tabs" role="tablist" aria-label="Categories">
            {categories.map((c) => {
              const on = categoryLive(c);
              const cnt = on ? countOf(albumOf(c, undefined, owned), owned) : null;
              const freshCount = on ? newIn(c) : 0;
              return (
                <button
                  key={c} type="button" role="tab" aria-selected={category === c}
                  className={`colls-tab${category === c ? ' on' : ''}${on ? '' : ' locked'}`}
                  aria-label={on ? `${COSMETIC_CATEGORY_DEFS[c].label}, ${cnt!.owned} of ${cnt!.total}${freshCount ? `, ${freshCount} new` : ''}` : `${COSMETIC_CATEGORY_DEFS[c].label}, coming soon`}
                  onClick={() => pickCategory(c)}
                >
                  <CategoryIcon category={c} />
                  <span className="colls-tab-name">{COSMETIC_CATEGORY_DEFS[c].label}</span>
                  {on ? <span className="colls-tab-count">{cnt!.owned}/{cnt!.total}</span> : <span className="colls-tab-soon"><LockGlyph />Soon</span>}
                  {on && cnt!.total > 0 && <span className="colls-tab-bar" aria-hidden><span style={{ transform: `scaleX(${cnt!.owned / cnt!.total})` }} /></span>}
                  {freshCount > 0 && <span className="colls-tab-new" aria-hidden>{freshCount}</span>}
                </button>
              );
            })}
          </div>

          {live ? (
            <>
              <div className="colls-filters">
                <div className="colls-seg" role="group" aria-label="Show">
                  {(['all', 'owned', 'missing'] as const).map((f) => (
                    <button key={f} type="button" className={`colls-chip${show === f ? ' on' : ''}`} aria-pressed={show === f} onClick={() => { sfx.pulse(); setShow(f); }}>
                      {f === 'all' ? 'All' : f === 'owned' ? 'Owned' : 'Missing'}
                      <span className="colls-chip-n">{f === 'all' ? albumCount.total : f === 'owned' ? albumCount.owned : albumCount.total - albumCount.owned}</span>
                    </button>
                  ))}
                </div>
                <div className="colls-seg" role="group" aria-label="Rarity">
                  <button type="button" className={`colls-chip${rarity === 'all' ? ' on' : ''}`} aria-pressed={rarity === 'all'} onClick={() => { sfx.pulse(); setRarity('all'); }}>Any rarity</button>
                  {COSMETIC_RARITIES.filter((r) => byRarity[r].total > 0).map((r) => (
                    <button key={r} type="button" className={`colls-chip colls-chip-r r-${r}${rarity === r ? ' on' : ''}`} aria-pressed={rarity === r} onClick={() => { sfx.pulse(); setRarity(r); }}>
                      <span className="colls-gem" aria-hidden />{RARITY_LABELS[r]}
                      <span className="colls-chip-n">{byRarity[r].owned}/{byRarity[r].total}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="colls-gridwrap" onScroll={hover ? clearHover : undefined}>
                {shown.length === 0 ? (
                  <div className="colls-nomatch">
                    <div>{show === 'owned' && albumCount.owned === 0 ? 'You have none yet. Open a chest to find one.' : show === 'missing' && albumCount.owned === albumCount.total ? 'You have them all.' : 'Nothing matches these filters.'}</div>
                    <button type="button" className="colls-quiet pressable quiet" onClick={() => { sfx.pulse(); setShow('all'); setRarity('all'); }}>Show all</button>
                  </div>
                ) : (
                  <ul className="colls-grid" aria-label={`${COSMETIC_CATEGORY_DEFS[category].label}`}>
                    {shown.map((c) => (
                      <li key={c.id}>
                        <ItemTile
                          id={c.id} name={c.name} rarity={c.rarity} art={c.category === 'portrait_frame' ? frameSrc(c.id) : c.category === 'emote' ? emoteSrc(c.id) : c.category === 'card_plate' ? plateLookOf(c)?.thumb : skinArtOf(c)} ring={c.category === 'portrait_frame' || c.category === 'card_plate'} emote={c.category === 'emote'} target={skinTargetName(c) ?? undefined}
                          owned={owned.has(c.id)} equipped={worn(c)} fresh={fresh(c)} selected={selectedId === c.id} master={isMasterTitle(c.id)}
                          how={owned.has(c.id) ? undefined : acquisitionText(c)}
                          onPick={onPick} onHover={c.target?.type === 'card' || c.category === 'card_plate' ? onHover : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ) : (
            <ComingSoon category={category} />
          )}
        </main>

        <aside className="colls-side">
          {aetherOn && (
            <button type="button" className="colls-shopbtn" onClick={openShop}><AetherIcon className="colls-shopbtn-gem" />Chest Shop</button>
          )}
          <CrateBay
            cratesOn={cratesOn} loading={crateList === null} sealed={sealed} tier={bayTier} nextLevel={nextCrateLevel} guest={anonymous} oddsLine={oddsLine} busy={shopBusy}
            onOpen={openBay} onOpenAll={openAllBay}
          />
          {live && selected && (
            <DetailPanel
              item={selected} owned={owned.has(selected.id)} equipped={worn(selected)} busy={busy} error={error} playerName={name}
              reducedMotion={reducedMotion} showDefault={defaultShown === selected.id && (busy || !isEquipped(selected, me))}
              onHover={onHover} emotePosition={selected.category === 'emote' ? emoteMenu.indexOf(selected.id) : -1} emoteSlots={emoteMenu}
              onPlaceEmote={(pos) => { void onPlaceEmote(selected, pos); }}
              onEquip={() => { void onEquip(selected, true); }} onTakeOff={() => { void onEquip(selected, false); }}
            />
          )}
          {!live && (
            <section className="colls-panel colls-detail colls-detail-soon" aria-label="Details">
              <div className="colls-kicker">{COSMETIC_CATEGORY_DEFS[category].label}</div>
              <div className="colls-soon-note">Coming in a later update.</div>
            </section>
          )}
          {anonymous && (
            <div className="colls-guest">
              <span>Guest account. Save it to keep your collection.</span>
              <button type="button" className="colls-quiet pressable quiet" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Create account</button>
            </div>
          )}
        </aside>
      </div>
        </>
      )}

      {/* NEW REWARDS (owner 2026-09-28): what the last games awarded, summarised once, then marked seen. */}
      {introFor && <AetherIntroPopup userId={introFor} onDone={() => setIntroFor(null)} />}
      {!introUp && <NewRewardsPopup sealedIds={sealedIds} onOpenCrates={(all) => { if (all) openAllBay(); else openBay(); }} />}
      <CrateSignInGate open={gate} onClose={closeGate} />
      {hover && <SkinCardPreview key={`${hover.cardId}:${hover.art ?? ''}:${hover.plate === undefined ? '' : hover.plate?.id ?? 'standard'}:${hover.rect.left}:${hover.rect.top}`} cardId={hover.cardId} art={hover.art} anchor={hover.rect} plate={hover.plate} />}
      {theatre && (
        <CrateOpener
          queue={theatre.queue}
          autoOpen
          openAll={theatre.openAll}
          open={theatre.open}
          reducedMotion={reducedMotion}
          onClose={() => { setTheatre(null); void refreshCrates(); }}
        />
      )}
    </SidebarHost>
  );
}

// ── The album tile (memoized: primitive props + one stable callback) ───────────────────────────────────────

interface TileProps {
  id: string; name: string; rarity: CosmeticRarity; owned: boolean; equipped: boolean; fresh: boolean; selected: boolean; onPick: (id: string) => void;
  /** A hero title's master version: its name wears the master look (TitleBadge, owner pick 2026-10-28). */
  master?: boolean;
  /** A skin's art (its tile shows it, dimmed and blurred until owned). Undefined for a title, or a missing file. */
  art?: string;
  /** A skin's hero / minion, by name. */
  target?: string;
  /** A portrait frame or a card plate: `art` is the ring / plate, shown whole (contained) rather than cropped. */
  ring?: boolean;
  /** A CARD skin: hovering the tile floats the in-game card wearing it (null clears it). */
  onHover?: (id: string | null, el?: HTMLElement) => void;
  /** An emote: `art` is the whole painted bubble, contained. */
  emote?: boolean;
  /** How to get it, printed on a MISSING item's tile (WS-6: the path to own it, not just a lock). */
  how?: string;
}

const ItemTile = memo(function ItemTile({ id, name, rarity, owned, equipped, fresh, selected, onPick, art, target, master, onHover, ring, emote, how }: TileProps): JSX.Element {
  const state = equipped ? 'equipped' : owned ? 'owned' : 'not owned';
  return (
    <button
      type="button"
      className={`colls-tile r-${rarity}${owned ? ' owned' : ' missing'}${equipped ? ' worn' : ''}${selected ? ' sel' : ''}${fresh ? ' fresh' : ''}${art ? ' skin' : ''}${ring ? ' ring' : ''}${emote ? ' emote' : ''}`}
      aria-pressed={selected}
      aria-label={`${name}${target ? `, for ${target}` : ''}, ${RARITY_LABELS[rarity]}, ${state}${fresh ? ', new' : ''}`}
      onClick={() => onPick(id)}
      onPointerEnter={onHover ? (e) => { if (e.pointerType !== 'touch') onHover(id, e.currentTarget); } : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
    >
      {art && <img className="colls-tile-art" src={art} alt="" draggable={false} decoding="sync" />}
      {/* The text block. `display: contents` everywhere except a skin tile, where it becomes the faint dark band
          behind the text (collection.css, "LEGIBILITY OVER ART"). */}
      <span className="colls-tile-text">
        {/* A skin tile's lines are outlined + shadowed: `data-wkt` is their iPhone copy (webkitText.ts, R-WEBKIT-SHADOW-01). */}
        {target && <span className="colls-tile-for" data-wkt={art ? target : undefined}>{target}</span>}
        <span className="colls-tile-top">
          <span className="colls-gem" aria-hidden />
          <span className="colls-tile-rar" data-wkt={art ? RARITY_LABELS[rarity] : undefined}>{RARITY_LABELS[rarity]}</span>
        </span>
        <span className="colls-tile-name" data-wkt={art && owned && !master ? name : undefined}>{master ? <TitleBadge id={id} className="colls-titleplate" /> : name}</span>
        {how && <span className="colls-tile-how">{how}</span>}
      </span>
      {!owned && <span className="colls-tile-lock" aria-hidden><LockGlyph /></span>}
      {fresh && <span className="colls-new" aria-hidden>New</span>}
      {equipped && <span className="colls-tile-ribbon" aria-hidden>Equipped</span>}
    </button>
  );
});

// ── The detail panel ───────────────────────────────────────────────────────────────────────────────────────

function DetailPanel({ item, owned, equipped, busy, error, playerName, reducedMotion, showDefault, onHover, onEquip, onTakeOff, emotePosition = -1, emoteSlots, onPlaceEmote }: {
  item: CosmeticDef; owned: boolean; equipped: boolean; busy: boolean; error: string | null; playerName: string; reducedMotion?: boolean;
  /** "Use default art" was just pressed for this skin: preview the target's DEFAULT art (owner 2026-09-30). */
  showDefault?: boolean;
  onHover?: (id: string | null, el?: HTMLElement, asDefault?: boolean) => void;
  onEquip: () => void; onTakeOff: () => void;
  /** An emote: its menu position (0 to 7), or -1 when it is not in the menu; and how to put it in one. */
  emotePosition?: number;
  /** Your emote menu by position (null = an empty slot), shown as the eight slots. */
  emoteSlots?: readonly (string | null)[];
  onPlaceEmote?: (position: number) => void;
}): JSX.Element {
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
  const plateArt = plate ? plateLookOf(item)?.thumb : undefined;
  // An announcer's sample stops when you look at another item or leave the screen.
  useEffect(() => (voice ? stopAnnouncerPreview : undefined), [voice, item.id]);
  return (
    <section className={`colls-panel colls-detail r-${item.rarity}${owned ? '' : ' missing'}${skin || frame || plate ? ' skin' : ''}`} aria-label="Details">
      <div className="colls-kicker">{skin ? (item.category === 'hero_skin' ? 'Hero skin' : 'Minion skin') : attack ? 'Hero attack' : frame ? 'Portrait frame' : voice ? 'Announcer' : emote ? 'Emote' : plate ? 'Card plate' : COSMETIC_CATEGORY_DEFS[item.category].label.replace(/s$/, '')}</div>
      {/* An emote's bubble, large: the painted art as it pops up in a game. */}
      {emote && emoteSrc(item.id) && (
        <div className="colls-skinart colls-emoteart" aria-label="Preview">
          <img src={emoteSrc(item.id)} alt="" draggable={false} decoding="sync" />
        </div>
      )}
      {frame && <FramePreview item={item} owned={owned} showDefault={!!showDefault} />}
      {/* A CARD PLATE (2026-10-14): the plate whole; an owned one floats a sample card wearing it on hover (after "Use
          standard plate", the standard plate). A missing one stays blurred, like a skin. */}
      {plate && plateArt && (
        <div
          className="colls-skinart colls-plateart" aria-label={showDefault ? 'Preview, standard plate' : 'Preview'}
          onPointerEnter={owned && onHover ? (e) => { if (e.pointerType !== 'touch') onHover(item.id, e.currentTarget, showDefault); } : undefined}
          onPointerLeave={owned && onHover ? () => onHover(null) : undefined}
        >
          <img src={plateArt} alt="" draggable={false} decoding="sync" />
          {showDefault && <span className="colls-default-tag">Standard plate</span>}
        </div>
      )}
      {/* A hero attack plays in place (the Blast tuner's own runner, in a sandbox box): owned or not, so you can
          see what a crate might give. Keyed by item so switching items starts a fresh stage. */}
      {attack && <HeroAttackPreview key={item.id} style={typeof item.assets.style === 'string' ? item.assets.style : ''} reducedMotion={reducedMotion} />}
      {/* A skin's art, large (Valorant's big preview). Missing items stay blurred, like a title's name. A HERO skin
          sits in the in-game portrait ring (the same disc, crop and frame as your portrait in a run); a CARD skin's
          art floats the in-game card on hover. After "Use default art" both show the DEFAULT art. */}
      {item.category === 'hero_skin' && skinArt && (
        <div className="colls-heropreview" aria-label={showDefault ? 'Preview, default art' : 'Preview'}>
          <HeroPortraitRing art={art} alt="" className="colls-heroring" />
          {showDefault && <span className="colls-default-tag">Default art</span>}
        </div>
      )}
      {item.category !== 'hero_skin' && !frame && !plate && art && (
        <div
          className="colls-skinart minion" aria-label={showDefault ? 'Preview, default art' : 'Preview'}
          onPointerEnter={cardSkin && onHover ? (e) => { if (e.pointerType !== 'touch') onHover(item.id, e.currentTarget, showDefault); } : undefined}
          onPointerLeave={cardSkin && onHover ? () => onHover(null) : undefined}
        >
          <img src={art} alt="" draggable={false} decoding="sync" />
          {showDefault && <span className="colls-default-tag">Default art</span>}
        </div>
      )}
      <div className="colls-plate">
        <span className="colls-gem colls-gem-lg" aria-hidden />
        <div className="colls-plate-name">{isMasterTitle(item.id) ? <TitleBadge id={item.id} className="colls-titleplate colls-titleplate-lg" /> : item.name}</div>
        <div className="colls-plate-rar">{RARITY_LABELS[item.rarity]}</div>
      </div>
      <div className="colls-facts">
        <div className="colls-fact"><span>Status</span><b className={owned ? 'yes' : 'no'}>{equipped ? 'Equipped' : owned ? 'Owned' : 'Not owned'}</b></div>
        {target && <div className="colls-fact"><span>For</span><b>{target}</b></div>}
        {showDefault && !equipped && <div className="colls-fact"><span>In use</span><b>Default art</b></div>}
        {attack && <div className="colls-fact"><span>For</span><b>Your hero, seen by the players you hit</b></div>}
        {frame && <div className="colls-fact"><span>For</span><b>Your hero portrait, seen by the players you meet</b></div>}
        {frame && showDefault && !equipped && <div className="colls-fact"><span>In use</span><b>Default frame</b></div>}
        {voice && <div className="colls-fact"><span>For</span><b>The voice calling your games. Only you hear it</b></div>}
        {plate && <div className="colls-fact"><span>For</span><b>Your cards, seen by the players you meet. Gilded cards keep their gold plate</b></div>}
        {plate && showDefault && !equipped && <div className="colls-fact"><span>In use</span><b>Standard plate</b></div>}
        {emote && <div className="colls-fact"><span>For</span><b>Your hero. {touchText('Right-click', 'Tap and hold')} your portrait in a game to say it</b></div>}
        {emote && emotePosition >= 0 && <div className="colls-fact"><span>In your menu</span><b>Slot {emotePosition + 1}</b></div>}
        {/* Owned: where it came from. Missing: the hint under the facts already says how to get it (it repeated it). */}
        {owned && <div className="colls-fact"><span>How to get</span><b>{acquisitionText(item)}</b></div>}
        {masteryText(item) && <div className="colls-fact"><span>Mastery</span><b>{masteryText(item)}</b></div>}
      </div>
      {item.category === 'title' && (
        <div className="colls-preview" aria-label="Preview">
          <div className="colls-preview-lbl">Preview</div>
          <div className="colls-preview-name">{playerName}</div>
          <div className="colls-preview-title">{isMasterTitle(item.id) ? <TitleBadge id={item.id} className="colls-titleplate" /> : item.name}</div>
        </div>
      )}
      {/* An announcer plays a sample line in place (owned or not, so you can hear what a crate might give). Each
          press plays the next sample; it goes through the Announcer volume and mute in Settings. */}
      {voice && (
        <div className="colls-preview" aria-label="Preview">
          <div className="colls-preview-lbl">Preview</div>
          <button type="button" className="colls-quiet pressable quiet colls-voice-play" onClick={() => { previewAnnouncerPack(announcerPackOf(item)); }} aria-label={`Hear a line from ${item.name}`}>Hear a line</button>
        </div>
      )}
      <div className="colls-detail-actions">
        {emote && <EmoteSlotRow item={item} owned={owned} busy={busy} slots={emoteSlots} onPlace={onPlaceEmote} />}
        {emote && owned ? null : !owned ? (
          <div className="colls-hint">{missingHint(item)}</div>
        ) : equipped ? (
          <>
            <div className="colls-worn-tag" role="status">Equipped</div>
            <button type="button" className="colls-quiet pressable quiet" disabled={busy} onClick={onTakeOff} aria-label={skin ? `Use the default art for ${target ?? 'this target'}` : attack ? 'Use the Classic hero attack' : frame ? 'Use the default portrait frame' : voice ? 'Use the default announcer' : plate ? 'Use the standard card plate' : `Take off ${item.name}`}>{skin ? 'Use default art' : attack ? 'Use Classic' : frame ? 'Use default frame' : voice ? 'Use default announcer' : plate ? 'Use standard plate' : 'Take off'}</button>
          </>
        ) : (
          <button type="button" className="cv2-btn pressable colls-equip" disabled={busy} onClick={onEquip} aria-label={`Equip ${item.name}`}>{busy ? 'Equipping' : 'Equip'}</button>
        )}
      </div>
      {error && <div className="coll-error" role="status">{error}</div>}
    </section>
  );
}

/**
 * YOUR EMOTE MENU as eight slots (owner 2026-10-15: "show the empty emote slots so it's obvious they have empty slots"),
 * drawn like the in-game menu: an emote's bubble, or the dashed empty-slot frame. With an OWNED emote selected each slot
 * is a button that puts it there (the one already holding it is ringed); otherwise the row is read-only.
 */
function EmoteSlotRow({ item, owned, busy, slots, onPlace }: {
  item: CosmeticDef; owned: boolean; busy: boolean; slots?: readonly (string | null)[]; onPlace?: (position: number) => void;
}): JSX.Element {
  const row = slots ?? Array.from({ length: EMOTE_SLOT_COUNT }, () => null);
  return (
    <div className="colls-emote-slots" role="group" aria-label="Your emote menu">
      {row.map((id, i) => {
        const art = id ? emoteSrc(id) : undefined;
        const name = id ? cosmeticOf(id)?.name ?? id : null;
        if (!owned) {
          return id
            ? <span key={i} className="emote-pick" aria-label={`Slot ${i + 1}: ${name}`}>{art && <img src={art} alt="" draggable={false} decoding="sync" />}</span>
            : <EmptyEmoteSlot key={i} position={i} />;
        }
        const here = id === item.id;
        return (
          <button
            key={i} type="button" className={`emote-pick pressable${id ? '' : ' emote-slot-empty'}${here ? ' on' : ''}`} aria-pressed={here}
            disabled={busy || here} onClick={() => onPlace?.(i)}
            aria-label={here ? `${item.name} is in slot ${i + 1}` : `Put ${item.name} in slot ${i + 1}`}
          >
            <span className="colls-emote-slot-n" aria-hidden="true">{i + 1}</span>
            {art ? <img src={art} alt="" draggable={false} decoding="sync" /> : <span className="emote-slot-empty-txt" aria-hidden="true">Empty</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A PORTRAIT FRAME's preview (owner 2026-10-01). OWNED: the frame around your current hero portrait (your avatar, else
 * the first hero), the same `HeroPortraitRing` disc every Career portrait uses, so it reads exactly as in a game; after
 * "Use default frame" it shows the default ring instead. NOT OWNED: only the ring itself, blurred, and never around a
 * portrait (owner 2026-10-01: "do not allow preview if you do not own the art").
 */
function FramePreview({ item, owned, showDefault }: { item: CosmeticDef; owned: boolean; showDefault: boolean }): JSX.Element | null {
  const avatar = useGame((s) => s.playerAvatar);
  const portrait = avatarSrc(avatar) ?? heroArt(HEROES[0]!.id);
  if (!owned) {
    const ring = frameSrc(item.id);
    return ring ? <div className="colls-skinart colls-framelocked" aria-label="Locked frame"><img src={ring} alt="" draggable={false} decoding="sync" /></div> : null;
  }
  return (
    <div className="colls-heropreview" aria-label={showDefault ? 'Preview, default frame' : 'Preview'}>
      <HeroPortraitRing art={portrait} alt="" className="colls-heroring colls-framering" frameId={showDefault ? null : item.id} />
      {showDefault && <span className="colls-default-tag">Default frame</span>}
    </div>
  );
}

// ── Card plates (2026-10-14) ───────────────────────────────────────────────────────────────────────────────

/** The card a plate preview floats: Impossible Todd, Set 2's longest-text minion, so the preview shows the plate, its
 *  darkening and the most rules text a card carries (owner 2026-10-18: "can you use impossible todd for the hover preview
 *  as well in the collection?"; it was Cheap Date). The Card Plate Editor previews the same card. */
const PLATE_SAMPLE_CARD = 'dm_todd';

/** A plate item's look (art + darkening), or null for an item this client has no art for. */
const plateLookOf = (item: CosmeticDef | null | undefined): CardPlateLook | null => {
  const key = item?.category === 'card_plate' ? item.assets.art : undefined;
  return key ? CARD_PLATE_LOOKS[key] ?? null : null;
};

// ── The crate bay (always in view) ─────────────────────────────────────────────────────────────────────────

function CrateBay({ cratesOn, loading, sealed, tier, nextLevel, guest, oddsLine, busy, onOpen, onOpenAll }: {
  cratesOn: boolean; loading: boolean; sealed: CrateQueueItem[]; nextLevel: number; guest: boolean;
  /** The chest the bay draws (see `bayTier`). */
  tier: ChestTier;
  /** The odds line's body (`crateOddsLine()` with Aether off; the first sealed crate's floor odds with it on). */
  oddsLine: string;
  /** A Crate Shop purchase is in flight: hold Open / Open all (a second theatre would replace the reveal). */
  busy: boolean;
  onOpen: () => void; onOpenAll: () => void;
}): JSX.Element {
  const n = sealed.length;
  const ready = cratesOn && !loading && n > 0;
  return (
    <section className={`colls-panel colls-bay${ready ? ' ready' : ''}`} aria-label="Sealed chests">
      <div className="colls-bay-art" aria-hidden>
        {ready && <span className="colls-hero-glow" />}
        <ChestPicture tier={tier} className="colls-bay-chest" />
        {ready && <span className="colls-hero-count">{n}</span>}
      </div>
      <div className="colls-bay-body">
        <div className="colls-bay-head">Sealed chests</div>
        {!cratesOn ? (
          <div className="colls-bay-sub">Chests are coming soon.</div>
        ) : loading ? (
          <div className="colls-bay-sub">Loading</div>
        ) : n === 0 ? (
          <div className="colls-bay-sub">None right now. Your next chest comes at Level {nextLevel}.</div>
        ) : (
          <>
            <div className="colls-bay-sub"><b>{n}</b> ready. Next: {crateLabel({ ...sealed[0]!, floor: chestFloorOf(sealed[0]!.tier) })}</div>
            {guest && <div className="colls-bay-guest">Create a free account to open them.</div>}
            <div className="colls-bay-actions">
              <button type="button" className="cv2-btn pressable colls-open" disabled={busy} onClick={onOpen} aria-label={guest ? 'Open (needs an account)' : undefined}>{guest && <LockGlyph />}Open</button>
              {n > 1 && <button type="button" className="colls-quiet pressable quiet" disabled={busy} onClick={onOpenAll}>Open all ({n})</button>}
            </div>
          </>
        )}
        {/* The published odds (owner 2026-09-29: fixed rarity odds, safe to show players). */}
        {cratesOn && <div className="colls-bay-odds">Chest odds: {oddsLine}</div>}
      </div>
    </section>
  );
}

// ── A switched-off category ────────────────────────────────────────────────────────────────────────────────

function ComingSoon({ category }: { category: CosmeticCategory }): JSX.Element {
  return (
    <div className="colls-soon">
      <div className="colls-soon-head">
        <span className="colls-soon-icon" aria-hidden><CategoryIcon category={category} /></span>
        <div>
          <div className="colls-soon-title">{COSMETIC_CATEGORY_DEFS[category].label}</div>
          <div className="colls-soon-sub">{COMING_BLURB[category]} Coming soon.</div>
        </div>
      </div>
      <ul className="colls-grid colls-grid-ghost" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => <li key={i}><span className="colls-ghost"><LockGlyph /></span></li>)}
      </ul>
    </div>
  );
}

// ── Glyphs ─────────────────────────────────────────────────────────────────────────────────────────────────

function LockGlyph(): JSX.Element {
  return <svg className="colls-lock" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1zm2 0h6V7a3 3 0 0 0-6 0v3z" /></svg>;
}

const CAT_PATHS: Readonly<Record<CosmeticCategory, string>> = {
  title: 'M5 3h14v14l-7 4-7-4V3zm3 4v2h8V7H8zm0 4v2h5v-2H8z',
  announcer: 'M3 9h4l5-4v14l-5-4H3V9zm13.5-1.5a6 6 0 0 1 0 9l-1.4-1.4a4 4 0 0 0 0-6.2l1.4-1.4z',
  hero_skin: 'M12 2a8 8 0 0 0-8 8v5a3 3 0 0 0 3 3h1v3h8v-3h1a3 3 0 0 0 3-3v-5a8 8 0 0 0-8-8zm-3 8h1.5v4H9a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1zm6 0a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-1.5v-4H15z',
  minion_skin: 'M12 13c3 0 6 2.5 6 5.5 0 1.5-1.2 2.5-2.7 2.5-1.2 0-2.1-.8-3.3-.8s-2.1.8-3.3.8C7.2 21 6 20 6 18.5 6 15.5 9 13 12 13zM5 8.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm14 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM9 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  hero_attack: 'M14 3h7v7l-3.5-1L9 17l1 3-3 1-1-3 8-8.5L14 6z',
  board: 'M3 4h18v16H3V4zm2 2v5h6V6H5zm8 0v5h6V6h-6zm-8 7v5h6v-5H5zm8 0v5h6v-5h-6z',
  music: 'M9 4l11-2v13.5a3 3 0 1 1-2-2.8V6.3l-7 1.3v9.9a3 3 0 1 1-2-2.8V4z',
  portrait_frame: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z',
  emote: 'M5 3h14a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8l-5 4v-4H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zm3 6.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm4 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  card_plate: 'M7 2h10l2 3v15l-2 2H7l-2-2V5l2-3zm1 4v6h8V6H8zm0 8v2h8v-2H8zm0 3v1h5v-1H8z',
};

function CategoryIcon({ category }: { category: CosmeticCategory }): JSX.Element {
  return <svg className="colls-caticon" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d={CAT_PATHS[category]} /></svg>;
}
