import { describe, it, expect, afterEach } from 'vitest';
import { combatKeyedHoldMs, combatBeatsEnabled, setCombatLiveProvider } from './combatHolds';
import { MODE_DEFAULTS } from './resolveTiming';
import type { BeatConfigSnapshot } from './resolveTiming';

/**
 * BEAT CHOREOGRAPHER PR 21 — the first combat value the Beat Lab drives (audit step 4).
 *
 * The property that matters most is the NEGATIVE space: with the flag off, or for anything that is not a
 * keyed quest/rune trigger, the answer must be null — meaning combat pacing is byte-identical to today.
 * The override is a scalpel for the ~57 keyed flags, not a new pacing regime for fights.
 */
const EMPTY: BeatConfigSnapshot = { version: 2, templates: {}, overrides: {} };
const gems = { type: 'questTrigger', flag: 'runeAttackingGems' };

describe('the LIVE toggle is the single switch (owner ask 2026-08-14 — one click, no console)', () => {
  afterEach(() => setCombatLiveProvider(() => false));

  it('combatBeatsEnabled follows the live provider — flip it on and combat is enabled', () => {
    setCombatLiveProvider(() => true);
    expect(combatBeatsEnabled()).toBe(true);
    setCombatLiveProvider(() => false);
    // With the provider off and no localStorage flag in this env, it falls back to off.
    expect(combatBeatsEnabled()).toBe(false);
  });

  it('a keyed trigger paces from config the moment the toggle is on, with no explicit enabled option', () => {
    setCombatLiveProvider(() => true);
    // No `enabled` in options → it reads the real gate, which the provider now drives.
    expect(combatKeyedHoldMs(gems, { config: EMPTY })).not.toBeNull();
  });
});

describe('the negative space — when combat pacing must be untouched', () => {
  it('flag off → null, regardless of the moment', () => {
    expect(combatKeyedHoldMs(gems, { enabled: false })).toBeNull();
  });

  it('an ordinary combat moment is never overridden, even with the flag on', () => {
    for (const type of ['attack', 'dmg', 'death', 'summon', 'buff', 'sc']) {
      expect(combatKeyedHoldMs({ type }, { enabled: true, config: EMPTY }), type).toBeNull();
    }
  });

  it('a trigger with no flag, or a flag no content owns, is never guessed (PR 1\'s rule)', () => {
    expect(combatKeyedHoldMs({ type: 'questTrigger' }, { enabled: true, config: EMPTY })).toBeNull();
    expect(combatKeyedHoldMs({ type: 'questTrigger', flag: 'notARealFlag' }, { enabled: true, config: EMPTY })).toBeNull();
  });
});

describe('keyed triggers take compiled timing', () => {
  it('Attacking Gems resolves through its registry row (foldedCue → the folded envelope)', () => {
    const hold = combatKeyedHoldMs(gems, { enabled: true, config: EMPTY, draft: null });
    expect(hold).toBe(MODE_DEFAULTS.reactInsideParent.completionOffsetMs); // classified foldedCue today
  });

  it('a committed override re-paces the fight\'s pause', () => {
    const config: BeatConfigSnapshot = {
      version: 2, templates: {},
      overrides: { 'source:rune:rune_attacking_gems:combat': { completionOffsetMs: 900, deliveryOffsetMs: 0 } },
    };
    expect(combatKeyedHoldMs(gems, { enabled: true, config, draft: null })).toBe(900);
  });

  it('the LIVE draft layers on top — the Lab loop reaches combat', () => {
    const hold = combatKeyedHoldMs(gems, {
      enabled: true, config: EMPTY,
      draft: { timings: { 'source:rune:rune_attacking_gems:combat': { windupMs: 0, holdMs: 1500, recoveryMs: 0 } }, policies: {} },
    });
    expect(hold).toBe(1500);
  });

  it("the owner's exact ask: flipping it to ownBeat gives it a real beat", () => {
    const folded = combatKeyedHoldMs(gems, { enabled: true, config: EMPTY, draft: null })!;
    const own = combatKeyedHoldMs(gems, {
      enabled: true, config: EMPTY,
      draft: { timings: {}, policies: { 'source:rune:rune_attacking_gems:combat': 'ownBeat' } },
    })!;
    expect(own).toBe(MODE_DEFAULTS.ownBeat.completionOffsetMs);
    expect(own).toBeGreaterThan(folded);
  });

  it('a silent reclassification floors at a legible tick instead of a literal 0', () => {
    const hold = combatKeyedHoldMs(gems, {
      enabled: true, config: EMPTY,
      draft: { timings: {}, policies: { 'source:rune:rune_attacking_gems:combat': 'passive' } },
    });
    expect(hold).toBe(40);
  });

  it('is deterministic', () => {
    const a = combatKeyedHoldMs(gems, { enabled: true, config: EMPTY, draft: null });
    const b = combatKeyedHoldMs(gems, { enabled: true, config: EMPTY, draft: null });
    expect(a).toBe(b);
  });
});

describe('PR 23 — the MINION class is tunable through the same gate (Oona et al.)', () => {
  const oona = { type: 'buff', key: 'factory:onSummonTribeBuffThenDouble:onSummon', srcCard: 'b2_oona' };

  it('a stamped minion effect resolves through its registry row', () => {
    const hold = combatKeyedHoldMs(oona, { enabled: true, config: EMPTY, draft: null });
    expect(hold).toBe(MODE_DEFAULTS.reactInsideParent.completionOffsetMs); // summonReact is foldedCue today
  });

  it("the LIBRARY's own edit key (source:minion:<cardId>:<on>) re-paces it", () => {
    const hold = combatKeyedHoldMs(oona, {
      enabled: true, config: EMPTY,
      draft: { timings: { 'source:minion:b2_oona:onSummon': { windupMs: 0, holdMs: 1800, recoveryMs: 0 } }, policies: {} },
    });
    expect(hold).toBe(1800);
  });

  it("the owner's ORIGINAL ask, now as a class member: flip Oona to ownBeat and the read re-bases", () => {
    const own = combatKeyedHoldMs(oona, {
      enabled: true, config: EMPTY,
      draft: { timings: {}, policies: { 'source:minion:b2_oona:onSummon': 'ownBeat' } },
    })!;
    expect(own).toBe(MODE_DEFAULTS.ownBeat.completionOffsetMs);
  });

  it('an unstamped moment, or a stamped key the registry does not carry, keeps its pacing', () => {
    expect(combatKeyedHoldMs({ type: 'buff' }, { enabled: true, config: EMPTY })).toBeNull();
    expect(combatKeyedHoldMs({ type: 'buff', key: 'factory:notReal:onSummon', srcCard: 'x' }, { enabled: true, config: EMPTY })).toBeNull();
  });

  it('flag off → null for the minion path too', () => {
    expect(combatKeyedHoldMs(oona, { enabled: false })).toBeNull();
  });
});
