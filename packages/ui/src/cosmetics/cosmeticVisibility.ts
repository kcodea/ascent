/**
 * COSMETIC VISIBILITY (owner 2026-11-20: "for cosmetics, it should have toggles for the various cosmetics to show/hide
 * etc, and these should work in spectating too"; R-SETTINGS-COSMETICS-01).
 *
 * One switch per cosmetic category the game draws. Off = that category falls back to the default look EVERYWHERE it
 * renders: your own game, the players you meet, the lobby rail, history, replays and spectating. It applies to
 * everyone's cosmetics, yours included (the existing "Show other players' cosmetics" switch stays the way to hide only
 * other people's). Every switch defaults ON, so nothing changes until a player turns one off.
 *
 * PURELY PRESENTATIONAL. Nothing here changes a snapshot, a loadout or anything sent to a server: the one UI resolver
 * per category (`heroPortrait`, `minionSkinMap`, `cardPlateLookOf`, `titleLookOf`, `usePortraitFrame`,
 * `attackerCosmeticOf`, `currentAnnouncerPack`, `showEmoteBubble`) asks `cosmeticShown` and draws the default instead.
 *
 * CHEAP. The state is a tiny map that changes only when a switch flips. Surfaces that draw cosmetics re-read through
 * `useCosmeticVisEpoch` (folded into `useSkinEpoch` and the opponent-cosmetics hook they already call), so a flip
 * re-renders those surfaces once and a shop click never touches this store. Saved on this device (localStorage).
 *
 * Boards and Music are cosmetic categories too, but both are switched off in the catalog (nothing renders them yet),
 * so they get no switch until they ship.
 */
import { create } from 'zustand';

export const COSMETIC_TOGGLES = ['minion_skin', 'card_plate', 'hero_skin', 'portrait_frame', 'hero_attack', 'title', 'emote', 'announcer'] as const;
export type CosmeticToggle = (typeof COSMETIC_TOGGLES)[number];

/** The settings rows, in order. `note` says what Off does. */
export const COSMETIC_TOGGLE_ROWS: readonly { id: CosmeticToggle; label: string; note: string }[] = [
  { id: 'minion_skin', label: 'Minion skins', note: 'Off shows every minion in its default art.' },
  { id: 'card_plate', label: 'Card plates', note: 'Off shows every card on the standard plate.' },
  { id: 'hero_skin', label: 'Hero skins', note: 'Off shows every hero in its default portrait.' },
  { id: 'portrait_frame', label: 'Portrait frames', note: 'Off shows the default ring around every portrait.' },
  { id: 'hero_attack', label: 'Hero attacks', note: 'Off plays the Classic attack for every hero.' },
  { id: 'title', label: 'Titles', note: 'Off hides the titles shown under player names.' },
  { id: 'emote', label: 'Player emotes', note: 'Off hides the emotes of the players in your game. Yours still show to you.' },
  { id: 'announcer', label: 'Announcer pack', note: 'Off uses the default announcer voice.' },
];

const KEY = 'ascent.cosmeticsHidden.v1';

type Hidden = Readonly<Partial<Record<CosmeticToggle, true>>>;

function read(): Hidden {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Partial<Record<CosmeticToggle, true>> = {};
    for (const id of COSMETIC_TOGGLES) if ((v as Record<string, unknown>)[id] === true) out[id] = true;
    return out;
  } catch { return {}; }
}

interface VisState { hidden: Hidden; epoch: number }

export const useCosmeticVisibility = create<VisState>(() => ({ hidden: read(), epoch: 0 }));

/** Is this category drawn right now? Non-reactive (resolvers call it; components re-read via the epoch). */
export const cosmeticShown = (id: CosmeticToggle): boolean => useCosmeticVisibility.getState().hidden[id] !== true;

export function setCosmeticShown(id: CosmeticToggle, on: boolean): void {
  const cur = useCosmeticVisibility.getState();
  if ((cur.hidden[id] !== true) === on) return;
  const next: Partial<Record<CosmeticToggle, true>> = { ...cur.hidden };
  if (on) delete next[id]; else next[id] = true;
  useCosmeticVisibility.setState({ hidden: next, epoch: cur.epoch + 1 });
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable: lasts this session */ }
}

/** Every switch back on. */
export function showAllCosmetics(): void {
  const cur = useCosmeticVisibility.getState();
  if (Object.keys(cur.hidden).length === 0) return;
  useCosmeticVisibility.setState({ hidden: {}, epoch: cur.epoch + 1 });
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Subscribe a cosmetic surface to the switches: changes only when one flips. */
export const useCosmeticVisEpoch = (): number => useCosmeticVisibility((s) => s.epoch);

/** One switch's value, reactive (the settings row). */
export const useCosmeticShown = (id: CosmeticToggle): boolean => useCosmeticVisibility((s) => s.hidden[id] !== true);

/** Tests: re-read storage. */
export function reloadCosmeticVisibilityForTest(): void {
  useCosmeticVisibility.setState({ hidden: read(), epoch: useCosmeticVisibility.getState().epoch + 1 });
}
