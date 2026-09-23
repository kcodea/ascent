import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE COMBAT Z-ORDER LADDER (owner report 2026-09-23: "can you fix the z axis of the hero power art etc? it is
// on top of minions and heroes so when they attack they are behind it"). In combat `.app` dissolves its
// stacking context, the hero cluster (`.statusbar`) drops to z0 and the idle units rise to z1, so a lunging or
// struck minion paints OVER the portrait / power diamond / equipment slot / rune nodes, while the cluster's own
// popovers lift the whole bar back over the units on hover. jsdom does not compute stacking, so this pins the
// CSS tokens the ladder is built from and the ORDER between them; see the ladder comment at `.app.combat` in
// styles.css for the full picture.
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');
const lungeTs = readFileSync(fileURLToPath(new URL('./choreo/channels/lunge.ts', import.meta.url)), 'utf8');

/** The z-index a rule with EXACTLY this selector sets (first match; the selector is escaped for the regex). */
const zRaw = (selector: string): number | 'auto' => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^${esc}\\s*\\{[^}]*?z-index:\\s*(-?\\d+|auto)`, 'm'));
  if (!m) throw new Error(`no z-index rule for selector: ${selector}`);
  return m[1] === 'auto' ? 'auto' : Number(m[1]);
};
/** Same, for a rule that must set a NUMBER (the ladder's rungs). */
const zOf = (selector: string): number => {
  const v = zRaw(selector);
  if (v === 'auto') throw new Error(`expected a numeric z-index for selector: ${selector}`);
  return v;
};
const lineIndexOf = (needle: string): number => {
  const i = css.indexOf(needle);
  if (i < 0) throw new Error(`rule not found: ${needle}`);
  return i;
};

describe('combat z-order ladder: the hero cluster sits under the units, its popovers over them', () => {
  const bar = zOf('.statusbar');
  const barInCombat = zOf(':where(body:has(.app.combat)) .statusbar');
  const barLifted = zOf(':where(body:has(.app.combat)) .statusbar:where(:has(.heropanel:hover, .questbadge:hover, .buffsopen))');
  const barDuel = zOf('body.duel-attacker-player .statusbar');
  const app = zRaw('.app');
  const appInCombat = zRaw('.app.combat');
  const unitIdle = zOf(':where(.app.combat) .unit');
  const unitDying = zOf(':where(.app.combat) .unit.dying');
  const unitAttacking = zOf('.unit.attacking');
  const unitStruck = zOf('.unit.struck');
  const unitPoisoned = zOf('.unit.poisoned');
  const unitReborn = zOf('.unit.reborn');
  const boardbg = zOf('.boardbg');
  const pixifxBelow = zOf('.pixifx-below');
  const pixifx = zOf('.pixifx');
  const floatAnchor = zOf('.floatanchor');
  const foePortrait = zOf('.combatopp');
  const lungeInline = Number(lungeTs.match(/gsap\.set\(attacker,\s*\{\s*zIndex:\s*(\d+)/)?.[1]);

  it('the shop order is untouched: the bar over the whole app', () => {
    expect(app).toBe(1);
    expect(bar).toBe(40);
  });

  it('in combat the app dissolves and the bar sits at z0, over the board art by tree order', () => {
    expect(appInCombat).toBe('auto');
    expect(barInCombat).toBe(0);
    // Same layer as the art and the under-card canvas: the bar wins only because it comes later in the tree,
    // and it must NOT go negative (a negative bar sits under the app's transparent box and loses the pointer).
    expect(boardbg).toBe(0);
    expect(pixifxBelow).toBe(0);
  });

  it('every unit state clears the bar, in the same root context, defender over attacker as before', () => {
    expect(unitIdle).toBeGreaterThan(barInCombat);
    expect(unitDying).toBeGreaterThan(unitIdle);
    expect(unitAttacking).toBeGreaterThan(unitDying);
    expect(lungeInline).toBeGreaterThanOrEqual(unitAttacking); // the lunge's inline z rides above the class
    expect(unitStruck).toBeGreaterThanOrEqual(lungeInline);    // the struck defender over the lunging attacker
    expect(unitPoisoned).toBeGreaterThan(unitStruck);
    expect(unitReborn).toBeGreaterThan(unitPoisoned);
  });

  it('a hovered popover lifts the bar over every unit, under the foe portrait and the FX canvas', () => {
    const topUnit = Math.max(unitIdle, unitDying, unitAttacking, unitStruck, unitPoisoned, unitReborn, lungeInline);
    expect(barLifted).toBeGreaterThan(topUnit);
    expect(barLifted).toBeLessThan(foePortrait);
    expect(barLifted).toBeLessThan(pixifx);
    expect(pixifx).toBeLessThan(floatAnchor);
  });

  it('the duel lift still wins mid-strike: higher than the popover lift and later in the file', () => {
    expect(barDuel).toBeGreaterThan(barLifted);
    expect(barDuel).toBeLessThan(pixifx);
    expect(lineIndexOf('body.duel-attacker-player .statusbar {'))
      .toBeGreaterThan(lineIndexOf(':where(body:has(.app.combat)) .statusbar:where('));
  });

  it('the combat rules lose to the unit-state rules by specificity, not order', () => {
    // `:where(.app.combat) .unit` weighs (0,1,0): it must never out-rank `.unit.attacking` etc. (0,2,0),
    // wherever it sits in the file. A bare `.app.combat .unit` (0,2,0) placed after them would flatten
    // every attacking / struck / reborn unit back to the idle value.
    expect(css).toMatch(/^:where\(\.app\.combat\) \.unit \{ z-index: 1; \}$/m);
    expect(css).not.toMatch(/^\.app\.combat \.unit \{/m);
    // Likewise the bar's combat rules weigh (0,1,0) so the (0,2,1) duel rule keeps winning.
    expect(css).not.toMatch(/^body:has\(\.app\.combat\) \.statusbar/m);
  });
});
