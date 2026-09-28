import { useEffect, useMemo, useState } from 'react';
import { COSMETICS, COSMETIC_CATEGORY_DEFS, RARITY_LABELS, cosmeticOf, crateName, titleName } from '@game/progression';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { MenuSidebar, SidebarHost } from '../MenuSidebar';
import { IconChest } from '../menuIcons';
import { CrateOpener, type CrateQueueItem } from './CrateOpener';
import { cratesVisible, equipTitle, mirrorFor, refreshCrates, useProgression } from './progressionStore';
import './collection.css';

/**
 * THE COLLECTION SCREEN (owner ask 2026-09-28: "make the collection screen separate"). A ladder page of its own,
 * a sibling of Career in the menu sidebar's idiom, reached from the title's Collection plaque, the sidebar, and
 * the Account Level card on your Career. It replaced the modal that used to open over the Career page.
 *
 *   CRATES   the sealed crates, oldest first: Open (the next one) and Open all. Either starts the crate theatre
 *            (`CrateOpener`, the Pixi opening) at once; the queue is frozen at the click so the list can update
 *            underneath while the reveals play.
 *   TITLES   every title you own, its rarity, and Equip (through the server, which checks ownership).
 *   COMING   the catalog's other categories, switched off today, as a quiet "coming soon" strip.
 *
 * A guest sees the save-progress prompt. Before the crates switch is on (the migration), the crate panel says so
 * and the titles still show. Sizes are layout px (the stage scales the whole page on a small screen). No native
 * tooltips; buttons take the global gauntlet cursor.
 */

/** Every title the catalog can give today (level milestones + crate titles), for the "found" count. */
const ALL_TITLES = COSMETICS.filter((c) => c.category === 'title' && c.active && COSMETIC_CATEGORY_DEFS.title.enabled);
/** The categories still switched off: the "coming soon" strip. */
const COMING = Object.values(COSMETIC_CATEGORY_DEFS).filter((d) => !d.enabled);

export function CollectionScreen(): JSX.Element | null {
  const show = useGame((s) => s.showCollection);
  return show ? <CollectionPage /> : null;
}

export function CollectionPage({ reducedMotion }: { reducedMotion?: boolean }): JSX.Element {
  const close = useGame((s) => s.closeCollection);
  const mirror = useProgression((s) => s.mirror);
  const crateList = useProgression((s) => s.crateList);
  const cratesOn = useProgression(cratesVisible);
  const anonymous = useGame((s) => s.account.anonymous);
  const openAccountPanel = useGame((s) => s.openAccountPanel);
  const userId = useGame((s) => s.account.userId);
  const me = mirrorFor(userId, mirror);
  const owned = me?.titles ?? [];
  const equipped = me?.equippedTitleId ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theatre, setTheatre] = useState<{ queue: CrateQueueItem[]; openAll: boolean } | null>(null);

  useEffect(() => { void refreshCrates(); }, []);

  const sealed: CrateQueueItem[] = useMemo(
    () => (crateList ?? []).filter((c) => c.state === 'sealed').map((c) => ({ crateId: c.crateId, earnedLevel: c.earnedLevel })),
    [crateList],
  );

  const onEquip = async (id: string | null): Promise<void> => {
    sfx.pulse();
    setBusy(id ?? 'none');
    setError(null);
    const ok = await equipTitle(id);
    setBusy(null);
    if (!ok) setError('Could not change your title. Try again.');
  };

  const begin = (openAll: boolean): void => {
    if (!sealed.length) return;
    sfx.pulse();
    setTheatre({ queue: [...sealed], openAll });
  };

  const titles = owned.map((id) => ({ id, def: cosmeticOf(id) })).filter((t) => t.def);
  const back = (): void => { sfx.pulse(); close(); };

  return (
    <SidebarHost className="lbpage colls-page">
      <MenuSidebar current="collection" onBack={back} />
      <div className="lbtopbar">
        <div className="lbtitle">
          <IconChest />
          <div>
            <div className="esch disp">Collection</div>
            <div className="lbsub">Open your crates and wear your titles</div>
          </div>
        </div>
      </div>

      <div className="lbscroll colls-scroll">
        <div className="colls-grid">
          <section className="colls-panel colls-crates" aria-label="Crates">
            <div className="coll-sec-head">
              <span>Crates</span>
              <span className="coll-count">{!cratesOn || crateList === null ? '' : sealed.length === 1 ? '1 sealed' : `${sealed.length} sealed`}</span>
            </div>
            {!cratesOn ? (
              <div className="coll-empty">Crates are not switched on yet. Your titles are below.</div>
            ) : crateList === null ? (
              <div className="coll-empty">Loading</div>
            ) : sealed.length === 0 ? (
              <>
                <div className="colls-hero empty" aria-hidden><span className="colls-crate" /></div>
                <div className="coll-empty">No sealed crates. You earn one every time you level up.</div>
              </>
            ) : (
              <>
                <div className="colls-hero" aria-hidden>
                  <span className="colls-hero-glow" />
                  <span className="colls-crate" />
                  <span className="colls-hero-count">{sealed.length}</span>
                </div>
                <div className="colls-next">{crateName(sealed[0]!.earnedLevel)}</div>
                <div className="colls-actions">
                  <button type="button" className="crate-btn pressable" onClick={() => begin(false)}>Open</button>
                  {sealed.length > 1 && (
                    <button type="button" className="crate-btn crate-btn-quiet pressable" onClick={() => begin(true)}>Open all ({sealed.length})</button>
                  )}
                </div>
                {sealed.length > 1 && (
                  <ul className="colls-cratelist" aria-label="Sealed crates">
                    {sealed.map((c) => <li key={c.crateId}>{crateName(c.earnedLevel)}</li>)}
                  </ul>
                )}
              </>
            )}
          </section>

          <section className="colls-panel colls-titles" aria-label="Titles">
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
        </div>

        {COMING.length > 0 && (
          <section className="colls-panel colls-coming" aria-label="Coming soon">
            <div className="coll-sec-head"><span>Coming soon</span></div>
            <ul className="colls-coming-list">
              {COMING.map((d) => <li key={d.id}>{d.label}</li>)}
            </ul>
          </section>
        )}

        {anonymous && (
          <div className="coll-save colls-panel">
            <span>Playing as a guest. Create an account to keep your crates and titles.</span>
            <button type="button" className="cv2-btn cv2-btn-sm pressable" onClick={() => { sfx.pulse(); openAccountPanel(); }}>Create account</button>
          </div>
        )}
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
