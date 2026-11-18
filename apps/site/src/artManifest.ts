import manifest from './artManifest.json';

/** A source copied as is, or a source resized to `width` px and re-encoded as `format` (by sync-art, with sharp). */
export type ArtEntry = string | { src: string; width: number; format: string };

/** Site path under `public/art/` -> repo-relative source. Pages reference art as `/art/<key>`. */
export const ART_MANIFEST: Record<string, ArtEntry> = manifest;

/** The repo-relative source path of an entry, whichever form it takes. */
export function artSource(entry: ArtEntry): string {
  return typeof entry === 'string' ? entry : entry.src;
}

/** Source paths that must never reach the site: Secret cosmetics, and Skins rarities that are not live. */
export const DENIED_ART: RegExp[] = [/secret/i, /(^|\/)Skins\/(?!(Common|Rare|Epic|Legendary|Ancient)\/)/i];
