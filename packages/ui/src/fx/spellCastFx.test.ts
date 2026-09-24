// @vitest-environment jsdom
/**
 * GROWTH'S AND WAKING RIFT'S CAST EFFECTS, PRESENTATION HALF (owner 2026-09-24): *"i added a growth effect for
 * whenever growth is cast, by any means. player,rune,minion etc and any phase. recruit, combat, end of turn
 * whatever it may be."* and, the same day, *"i added a waking rift effect"*.
 *
 * ONE mechanism, one map entry per spell: the spell's card-level `spellCast` row in bindings.json (`growth` ->
 * `growth-effect`, `sparkplug` (Waking Rift, id kept from Spark Plug) -> `waking-rift-fx`), read by
 * `spellCastFxFor` and played from every phase's path. Each case drives the REAL path with the real signal shape:
 * the player's `spellCast` moment through the shop cue runner, the sim's `castFx` records for rune / minion /
 * End-of-Turn casts, the `spellResolved` consequence presenter, and a REAL `simulate()` log compiled into moments
 * and run through the combat score, with `playDef` mocked at the contract. The engine halves are pinned
 * separately: packages/sim/src/growthCastFx.test.ts (shop records) and
 * packages/core/src/combat/growthCastTag.test.ts (combat `sc` + `spellId` tagging).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type CombatEvent } from '@game/core';
import { canPlayDefs, playDef } from './playDef';
import { playCombatSpellCastFx, playRecordedCastFx, playSpellCastFx } from './spellCastFx';
import { castFxReplacesTendril, spellCastFxFor } from '../choreo/bindings';
import { groupBuffCasts } from '../choreo/channels/buffCast';
import { runRecruitMomentCues } from '../choreo/recruitCues';
import { spellCastMoment } from '../choreo/recruitMoments';
import { compileMoments } from '../choreo/compile';
import { runMomentCues } from '../choreo/score';
import { spellCastsIn } from '../choreo/channels/castPreview';
import { presentConsequence } from '../choreographer/consequencePresenters';

vi.mock('./playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('./combatAnchors', () => ({ anchorsForUnits: vi.fn(() => null) }));
const mockPlayDef = vi.mocked(playDef);

const readRecruit = (): string => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../Recruit.tsx'), 'utf8');
const plays = (def: string): unknown[][] => mockPlayDef.mock.calls.filter((c) => c[0] === def);
const camera = (): { x: number; y: number } => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
/** [spell name, spell id, the owner's def]. */
const SPELLS = [['Growth', 'growth', 'growth-effect'], ['Waking Rift', 'sparkplug', 'waking-rift-fx']] as const;

/** Compile a REAL combat log into moments and run every moment through the combat score (every other channel's
 *  callback a no-op). Returns the number of `sc` + `spellId` casts in the log, for the caller to compare. */
function runScore(events: CombatEvent[], player: readonly { uid: string; cardId: string }[]): number {
  const noop = (): void => {};
  const ctx = new Proxy({ events, combatSpeed: 1, slotRectOf: () => null, attackerUid: null, meleePair: null,
    cardIds: new Map(player.map((m) => [m.uid, m.cardId] as [string, string])) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : noop),
  });
  for (const m of compileMoments(events)) runMomentCues(m, ctx as never);
  vi.runAllTimers();
  return events.filter((e) => e.type === 'sc' && typeof e.spellId === 'string').length;
}

beforeEach(() => { mockPlayDef.mockClear(); vi.mocked(canPlayDefs).mockReturnValue(true); });
afterEach(() => { vi.useRealTimers(); });

describe('the per-spell cast binding', () => {
  it('each bound spell resolves its own card-level cast effect; the kind default and fan-out rows do not leak in', () => {
    expect(spellCastFxFor('growth')?.def).toBe('growth-effect');
    expect(spellCastFxFor('sparkplug')?.def).toBe('waking-rift-fx');
    expect(spellCastFxFor('staffofguel'), 'an unbound spell must NOT fall through to the spell-sparks default').toBeNull();
    expect(spellCastFxFor('sp_dragonflame'), 'a buffedOn row plays per buff on its own path').toBeNull();
    expect(spellCastFxFor('wo_mine'), 'an Ale volley row plays per buff on its own path').toBeNull();
  });

  it('plays once, on the camera (viewport centre): the defs are authored board-wide', () => {
    expect(playSpellCastFx('growth')).toBe(true);
    expect(plays('growth-effect')).toHaveLength(1);
    expect((plays('growth-effect')[0]![1] as { camera: unknown }).camera).toEqual(camera());
    expect(playSpellCastFx('staffofguel')).toBe(false);
  });

  it('the Shop watcher and the legacy End-of-Turn beat both route through `playRecordedCastFx`', () => {
    const src = readRecruit();
    expect(src).toContain("playRecordedCastFx(run.castFx, 'recruit')");
    expect(src).toContain('playRecordedCastFx(bfx.casts)');
  });
});

describe.each(SPELLS)('%s plays its own effect in every phase, from every source', (_name, id, def) => {
  it('PLAYER, from hand (the shop `spellCast` moment through the recruit cue runner)', () => {
    runRecruitMomentCues(spellCastMoment(id, { x: 120, y: 340 }), { cardIdOf: () => null, measure: () => null });
    expect(plays(def)).toHaveLength(1);
  });

  it('RUNE and MINION, in the Shop (the sim `castFx` records, recruit phase)', () => {
    const played = playRecordedCastFx([
      { spellId: id, phase: 'recruit' }, // Rune of the Gilded Ledger
      { spellId: id, phase: 'recruit' }, // a Mage-Pup's Shout / a shop Rally
      { spellId: id, phase: 'endOfTurn' }, // left to the End-of-Turn beat, never double-played here
    ], 'recruit');
    expect(played).toBe(2);
    expect(plays(def)).toHaveLength(2);
  });

  it('END OF TURN: the legacy per-beat `EotStepFx.casts` and the authoritative `spellResolved` presenter', () => {
    expect(playRecordedCastFx([{ spellId: id, phase: 'endOfTurn' }, { spellId: id, phase: 'endOfTurn' }])).toBe(2);
    // The authoritative path: the presenter hands the cast to the context's `spellCast`...
    const spellCast = vi.fn();
    presentConsequence({
      consequence: { type: 'spellResolved', cardId: id },
      beat: { source: { kind: 'rune', id: 'rune_recurrence' } },
      ctx: { spellCast },
    } as never);
    expect(spellCast).toHaveBeenCalledWith(id, { kind: 'rune', id: 'rune_recurrence' });
    // ...and Recruit.tsx's context plays the spell's own effect there, for ANY source (a hero / quest beat too).
    const src = readRecruit();
    const at = src.indexOf('spellCast: (cardId, source) => {');
    expect(at).toBeGreaterThan(0);
    // (A rune's cast flourishes first and plays the effect through `playRuneSpellCastFx`: runeCastFlourish.test.ts.)
    expect(src.slice(at, at + 600)).toContain("if (source.kind === 'rune') playRuneSpellCastFx(cardId, source.id);");
    expect(src.slice(at, at + 600)).toContain('else playSpellCastFx(cardId);');
    expect(plays(def)).toHaveLength(2);
  });

  it('COMBAT: Sporebat re-casting it plays one effect per cast, through the real score', () => {
    vi.useFakeTimers();
    const r = simulate([{ cardId: 'sporebat', attack: 2, health: 1 }, { cardId: 'pack', attack: 3, health: 200 }],
      [{ cardId: 'omen', attack: 5, health: 200 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 4, lastSpellCastId: id }), combatSide({ tier: 1 }));
    expect(runScore(r.events as CombatEvent[], r.initial.player)).toBe(1);
    expect(plays(def)).toHaveLength(1);
  });
});

describe('combat Growth from its dedicated casters (the arena castRepeat path)', () => {
  it.each([
    ['Fatecarver (on any ally attack)', { cardId: 'n2_fatecarver', attack: 4, health: 900, chosenOption: 1 }],
    ['Hoardbreaker Drake (Rally)', { cardId: 'hoardbreaker', attack: 4, health: 900 }],
  ])('%s: one growth-effect per Growth cast, through the real score', (_n, caster) => {
    vi.useFakeTimers();
    const r = simulate([caster, { cardId: 'sandbag', attack: 1, health: 900 }], [{ cardId: 'sandbag', attack: 0, health: 90000 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const casts = runScore(r.events as CombatEvent[], r.initial.player);
    expect(casts).toBeGreaterThan(0);
    expect(plays('growth-effect')).toHaveLength(casts);
  });

  it('the channel plays per cast, not once per fight (unlike the cast preview)', () => {
    const casts = spellCastsIn({ start: 0, end: 3 }, [
      { type: 'sc', source: 'FC', text: 'Fatecarver casts Growth', spellId: 'growth' },
      { type: 'sc', source: 'FC', text: 'Fatecarver casts Growth', spellId: 'growth' },
      { type: 'sc', source: 'X', text: 'narration' },
    ] as CombatEvent[]);
    expect(playCombatSpellCastFx(casts)).toBe(2);
  });
});

/**
 * THE CAST EFFECT REPLACES THE CASTER'S TENDRIL (owner ruling 2026-09-24, verbatim): *"the growth and waking rift
 * effects should replace the tendril for a card that carried those effects, like fatecarver as an example."*
 * Every phase's buff path asks ONE predicate (`castFxReplacesTendril`) of the spell tag the sim put on the buff.
 */
describe('a bound spell cast by a card replaces the tendril; an unbound one keeps it', () => {
  it('the predicate: bound spells replace, unbound / untagged do not', () => {
    expect(castFxReplacesTendril('growth')).toBe(true);
    expect(castFxReplacesTendril('sparkplug')).toBe(true);
    expect(castFxReplacesTendril('spiritfire')).toBe(false);
    expect(castFxReplacesTendril('sp_dragonflame'), 'Dragonflame has its own buffedOn def path').toBe(false);
    expect(castFxReplacesTendril(undefined)).toBe(false);
  });

  it('COMBAT, Fatecarver: growth-effect plays per cast AND every buff it cast is claimed (no tendril)', () => {
    vi.useFakeTimers();
    const r = simulate([{ cardId: 'n2_fatecarver', attack: 4, health: 900, chosenOption: 1 }, { cardId: 'sandbag', attack: 1, health: 900 }],
      [{ cardId: 'sandbag', attack: 0, health: 90000 }], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const events = r.events as CombatEvent[];
    const fc = r.initial.player.find((m) => m.cardId === 'n2_fatecarver')!.uid;
    // The buff casts `fireBuffCasts` receives (both from the buff-wave cue and the attack wind-up).
    const casts = groupBuffCasts({ start: 0, end: events.length } as never, events).filter((c) => c.source === fc);
    expect(casts.length, 'Fatecarver buffed its allies').toBeGreaterThan(0);
    expect(casts.every((c) => castFxReplacesTendril(c.spellId)), 'every Fatecarver Growth buff drops its tendril').toBe(true);
    const played = runScore(events, r.initial.player);
    expect(plays('growth-effect')).toHaveLength(played);
  });

  it('COMBAT, an UNBOUND spell cast by a card (Sporebat re-casting Spirit Fire) keeps its tendril', () => {
    const r = simulate([{ cardId: 'sporebat', attack: 2, health: 1 }, { cardId: 'pack', attack: 3, health: 200 }],
      [{ cardId: 'omen', attack: 5, health: 200 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 4, lastSpellCastId: 'spiritfire' }), combatSide({ tier: 1 }));
    const events = r.events as CombatEvent[];
    const casts = groupBuffCasts({ start: 0, end: events.length } as never, events).filter((c) => c.spellId === 'spiritfire');
    expect(casts.length, 'Sporebat cast Spirit Fire on a friendly Beast').toBeGreaterThan(0);
    expect(casts.some((c) => castFxReplacesTendril(c.spellId))).toBe(false);
  });

  it('combat and the shop both ask the predicate before drawing the tendril', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const replay = readFileSync(join(here, '../useCombatReplay.ts'), 'utf8');
    const fire = replay.slice(replay.indexOf('const fireBuffCasts = useCallback('));
    expect(fire.indexOf('castFxReplacesTendril(c.spellId)')).toBeGreaterThan(0);
    expect(fire.indexOf('castFxReplacesTendril(c.spellId)')).toBeLessThan(fire.indexOf('fireBuffFx('));
    const recruit = readRecruit();
    const replayFx = recruit.slice(recruit.indexOf('const replayBuffFxEvents = useCallback('));
    expect(replayFx.indexOf('castFxReplacesTendril(ev.spellId)')).toBeGreaterThan(0);
    expect(replayFx.indexOf('castFxReplacesTendril(ev.spellId)')).toBeLessThan(replayFx.indexOf('fireBuffFx('));
    expect(recruit).toContain('spellHasCastFx: castFxReplacesTendril');
  });

  it('END OF TURN (authoritative beats): a bound spell\'s tagged stat gain draws no tendril; an unbound one does', () => {
    const statGain = vi.fn();
    const ctx = { statGain, spellHasCastFx: castFxReplacesTendril, selfBuff: vi.fn(), heroPowerGain: vi.fn(), questTendril: vi.fn() };
    const beat = { source: { kind: 'minion', id: 'b2_magepup', uid: 'p' } };
    const gain = (spellId?: string) => ({ type: 'statsChanged', target: { zone: 'board', uid: 'a', cardId: 'stray', side: 'player' },
      attack: 1, health: 1, permanent: true, channel: 'ordinary', ...(spellId ? { spellId } : {}) });
    presentConsequence({ consequence: gain('growth'), beat, ctx } as never);
    presentConsequence({ consequence: gain('sparkplug'), beat, ctx } as never);
    expect(statGain).not.toHaveBeenCalled();
    presentConsequence({ consequence: gain('spiritfire'), beat, ctx } as never);
    presentConsequence({ consequence: gain(), beat, ctx } as never);
    expect(statGain).toHaveBeenCalledTimes(2);
  });
});
