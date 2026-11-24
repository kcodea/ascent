import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RARITY_LABELS, cardPlateOf, cosmeticOf, withStarterCosmetics, type CosmeticCategory, type CosmeticDef, type CosmeticRarity } from '@game/progression';
import { tempHandle, useGame } from '../store';
import { stageHost } from '../stage';
import { avatarSrc } from '../art';
import { PhButton, PhTabs } from '../partyHome/kit';
import { PhShowcaseCard } from '../partyHome/kit/PhShowcaseCard';
import { usePhLayer } from '../partyHome/shell/usePhLayer';
import { AvatarTabBody, usePortraitEntries } from '../AvatarPicker';
import { equipCosmetic, equipTitle, mirrorFor, useProgression } from '../progression/progressionStore';
import { albumOf, ownedIds } from '../progression/collectionModel';
import { PLATE_SAMPLE_CARD, plateLookOf } from '../progression/CollectionScreen';
import { InlinePlateCard } from '../progression/SkinCardPreview';
import { useOwnPortraitFrameId } from '../portraitFrame/PortraitFrame';
import { frameSrc } from '../portraitFrame/portraitFrameConfig';
import { TitleBadge } from '../titles/TitleBadge';
import { useCurrentRank } from '../rank/rankSource';
import { playerCardArt } from '../versus/versusSeatCard';
import { applyPending, changedKeys, type CosmeticsTab, type Loadout4, type Loadout4Savers } from './cosmeticsPending';
import '../avatarPicker.css';
import './cosmeticsWindow.css';

/**
 * THE COSMETICS WINDOW (showcase player card, PR 3 Task 6; spec "The cosmetics window"): one window, four tabs, for the
 * four things your player card wears: Avatar · Frame · Title · Card plate. It replaces the portrait window: every path that
 * opened that (`openAvatarPicker`) opens this on the Avatar tab; `openCosmetics(tab)` opens it on any tab.
 *
 *   PENDING   the window edits ONE pending copy of all four, seeded from what you wear (`cosmeticsPending.ts`). Switching
 *             tabs keeps it, so you can change a frame and a title and save both with one "Use".
 *   TILES     owned only; the item in use wears "In use"; the rarity is the edge colour. A press SELECTS; a double press
 *             selects, applies and closes. The default of each slot (default ring, "No title", the standard plate) is a
 *             tile too, and maps to null.
 *   SIDE      the selection's name, a live preview (Avatar / Title: your showcase card wearing it; Frame: the ring alone,
 *             large; Card plate: the sample card on the plate), "Use" (on when anything changed) and "Reset to default"
 *             (sets the CURRENT tab back to its default). A failed save says so and the window stays open.
 *
 * Esc closes (usePhLayer + a capture-phase key listener, as the portrait window). Guests see nothing (the portrait sign-in
 * gate stays the only path). Static paint; the only motion is one-shot transforms.
 */

const TABS: readonly { id: CosmeticsTab; name: string }[] = [
  { id: 'avatar', name: 'Avatar' }, { id: 'frame', name: 'Frame' }, { id: 'title', name: 'Title' }, { id: 'plate', name: 'Card plate' },
];

const CATEGORY: Record<Exclude<CosmeticsTab, 'avatar'>, CosmeticCategory> = { frame: 'portrait_frame', title: 'title', plate: 'card_plate' };

/** Collection's own copy for a failed save, per slot. */
const SAVE_ERROR: Record<keyof Loadout4, string> = {
  avatar: 'Could not change your portrait. Try again.',
  frame: 'Could not change your portrait frame. Try again.',
  title: 'Could not change your title. Try again.',
  plate: 'Could not change your card plate. Try again.',
};

const DEFAULT_NAME: Record<CosmeticsTab, string> = { avatar: 'Default', frame: 'Default frame', title: 'No title', plate: 'Standard plate' };
const KIND: Record<CosmeticsTab, string> = { avatar: 'Portrait', frame: 'Portrait frame', title: 'Title', plate: 'Card plate' };

const SAVERS: Loadout4Savers = {
  avatar: (id) => useGame.getState().setPlayerAvatar(id),
  frame: (id) => equipCosmetic('portrait_frame', '', id),
  title: (id) => equipTitle(id),
  plate: (id) => equipCosmetic('card_plate', '', id),
};

const EMPTY: readonly string[] = [];

const tabLabel = (name: string, n: number): JSX.Element => <><span className="cw-tabname">{name}</span><span className="avp-n">{n}</span></>;

export function CosmeticsWindow() {
  const open = useGame((s) => s.avatarPickerOpen);
  // Only on the Title and Career surfaces, never over gameplay (the same defensive gate as the portrait window).
  const onTitle = useGame((s) => s.showTitle);
  const onCareer = useGame((s) => s.showCareer);
  // Guests cannot change their cosmetics (owner 2026-09-29): render nothing, so no path opens it around the sign-in gate.
  const anonymous = useGame((s) => s.account.anonymous);
  if (!open || !(onTitle || onCareer) || anonymous) return null;
  return createPortal(<CosmeticsDialog />, stageHost());
}

/** What you wear now, as one Loadout4 (primitives only, so it is stable between renders). */
function useLiveLoadout4(): Loadout4 {
  const userId = useGame((s) => s.account.userId);
  const avatar = useGame((s) => s.playerAvatar);
  const frame = useOwnPortraitFrameId();
  const title = useProgression((s) => mirrorFor(userId, s.mirror)?.equippedTitleId ?? null);
  const plate = useProgression((s) => (s.catalogEpoch >= 0 ? cardPlateOf(mirrorFor(userId, s.mirror)?.loadout)?.id ?? null : null));
  return useMemo(() => ({ avatar, frame, title, plate }), [avatar, frame, title, plate]);
}

/** The owned items of each non-avatar tab, in album order (rarest first). */
function useOwnedAlbums(): Record<Exclude<CosmeticsTab, 'avatar'>, CosmeticDef[]> {
  const userId = useGame((s) => s.account.userId);
  const mirror = useProgression((s) => s.mirror);
  const catalogEpoch = useProgression((s) => s.catalogEpoch);
  const me = mirrorFor(userId, mirror);
  return useMemo(() => {
    const owned = new Set(withStarterCosmetics(me ? ownedIds(me) : EMPTY));
    const of = (cat: CosmeticCategory): CosmeticDef[] => albumOf(cat, undefined, owned).filter((c) => owned.has(c.id));
    return { frame: of(CATEGORY.frame), title: of(CATEGORY.title), plate: of(CATEGORY.plate) };
  }, [me, catalogEpoch]);
}

function CosmeticsDialog() {
  const close = useGame((s) => s.closeAvatarPicker);
  const tab = useGame((s) => s.cosmeticsTab);
  const openCosmetics = useGame((s) => s.openCosmetics);
  const now = useLiveLoadout4();
  const albums = useOwnedAlbums();
  const { all: portraits, byId } = usePortraitEntries();

  const [pending, setPending] = useState<Loadout4>(now);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePhLayer(true, close);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // An open filter list (the Avatar tab) takes Esc first; the window stays.
      if (e.key !== 'Escape' || document.querySelector('.phk-selectlayer')) return;
      e.preventDefault(); e.stopImmediatePropagation(); close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  const apply = useCallback(async (next: Loadout4): Promise<void> => {
    setBusy(true);
    setError(null);
    const failed = await applyPending(now, next, SAVERS);
    setBusy(false);
    if (failed.length === 0) { close(); return; }
    setError(failed.map((k) => SAVE_ERROR[k]).join(' '));
  }, [now, close]);

  /** Select `id` for `key` (one press). */
  const select = useCallback((key: keyof Loadout4, id: string | null): void => setPending((p) => ({ ...p, [key]: id })), []);
  /** Select and apply at once (a double press). */
  const selectApply = useCallback((key: keyof Loadout4, id: string | null): void => {
    const next = { ...pendingRef.current, [key]: id };
    pendingRef.current = next;
    setPending(next);
    void apply(next);
  }, [apply]);

  const pickAvatar = useCallback((id: string) => select('avatar', id), [select]);
  const applyAvatar = useCallback((id: string) => selectApply('avatar', id), [selectApply]);
  const pickItem = useCallback((id: string | null) => { if (tab !== 'avatar') select(tab, id); }, [select, tab]);
  const applyItem = useCallback((id: string | null) => { if (tab !== 'avatar') selectApply(tab, id); }, [selectApply, tab]);

  const changed = changedKeys(now, pending).length > 0;
  const portraitCount = Object.values(portraits).reduce((n, rows) => n + rows.length, 0);
  const counts: Record<CosmeticsTab, number> = { avatar: portraitCount, frame: albums.frame.length, title: albums.title.length, plate: albums.plate.length };

  // The selection on this tab: its name and rarity line.
  const selId = pending[tab];
  const selItem = tab === 'avatar' ? null : cosmeticOf(selId);
  const selAvatar = tab === 'avatar' && selId ? byId.get(selId) : undefined;
  const selName = !selId ? DEFAULT_NAME[tab] : tab === 'avatar' ? selAvatar?.name ?? 'Portrait' : selItem?.name ?? selId;
  const selRarity: CosmeticRarity | undefined = tab === 'avatar' ? selAvatar?.rarity : selItem?.rarity;
  const selSub = !selId ? (tab === 'avatar' ? 'No picture' : '') : tab === 'avatar' ? selAvatar?.sub ?? '' : KIND[tab];

  const side = (
    <div className="cw-side">
      <div className="cw-picked" aria-live="polite">
        <div className="cw-name">{selName}</div>
        <div className={`cw-sub${selRarity ? ` r-${selRarity}` : ''}`}>
          {selRarity && <span className="cw-rarname">{RARITY_LABELS[selRarity]}</span>}
          <span>{selSub}</span>
        </div>
      </div>
      <div className="cw-preview" aria-hidden="true" {...{ inert: '' }}>
        <Preview tab={tab} pending={pending} />
      </div>
      <div className="cw-actions">
        {error && <div className="cw-error" role="alert">{error}</div>}
        <PhButton variant="primary" size="l" className="cw-use" disabled={!changed || busy} onClick={() => { void apply(pending); }}>{changed ? 'Use' : 'In use'}</PhButton>
        <PhButton variant="ghost" size="s" className="cw-reset" disabled={selId === null || busy} onClick={() => select(tab, null)}>Reset to default</PhButton>
      </div>
    </div>
  );

  return (
    <div className="phk-dialog ph-tokens avp cw" role="dialog" aria-modal="true" aria-label="Customize your card">
      <div className="phk-veil" aria-hidden="true" onClick={() => {
        const el = document.activeElement;
        if (el instanceof HTMLInputElement) { el.blur(); return; }
        close();
      }} />
      <div className="avp-box cw-box">
        <header className="avp-head">
          <div className="avp-titles">
            <span className="phk-eyebrow">Profile</span>
            <h2 className="avp-title">Customize your card</h2>
          </div>
          <PhButton variant="ghost" size="s" className="avp-close" aria-label="Close" onClick={close}>✕</PhButton>
        </header>
        <div className="cw-tabs">
          <PhTabs<CosmeticsTab> label="Cosmetic" value={tab} onChange={(t) => openCosmetics(t)}
            tabs={TABS.map((t) => ({ id: t.id, label: tabLabel(t.name, counts[t.id]) }))} />
        </div>
        <div className="avp-body cw-body">
          {tab === 'avatar'
            ? <AvatarTabBody selected={pending.avatar} onSelect={pickAvatar} onApply={applyAvatar} side={side} />
            : <>
                <div className="avp-left">
                  <div className="avp-main">
                    <div className="avp-scroll cw-scroll">
                      <div className={`cw-grid cw-grid-${tab}`}>
                        <ItemTile tab={tab} item={null} on={pending[tab] === null} used={now[tab] === null} onPick={pickItem} onApply={applyItem} />
                        {albums[tab].map((c) => (
                          <ItemTile key={c.id} tab={tab} item={c} on={pending[tab] === c.id} used={now[tab] === c.id} onPick={pickItem} onApply={applyItem} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <aside className="avp-side">{side}</aside>
              </>}
        </div>
      </div>
    </div>
  );
}

/** The side preview for the current tab, wearing the pending values. */
function Preview({ tab, pending }: { tab: CosmeticsTab; pending: Loadout4 }): JSX.Element | null {
  const userId = useGame((s) => s.account.userId);
  const playerName = useGame((s) => s.playerName);
  const rank = useCurrentRank();
  const rankD = rank?.divisionIndex;
  const rankP = rank?.points;
  const stableRank = useMemo(() => (rankD !== undefined && rankP !== undefined ? { divisionIndex: rankD, points: rankP } : null), [rankD, rankP]);
  if (tab === 'frame') {
    const ring = frameSrc(pending.frame ?? 'default');
    return <div className="cw-ringbig">{ring && <img src={ring} alt="" draggable={false} decoding="sync" />}</div>;
  }
  if (tab === 'plate') {
    return <div className="cw-platecard"><InlinePlateCard cardId={PLATE_SAMPLE_CARD} plate={plateLookOf(cosmeticOf(pending.plate))} /></div>;
  }
  const art = playerCardArt({ avatar: pending.avatar, favoriteHero: null, cosmetics: null }) ?? avatarSrc(pending.avatar);
  return (
    <div className="cw-cardwrap">
      <PhShowcaseCard size="full" label="Your card, preview" name={playerName || tempHandle(userId)} titleId={pending.title} art={art} rank={stableRank} mine />
    </div>
  );
}

/** One tile on the Frame / Title / Card plate tabs. `item` null is the slot's default. Memoised; its callbacks are stable. */
const ItemTile = memo(function ItemTile({ tab, item, on, used, onPick, onApply }: {
  tab: Exclude<CosmeticsTab, 'avatar'>; item: CosmeticDef | null; on: boolean; used: boolean;
  onPick: (id: string | null) => void; onApply: (id: string | null) => void;
}) {
  const id = item?.id ?? null;
  const name = item?.name ?? DEFAULT_NAME[tab];
  let face: ReactNode;
  if (tab === 'frame') {
    const ring = frameSrc(id ?? 'default');
    face = <span className="cw-frame">{ring && <img src={ring} alt="" draggable={false} decoding="sync" loading="lazy" />}</span>;
  } else if (tab === 'title') {
    face = <span className="cw-titleface">{id ? <TitleBadge id={id} item /> : <span className="cw-notitle">No title</span>}</span>;
  } else {
    const thumb = plateLookOf(item)?.thumb;
    face = <span className="cw-plate">{thumb ? <img src={thumb} alt="" draggable={false} decoding="sync" loading="lazy" /> : <span className="cw-plainplate">Standard</span>}</span>;
  }
  return (
    <button type="button" data-id={id ?? ''}
      className={`cw-tile cw-tile-${tab}${on ? ' on' : ''}${used ? ' used' : ''}${item ? ` r-${item.rarity}` : ''}`}
      aria-pressed={on} aria-label={`${name}${item ? `, ${RARITY_LABELS[item.rarity]}` : ''}${used ? ', in use' : ''}`}
      onClick={() => onPick(id)} onDoubleClick={() => onApply(id)}>
      {face}
      {used && <span className="cw-used" aria-hidden="true">In use</span>}
    </button>
  );
});
