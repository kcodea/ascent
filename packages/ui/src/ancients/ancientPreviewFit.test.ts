import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The Ancients preview never clips a page (owner 2026-09-27: "the full text should show"). */
describe('Ancients preview sizes to the tallest page', () => {
  const tsx = readFileSync(join(__dirname, 'AncientPreview.tsx'), 'utf8');
  const css = readFileSync(join(__dirname, 'ancients.css'), 'utf8');
  it('renders an invisible sizer of every Ancient page in the stage cell', () => {
    expect(tsx).toContain('className="anc-pv-sizer" aria-hidden="true"');
    expect(tsx).toContain('ANCIENT_IDS.map((a) => <div key={a} className="anc-pv-page">');
  });
  it('the stage is a one-cell grid with no fixed height, and pages are not absolutely positioned', () => {
    expect(css).toContain('.anc-pv-stage { position: relative; display: grid; min-height: 420px; overflow: hidden; }');
    expect(css).not.toMatch(/\.anc-pv-stage \{[^}]*(?<![-\w])height: 420px/);
    expect(css).not.toMatch(/\.anc-pv-page \{ position: absolute; inset: 0; \}/);
  });
});
