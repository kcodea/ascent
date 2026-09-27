import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Practice's Unlimited time (owner 2026-09-27: "add an unlimited time option in practice"): 0 = no turn clock. */
const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
describe('Practice Unlimited time', () => {
  it('the Time row offers Unlimited as timeMult 0', () => {
    expect(read('PracticeOptions.tsx')).toContain("{ value: 0, label: 'Unlimited' },");
  });
  it('practice on 0 runs the effectively-infinite clock and shows the infinity symbol', () => {
    const r = read('Recruit.tsx');
    expect(r).toContain("|| (run.mode === 'practice' && !run.sandbox && practiceTimer === 0);");
    expect(r).toContain("practice && practiceTimer === 0 ? '∞'");
    expect(r).toContain('<option value={0}>∞</option>');
  });
  it('the store keeps 0 instead of clamping it back to 1', () => {
    const s = read('store.ts');
    expect(s).toContain('const practiceTimer = mult === 0 ? 0 : Math.min(4, Math.max(1, Math.round(mult)));');
    expect(s).toContain("if (raw === '0') return 0;");
  });
});
