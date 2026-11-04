import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** R-BOOT-FIRST-PAINT-01: the first thing in the head paints the ground, before any tag that could hold the parser up. */
describe('first paint', () => {
  const html = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8');
  it('the navy ground and the logo size are inline, before every link and script', () => {
    const style = html.indexOf('<style>');
    expect(style).toBeGreaterThan(-1);
    expect(style).toBeLessThan(html.indexOf('<link'));
    expect(style).toBeLessThan(html.indexOf('<script'));
    const first = html.slice(style, html.indexOf('</style>', style));
    expect(first).toMatch(/html, body \{[^}]*overflow: hidden;[^}]*background: #0a1730;/);
    expect(first).toMatch(/#bootsplash-img \{[^}]*width: min\(/);
  });
});
