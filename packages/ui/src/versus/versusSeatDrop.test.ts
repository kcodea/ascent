import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE SEAT DROP LANDS ONCE (owner report 2026-10-26, R-VERSUS-SEAT-DROP-01):
 *
 *   "when dragging the player portrait to a lobby slot it kinda does a pop/plop that looks janky. the card gets really
 *   big like it's being dropped from higher than where it was when it actually was dropped."
 *
 * Two causes, both pinned here at the source (the motion itself needs a real compositor):
 *  1. A hand card is still HOVERED (its lift popped: one card up, x2) when it is dropped on a seat. Flipping it to a
 *     seat card eased that pop away over the lift's 0.14 s transition on top of the landing glide. A seated card's lift
 *     is now `none` with no transition, so the landing is the FLIP alone.
 *  2. The FLIP started at the ghost's HELD size at the pointer, but a quick flick drops the card before the grab-shrink
 *     has grown it, so the landing started bigger than the card that was let go. It now starts at the ghost's box as
 *     drawn at the drop (one read, on the drop only).
 */
const css = readFileSync(join(__dirname, 'versus.css'), 'utf8');
const hook = readFileSync(join(__dirname, 'useSeatDrag.tsx'), 'utf8');

describe('R-VERSUS-SEAT-DROP-01: a seat drop lands from where it was let go, once', () => {
  it('a seated card has no hand pop and leaves it with no transition', () => {
    expect(css).toMatch(/\.vsmcard-seat \.vsbcard-lift \{ transform: none; transition: none; \}/);
    // The hand's pop and its transition still exist for hand cards.
    expect(css).toMatch(/\.vsbcard:hover \.vsbcard-lift \{ transform:/);
    expect(css).toMatch(/\.vsbcard-lift \{[^}]*transition: transform 0\.14s/);
  });

  it('the landing FLIP starts at the ghost as drawn at the drop, not at its held size', () => {
    expect(hook).toMatch(/flipFrom\.set\(me, releaseBoxOf\(d\)\)/);
    const fn = hook.slice(hook.indexOf('function releaseBoxOf'), hook.indexOf('function writeGhost'));
    expect(fn).toMatch(/\.dragshrink'\)\?\.getBoundingClientRect\(\)/);
    // Only on the drop: the per-frame ghost write never measures.
    const write = hook.slice(hook.indexOf('function writeGhost'), hook.indexOf('export function beginSeatDrag'));
    expect(write).not.toMatch(/getBoundingClientRect/);
  });
});
