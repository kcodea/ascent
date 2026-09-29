import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// YOUR PORTRAIT RING OVER YOUR HERO POWER (owner report 2026-09-29: "fix the Z axis of the hero power here so that
// the player frame is on top of that"). The ring lives inside `.statusbar .hero`, a transformed (so self-contained)
// block that sat at z `auto` inside the bar while the power diamond `.statusbar .heropanel` sits at z41, so the
// ring's overhang painted under the diamond and its cost coin. With a frame on, StatusBar adds `pf-top` and the
// block ranks above the diamond. jsdom computes no stacking, so this pins the tokens and their ORDER, the class
// wiring, and the click-through that keeps the diamond fully pressable under the ring.
const css = readFileSync(fileURLToPath(new URL('../styles.css', import.meta.url)), 'utf8');
const statusBar = readFileSync(fileURLToPath(new URL('../StatusBar.tsx', import.meta.url)), 'utf8');

/** The body of the FIRST rule whose selector is exactly `selector`. */
const ruleBody = (selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^${esc}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`no rule for selector: ${selector}`);
  return m[1]!;
};
/** The numeric z-index that rule sets. */
const zOf = (selector: string): number => {
  const m = ruleBody(selector).match(/z-index:\s*(-?\d+)/);
  if (!m) throw new Error(`no numeric z-index for selector: ${selector}`);
  return Number(m[1]);
};

describe('the player portrait ring paints over the hero power', () => {
  it('StatusBar lifts the hero block (pf-top) only while a frame is on', () => {
    expect(statusBar).toMatch(/className=\{`hero\$\{[^`]*\$\{frame \? ' pf-top' : ''\}`\}/);
  });

  it('the lifted block out-ranks the power diamond, inside the same bar context', () => {
    const lifted = zOf('.statusbar .hero.pf-top');
    const power = zOf('.statusbar .heropanel');
    expect(lifted).toBeGreaterThan(power);
    // The cost coin rides INSIDE the diamond (`.hpwrap`), so it can never climb over the lifted block either.
    expect(statusBar).toMatch(/<div className="hpwrap">[\s\S]*?className="hpcost"/);
  });

  it('stays under the open Buffs panel lift (which must keep winning)', () => {
    expect(zOf('.statusbar .hero:has(> .herobuffs.open)')).toBeGreaterThan(zOf('.statusbar .hero.pf-top'));
  });

  it('the ring layer never takes a click, so the diamond under it stays pressable', () => {
    expect(ruleBody('.pframe-box')).toMatch(/pointer-events:\s*none/);
    expect(ruleBody('.pframe')).toMatch(/pointer-events:\s*none/);
  });

  it('the foe side already has it: the foe power icon sits under the foe portrait (and its ring)', () => {
    expect(zOf('.combatopp')).toBeGreaterThan(zOf('.heropowerbtn.opp-power'));
  });
});
