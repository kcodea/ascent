/**
 * SOLO / DUO above Play (owner 2026-10-26: "i think we should add a toggle above 'play' that says solo/duo. if duo is
 * selected it then puts you into a room specific for duo's where you can invite a friend"). R-RANKED-DUOS-PARTY-01.
 *
 * - The choice is per viewer and remembered (localStorage, a convenience: it reads Solo when storage is unavailable).
 * - Solo + Play: today's flow, unchanged. Duo + Play: the Ranked Duos confirmation, then my party room
 *   (`enterDuosParty`). The confirmation lives on the title (`Title.tsx`), so Play here only REQUESTS it.
 * - The control wears the Career page's segmented-control look (`.cv2-seg`, the same values); no animation.
 */
import { useSyncExternalStore } from 'react';
import { sfx } from '../sfx';
import { versusEnabled } from './versusFlag';

export type PlayParty = 'solo' | 'duo';
/** A new party's room name: "Name's party". */
export function defaultPartyName(playerName: string): string {
  const n = (playerName ?? '').trim();
  return n ? `${n}'s party`.slice(0, 40) : 'Duos party';
}
const KEY = 'ascent.playParty';
const listeners = new Set<() => void>();
let current: PlayParty | null = null;

function read(): PlayParty {
  if (current) return current;
  try { current = localStorage.getItem(KEY) === 'duo' ? 'duo' : 'solo'; } catch { current = 'solo'; }
  return current;
}
/** The viewer's Solo / Duo choice (Solo whenever Versus is off on this build). */
export function playParty(): PlayParty {
  return versusEnabled() ? read() : 'solo';
}
export function setPlayParty(p: PlayParty): void {
  current = p;
  try { localStorage.setItem(KEY, p); } catch { /* a convenience only */ }
  for (const l of listeners) l();
}
const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const usePlayParty = (): PlayParty => useSyncExternalStore(subscribe, playParty, playParty);

// Duo + Play asks the title for the Ranked Duos confirmation (one listener: the mounted title).
let duoRequest: (() => void) | null = null;
export function onDuoPlayRequest(h: (() => void) | null): void { duoRequest = h; }
/** Play was pressed with Duo selected. False when no title is mounted to answer it. */
export function requestDuoPlay(): boolean {
  if (!duoRequest) return false;
  duoRequest();
  return true;
}

/** The Solo | Duo switch over a Play button (hidden when Versus is off on this build). */
export function PlayPartyToggle({ className = '' }: { className?: string }) {
  const p = usePlayParty();
  if (!versusEnabled()) return null;
  const pick = (v: PlayParty): void => { if (v !== p) { sfx.pulse(); setPlayParty(v); } };
  return (
    <div className={`playparty ${className}`} role="group" aria-label="Play solo or with a teammate">
      <button type="button" className={`playparty-btn${p === 'solo' ? ' on' : ''}`} aria-pressed={p === 'solo'} onClick={() => pick('solo')}>Solo</button>
      <button type="button" className={`playparty-btn${p === 'duo' ? ' on' : ''}`} aria-pressed={p === 'duo'} onClick={() => pick('duo')}>Duo</button>
    </div>
  );
}
