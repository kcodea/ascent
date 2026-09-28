import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, RARITY_LABELS, crateName, levelProgress,
  type CosmeticCategory, type CosmeticDef, type CosmeticRarity,
} from '@game/progression';
import { tempHandle, useGame } from '../store';
import { sfx } from '../sfx';
import { MenuSidebar, SidebarHost } from '../MenuSidebar';
import { IconChest } from '../menuIcons';
import { CrateOpener, type CrateQueueItem } from './CrateOpener';
import { cratesVisible, equipCosmetic, equipTitle, mirrorFor, refreshCrates, useProgression } from './progressionStore';
import {
  COMING_BLURB, acquisitionText, albumOf, categoryLive, collectibleItems, collectionCategories, countOf, filterAlbum, isEquipped, isNew,
  loadSeen, missingHint, ownedIds, rarityCounts, saveSeen, skinTargetName, type RarityFilter, type ShowFilter,
} from './collectionModel';
import { skinArtOf } from '../skins/skinArt';
import { HeroAttackPreview } from '../heroBlast/HeroAttackPreview';
import './collection.css';

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
 *               full-tile gold ring and a ribbon, not a corner tick (Fortnite). NEW until selected.
 *   DETAIL      the selected item large on a nameplate (Valorant's big preview), with a preview of it under your
 *               name, how it is found, and Equip / Take off.
 *   CRATE BAY   sealed crates always in view, whatever tab is open: the crate, the count, Open and Open all, and
 *               the next crate's level when none are sealed. It mounts the crate theatre (`CrateOpener`) as-is.
 *   SKINS       (2026-09-28) Heroes and Minions are live tabs. Their tiles show the skin's art (dimmed and blurred
 *               until owned, like a title's name) with the hero / minion it is for; the detail panel shows the art
 *               large, and Equip / "Use default art" wear it on that one target (Default is always selectable).
 *               A RETIRED item (the kill switch) is not in the album at all; see collectionModel.ts.
 *
 * A guest sees a slim save-progress row. Sizes are layout px (the stage scales the page on a small screen); no
 * native tooltips; buttons take the global gauntlet cursor. Tiles are memoized with primitive props; the only
 * loops are the crate's float (transform) and two glows that breathe by OPACITY over a static paint.
 */

export function CollectionScreen(): JSX.Element | null {
  const show = useGame((s) => s.showCollection);
  return show ? <CollectionPage /> : null;
}

const EMPTY: readonly string[] = [];

export function CollectionPage({ reducedMotion }: { reducedMotion?: boolean }): JSX.Element {
  const close = useGame((s) => s.closeCollection);
  const mirror = useProgression((s) => s.mirror);
  const crateList = useProgression((s) => s.crateList);
  const cratesOn = useProgression(cratesVisible);
  const anonymous = useGame((s) => s.account.anonymous);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const userId = useGame((s) => s.account.userId);
  const playerName = useGame((s) => s.playerName);
  const me = mirrorFor(userId, mirror);
  const ownedList = me ? ownedIds(me) : EMPTY;
  const owned = useMemo(() => new Set(ownedList), [ownedList]);
  // The server's kill switch can retire an item or a category while the page is open: every list re-derives.
  const catalogEpoch = useProgression((s) => s.catalogEpoch);
  const categories = useMemo(() => collectionCategories(), [catalogEpoch]);

  // Lands on Titles (the page's first and largest shelf) while it is live; else the first live category.
  const [category, setCategory] = useState<CosmeticCategory>(() => (categoryLive('title') ? 'title' : collectionCategories()[0]!));
  const [show, setShow] = useState<ShowFilter>('all');
  const [rarity, setRarity] = useState<RarityFilter>('all');
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen(userId));
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theatre, setTheatre] = useState<{ queue: CrateQueueItem[]; openAll: boolean } | null>(null);

  useEffect(() => { void refreshCrates(); }, []);
  useEffect(() => { setSeen(loadSeen(userId)); }, [userId]);

  const sealed: CrateQueueItem[] = useMemo(
    () => (crateList ?? []).filter((c) => c.state === 'sealed').map((c) => ({ crateId: c.crateId, earnedLevel: c.earnedLevel })),
    [crateList],
  );

  const everything = useMemo(() => collectibleItems(), [catalogEpoch]);
  const total = useMemo(() => countOf(everything, owned), [everything, owned]);
  const album = useMemo(() => albumOf(category), [category, catalogEpoch]);
  const wornId = album.find((c) => isEquipped(c, me))?.id ?? null;
  const shown = useMemo(() => filterAlbum(album, owned, show, rarity), [album, owned, show, rarity]);
  const byRarity = useMemo(() => rarityCounts(album, owned), [album, owned]);
  const albumCount = useMemo(() => countOf(album, owned), [album, owned]);

  // The selected item: the one you picked, else what you wear, else your first owned item, else the album's first.
  // Only a PICK clears NEW (Fortnite's "clears on view"): a default selection never does, so opening the page
  // never wipes the badges before you have looked.
  const selectedId = picked && album.some((c) => c.id === picked) ? picked
    : wornId
    ?? album.find((c) => owned.has(c.id))?.id ?? album[0]?.id ?? null;
  const selected = album.find((c) => c.id === selectedId) ?? null;

  const markSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveSeen(userId, next);
      return next;
    });
  }, [userId]);

  const onPick = useCallback((id: string) => {
    sfx.pulse();
    setPicked(id);
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
    const ok = attack
      ? await equipCosmetic('hero_attack', '', on ? item.id : null)
      : skin && item.target
      ? await equipCosmetic(item.category as 'hero_skin' | 'minion_skin', item.target.id, on ? item.id : null)
      : await equipTitle(on ? item.id : null);
    setBusy(false);
    if (!ok) setError(attack ? 'Could not change your hero attack. Try again.' : skin ? 'Could not change your skin. Try again.' : 'Could not change your title. Try again.');
  };

  const begin = (openAll: boolean): void => {
    if (!sealed.length) return;
    sfx.pulse();
    setTheatre({ queue: [...sealed], openAll });
  };

  const pickCategory = (c: CosmeticCategory): void => { sfx.pulse(); setCategory(c); setPicked(null); setError(null); };
  const back = (): void => { sfx.pulse(); close(); };
  const lp = levelProgress(me?.accountXp ?? 0);
  const name = playerName || tempHandle(userId);
  const live = categoryLive(category);
  const newIn = (c: CosmeticCategory): number => albumOf(c).filter((i) => isNew(i.id, owned, seen)).length;

  return (
    <SidebarHost className={`lbpage colls-page${reducedMotion ? ' colls-still' : ''}`}>
      <MenuSidebar current="collection" onBack={back} />
      <div className="lbtopbar colls-top">
        <div className="lbtitle">
          <IconChest />
          <div>
            <div className="esch disp">Collection</div>
            <div className="lbsub">Find, view and wear what you have earned</div>
          </div>
        </div>
        <div className="colls-meters">
          <div className="colls-meter" role="group" aria-label={`${total.owned} of ${total.total} collected`}>
            <div className="colls-meter-num"><b>{total.owned}</b> / {total.total}</div>
            <div className="colls-meter-lbl">Collected</div>
            <div className="colls-bar" aria-hidden><div className="colls-bar-fill" style={{ transform: `scaleX(${total.total ? total.owned / total.total : 0})` }} /></div>
          </div>
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
              const cnt = on ? countOf(albumOf(c), owned) : null;
              const fresh = on ? newIn(c) : 0;
              return (
                <button
                  key={c} type="button" role="tab" aria-selected={category === c}
                  className={`colls-tab${category === c ? ' on' : ''}${on ? '' : ' locked'}`}
                  aria-label={on ? `${COSMETIC_CATEGORY_DEFS[c].label}, ${cnt!.owned} of ${cnt!.total}${fresh ? `, ${fresh} new` : ''}` : `${COSMETIC_CATEGORY_DEFS[c].label}, coming soon`}
                  onClick={() => pickCategory(c)}
                >
                  <CategoryIcon category={c} />
                  <span className="colls-tab-name">{COSMETIC_CATEGORY_DEFS[c].label}</span>
                  {on ? <span className="colls-tab-count">{cnt!.owned}/{cnt!.total}</span> : <span className="colls-tab-soon"><LockGlyph />Soon</span>}
                  {fresh > 0 && <span className="colls-tab-new" aria-hidden>{fresh}</span>}
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

              <div className="colls-gridwrap">
                {shown.length === 0 ? (
                  <div className="colls-nomatch">
                    <div>{show === 'owned' && albumCount.owned === 0 ? 'You have none yet. Open a crate to find one.' : show === 'missing' && albumCount.owned === albumCount.total ? 'You have them all.' : 'Nothing matches these filters.'}</div>
                    <button type="button" className="colls-quiet pressable quiet" onClick={() => { sfx.pulse(); setShow('all'); setRarity('all'); }}>Show all</button>
                  </div>
                ) : (
                  <ul className="colls-grid" aria-label={`${COSMETIC_CATEGORY_DEFS[category].label}`}>
                    {shown.map((c) => (
                      <li key={c.id}>
                        <ItemTile
                          id={c.id} name={c.name} rarity={c.rarity} art={skinArtOf(c)} target={skinTargetName(c) ?? undefined}
                          owned={owned.has(c.id)} equipped={isEquipped(c, me)} fresh={isNew(c.id, owned, seen)} selected={selectedId === c.id}
                          onPick={onPick}
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
          <CrateBay
            cratesOn={cratesOn} loading={crateList === null} sealed={sealed} nextLevel={lp.level + 1}
            onOpen={() => begin(false)} onOpenAll={() => begin(true)}
          />
          {live && selected && (
            <DetailPanel
              item={selected} owned={owned.has(selected.id)} equipped={isEquipped(selected, me)} busy={busy} error={error} playerName={name}
              reducedMotion={reducedMotion}
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

      {theatre && (
        <CrateOpener
          queue={theatre.queue}
          autoOpen
          openAll={theatre.openAll}
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
  /** A skin's art (its tile shows it, dimmed and blurred until owned). Undefined for a title, or a missing file. */
  art?: string;
  /** A skin's hero / minion, by name. */
  target?: string;
}

const ItemTile = memo(function ItemTile({ id, name, rarity, owned, equipped, fresh, selected, onPick, art, target }: TileProps): JSX.Element {
  const state = equipped ? 'equipped' : owned ? 'owned' : 'not owned';
  return (
    <button
      type="button"
      className={`colls-tile r-${rarity}${owned ? ' owned' : ' missing'}${equipped ? ' worn' : ''}${selected ? ' sel' : ''}${fresh ? ' fresh' : ''}${art ? ' skin' : ''}`}
      aria-pressed={selected}
      aria-label={`${name}${target ? `, for ${target}` : ''}, ${RARITY_LABELS[rarity]}, ${state}${fresh ? ', new' : ''}`}
      onClick={() => onPick(id)}
    >
      {art && <img className="colls-tile-art" src={art} alt="" draggable={false} decoding="sync" />}
      {target && <span className="colls-tile-for">{target}</span>}
      <span className="colls-tile-top">
        <span className="colls-gem" aria-hidden />
        <span className="colls-tile-rar">{RARITY_LABELS[rarity]}</span>
      </span>
      <span className="colls-tile-name">{name}</span>
      {!owned && <span className="colls-tile-lock" aria-hidden><LockGlyph /></span>}
      {fresh && <span className="colls-new" aria-hidden>New</span>}
      {equipped && <span className="colls-tile-ribbon" aria-hidden>Equipped</span>}
    </button>
  );
});

// ── The detail panel ───────────────────────────────────────────────────────────────────────────────────────

function DetailPanel({ item, owned, equipped, busy, error, playerName, reducedMotion, onEquip, onTakeOff }: {
  item: CosmeticDef; owned: boolean; equipped: boolean; busy: boolean; error: string | null; playerName: string; reducedMotion?: boolean; onEquip: () => void; onTakeOff: () => void;
}): JSX.Element {
  const art = skinArtOf(item);
  const target = skinTargetName(item);
  const skin = item.category === 'hero_skin' || item.category === 'minion_skin';
  const attack = item.category === 'hero_attack';
  return (
    <section className={`colls-panel colls-detail r-${item.rarity}${owned ? '' : ' missing'}${skin ? ' skin' : ''}`} aria-label="Details">
      <div className="colls-kicker">{skin ? (item.category === 'hero_skin' ? 'Hero skin' : 'Minion skin') : attack ? 'Hero attack' : COSMETIC_CATEGORY_DEFS[item.category].label.replace(/s$/, '')}</div>
      {/* A hero attack plays in place (the Blast tuner's own runner, in a sandbox box): owned or not, so you can
          see what a crate might give. Keyed by item so switching items starts a fresh stage. */}
      {attack && <HeroAttackPreview key={item.id} style={typeof item.assets.style === 'string' ? item.assets.style : ''} reducedMotion={reducedMotion} />}
      {/* A skin's art, large (Valorant's big preview). Missing items stay blurred, like a title's name. */}
      {art && (
        <div className={`colls-skinart${item.category === 'hero_skin' ? ' hero' : ' minion'}`} aria-label="Preview">
          <img src={art} alt="" draggable={false} decoding="sync" />
        </div>
      )}
      <div className="colls-plate">
        <span className="colls-gem colls-gem-lg" aria-hidden />
        <div className="colls-plate-name">{item.name}</div>
        <div className="colls-plate-rar">{RARITY_LABELS[item.rarity]}</div>
      </div>
      <div className="colls-facts">
        <div className="colls-fact"><span>Status</span><b className={owned ? 'yes' : 'no'}>{equipped ? 'Equipped' : owned ? 'Owned' : 'Not owned'}</b></div>
        {target && <div className="colls-fact"><span>For</span><b>{target}</b></div>}
        {attack && <div className="colls-fact"><span>For</span><b>Your hero, seen by the players you hit</b></div>}
        <div className="colls-fact"><span>How to get</span><b>{acquisitionText(item)}</b></div>
      </div>
      {item.category === 'title' && (
        <div className="colls-preview" aria-label="Preview">
          <div className="colls-preview-lbl">Preview</div>
          <div className="colls-preview-name">{playerName}</div>
          <div className="colls-preview-title">{item.name}</div>
        </div>
      )}
      <div className="colls-detail-actions">
        {!owned ? (
          <div className="colls-hint">{missingHint(item)}</div>
        ) : equipped ? (
          <>
            <div className="colls-worn-tag" role="status">Equipped</div>
            <button type="button" className="colls-quiet pressable quiet" disabled={busy} onClick={onTakeOff} aria-label={skin ? `Use the default art for ${target ?? 'this target'}` : attack ? 'Use the Classic hero attack' : `Take off ${item.name}`}>{skin ? 'Use default art' : attack ? 'Use Classic' : 'Take off'}</button>
          </>
        ) : (
          <button type="button" className="cv2-btn pressable colls-equip" disabled={busy} onClick={onEquip} aria-label={`Equip ${item.name}`}>{busy ? 'Equipping' : 'Equip'}</button>
        )}
      </div>
      {error && <div className="coll-error" role="status">{error}</div>}
    </section>
  );
}

// ── The crate bay (always in view) ─────────────────────────────────────────────────────────────────────────

function CrateBay({ cratesOn, loading, sealed, nextLevel, onOpen, onOpenAll }: {
  cratesOn: boolean; loading: boolean; sealed: CrateQueueItem[]; nextLevel: number; onOpen: () => void; onOpenAll: () => void;
}): JSX.Element {
  const n = sealed.length;
  const ready = cratesOn && !loading && n > 0;
  return (
    <section className={`colls-panel colls-bay${ready ? ' ready' : ''}`} aria-label="Sealed crates">
      <div className="colls-bay-art" aria-hidden>
        {ready && <span className="colls-hero-glow" />}
        <span className="colls-crate" />
        {ready && <span className="colls-hero-count">{n}</span>}
      </div>
      <div className="colls-bay-body">
        <div className="colls-bay-head">Sealed crates</div>
        {!cratesOn ? (
          <div className="colls-bay-sub">Crates are coming soon.</div>
        ) : loading ? (
          <div className="colls-bay-sub">Loading</div>
        ) : n === 0 ? (
          <div className="colls-bay-sub">None right now. Your next crate comes at Level {nextLevel}.</div>
        ) : (
          <>
            <div className="colls-bay-sub"><b>{n}</b> ready. Next: {crateName(sealed[0]!.earnedLevel)}</div>
            <div className="colls-bay-actions">
              <button type="button" className="cv2-btn pressable colls-open" onClick={onOpen}>Open</button>
              {n > 1 && <button type="button" className="colls-quiet pressable quiet" onClick={onOpenAll}>Open all ({n})</button>}
            </div>
          </>
        )}
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
};

function CategoryIcon({ category }: { category: CosmeticCategory }): JSX.Element {
  return <svg className="colls-caticon" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d={CAT_PATHS[category]} /></svg>;
}
