import { useEffect, useRef } from 'react';
import { CARD_INDEX } from '@game/content';
import { COSMETIC_INDEX, RARITY_LABELS, type CosmeticDef } from '@game/progression';
import { skinArt } from '../art';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { Icon } from '../Icon';
import { dismissGifts, useProgression } from './progressionStore';
import './collection.css';

/**
 * GIFTS (owner 2026-11-13: "give Ionlime the cosmetic. have an alert next time he loads up the game", R-PROG-GIFT-01).
 * An item handed to this account directly (`player_cosmetics.source = 'gift'`) is announced ONCE, on the menus, the
 * next time the game loads: what it is, its rarity and what it is for. Closing it any way marks it seen on the account
 * (the Collection's seen list), so it never returns on this or any other device.
 * Reuses the New rewards pop-up shell (`nrw-*`), like the sign-in gates.
 */

/** "an Ancient skin for Kobebes", "a Legendary title": what the gift is, in player words. */
function describe(def: CosmeticDef): string {
  const rarity = RARITY_LABELS[def.rarity];
  const article = /^[AEIOU]/.test(rarity) ? 'An' : 'A';
  const kind = def.category === 'minion_skin' || def.category === 'hero_skin' ? 'skin'
    : def.category === 'title' ? 'title'
      : def.category === 'portrait_frame' ? 'portrait frame'
        : def.category === 'card_plate' ? 'card plate'
          : def.category === 'hero_attack' ? 'attack animation'
            : def.category === 'emote' ? 'emote' : 'item';
  const target = def.category === 'minion_skin' && def.target ? CARD_INDEX[def.target.id]?.name : undefined;
  return `${article} ${rarity} ${kind}${target ? ` for ${target}` : ''}.`;
}

export function GiftNotice(): JSX.Element | null {
  const userId = useGame((s) => s.account.userId);
  const openCollection = useGame((s) => s.openCollection);
  const gifts = useProgression((s) => s.gifts);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mine = gifts && gifts.userId === userId ? gifts.ids.map((id) => COSMETIC_INDEX[id]).filter((d): d is CosmeticDef => !!d) : [];
  const open = mine.length > 0;
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation(); sfx.tick(); dismissGifts();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  if (!open) return null;
  const view = (): void => { sfx.pulse(); dismissGifts(); openCollection(); };
  return (
    <div className="nrw-scrim gift-scrim" onPointerDown={() => { sfx.tick(); dismissGifts(); }}>
      <section className="nrw-panel pfgate-panel" role="dialog" aria-modal="true" aria-labelledby="gift-title" onPointerDown={(e) => e.stopPropagation()}>
        <header className="nrw-head">
          <span className="nrw-title" id="gift-title"><Icon name="gift" />{mine.length === 1 ? 'A gift for you' : 'Gifts for you'}</span>
        </header>
        <ul className="gift-list">
          {mine.map((def) => {
            const art = def.category === 'minion_skin' || def.category === 'hero_skin' ? skinArt(def.assets.art) : undefined;
            return (
              <li key={def.id} className={`gift-item r-${def.rarity}`}>
                {art && <img className="gift-art" src={art} alt="" decoding="sync" draggable={false} />}
                <div className="gift-text">
                  <span className={`gift-name r-${def.rarity}`}>{def.name}</span>
                  <span className="nrw-note">{describe(def)}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="nrw-note gift-note">{mine.length === 1 ? 'It is in your Collection now.' : 'They are in your Collection now.'}</p>
        <footer className="nrw-foot pfgate-foot">
          <button type="button" className="colls-quiet pressable quiet" onClick={view}>View in Collection</button>
          <button ref={closeRef} type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); dismissGifts(); }}>Got it</button>
        </footer>
      </section>
    </div>
  );
}
