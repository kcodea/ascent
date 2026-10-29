/**
 * R-SPECTATE-TIP-01 (owner 2026-10-29: "whenever hovering over a spectator some weird box shows up off screen"): the
 * spectator column sits at the very top left, so its plates' and the "+N" chip's shared hover tips open to the RIGHT
 * (`.gtip-right`), never above (clipped by the screen edge), and the "+N" chip does not clip its own tip.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');

describe('the spectator column tips open on screen (R-SPECTATE-TIP-01)', () => {
  it('every plate and the "+N" chip wear the right-hand placement', () => {
    const badge = src('WatchersBadge.tsx');
    expect(badge).toMatch(/vsspec-seat on vswatch-seat gtip gtip-right/);
    expect(badge).toMatch(/vswatch-more gtip gtip-right/);
    expect(src('SpectatorHud.tsx')).toMatch(/vsself-seat gtip gtip-right/);
  });
  it('the shared placement opens to the right, centred; the "+N" chip lets its tip out', () => {
    const css = src('../styles.css');
    expect(css).toMatch(/\.gtip\.gtip-right\[data-tip\]::after \{ left: calc\(100% \+ 9px\); right: auto; top: 50%; bottom: auto;/);
    expect(src('versus.css')).toMatch(/\.vswatch \.vswatch-more, \.vsself \.vswatch-more \{ overflow: visible;/);
  });
});
