import { useEffect, useMemo, useRef, useState } from 'react';
import { COSMETICS, COSMETIC_CATEGORY_DEFS, RARITY_LABELS, cosmeticOf, titleName } from '@game/progression';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { CrateOpener, type CrateQueueItem } from './CrateOpener';
import { equipTitle, mirrorFor, refreshCrates, useProgression } from './progressionStore';

/**
 * THE COLLECTION (2026-09-28; handoff §9.4, titles only for now): your sealed crates (open them here, one reveal
 * at a time, never forced) and the titles you own, with the equip control. Opened from the Account Level card on
 * your own Career. Every change goes through the server (`progression-inventory`): the equip button asks, the
 * server checks ownership, and the profile it returns updates the Career at once.
 *
 * Only ENABLED categories are listed (titles today); the other sections appear when their category is switched
 * on in the catalog. Escape or the close button dismisses it. Buttons take the global gauntlet cursor.
 */

/** Every title the catalog can give today (level milestones + crate titles), for the "found" count. */
const ALL_TITLES = COSMETICS.filter((c) => c.category === 'title' && c.active && COSMETIC_CATEGORY_DEFS.title.enabled);

export function CollectionPanel({ onClose, reducedMotion }: { onClose: () => void; reducedMotion?: boolean }): JSX.Element {
  const mirror = useProgression((s) => s.mirror);
  const crateList = useProgression((s) => s.crateList);
  const anonymous = useGame((s) => s.account.anonymous);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const userId = useGame((s) => s.account.userId);
  const me = mirrorFor(userId, mirror);
  const owned = me?.titles ?? [];
  const equipped = me?.equippedTitleId ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { void refreshCrates(); closeRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // The sealed crates, oldest first. Frozen as the opener's queue once the first opening starts, so the crate
  // being revealed stays on show (even the last one) while the list itself updates underneath.
  const sealed: CrateQueueItem[] = useMemo(
    () => (crateList ?? []).filter((c) => c.state === 'sealed').map((c) => ({ crateId: c.crateId, earnedLevel: c.earnedLevel })),
    [crateList],
  );
  const [queue, setQueue] = useState<CrateQueueItem[] | null>(null);
  const openerQueue = queue ?? sealed;

  const onEquip = async (id: string | null): Promise<void> => {
    sfx.pulse();
    setBusy(id ?? 'none');
    setError(null);
    const ok = await equipTitle(id);
    setBusy(null);
    if (!ok) setError('Could not change your title. Try again.');
  };

  const titles = owned.map((id) => ({ id, def: cosmeticOf(id) })).filter((t) => t.def);

  return (
    <div className="coll-scrim" role="dialog" aria-modal="true" aria-label="Collection" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="coll-box">
        <div className="coll-head">
          <span className="coll-title">Collection</span>
          <button ref={closeRef} type="button" className="coll-close pressable" aria-label="Close" onClick={() => { sfx.pulse(); onClose(); }}>✕</button>
        </div>

        <section className="coll-sec" aria-label="Crates">
          <div className="coll-sec-head">
            <span>Crates</span>
            <span className="coll-count">{crateList === null ? '' : sealed.length === 1 ? '1 sealed' : `${sealed.length} sealed`}</span>
          </div>
          {crateList === null && <div className="coll-empty">Loading</div>}
          {crateList !== null && openerQueue.length === 0 && (
            <div className="coll-empty">No sealed crates. You earn one every time you level up.</div>
          )}
          {openerQueue.length > 0 && (
            <CrateOpener queue={openerQueue} reducedMotion={reducedMotion} onStart={() => setQueue((q) => q ?? sealed)} />
          )}
        </section>

        <section className="coll-sec" aria-label="Titles">
          <div className="coll-sec-head">
            <span>Titles</span>
            <span className="coll-count">{titles.length} of {ALL_TITLES.length} found</span>
          </div>
          {titles.length === 0 ? (
            <div className="coll-empty">No titles yet. Open a crate or reach Level 2.</div>
          ) : (
            <ul className="coll-titles">
              {titles.map(({ id, def }) => (
                <li key={id} className={`coll-titlerow r-${def!.rarity}${equipped === id ? ' worn' : ''}`}>
                  <span className="coll-titlename">{def!.name}</span>
                  <span className="coll-rarity">{RARITY_LABELS[def!.rarity]}</span>
                  {equipped === id ? (
                    <button type="button" className="coll-equip worn pressable" disabled={busy !== null} onClick={() => { void onEquip(null); }} aria-label={`Take off ${def!.name}`}>
                      Equipped
                    </button>
                  ) : (
                    <button type="button" className="coll-equip pressable" disabled={busy !== null} onClick={() => { void onEquip(id); }} aria-label={`Equip ${def!.name}`}>
                      {busy === id ? 'Equipping' : 'Equip'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && <div className="coll-error" role="status">{error}</div>}
          {equipped && titleName(equipped) && <div className="coll-hint">Click Equipped to take your title off.</div>}
        </section>

        {anonymous && (
          <div className="coll-save">
            <span>Playing as a guest. Create an account to keep your crates and titles.</span>
            <button type="button" className="cv2-btn cv2-btn-sm pressable" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Create account</button>
          </div>
        )}
      </div>
    </div>
  );
}
