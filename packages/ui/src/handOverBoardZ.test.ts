import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A HAND CARD PAINTS OVER THE BOARD (R-PRESENT-HAND-OVER-BOARD-01, owner report 2026-11-01: "the card art in hand
// should be on top of the minion on board here"). Play a minion, then lift the next hand card: the new minion's badges
// and tier banner painted across the lifted card's top edge. Cause: the landing dust (`puffOnBoard` in Recruit.tsx)
// gave the landed board card an inline `z-index: 111` for 850 ms, and hovering a hand card dissolves `.app`'s stacking
// context, so that card outranked the hand zone (z70). jsdom computes no stacking, so this pins the tokens: no board
// card is ever raised inline from Recruit.tsx, and every board-card z-index rule stays under the resting hand zone.
const read = (p: string): string => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const css = read('./styles.css');
const recruit = read('./Recruit.tsx');

const zOf = (selector: string): number => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^${esc}\\s*\\{[^}]*?z-index:\\s*(-?\\d+)`, 'm'));
  if (!m) throw new Error(`no z-index rule for selector: ${selector}`);
  return Number(m[1]);
};

describe('hand cards paint over board minions', () => {
  it('the landing dust never raises the landed board card (no inline z-index in Recruit.tsx)', () => {
    const start = recruit.indexOf('const puffOnBoard = (uid: string): void => {');
    expect(start).toBeGreaterThan(0);
    const body = recruit.slice(start, recruit.indexOf('\n  };', start));
    expect(body).not.toMatch(/zIndex/);
    // Nothing else in the Shop screen writes an inline z-index onto a card either.
    expect(recruit).not.toMatch(/\.style\.zIndex\s*=/);
  });

  it('the hand zone outranks every board-card state rule, resting and lifted', () => {
    const handRest = zOf(".zone[data-zone='hand']");
    const handLift = zOf("body:not(.dragging) .app:has(.row.hand .card:hover) .zone[data-zone='hand']");
    expect(handLift).toBeGreaterThan(handRest);
    // Board-card state z-indexes that escape into `.app` (a card is `position: relative` with no z of its own).
    for (const sel of ['.card.targeted', '.card.compact img.tierbadge.tierplate', '.card.compact img.tierbadge.tierstars']) {
      expect(zOf(sel), sel).toBeLessThan(handRest);
    }
  });
});
