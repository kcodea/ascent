/**
 * YOUR EMOTE MENU (owner 2026-10-13: "Players equip up to 4 in Collections"). The four emotes the in-game menu shows,
 * resolved from the live loadout by `emoteLoadoutOf` (@game/progression): explicit positions first, the starter emotes
 * filling the rest, so a guest, an offline player and a fresh account all get the four starters.
 *
 * THE LOCAL LAYER. Emotes must work locally and offline, and until the owner runs 2026-10-13-emotes.sql (and deploys
 * progression-inventory) the server refuses the `emote` slot. So an equip the server does not take (signed out, the
 * SQL not run yet, offline) is kept on THIS device instead (`ascent.emoteLoadout`, a per-viewer convenience), and the
 * menu reads it over the server's rows. A server-accepted equip clears it, so the account becomes the truth again.
 * The emotes you USE are recorded on your boards either way (that path needs no server change at all).
 */
import { useMemo } from 'react';
import { EMOTE_SLOT_COUNT, emoteLoadoutOf, withEmoteAt, type RunCosmeticSnapshot } from '@game/progression';
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

/** Your four menu emotes right now (outside React). */
export function equippedEmotes(): string[] {
  const server = mirrorFor(currentUserId(), useProgression.getState().mirror)?.loadout;
  return emoteLoadoutOf(effectiveEmoteLoadout(server, useLocalEmotes.getState().local));
}

/** Your four menu emotes, as a hook (re-renders on an equip, a server read or a local change). */
export function useEquippedEmotes(): string[] {
  const server = useProgression((s) => mirrorFor(currentUserId(), s.mirror)?.loadout);
  const local = useLocalEmotes((s) => s.local);
  const key = JSON.stringify([server?.emotes ?? null, local]);
  return useMemo(() => emoteLoadoutOf(effectiveEmoteLoadout(server, local)), [key]);
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
