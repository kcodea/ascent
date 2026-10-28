import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// R-FREEZE-TAUNT-01 (owner 2026-10-28: "do taunt frames get the same effect as the minion frames for freeze? they
// should"). A Taunt minion wears the shield frame (`.tframe`), not `.stdframe`, so the frozen-shop ice needs its
// own seat on the SHIELD's box or it falls back to the bare card box (small and low). jsdom does not lay out, so
// this pins the CSS geometry: the Taunt ice box must equal the shield frame image box.
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

describe('frozen Taunt ice sits on the shield frame (R-FREEZE-TAUNT-01)', () => {
  it('a frozen Taunt card seats its ice on the .tframe-img box', () => {
    const shield = box('.card.compact.taunt .tframe-img');
    const ice = box("[data-zone='tavern'].frozen .card.taunt:not(.spellcard)::after");
    expect(ice.width).toBe(shield.width);
    expect(ice.left).toBe(shield.left);
    expect(ice.top).toBe(shield.top);
    // the shield frame art is 1086 x 1448 (the same ratio its hover glow uses)
    expect(ice['aspect-ratio']).toBe('1086 / 1448');
  });

  it('the Taunt seat comes AFTER the base frozen rule, so it wins the cascade', () => {
    const base = css.indexOf('[data-zone="tavern"].frozen .card::after');
    const taunt = css.indexOf("[data-zone='tavern'].frozen .card.taunt:not(.spellcard)::after");
    expect(base).toBeGreaterThan(-1);
    expect(taunt).toBeGreaterThan(base);
  });
});
