// @vitest-environment jsdom
/**
 * R-SKIP-DIAMOND-01 (owner ask 2026-10-22): Skip lives on the End Turn diamond. While the combat replay can be
 * skipped the diamond glows yellow, its hover pill reads "Skip Combat", and a click runs Skip (not End Turn or End
 * Combat). The old Skip pill is gone, and the glow is an opacity fade over a static filter (never a paint loop).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type Mounted } from './renderedText.mount';
import { EndTurnButton } from './EndTurnButton';

// jsdom has no 2D canvas; the diamond's lightning canvas just needs a context that does nothing.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

const btn = (): HTMLButtonElement => ui!.container.querySelector('button.etbwrap')!;

describe('R-SKIP-DIAMOND-01: the diamond is the Skip button during the replay', () => {
  it('glows (the .skip state), reads "Skip Combat" and skips on click', () => {
    const onSkip = vi.fn(), onEndTurn = vi.fn(), onEndCombat = vi.fn();
    ui = mount(<EndTurnButton onEndTurn={onEndTurn} onEndCombat={onEndCombat} onSkip={onSkip} skipReady pressed disabled={false} urgent={false} />);
    expect(btn().classList.contains('skip')).toBe(true);
    expect(btn().disabled).toBe(false);
    expect(btn().getAttribute('aria-label')).toBe('Skip combat');
    expect(btn().querySelector('.etb-tip')!.textContent).toBe('Skip Combat');
    expect(btn().querySelector('.etb-skipglow')).not.toBeNull();
    act(() => { btn().click(); });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onEndTurn).not.toHaveBeenCalled();
    expect(onEndCombat).not.toHaveBeenCalled();
  });

  it('once the replay is done it is End Combat again, with no glow', () => {
    const onSkip = vi.fn(), onEndCombat = vi.fn();
    ui = mount(<EndTurnButton onEndTurn={vi.fn()} onEndCombat={onEndCombat} onSkip={onSkip} combatReady pressed disabled={false} urgent={false} />);
    expect(btn().classList.contains('skip')).toBe(false);
    expect(btn().querySelector('.etb-tip')!.textContent).toBe('End combat and go back to shop');
    act(() => { btn().click(); });
    expect(onEndCombat).toHaveBeenCalledTimes(1);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('a Skip click fires the owner skip-sparks at the gem on the wall clock, and the def ships', () => {
    const src = readFileSync(join(__dirname, 'EndTurnButton.tsx'), 'utf8');
    expect(src).toContain("playDef('skip-sparks', { source: at, target: at }, { realTime: true });");
    const def = JSON.parse(readFileSync(join(__dirname, 'fx', 'defs', 'skip-sparks.json'), 'utf8')) as { id: string };
    expect(def.id).toBe('skip-sparks');
    // realTime divides the Skip's FX clock rate back out, so the sparks are not raced by the Skip they start.
    expect(readFileSync(join(__dirname, 'fx', 'playDef.ts'), 'utf8')).toContain('opts.realTime ? scaledMs / pixiFx.getTimeScale() : scaledMs');
  });

  it('Recruit drives it from the replay and no longer renders the Skip pill', () => {
    const src = readFileSync(join(__dirname, 'Recruit.tsx'), 'utf8');
    expect(src).toContain('const skipReady = fighting && !replayDone && !replayTurboing;');
    expect(src).toContain('skipReady={inCombat && skipReady}');
    expect(src).toContain('onSkip={onSkip}');
    expect(src).not.toContain('combathud-skip');
  });

  it('the yellow glow fades on opacity over a static filter, never a looping animation', () => {
    const css = readFileSync(join(__dirname, 'styles.css'), 'utf8');
    expect(css).not.toContain('.combathud-skip');
    const rules = css.split('}').filter((r) => r.includes('.etb-skipglow'));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/animation\s*:/);
    expect(css).toMatch(/\.etbwrap\.skip \.etb-skipglow \{ opacity: 1; \}/);
  });
});
