/**
 * PING ART (owner 2026-10-29: "I can make the art for them"; painted and delivered the same day). Each ping is ONE
 * painted thought bubble (gold rim, the icon inside), shipped as `packages/ui/src/art/pings/<kind>.webp` (check, x,
 * question, pass, sell, and the menu's inspect): cut from the owner's 1536 x 1024 paintings onto a transparent
 * background with a short soft glow, trimmed to the bubble, 256 px wide (about 20-30 KB each). A kind with no file shows
 * a plain text glyph (never code-drawn illustration).
 */
import type { PingKind } from '@game/versus-cf/pings';

const PING_URLS = import.meta.glob('../art/pings/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The painted icon of a ping (or of the menu's Inspect), or undefined when its file is missing. */
export function pingSrc(kind: PingKind | 'inspect'): string | undefined {
  return PING_URLS[`../art/pings/${kind}.webp`];
}

/** The placeholder glyph and the menu label of each ping. */
export const PING_LOOK: Record<PingKind, { glyph: string; label: string }> = {
  check: { glyph: '✓', label: 'Check' },
  x: { glyph: '✕', label: 'No' },
  question: { glyph: '?', label: 'Question' },
  pass: { glyph: '»', label: 'Pass' },
  sell: { glyph: '$', label: 'Sell' },
};
