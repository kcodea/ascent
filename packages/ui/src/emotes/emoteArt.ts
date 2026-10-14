/**
 * EMOTE ART (owner 2026-10-13). Each emote is ONE painted speech bubble (frame, character and tail baked in, tail at the
 * bottom-left), shipped as `art/emotes/<id>.webp`, trimmed to the bubble and downscaled to the repo's 512 px art size.
 * Placeholder art: the owner has not settled the final look. An emote with no file renders nothing (never a broken img).
 */
const EMOTE_URLS = import.meta.glob('../art/emotes/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The bubble art of an emote id, or undefined when its file is missing. */
export function emoteSrc(id: string | null | undefined): string | undefined {
  return id ? EMOTE_URLS[`../art/emotes/${id}.webp`] : undefined;
}

/**
 * Where the painted TAIL'S TIP sits inside the bubble art, as fractions of its width and height (measured on the four
 * starter bubbles after trimming: x 0.15 to 0.16, y 0.90 to 1.0). Every bubble is placed so this point lands on the
 * speaker's portrait, and pops from it.
 */
export const EMOTE_TAIL = { x: 0.155, y: 0.97 } as const;
/** Height / width of a bubble (the starters are 512 x 293 to 373; the box uses `contain`, so this only sizes it). */
export const EMOTE_ASPECT = 0.64;
