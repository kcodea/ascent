/**
 * ANCIENT TRIGGER PROCS, the UI binding (owner 2026-11-17, R-FX-ANCIENT-PROC-01): an event-fired Ancient plays the SAME
 * rune-trigger burst a rune badge plays (the `runeTriggered` binding), on the hero-power button, once per fire.
 *
 * This repo runs no jsdom, so the DOM half is driven with a minimal stub (one power button with a measured box), and the
 * `playDef` seam is mocked to record what would play. The per-pairing engine half (one proc per fire, every phase) is
 * the sim's table test, `packages/sim/src/ancientProcs.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ANCIENT_PROC_FLAG, type CombatEvent } from '@game/core';
import { ANCIENT_PROC_FLAGS } from '@game/sim';

const played: { def: string; at: { x: number; y: number }; index?: number }[] = [];
vi.mock('./fx/playDef', () => ({
  canPlayDefs: () => true,
  playDef: (def: string, anchors: { source: { x: number; y: number } }, opts?: { index?: number }) => { played.push({ def, at: anchors.source, index: opts?.index }); },
}));

const { playAncientProcBurst, procBursts } = await import('./ancientProcFx');
const { bindingFor } = await import('./choreo/bindings');
const { triggerCounts, ANCIENT_PROC_KEY } = await import('./choreo/triggerCounts');

const g = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
const BUTTON = { getBoundingClientRect: () => ({ left: 100, top: 200, width: 40, height: 40 }) };

beforeEach(() => {
  for (const k of ['document', 'window', 'requestAnimationFrame']) saved[k] = g[k];
  g.document = { querySelector: (sel: string) => (sel.includes('.heropowerbtn') ? BUTTON : null) };
  g.window = { innerWidth: 1000, innerHeight: 800 };
  g.requestAnimationFrame = (f: () => void) => { f(); return 1; };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }); // the burst clock reads performance.now()
  played.length = 0;
});
afterEach(() => {
  vi.advanceTimersByTime(5000); // drain any queued burst so the shared burst clock is free for the next test
  vi.useRealTimers();
  for (const k of Object.keys(saved)) g[k] = saved[k];
});

describe('the Ancient proc plays the rune-trigger burst on the hero-power button', () => {
  it('plays the runeTriggered def (the rune badges\' own burst), centred on the power button', () => {
    expect(playAncientProcBurst()).toBe(true);
    const def = bindingFor(null, 'runeTriggered')?.def;
    expect(def).toBe('rune-burst');
    expect(played).toEqual([{ def, at: { x: 120, y: 220 }, index: 0 }]);
  });

  it('two fires back to back read as two bursts (staggered), a third right away coalesces', () => {
    vi.advanceTimersByTime(5000);
    played.length = 0;
    expect(playAncientProcBurst()).toBe(true);
    expect(playAncientProcBurst()).toBe(true); // booked one stagger behind
    expect(playAncientProcBurst()).toBe(false); // already flashing with one queued
    expect(played).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(played).toHaveLength(2);
  });

  it('no power button on screen: nothing plays (and nothing throws)', () => {
    g.document = { querySelector: () => null };
    vi.advanceTimersByTime(5000);
    playAncientProcBurst();
    expect(played).toEqual([]);
  });
});

describe('the counted signals', () => {
  it('only an increase bursts, a jump of N is N, the first sight records', () => {
    expect(procBursts(undefined, 5)).toBe(0); // a page load / remount never fires
    expect(procBursts(2, 3)).toBe(1);
    expect(procBursts(1, 3)).toBe(2);
    expect(procBursts(3, 0)).toBe(0); // the combat count resets at settle: not a fire
    expect(procBursts(0, 40)).toBe(4); // capped, like the rune badges
  });

  it('combat: every Ancient proc flag replayed so far counts under the reserved key, player side only', () => {
    const ev = (flag: string, side: 'player' | 'enemy', step: number): CombatEvent => ({ type: 'questTrigger', flag, side, step } as CombatEvent);
    const alias = [...ANCIENT_PROC_FLAGS].find((f) => f !== ANCIENT_PROC_FLAG)!;
    const events = [ev(ANCIENT_PROC_FLAG, 'player', 1), ev(alias, 'player', 2), ev(ANCIENT_PROC_FLAG, 'enemy', 2), ev(ANCIENT_PROC_FLAG, 'player', 3)];
    expect(triggerCounts(events, 2, false)[ANCIENT_PROC_KEY]).toBe(2); // up to step 2 only
    expect(triggerCounts(events, 4, false)[ANCIENT_PROC_KEY]).toBe(3);
    expect(triggerCounts(events, 4, false, 'enemy')[ANCIENT_PROC_KEY]).toBe(1);
    expect(triggerCounts(events, 4, true)[ANCIENT_PROC_KEY]).toBeUndefined(); // the stale-render guard holds
  });
});

describe('the wiring (source pins: this repo renders no components in tests)', () => {
  const src = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
  it('the status bar bursts on the Shop count and the replayed combat count', () => {
    const s = src('./StatusBar.tsx');
    expect(s).toContain('s.combatTriggeredQuests[ANCIENT_PROC_KEY]');
    expect(s).toContain('useAncientProcFx(ownRun?.ancients?.procs ?? 0, combatAncientProcs)');
  });
  it('an Ancient\'s Start-of-Turn and End-of-Turn beats burst as they play', () => {
    const s = src('./Recruit.tsx');
    expect(s).toContain('if (isAncientBuffLabel(src.label)) playAncientProcBurst();');
    expect(s).toContain("if (beat.source.kind === 'hero' && isAncientBuffLabel(beat.source.label)) playAncientProcBurst();");
  });
});
