/**
 * A skin whose art is a LIVING PICTURE (concept, owner 2026-11-25): its pieces are `art/skins/holo/<skin>-<piece>.webp`, drawn by `livingArt.ts`.
 * The canvas is an `.artimg`, so the card's own art framing (zoom, offset, window) applies to it as to any art; the flat painting underneath
 * is what a phone, reduced motion or a machine without WebGL 2 sees.
 */
import { memo, useEffect, useRef, useState } from 'react';
import { showLiving, type LivingSet } from './livingArt';

const FILES = import.meta.glob('../art/skins/holo/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const SETS = new Map<string, Record<string, string>>();
for (const [path, url] of Object.entries(FILES)) {
  const m = /([^/]+)-([a-z0-9]+)\.webp$/.exec(path);
  if (!m) continue;
  const set = SETS.get(m[1]!) ?? {};
  set[m[2]!] = url;
  SETS.set(m[1]!, set);
}
export interface Holo { key: string; set: LivingSet }
const HOLOS = new Map([...SETS].map(([key, set]) => [key, { key, set } as Holo]));
/** A skin's living picture, by its art url (null = ordinary art). */
export function holoOf(artUrl: string | undefined): Holo | null {
  if (!artUrl || !artUrl.includes('skin_')) return null;
  const key = /(skin_[a-z0-9]+_\d+)/.exec(artUrl)?.[1];
  return (key && HOLOS.get(key)) || null;
}

const still = (): boolean => typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(pointer: coarse)').matches;

export const HoloArt = memo(function HoloArt({ holo }: { holo: Holo }): JSX.Element | null {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || still()) return;
    return showLiving(holo.key, holo.set, el, () => setOn(true));
  }, [holo]);
  return <canvas ref={ref} className="artimg" aria-hidden="true" style={{ opacity: on ? 1 : 0, maxWidth: 'none', maxHeight: 'none' }} />;
});
