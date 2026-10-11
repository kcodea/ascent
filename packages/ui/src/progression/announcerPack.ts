/**
 * THE EQUIPPED ANNOUNCER (owner 2026-10-11: "i want to create a new announcer voice - the current one is the default.
 * this will be offered as a reward in collections").
 *
 * An announcer cosmetic names a PACK (`assets.pack`): the folder under `apps/web/public/announcer/` its clips live in.
 * `announcer.ts` asks for it through `setAnnouncerPackProvider` each time a line speaks, so wearing or taking off a
 * voice in the Collection changes the very next line. Only the wearer hears it: it is read from the LIVE loadout and is
 * never recorded on a run.
 */
import { announcerOf, type CosmeticDef } from '@game/progression';
import { currentUserId } from '../identity';
import { mirrorFor, useProgression } from './progressionStore';

/** The clip folder of an announcer item, or null (not an announcer, or one with no pack). */
export function announcerPackOf(item: CosmeticDef | null | undefined): string | null {
  return item && item.category === 'announcer' ? item.assets.pack ?? null : null;
}

/** The pack of the announcer the signed-in player wears, or null for the default voice (nothing equipped, signed out,
 *  or the item is retired / unknown: `announcerOf` only returns a LIVE announcer). */
export function equippedAnnouncerPack(): string | null {
  return announcerPackOf(announcerOf(mirrorFor(currentUserId(), useProgression.getState().mirror)?.loadout));
}
