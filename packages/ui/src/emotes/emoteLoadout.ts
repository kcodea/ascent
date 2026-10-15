/**
 * YOUR EMOTE MENU (owner 2026-10-13: "Players equip up to 4 in Collections"). The four emotes the in-game menu shows,
 * resolved from the live loadout by `emoteSlotsOf` (@game/progression): explicit positions first, the player's other
 * OWNED emotes filling the rest. Since 2026-10-15 no emote is given away (every one is a crate drop), so a guest or an
 * account that owns none has an EMPTY menu, and a position only ever shows an emote the account owns.
 *
 * THE LOCAL LAYER. Emotes must work locally and offline, and until the owner runs 2026-10-13-emotes.sql (and deploys
 * progression-inventory) the server refuses the `emote` slot. So an equip the server does not take (signed out, the
 * SQL not run yet, offline) is kept on THIS device instead (`ascent.emoteLoadout`, a per-viewer convenience), and the
 * menu reads it over the server's rows. A server-accepted equip clears it, so the account becomes the truth again.
 * The emotes you USE are recorded on your boards either way (that path needs no server change at all).
 */
import { useMemo } from 'react';
import { EMOTE_SLOT_COUNT, emoteSlotsOf, withEmoteAt, type ProgressionProfile, type RunCosmeticSnapshot } from '@game/progression';
import { create } from 'zustand';
import { currentUserId } from '../identity';
import { mirrorFor, useProgression } from '../progression/progressionStore';

const LOCAL_KEY = 'ascent.emoteLoadout';
type LocalEmotes = Readonly<Record<string, string>>;

function readLocal(): LocalEmotes | null {
  try {
    const o = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (/^[0-3]$/.test(k) && typeof v === 'string' && /^[a-z0-9_]{1,64}$/.test(v)) out[k] = v;
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
function writeLocal(v: LocalEmotes | null): void {
  try { if (v && Object.keys(v).length) localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); else localStorage.removeItem(LOCAL_KEY); } catch { /* storage unavailable: lasts this session */ }
}

/** The device's own emote positions (null = none). A tiny store so the Collection and the menu re-render on a change. */
export const useLocalEmotes = create<{ local: LocalEmotes | null }>(() => ({ local: typeof localStorage === 'undefined' ? null : readLocal() }));

/** The loadout the menu reads: the server's (via the mirror), with this device's positions laid over it. */
export function effectiveEmoteLoadout(server: RunCosmeticSnapshot | null | undefined, local: LocalEmotes | null): RunCosmeticSnapshot | null {
  if (!local) return server ?? null;
  return { ...(server ?? {}), emotes: { ...(server?.emotes ?? {}), ...local } };
}

/** The ids the account owns (none for a guest, or before the first server read). */
const ownedOf = (p: Pick<ProgressionProfile, 'cosmetics' | 'titles'> | null | undefined): readonly string[] => p?.cosmetics ?? p?.titles ?? [];

/** Your menu emotes right now (outside React), position order, empty positions left out. */
export function equippedEmotes(): string[] {
  const me = mirrorFor(currentUserId(), useProgression.getState().mirror);
  return emoteSlotsOf(effectiveEmoteLoadout(me?.loadout, useLocalEmotes.getState().local), ownedOf(me)).filter((x): x is string => !!x);
}

/** Your menu BY POSITION (EMOTE_SLOT_COUNT entries, null = empty), as a hook: the Collection's slot buttons read it. */
export function useEmoteSlots(): (string | null)[] {
  const me = useProgression((s) => mirrorFor(currentUserId(), s.mirror));
  const local = useLocalEmotes((s) => s.local);
  const owned = ownedOf(me);
  const key = JSON.stringify([me?.loadout?.emotes ?? null, local, owned]);
  return useMemo(() => emoteSlotsOf(effectiveEmoteLoadout(me?.loadout, local), owned), [key]);
}

/** Your menu emotes, as a hook (re-renders on an equip, a server read or a local change); empty positions left out. */
export function useEquippedEmotes(): string[] {
  const slots = useEmoteSlots();
  return useMemo(() => slots.filter((x): x is string => !!x), [slots]);
}

/** Keep an equip on this device (the server did not take it). Moves the emote like the SQL does. */
export function equipEmoteLocally(position: number, id: string | null): void {
  if (position < 0 || position >= EMOTE_SLOT_COUNT) return;
  // Start from what the menu shows now, so a local move swaps exactly like a server one.
  const server = mirrorFor(currentUserId(), useProgression.getState().mirror)?.loadout;
  const cur = effectiveEmoteLoadout(server, useLocalEmotes.getState().local);
  const next = withEmoteAt(cur, position, id).emotes ?? null;
  writeLocal(next);
  useLocalEmotes.setState({ local: next });
}

/** The server took an equip: the account is the truth again, so the device layer goes. */
export function clearLocalEmotes(): void {
  writeLocal(null);
  useLocalEmotes.setState({ local: null });
}
