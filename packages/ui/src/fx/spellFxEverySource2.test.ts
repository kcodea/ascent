// @vitest-environment jsdom
/**
 * SPELL EFFECTS FROM EVERY SOURCE, FOLLOW-UP (owner answers relayed 2026-09-24, on the report "all spell animations
 * and sfx should be wired to play whenever a spell or minion is cast/played from any source"):
 *
 *   1. rune and minion casts ring the generic cast sound, burst-gated per spell;
 *   2. Golden / Reinforcing Ale (no buffs) play their row once AT THE SOURCE from a rune or a minion;
 *   3. (sim) Lasso leaves its real caster; the UI throws from a `rune:<id>` origin's badge;
 *   4. Staff of Guel's shop-wide effect plays on the authoritative End of Turn;
 *   5. a minion arriving from any source gets the landing dust + summon sound (clip gate: summonSfxGate.test.ts);
 *   7. combat Dragonflame no longer plays twice on a standalone buff wave.
 *
 * `playDef` and `sfx` are mocked at the contract; the sim halves are in packages/sim/src/spellFxEverySource.test.ts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import { playDef } from './playDef';
import { sfx } from '../sfx';
import {
  playCombatSpellCastFx, playGenericCastSound, playRecordedCastFx, resetSpellCastSoundGate, sourceOnlyCastRow,
} from './spellCastFx';
import { presentConsequence } from '../choreographer/consequencePresenters';
import { compileMoments } from '../choreo/compile';
import { runMomentCues } from '../choreo/score';
import { resetBuffFxConfig } from '../buffFxConfig';
import { resetCastPreviewConfig, setCastPreviewValue } from '../castPreviewConfig';

vi.mock('./playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('./combatAnchors', () => ({ anchorsForUnits: vi.fn(() => ({ source: { x: 500, y: 500 }, target: { x: 500, y: 500 } })) }));
vi.mock('../sfx', () => ({ sfx: new Proxy({} as Record<string, unknown>, { get: (t, k: string) => (t[k] ??= vi.fn()) }) }));
const mockPlayDef = vi.mocked(playDef);
const plays = (def: string) => mockPlayDef.mock.calls.filter((c) => c[0] === def);
const anchorsOf = (call: unknown[]) => call[1] as { source: { x: number; y: number }; target: { x: number; y: number } };
const castSpellSfx = () => vi.mocked((sfx as unknown as Record<string, () => void>).castSpell);
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(here, rel), 'utf8');

const NODE = { x: 60, y: 30 };
function rectAt(x: number, y: number, w: number, h: number): () => DOMRect {
  return () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}) }) as DOMRect;
}
function mountRune(id: string): void {
  const rail = document.createElement('div');
  rail.className = 'questbadges';
  const node = document.createElement('div');
  node.className = 'runebadge';
  node.dataset.sourceId = id;
  node.getBoundingClientRect = rectAt(40, 10, 40, 40);
  rail.appendChild(node);
  document.body.appendChild(rail);
}
function mountMinion(uid: string, at: { x: number; y: number }): void {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.uid = uid;
  el.getBoundingClientRect = rectAt(at.x - 50, at.y - 70, 100, 140);
  document.body.appendChild(el);
}

let clock = 1000;
beforeEach(() => {
  mockPlayDef.mockClear();
  castSpellSfx().mockClear();
  resetSpellCastSoundGate();
  resetBuffFxConfig();
  setCastPreviewValue('runeFlourishOn', 0); // synchronous rune casts
  document.body.innerHTML = '';
  clock += 10_000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => { vi.restoreAllMocks(); resetCastPreviewConfig(); });

describe('1. the generic cast sound rings for every source, once per burst per spell', () => {
  it('a rune\'s and a minion\'s Shop cast records ring it; a burst of one spell rings once, two spells ring twice', () => {
    playRecordedCastFx([
      { source: { kind: 'rune', id: 'rune_recurrence' }, spellId: 'growth', phase: 'recruit' },
      { source: { kind: 'rune', id: 'rune_recurrence' }, spellId: 'growth', phase: 'recruit' },
      { source: { kind: 'minion', uid: 'p' } as never, spellId: 'spiritfire', phase: 'recruit' },
    ], 'recruit');
    expect(castSpellSfx()).toHaveBeenCalledTimes(2);
  });

  it('past the gap the same spell rings again', () => {
    expect(playGenericCastSound('growth')).toBe(true);
    expect(playGenericCastSound('growth')).toBe(false);
    clock += 300;
    expect(playGenericCastSound('growth')).toBe(true);
  });

  it('every other path goes through the same gate: the End-of-Turn presenter, combat `sc`, the player\'s own cast', () => {
    expect(src('../Recruit.tsx')).toContain('playGenericCastSound(cardId); // the cast sound, from every source');
    expect(src('../useCombatReplay.ts')).toContain('playGenericCastSound(e.spellId);');
    const store = src('../store.ts');
    expect(store).toContain('else if (def?.spell && card) playGenericCastSound(card.cardId);');
    expect(store).not.toContain('else if (def?.spell) sfx.castSpell();');
  });
});

describe('2. Golden / Reinforcing Ale from a rune or a minion play their row once at the source', () => {
  it('only the no-buff Ales qualify (a stat Ale keeps its per-buff play)', () => {
    expect(sourceOnlyCastRow('wo_mine')?.def).toBe('coin-ale');
    expect(sourceOnlyCastRow('wo_reinforcement')?.def).toBe('reinforcing-ale');
    expect(sourceOnlyCastRow('wo_attack')).toBeNull();
    expect(sourceOnlyCastRow('sp_dragonflame')).toBeNull();
    expect(sourceOnlyCastRow('growth')).toBeNull();
  });

  it('RUNE: on the rune node', () => {
    mountRune('rune_recurrence');
    playRecordedCastFx([{ source: { kind: 'rune', id: 'rune_recurrence' }, spellId: 'wo_mine', phase: 'recruit' }], 'recruit');
    expect(plays('coin-ale').map(anchorsOf)).toEqual([expect.objectContaining({ source: NODE, target: NODE })]);
  });

  it('MINION (Shop record): on the caster\'s body', () => {
    mountMinion('p', { x: 300, y: 400 });
    playRecordedCastFx([{ source: { kind: 'minion', uid: 'p' } as never, spellId: 'wo_reinforcement', phase: 'recruit' }], 'recruit');
    expect(plays('reinforcing-ale').map(anchorsOf)).toEqual([expect.objectContaining({ source: { x: 300, y: 400 }, target: { x: 300, y: 400 } })]);
  });

  it('COMBAT: on the caster', () => {
    playCombatSpellCastFx([{ source: 'm0', spellId: 'wo_mine' } as never]);
    expect(plays('coin-ale').map(anchorsOf)).toEqual([expect.objectContaining({ source: { x: 500, y: 500 } })]);
  });
});

describe('3. a Lasso from a rune other than Lassoing leaves that rune\'s badge', () => {
  it('the beam resolves a `rune:<id>` origin to that rune\'s node', () => {
    const recruit = src('../Recruit.tsx');
    const beam = recruit.slice(recruit.indexOf('const fireLassoBeam = useCallback('));
    expect(beam.indexOf("ev.origin.startsWith('rune:')")).toBeGreaterThan(0);
    expect(beam.indexOf("ev.origin.startsWith('rune:')")).toBeLessThan(beam.indexOf("playDef('lasso'"));
  });
});

describe('4. Staff of Guel on the authoritative End of Turn', () => {
  it('a `shopBuff` aura on a beat plays the shop-wide effect', () => {
    const shopBuffAll = vi.fn();
    const ctx = { spellPower: vi.fn(), impAura: vi.fn(), rubyAura: vi.fn(), shopBuffAll };
    const beat = { source: { kind: 'minion', id: 'dm_curator', uid: 'sd', label: 'Soul Defiler' } };
    presentConsequence({ consequence: { type: 'auraChanged', aura: 'shopBuff', amount: 4, attack: 2, health: 2 }, beat, ctx, index: 0 } as never);
    expect(shopBuffAll).toHaveBeenCalledWith(2, 2, undefined);
    expect(src('../Recruit.tsx')).toContain('shopBuffAll: (attack, health, sourceCardId) => {');
  });
});

describe('5. a minion arriving from any source lands like a player play', () => {
  it('the Shop arrival watcher and the End-of-Turn summon both play the landing dust and the summon sound', () => {
    const recruit = src('../Recruit.tsx');
    const watcher = recruit.slice(recruit.indexOf('const arrivalPrevRef = useRef'));
    expect(watcher.slice(0, 1200)).toMatch(/puffOnBoard\(c\.uid\);\s*sfx\.summon\(c\.cardId\);/);
    expect(recruit).toContain('cardSummoned: (cardId, uid) => { puffOnBoard(uid); sfx.summon(cardId); },');
    // The player's own play is excluded (it already lands with both).
    expect(recruit).toContain('playerPlacedRef.current.add(action.uid);');
  });
});

describe('7. combat Dragonflame plays once per buffed unit on a standalone wave', () => {
  it('the `fxDef` cue leaves an authored spell\'s buffs to `fireBuffCasts` (it used to play the column too)', () => {
    vi.useFakeTimers();
    const events = [
      { type: 'sc', source: 'm0', text: 'Rune of Spellhide casts Dragonflame', spellId: 'sp_dragonflame', rune: 'rune_spellhide', side: 'player', step: 0 },
      { type: 'buff', target: 'm1', attack: 4, health: 4, source: 'm0', spellId: 'sp_dragonflame', step: 1 },
      { type: 'buff', target: 'm2', attack: 4, health: 4, source: 'm0', spellId: 'sp_dragonflame', step: 2 },
    ] as unknown as CombatEvent[];
    const handedToBuffCasts: string[] = [];
    const noop = (): void => {};
    const ctx = new Proxy({
      events, combatSpeed: 1, slotRectOf: () => null, attackerUid: null, meleePair: null,
      cardIds: new Map([['m0', 'd2_ashscribe'], ['m1', 'd2_ashscribe'], ['m2', 'd2_ashscribe']]),
      onBuffCasts: (c: { target: string; spellId?: string }[]) => { for (const x of c) if (x.spellId === 'sp_dragonflame') handedToBuffCasts.push(x.target); },
    } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : noop) });
    for (const m of compileMoments(events)) runMomentCues(m, ctx as never);
    vi.runAllTimers();
    vi.useRealTimers();
    expect(plays('dragonflame'), 'the score itself plays none').toHaveLength(0);
    expect(handedToBuffCasts, 'fireBuffCasts plays one column per buffed unit').toEqual(['m1', 'm2']);
  });
});
