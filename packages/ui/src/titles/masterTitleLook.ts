/**
 * MASTER TITLE LOOK: a DEV-ONLY switch between restyle candidates (owner ask 2026-10-28: "can you make the mastery
 * title's way cleaner and exciting looking? they look gross with gold and red").
 *
 *   plate     today's golden plate with crimson embroidered text (the shipped look; the default).
 *   clean     A: crisp light text, a thin accent rule, one small glyph. No plate.
 *   exciting  B: a luminous gradient in the letters, a slow light sweep (transform only) and one twinkling glyph.
 *   badge     C: the game's painted pewter tier plate (`frames/tierplate.webp`) as a compact badge.
 *
 * The pick lives in localStorage (`ascent.dev.masterTitleLook`) and is read only in a dev build, so a production
 * build always paints `plate` until the owner's choice is finalized. `TitleBadge` subscribes to it, so flipping it
 * from the Dev Menu repaints every surface at once.
 */
import { create } from 'zustand';

export const MASTER_TITLE_LOOKS = ['plate', 'clean', 'exciting', 'badge'] as const;
export type MasterTitleLook = (typeof MASTER_TITLE_LOOKS)[number];

const KEY = 'ascent.dev.masterTitleLook';

function readLook(): MasterTitleLook {
  if (!import.meta.env.DEV) return 'plate';
  try {
    const v = localStorage.getItem(KEY);
    return (MASTER_TITLE_LOOKS as readonly string[]).includes(v ?? '') ? (v as MasterTitleLook) : 'plate';
  } catch {
    return 'plate';
  }
}

export const useMasterTitleLook = create<{ look: MasterTitleLook }>(() => ({ look: readLook() }));

/** DEV: set the master title look (no-op in production). */
export function setMasterTitleLook(look: MasterTitleLook): void {
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, look); } catch { /* ignore */ }
  useMasterTitleLook.setState({ look });
}

/** DEV: step to the next look, wrapping. Returns the new one. */
export function cycleMasterTitleLook(): MasterTitleLook {
  const cur = useMasterTitleLook.getState().look;
  const next = MASTER_TITLE_LOOKS[(MASTER_TITLE_LOOKS.indexOf(cur) + 1) % MASTER_TITLE_LOOKS.length]!;
  setMasterTitleLook(next);
  return next;
}
