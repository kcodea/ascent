/**
 * THE COSMETICS WINDOW'S PENDING LOADOUT (showcase player card, PR 3 Task 6). The window edits one pending copy of the
 * four things your card wears and "Use" saves only what changed. Pure (savers are passed in), so the rules are testable.
 *
 *   avatar   the portrait id (`setPlayerAvatar`; local + profile row, never fails here)
 *   frame    the portrait frame cosmetic id (`equipCosmetic('portrait_frame', '', id)`)
 *   title    the title id (`equipTitle(id)`)
 *   plate    the card plate cosmetic id (`equipCosmetic('card_plate', '', id)`)
 * null is each slot's default (the default portrait, ring, no title, the standard plate).
 */

export type CosmeticsTab = 'avatar' | 'frame' | 'title' | 'plate';

export interface Loadout4 { avatar: string | null; frame: string | null; title: string | null; plate: string | null }

const KEYS: readonly (keyof Loadout4)[] = ['avatar', 'frame', 'title', 'plate'];

/** The keys whose pending value differs from what is worn now, in a fixed order. */
export function changedKeys(now: Loadout4, pending: Loadout4): (keyof Loadout4)[] {
  return KEYS.filter((k) => now[k] !== pending[k]);
}

export interface Loadout4Savers {
  avatar: (id: string | null) => void;
  frame: (id: string | null) => Promise<boolean>;
  title: (id: string | null) => Promise<boolean>;
  plate: (id: string | null) => Promise<boolean>;
}

/** Save every changed key at once. Returns the keys whose save FAILED (a saver resolving false or throwing); every
 *  other changed saver still ran. */
export async function applyPending(now: Loadout4, pending: Loadout4, save: Loadout4Savers): Promise<(keyof Loadout4)[]> {
  const keys = changedKeys(now, pending);
  const results = await Promise.all(keys.map(async (k): Promise<boolean> => {
    try {
      if (k === 'avatar') { save.avatar(pending.avatar); return true; }
      return await save[k](pending[k]);
    } catch {
      return false;
    }
  }));
  return keys.filter((_, i) => !results[i]);
}
