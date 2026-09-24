/**
 * THE COMBAT CAST-PREVIEW CHANNEL (owner ask + detail 2026-09-23): "X casts Y" announcements are scanned per
 * event on every kind; each (caster, spell) pair previews ONCE per fight — *"for card like fatecarver or
 * warflame that casts the same spell every time, it should only do the quick pop one time in combat"* — a
 * different spell from the same caster previews once too, and a new fight (or a seek) starts the memory over.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { CastPreviewMemory, spellCastsIn } from './castPreview';
import { SCORE_DEFAULTS, runMomentCues } from '../score';
import { canPlayDefs, playDef } from '../../fx/playDef';
import { anchorsForUnits } from '../../fx/combatAnchors';

// The other channels' fx collaborators are mocked at their contract, as score.test.ts does — this file proves
// the cast-preview channel's scan + dispatch, not how the fx layer renders.
vi.mock('../../fx/playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('../../fx/combatAnchors', () => ({ anchorsForUnits: vi.fn(() => ({ target: { x: 5, y: 7 } })) }));
void playDef; void canPlayDefs; void anchorsForUnits;

const cast = (source: string, spellId: string): CombatEvent => ({ type: 'sc', source, text: `${source} casts ${spellId}`, spellId });
const narrate = (source: string): CombatEvent => ({ type: 'sc', source, text: `${source} gains Spell Power` });
const buff = (target: string): CombatEvent => ({ type: 'buff', target, attack: 1, health: 1, source: 'fc' });
const span = (start: number, end: number): Pick<Moment, 'start' | 'end'> => ({ start, end });
const moment = (kind: Moment['kind'], events: CombatEvent[]): Moment => ({ start: 0, end: events.length, primary: events[0]!, stepGroups: [[0]], kind });
const ctx = (events: CombatEvent[], overrides: Partial<Parameters<typeof runMomentCues>[1]> = {}) => ({
  events, combatSpeed: 1, onShake: vi.fn(), slotRectOf: () => ({ cx: 0, cy: 0, w: 100, h: 140 }), attackerUid: null, meleePair: null,
  onFloats: vi.fn(), onDeathFloats: vi.fn(), onAuraBurst: vi.fn(), onShieldBreak: vi.fn(), onReborn: vi.fn(), onBuffCasts: vi.fn(),
  onSelfBuffs: vi.fn(), onImprove: vi.fn(), onMaxGold: vi.fn(), onDamageFx: vi.fn(), onSummonFx: vi.fn(), onAscend: vi.fn(), onExecuteFx: vi.fn(), ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('spellCastsIn — the scan', () => {
  it('picks out ONLY the sc events stamped with a spellId (a cast), in order, inside the window', () => {
    const events = [cast('outside', 'dragonflame'), cast('fc', 'fate'), narrate('fc'), buff('a'), cast('wf', 'dragonflame'), cast('after', 'x')];
    expect(spellCastsIn(span(1, 5), events)).toEqual([{ source: 'fc', spellId: 'fate' }, { source: 'wf', spellId: 'dragonflame' }]);
  });
  it('returns nothing for a moment with narration and buffs but no cast', () => {
    expect(spellCastsIn(span(0, 2), [narrate('fc'), buff('a')])).toEqual([]);
  });
});

describe('CastPreviewMemory — once per (caster, spell) per fight', () => {
  it('Fatecarver casting its spell three times in one combat → exactly one preview', () => {
    const mem = new CastPreviewMemory();
    expect([mem.claim('fc', 'fate'), mem.claim('fc', 'fate'), mem.claim('fc', 'fate')]).toEqual([true, false, false]);
  });
  it('two DIFFERENT spells from one caster → two previews; the same spell from another caster → its own', () => {
    const mem = new CastPreviewMemory();
    expect(mem.claim('fc', 'fate')).toBe(true);
    expect(mem.claim('fc', 'dragonflame')).toBe(true);
    expect(mem.claim('wf', 'dragonflame')).toBe(true);
    expect(mem.claim('fc', 'dragonflame')).toBe(false);
  });
  it('the next combat (reset) previews again', () => {
    const mem = new CastPreviewMemory();
    expect(mem.claim('fc', 'fate')).toBe(true);
    expect(mem.claim('fc', 'fate')).toBe(false);
    mem.reset();
    expect(mem.claim('fc', 'fate')).toBe(true);
  });
});

describe('the castPreviewFx cue', () => {
  it('rides EVERY kind (an on-attack cast is absorbed into the wind-up, so the scan is per event)', () => {
    for (const kind of Object.keys(SCORE_DEFAULTS) as (keyof typeof SCORE_DEFAULTS)[]) {
      expect(SCORE_DEFAULTS[kind].some((c) => c.ch === 'castPreviewFx'), kind).toBe(true);
    }
  });
  it('hands the moment\x27s casts to onSpellCastPreviews at the moment\x27s start', () => {
    const c = ctx([cast('fc', 'fate'), buff('a')], { onSpellCastPreviews: vi.fn() });
    runMomentCues(moment('scNarrate', c.events), c);
    expect(c.onSpellCastPreviews).toHaveBeenCalledWith([{ source: 'fc', spellId: 'fate' }]);
  });
  it('an absorbed on-attack cast (attackExchange moment) still reaches the callback', () => {
    const events: CombatEvent[] = [{ type: 'attack', attacker: 'fc', defender: 'e', side: 'player' } as unknown as CombatEvent, cast('fc', 'fate'), buff('a')];
    const c = ctx(events, { onSpellCastPreviews: vi.fn() });
    runMomentCues(moment('attackExchange', events), c);
    expect(c.onSpellCastPreviews).toHaveBeenCalledWith([{ source: 'fc', spellId: 'fate' }]);
  });
  it('is silent for a moment with no cast, and tolerates a context without the callback', () => {
    const c = ctx([narrate('fc')], { onSpellCastPreviews: vi.fn() });
    runMomentCues(moment('scNarrate', c.events), c);
    expect(c.onSpellCastPreviews).not.toHaveBeenCalled();
    const bare = ctx([cast('fc', 'fate')]);
    expect(() => runMomentCues(moment('scNarrate', bare.events), bare)).not.toThrow();
  });
  it('three Fatecarver casts across three moments, through the memory the replay keeps → ONE preview', () => {
    const mem = new CastPreviewMemory();
    const shown: string[] = [];
    const onSpellCastPreviews = (casts: { source: string; spellId: string }[]): void => {
      for (const k of casts) if (mem.claim(k.source, k.spellId)) shown.push(`${k.source}:${k.spellId}`);
    };
    for (let i = 0; i < 3; i++) { const c = ctx([cast('fc', 'fate')], { onSpellCastPreviews }); runMomentCues(moment('scNarrate', c.events), c); }
    expect(shown).toEqual(['fc:fate']);
    mem.reset(); // the next fight
    const c = ctx([cast('fc', 'fate')], { onSpellCastPreviews }); runMomentCues(moment('scNarrate', c.events), c);
    expect(shown).toEqual(['fc:fate', 'fc:fate']);
  });
});
