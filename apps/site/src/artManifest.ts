import manifest from './artManifest.json';

/** Site path under `public/art/` -> repo-relative source path. Pages reference art as `/art/<key>`. */
export const ART_MANIFEST: Record<string, string> = manifest;

/** Source paths that must never reach the site: Secret cosmetics, and Skins rarities that are not live. */
export const DENIED_ART: RegExp[] = [/secret/i, /(^|\/)Skins\/(?!(Common|Rare|Epic|Legendary|Ancient)\/)/i];
