import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';
import { compileMoments } from '../compile';
import { attackSummonUids, ralliesFiredIn, rallyDamageEventIndex, rallyPulseUnits, RALLY_BEAT_MS, RALLY_GAP_MS } from './rallyFired';

const rally = (source: string, target: string): CombatEvent => ({ type: 'rally', source, target } as CombatEvent);
const buff = (target: string): CombatEvent =>
  ({ type: 'buff', target, attack: 1, health: 1, source: 's' } as CombatEvent);
const summon = (uid: string, source: string): CombatEvent =>
  ({ type: 'summon', minion: { uid }, side: 'player', index: 0, source } as unknown as CombatEvent);

/** Only `start`/`end` are read; the rest of a Moment is irrelevant to this scan. */
const span = (start: number, end: number): Moment => ({ start, end } as unknown as Moment);

describe('ralliesFiredIn', () => {
  it('picks out ONLY the rally events', () => {
    expect(ralliesFiredIn(span(0, 3), [buff('a'), rally('r', 'e'), buff('c')]))
      .toEqual([{ source: 'r', target: 'e', count: 1, delivered: [[]] }]);
  });

  it('returns nothing for a moment with no Rally in it', () => {
    expect(ralliesFiredIn(span(0, 2), [buff('a'), buff('b')])).toEqual([]);
  });

  /** BOTH ends, which is the property that made a Rally unrepresentable through the primary-event `fxDef`
   *  path: what plays is decided by the rallier's card, and where it plays is the ally it procced. */
  it('carries both ends of the pair', () => {
    const [fired] = ralliesFiredIn(span(0, 1), [rally('echohorn', 'sporeling')]);
    expect(fired).toEqual({ source: 'echohorn', target: 'sporeling', count: 1, delivered: [[]] });
  });

  it('keeps event order across distinct pairs', () => {
    const events = [rally('r2', 'e2'), rally('r1', 'e1')];
    expect(ralliesFiredIn(span(0, 2), events).map((f) => f.source)).toEqual(['r2', 'r1']);
  });

  /** A gilded Echohorn loops `mul(self)` times, and Elderhorn's Hunt grant adds more procs — two fires on the
   *  same ally is a 2-STACK, not a duplicate to collapse. Erasing it would hide the multiplier. */
  it('COUNTS a pair that fires twice in one moment, keeping first-seen order', () => {
    const events = [rally('r1', 'e1'), rally('r2', 'e2'), rally('r1', 'e1')];
    expect(ralliesFiredIn(span(0, 3), events)).toEqual([
      { source: 'r1', target: 'e1', count: 2, delivered: [[], []] },
      { source: 'r2', target: 'e2', count: 1, delivered: [[]] },
    ]);
  });

  /** Same rallier, DIFFERENT ally is two lands, not a 2-stack: the walk has to visit both units. */
  it('separates one rallier proccing two different allies', () => {
    expect(ralliesFiredIn(span(0, 2), [rally('r', 'e1'), rally('r', 'e2')])).toEqual([
      { source: 'r', target: 'e1', count: 1, delivered: [[]] },
      { source: 'r', target: 'e2', count: 1, delivered: [[]] },
    ]);
  });

  it('respects the moment window and never reads outside it', () => {
    const events = [rally('before', 'x'), rally('inside', 'x'), rally('after', 'x')];
    expect(ralliesFiredIn(span(1, 2), events).map((f) => f.source)).toEqual(['inside']);
  });

  /** `end` may run past the array when a moment is the last one compiled; a hole must not throw. */
  it('tolerates an end index past the event array', () => {
    expect(ralliesFiredIn(span(0, 99), [rally('r', 'e')])).toEqual([{ source: 'r', target: 'e', count: 1, delivered: [[]] }]);
  });
});

describe('attackSummonUids', () => {
  it('picks the attacker\'s OWN on-attack summons (Errand Fiend\'s imps)', () => {
    const events = [summon('imp1', 'errand'), summon('imp2', 'errand')];
    expect(attackSummonUids(span(0, 2), events, 'errand')).toEqual(['imp1', 'imp2']);
  });

  /** The whole reason it filters on `source`: a procced ally's Echo summon (source = that ally) belongs to
   *  the rally-cubs path, NOT to the attacker's own release, so it must be left out here. */
  it('excludes a procced ally\'s summons, keeping only source === attacker', () => {
    const events = [summon('imp1', 'errand'), summon('cub', 'manasaber')];
    expect(attackSummonUids(span(0, 2), events, 'errand')).toEqual(['imp1']);
  });

  it('returns nothing when the attacker summoned nothing on this swing', () => {
    expect(attackSummonUids(span(0, 2), [buff('a'), summon('cub', 'someoneElse')], 'errand')).toEqual([]);
  });

  it('respects the moment window', () => {
    const events = [summon('before', 'errand'), summon('inside', 'errand'), summon('after', 'errand')];
    expect(attackSummonUids(span(1, 2), events, 'errand')).toEqual(['inside']);
  });
});

/**
 * THE reason this channel exists, pinned as a test rather than left in a comment. A Rally is an `onAttack`
 * trigger, so its event lands inside the attacker's wind-up and the moment is classified `attackExchange` —
 * the `rally` KIND never appears. Anything that resolves one binding off the primary event therefore cannot
 * reach a Rally; only a scan of the moment's own events can.
 */
describe('a real Rally is absorbed into its attacker wind-up', () => {
  const events = [
    { type: 'attack', attacker: 'echohorn', defender: 'foe', swing: 0 },
    rally('echohorn', 'sporeling'),
    { type: 'dmg', target: 'foe', amount: 3, remainingHp: 0 },
  ] as CombatEvent[];

  it('classifies as attackExchange, NOT rally', () => {
    const [windup] = compileMoments(events);
    expect(windup?.kind).toBe('attackExchange');
    expect(windup?.primary.type).toBe('attack');
  });

  it('still finds the Rally inside that moment, with its own pair', () => {
    const [windup] = compileMoments(events);
    expect(ralliesFiredIn(windup!, events)).toEqual([{ source: 'echohorn', target: 'sporeling', count: 1, delivered: [[]] }]);
  });
});

/** The 2:1 ratio IS the information — see `beatExceedsGap` in fx/land.ts. */
describe('cascade timing', () => {
  it('beats a stack clearly faster than it walks between pairs', () => {
    expect(RALLY_BEAT_MS).toBeLessThan(RALLY_GAP_MS);
  });
});

/**
 * WHAT EACH PROC DELIVERED — the attribution that lets a sparkle carry its own summons rather than trail
 * them. A Rally's summon commits to the frame the instant the moment becomes current, so the cub is on the
 * board ahead of the effect that procced it; `fx/summonHold.ts` withholds these and the cue releases each
 * proc's litter on its own land.
 */
describe('ralliesFiredIn — delivered summons', () => {
  const summon = (uid: string): CombatEvent =>
    ({ type: 'summon', side: 'player', index: 0, minion: { uid, cardId: 'sabercub', name: 'Saber Cub', tribe: 'beast', attack: 1, health: 1, keywords: [], golden: false } } as CombatEvent);

  it('attributes the summons that immediately follow a proc', () => {
    const events = [rally('ech', 'saber'), summon('c1'), summon('c2')];
    expect(ralliesFiredIn(span(0, 3), events)[0]).toEqual({
      source: 'ech', target: 'saber', count: 1, delivered: [['c1', 'c2']],
    });
  });

  /** THE gilded case: two procs, two litters, kept SEPARATE so the second sparkle has something to deliver.
   *  Flattening them would put all four cubs on the first land and leave the second detonating over nothing. */
  it('keeps each proc litter separate, in proc order', () => {
    const events = [rally('ech', 'saber'), summon('c1'), summon('c2'), rally('ech', 'saber'), summon('c3'), summon('c4')];
    const [fired] = ralliesFiredIn(span(0, 6), events);
    expect(fired?.count).toBe(2);
    expect(fired?.delivered).toEqual([['c1', 'c2'], ['c3', 'c4']]);
  });

  /** Most Echoes summon nothing (a stat grant, a card to hand). An empty litter is a real proc with nothing
   *  to deliver — not a missing one — which is why `delivered` is per-proc rather than one flat list. */
  it('records an empty litter for a proc that summoned nothing', () => {
    expect(ralliesFiredIn(span(0, 1), [rally('ds', 'ally')])[0]?.delivered).toEqual([[]]);
  });

  /**
   * Contiguity is what keeps the attribution honest. A summon that is NOT adjacent to the proc could be any
   * other on-attack effect's, and withholding it would hide a minion nothing is scheduled to release.
   */
  it('stops at the first non-summon, leaving a later summon unattributed', () => {
    const events = [rally('ech', 'saber'), summon('c1'), buff('x'), summon('unrelated')];
    expect(ralliesFiredIn(span(0, 4), events)[0]?.delivered).toEqual([['c1']]);
  });

  it('does not attribute a summon that precedes the proc', () => {
    const events = [summon('before'), rally('ech', 'saber')];
    expect(ralliesFiredIn(span(0, 2), events)[0]?.delivered).toEqual([[]]);
  });

  it('never reads past the moment window for a litter', () => {
    const events = [rally('ech', 'saber'), summon('inside'), summon('next-moment')];
    expect(ralliesFiredIn(span(0, 2), events)[0]?.delivered).toEqual([['inside']]);
  });
});

describe('rallyPulseUnits', () => {
  const buffE = (source: string, target: string): CombatEvent =>
    ({ type: 'buff', target, attack: 1, health: 1, source } as CombatEvent);

  it('marks the attacker\'s own rally effect as a medallion pulse', () => {
    // attacker 'A' buffs someone → A rallied on its own swing
    expect(rallyPulseUnits(span(0, 1), [buffE('A', 'X')], 'A'))
      .toEqual([{ uid: 'A', surface: 'medallion' }]);
  });

  it('marks a different friendly\'s effect as a frame pulse (watcher)', () => {
    // attacker 'A' swings; watcher 'W' reacts with a buff → frame pulse on W
    expect(rallyPulseUnits(span(0, 1), [buffE('W', 'X')], 'A'))
      .toEqual([{ uid: 'W', surface: 'frame' }]);
  });

  it('dedupes multiple events from the same source, first surface wins', () => {
    expect(rallyPulseUnits(span(0, 2), [buffE('W', 'X'), buffE('W', 'Y')], 'A'))
      .toEqual([{ uid: 'W', surface: 'frame' }]);
  });

  it('includes both a self-rally and a watcher in the same beat, in first-seen order', () => {
    expect(rallyPulseUnits(span(0, 2), [buffE('A', 'X'), buffE('W', 'Y')], 'A'))
      .toEqual([{ uid: 'A', surface: 'medallion' }, { uid: 'W', surface: 'frame' }]);
  });
});

describe('rallyDamageEventIndex', () => {
  const dmg = (target: string, amount: number): CombatEvent => ({ type: 'dmg', target, amount, remainingHp: 1 } as CombatEvent);
  const death = (target: string): CombatEvent => ({ type: 'death', target } as CombatEvent);

  it('returns undefined when the attacker has no rally-damage effect, even with a dmg event present', () => {
    expect(rallyDamageEventIndex(span(0, 1), [dmg('x', 4)], false)).toBeUndefined();
  });

  it('returns undefined when the attacker has the effect but the moment has no dmg event (empty enemy pool)', () => {
    expect(rallyDamageEventIndex(span(0, 1), [death('someone-else')], true)).toBeUndefined();
  });

  it('returns the FIRST dmg event\'s index when the attacker has the effect', () => {
    // Philippe's splash lands before the clash's own damage (cleave neighbour, main hit, retaliation) —
    // simulated here as three dmg events in log order.
    const events = [dmg('splashTarget', 4), dmg('cleaveNeighbour', 5), dmg('defender', 5), dmg('attacker', 2)];
    expect(rallyDamageEventIndex(span(0, 4), events, true)).toBe(0);
  });

  it('does NOT pick a later dmg event as the first — index is absolute, not offset-from-zero', () => {
    const events = [{ type: 'attack' } as CombatEvent, dmg('splashTarget', 4), dmg('defender', 5)];
    expect(rallyDamageEventIndex(span(1, 3), events, true)).toBe(1);
  });

  it('respects the moment window and never reads outside it', () => {
    const events = [dmg('before', 1), dmg('inside', 2), dmg('after', 3)];
    expect(rallyDamageEventIndex(span(1, 2), events, true)).toBe(1);
  });

  it('a Cleave-only attacker (no rally-damage effect) never gets misidentified, even though its splash dmg is ALSO "not the defender"', () => {
    // This is the misfire this discriminator is built to avoid: Cleave's neighbour-splash dmg looks
    // identical in shape (a dmg event, not on the defender) to Philippe's rally splash — only the
    // caller-supplied card check (false here — no rally-damage effect) tells them apart.
    const events = [dmg('cleaveNeighbour', 5), dmg('defender', 5)];
    expect(rallyDamageEventIndex(span(0, 2), events, false)).toBeUndefined();
  });
});
