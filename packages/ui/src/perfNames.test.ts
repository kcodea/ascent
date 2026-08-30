import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { subjectOf, diagnose } from './perfDiagnose';
import { cardName, displaySubject, effectName, phaseName } from './perfNames';

/**
 * The perf HUD speaks in-game (owner ask 2026-08-30: *"id love the performance hud to use in-game names and
 * call outs for effects and jank frames etc"*). The monitor RECORDS addresses (`reduce:play:b2_packstrider`)
 * because they are stable and cheap to build in a hot path; this layer turns them into something a reader
 * recognises without looking anything up.
 */
describe('perf subjects read as the game, not as the code', () => {
  it('names a card, and keeps its id for grepping', () => {
    // A real pool card, read from CARD_INDEX rather than hardcoded, so a rename cannot leave this passing
    // against a name the game no longer uses.
    const real = CARD_INDEX['b2_packstrider'];
    expect(real, 'fixture card still exists').toBeTruthy();

    const label = 'reduce:play:b2_packstrider';
    const out = displaySubject(subjectOf(label), label);
    expect(out).toContain(real!.name);          // the name you recognise…
    expect(out).toContain('b2_packstrider');    // …and the id you grep for
    expect(out).toContain('playing a card');    // the action, in the game's words
  });

  it('names the action behind a bare reducer subject', () => {
    expect(displaySubject(subjectOf('reduce:roll'), 'reduce:roll')).toContain('rolling the Shop');
    expect(displaySubject(subjectOf('reduce:endTurn'), 'reduce:endTurn')).toContain('ending the turn');
  });

  it('leaves an UNKNOWN card id alone rather than inventing a name', () => {
    const label = 'reduce:play:not_a_real_card';
    const out = displaySubject(subjectOf(label), label);
    expect(out).toContain('not_a_real_card');
    expect(cardName('not_a_real_card')).toBeUndefined();
  });

  it('de-kebabs an effect id without inventing words', () => {
    expect(effectName('titan-hammer')).toBe('Titan Hammer');
    expect(effectName('weld_batch')).toBe('Weld Batch');
    // Every token is capitalised, including short ones — one predictable rule beats a special case that
    // makes 'fx-dm' render as 'fx dm' and read like a typo.
    expect(effectName('fx-dm')).toBe('Fx Dm');
  });

  it('names the engine blocks that are NOT gameplay, which is the useful part', () => {
    // Saying "building the board view" tells the reader immediately that no card is to blame.
    expect(displaySubject(subjectOf('view:board'), 'view:board')).toContain('building the board view');
    expect(displaySubject(subjectOf('autosave'), 'autosave')).toContain('the autosave');
  });

  it('falls through to the raw label for anything unrecognised', () => {
    expect(displaySubject(subjectOf('someInternalBlock'), 'someInternalBlock')).toContain('someInternalBlock');
  });

  it('uses the phase names players use', () => {
    expect(phaseName('recruit')).toBe('Shop');
    expect(phaseName('combat')).toBe('Combat');
    expect(phaseName('somethingNew')).toBe('somethingNew'); // unknown phases pass through
  });
});

describe('diagnose stays pure unless a namer is supplied', () => {
  // The real PerfBucket shape: `timings` / `marks` / `counts` are RECORDS, not arrays.
  const bucket = (i: number) => ({
    t: i * 1000, fps: 240, med: 4, p95: 8, worst: 60, long: 3, jank: 2, hz: 240, task: 0,
    heapMb: 0, nodes: 0, hidden: false,
    timings: { 'reduce:play:b2_packstrider': { n: 1, total: 60, max: 60 } },
    marks: {}, counts: {}, phase: 'recruit', wave: 1,
  });
  const buckets = Array.from({ length: 12 }, (_, i) => bucket(i)) as never;

  it('prints the raw id by default — no content dependency in the engine', () => {
    const d = diagnose(buckets);
    const hot = d.verdicts.find((v) => v.id.startsWith('hotspot:'));
    expect(hot?.title).toContain('b2_packstrider');
    expect(hot?.title).not.toContain('Packstrider —');
  });

  it('prints the in-game name when one is supplied', () => {
    const d = diagnose(buckets, displaySubject);
    const hot = d.verdicts.find((v) => v.id.startsWith('hotspot:'));
    expect(hot?.title).toContain(CARD_INDEX['b2_packstrider']!.name);
  });
});
