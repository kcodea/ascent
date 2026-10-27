import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// R-SPELL-GLOW-FIT-01 (owner 2026-10-27: "the glow when hovering a spell is way too large"). The spell hover
// glow (`.cglow`, its rim masked to the spell frame PNG) and the spell colour overlay (`.cframe-tint`) must sit
// in EXACTLY the spell frame's own box. They had kept an older, larger spell frame's box (1.387 wide, 1122/1346),
// which stretched the glow ~12% past the arch. jsdom does not lay out, so this pins the CSS geometry tokens.
const css = readFileSync(fileURLToPath(new URL('./styles.css', import.meta.url)), 'utf8');

/** The width / aspect-ratio / left / top declarations of the FIRST rule whose selector is exactly `selector`. */
function box(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^${esc}\\s*\\{([^}]*)\\}`, 'm'));
  if (!m) throw new Error(`no rule for selector: ${selector}`);
  const out: Record<string, string> = {};
  for (const prop of ['width', 'aspect-ratio', 'left', 'top']) {
    const d = m[1].match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+);`));
    if (d) out[prop] = d[1].trim();
  }
  return out;
}

describe('spell glow + tint sit in the spell frame box (R-SPELL-GLOW-FIT-01)', () => {
  const frame = box('.card.compact.spellframe .cframe-img');
  // the frame img sizes by width and lets the image's own ratio set the height
  const frameAspect = '705 / 862';

  it('the spell frame box is the one measured for the arch frame', () => {
    expect(frame.width).toContain('1.239');
  });

  for (const sel of ['.card.compact.spellframe .cglow', '.card.compact.spellframe .cframe-tint']) {
    it(`${sel} matches the frame box`, () => {
      const b = box(sel);
      expect(b.width).toBe(frame.width);
      expect(b.left).toBe(frame.left);
      expect(b.top).toBe(frame.top);
      expect(b['aspect-ratio']).toBe(frameAspect);
    });
  }
});
