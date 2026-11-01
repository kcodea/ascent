import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * R-RAIL-SCOUT-RUNE-TIP-01 (owner 2026-11-01: "when hovering the runes in this hover view of the lobby rail, i need it to
 * show what the rune's mechanic is"). The Docked rail's scouting card shows each rune's text over its socket on hover, in
 * the hover card as well as the pinned one. Two things broke it: the hover card ignored the pointer (so its runes could
 * not be hovered), and the shared `.questbadge-tip` is transparent until a `.questbadge` is hovered, which a socket is not.
 */
const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');
const docked = strip(readFileSync(join(__dirname, 'lobbyRailDocked.css'), 'utf8'));
const styles = strip(readFileSync(join(__dirname, 'styles.css'), 'utf8'));
const rules = (css: string): { sel: string; body: string }[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const R = rules(docked);

describe('R-RAIL-SCOUT-RUNE-TIP-01: the rail card shows what a rune does on hover', () => {
  it('the shared tip is transparent by default, so the card must light it itself', () => {
    const base = rules(styles).find((r) => r.sel === '.questbadge-tip');
    expect(base?.body).toMatch(/opacity:\s*0/);
  });

  it('a hovered (or tapped) socket shows its tip, fully opaque, in the hover card and the pinned card alike', () => {
    const lit = R.find((r) => r.sel.includes('.lrv-sc-socket') && r.sel.includes('.questbadge-tip') && /opacity:\s*1/.test(r.body));
    expect(lit, 'a rule lights the socket tip').toBeTruthy();
    expect(lit!.sel).toContain(':hover');
    expect(lit!.sel).toContain('.tt-on'); // a finger reaches it too (touchInput.ts parks a tap as .tt-on)
    expect(lit!.sel).not.toContain('.pinned'); // not only once the card is pinned
    expect(lit!.body).toMatch(/display:\s*flex/);
  });

  it('the hover card takes the pointer, and a strip bridges the gap to the slice so moving onto it keeps it open', () => {
    expect(R.some((r) => r.sel === '.lobbyscout.lrv-scout' && /pointer-events:\s*auto/.test(r.body))).toBe(true);
    const bridge = R.find((r) => r.sel === '.lobbyscout.lrv-scout::after');
    expect(bridge?.body).toMatch(/left:\s*100%/);
    expect(bridge?.body).toMatch(/var\(--lr2-card-x/); // follows the card's left / right nudge
  });
});
