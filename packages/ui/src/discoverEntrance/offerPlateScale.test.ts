import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPELL_MEDALLION_DEFAULTS } from '../spellMedallionConfig';

/**
 * A PLATED OFFER OPTION IS THE HAND CARD, UNIFORMLY LARGER (owner report 2026-10-12, on the hero-power Discover:
 * "the cardplate darkening overlay is too high, it needs to be lower to matchup with the gold trim" and the text
 * "should exactly match the layout for existing spell cards").
 *
 * Every length on a card scales with `--ccw` except ONE: the plate's lift, `--plate-top`, is plain px tuned at the
 * standard card size. The offer row draws its cards 1.3x (`.disc-cards`' `--ch`), so an unscaled lift left the stone
 * plate ~11px low against the frame, the text and the dark backbox. `--plate-k` scales the lift by the same bump.
 * jsdom cannot lay a card out, so this pins the stylesheet: the two bumps are one number, and no rule positions
 * anything off the raw lift. (Measured live at 1920x1080: plate top -0.268 x card width on a hand spell AND on a
 * power card after the fix; it was -0.206 on the power card before.)
 */
const here = dirname(fileURLToPath(import.meta.url));
const styles = readFileSync(join(here, '..', 'styles.css'), 'utf8');
const entrance = readFileSync(join(here, 'discoverEntrance.css'), 'utf8');

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `rule "${selector}" exists`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('\n}', open));
}

describe('the offer row scales the plate lift with its cards', () => {
  it('`--plate-k` is the same bump as the row\'s card size', () => {
    const body = ruleBody(styles, '.disc-cards');
    const bump = /--ch:\s*calc\(var\(--ch-base\) \* var\(--card-scale, [\d.]+\) \* ([\d.]+)\)/.exec(body)?.[1];
    const k = /--plate-k:\s*([\d.]+);/.exec(body)?.[1];
    expect(bump, 'the row declares its card bump').toBeDefined();
    expect(k, 'the row declares --plate-k').toBeDefined();
    expect(Number(k)).toBe(Number(bump));
  });

  it('every rule that places something off the plate lift multiplies it by `--plate-k`', () => {
    const raw = styles.split('var(--plate-top, -37px)').length - 1;
    const scaled = styles.split('var(--plate-top, -37px) * var(--plate-k, 1)').length - 1;
    expect(raw).toBeGreaterThanOrEqual(3); // the plate, its bottom-gem label, the step counter
    expect(scaled).toBe(raw);
  });

  it('the full Discover row reserves the SCALED plate footprint (so the plates still clear the Peek button)', () => {
    const card = ruleBody(entrance, '.discover-ov.disc-full .disc-slot .card.plated');
    expect(card).toContain('var(--plate-top, -37px) * var(--plate-k, 1)');
    // ...and hands the extra lift back above the row, so the plate's crown keeps its gap under the banner.
    const row = /\.discover-ov\.disc-full \.disc-cards \{([^}]*)\}/.exec(entrance)?.[1] ?? '';
    expect(row).toContain('var(--plate-k, 1) - 1');
  });
});

describe('the medallion CSS fallbacks mirror the tuner defaults', () => {
  // The stylesheet's fallbacks are what renders whenever a var is absent, so they must equal DEFAULTS (the
  // contract `spellMedallionConfig.ts` states). The hero-power helm was retuned by the owner on 2026-10-12.
  const fields: [keyof typeof SPELL_MEDALLION_DEFAULTS extends infer K ? K extends `spell${infer F}` ? F : never : never, string, string][] = [
    ['Size', 'size', ''], ['Dx', 'dx', 'px'], ['Dy', 'dy', 'px'],
    ['ShadowY', 'shadow-y', 'px'], ['ShadowBlur', 'shadow-blur', 'px'], ['GlowSize', 'glow-size', 'px'],
  ];
  it.each(['spell', 'ruby', 'gift', 'power'] as const)('%s', (kind) => {
    for (const [field, css, unit] of fields) {
      const want = SPELL_MEDALLION_DEFAULTS[`${kind}${field}` as keyof typeof SPELL_MEDALLION_DEFAULTS];
      expect(styles, `--smed-${kind}-${css}`).toContain(`var(--smed-${kind}-${css}, ${want}${unit})`);
    }
  });

  it('the hero-power helm: seated 6px lower, a quieter glow (0.6, then -40%, then -20%), a tighter and deeper shadow', () => {
    expect(SPELL_MEDALLION_DEFAULTS.powerDy).toBe(3);
    expect(SPELL_MEDALLION_DEFAULTS.powerGlowStrength).toBe(0.29);
    expect(styles).toContain('var(--smed-power-glow-color, rgba(53, 242, 154, 0.29))');
    expect(SPELL_MEDALLION_DEFAULTS.powerShadowBlur).toBeLessThan(SPELL_MEDALLION_DEFAULTS.spellShadowBlur);
    expect(SPELL_MEDALLION_DEFAULTS.powerShadowY).toBeGreaterThan(SPELL_MEDALLION_DEFAULTS.spellShadowY);
  });
});
