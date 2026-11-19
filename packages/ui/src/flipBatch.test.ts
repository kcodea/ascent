import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R-PERF-FLIP-BATCH-01 (desktop jank pass 2026-10-18): the board re-layout's slides are ONE multi-target tween per
// commit, with every rect read before any write. A tween per card interleaved GSAP's computed-transform read with the
// previous card's transform write: a forced style recalc per moved card (layout:flip:write, worst 21.7 ms on 240 Hz).
const src = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
const rowFlip = src.slice(src.indexOf('const RowFlip = memo('), src.indexOf('Refresh the last-known-centre cache'));

describe('the board FLIP writes in one batch', () => {
  it('found the RowFlip block', () => {
    expect(rowFlip.length).toBeGreaterThan(1000);
  });
  // R-PERF-ROW-SLIDE-01 (2026-11-19): the slide itself is a compositor animation now (`slideHome`, rowSlide.ts), so
  // there is no tween left to batch. The contract this file pins is unchanged: one call per commit over every mover.
  it('never starts a slide per card inside a loop', () => {
    expect(rowFlip).not.toMatch(/for \(const el of (pool|targets|all)\) \{[\s\S]{0,400}?(gsap\.fromTo|slideHome)\(\s*\[?el/);
  });
  it('both commit slides are a single slideHome over every mover, deltas by index', () => {
    const batched = rowFlip.match(/slideHome\(movers, moverDeltas, flipCfg\.commitMs/g) ?? [];
    expect(batched.length).toBe(2);
  });
  it('the row FLIP runs no GSAP tween and reads no computed transform', () => {
    expect(rowFlip).not.toMatch(/gsap\.(fromTo|to|from|set|timeline)\(/);
    expect(rowFlip).not.toMatch(/Flip\.(from|to|getState)\(/);
  });
  it('the drop branch reads every rect before writing any transition', () => {
    const drop = rowFlip.slice(rowFlip.indexOf('handPlaySnapRef.current = false;'), rowFlip.indexOf('const place = placePendingRef.current;'));
    const read = drop.indexOf('getBoundingClientRect');
    const firstWrite = drop.indexOf("el.style.transition = ''");
    expect(read).toBeGreaterThan(0);
    expect(firstWrite).toBeGreaterThan(read);
    expect(drop.slice(firstWrite)).not.toMatch(/getBoundingClientRect/);
  });
});
