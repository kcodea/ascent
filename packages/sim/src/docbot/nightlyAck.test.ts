/**
 * SABOTAGE PROOF for the nightly acknowledgement registry (2026-09-11): an unknown fingerprint keeps the
 * nightly red; an acknowledged one is reported as known and does NOT fail; an ack for a different fingerprint
 * covers nothing. Plus the registry's own hygiene (dates, non-empty reasons, fingerprint shape) so a sloppy
 * row can't silently acknowledge everything.
 */
import { describe, expect, it } from 'vitest';
import { makeFinding } from './findings';
import { NIGHTLY_ACKS, buildNightlyStatus, describeAck, formatNightlyStatus, nightlyVerdict, type NightlyAck } from './nightlyAck';

const finding = (checkId: string, seed: number) => makeFinding({
  lane: 'nightly-lifecycle', severity: 'error', confidence: 'proven',
  title: `nightly ${checkId} failure (seed ${seed})`, summary: 'prose that must never matter',
  contentIds: [], ruleIds: [], expectationKind: checkId, expected: null,
  observed: { seed, checkId },
});

describe('nightly acknowledgement registry (sabotage-proofed)', () => {
  it('an UNKNOWN fingerprint keeps the nightly red', () => {
    const f = finding('roundtrip', 62931);
    const v = nightlyVerdict([f], []);
    expect(v.ok).toBe(false);
    expect(v.red.map((x) => x.fingerprint)).toEqual([f.fingerprint]);
    expect(v.known).toEqual([]);
  });

  it('an ACKNOWLEDGED fingerprint is reported as known and does not fail', () => {
    const f = finding('roundtrip', 62931);
    const ack: NightlyAck = { fingerprint: f.fingerprint, date: '2026-09-11', reason: 'parked pending the serializer rework' };
    const v = nightlyVerdict([f], [ack]);
    expect(v.ok).toBe(true);
    expect(v.red).toEqual([]);
    expect(v.known).toEqual([{ finding: f, ack }]);
    expect(describeAck(ack)).toBe('known (acknowledged 2026-09-11: parked pending the serializer rework)');
  });

  it('an ack covers ONLY its own fingerprint — a second, different finding still reds the run', () => {
    const a = finding('roundtrip', 62931);
    const b = finding('roundtrip', 60000); // same check, different seed → different structural fingerprint
    expect(a.fingerprint).not.toBe(b.fingerprint);
    const v = nightlyVerdict([a, b], [{ fingerprint: a.fingerprint, date: '2026-09-11', reason: 'x' }]);
    expect(v.ok).toBe(false);
    expect(v.red.map((x) => x.fingerprint)).toEqual([b.fingerprint]);
    expect(v.known.map((k) => k.finding.fingerprint)).toEqual([a.fingerprint]);
  });

  it('re-wording a finding neither creates nor silences an ack (fingerprints ignore prose)', () => {
    const f = finding('roundtrip', 62931);
    const reworded = { ...f, title: 'completely different title', summary: 'and summary' };
    const v = nightlyVerdict([reworded], [{ fingerprint: f.fingerprint, date: '2026-09-11', reason: 'x' }]);
    expect(v.ok).toBe(true);
  });

  it('the committed registry is well-formed (fingerprint shape, ISO date, non-empty reason, no duplicates)', () => {
    const seen = new Set<string>();
    for (const a of NIGHTLY_ACKS) {
      expect(a.fingerprint).toMatch(/^[0-9a-f]{8}$/);
      expect(a.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(a.reason.trim().length).toBeGreaterThan(0);
      expect(seen.has(a.fingerprint), `duplicate ack for ${a.fingerprint}`).toBe(false);
      seen.add(a.fingerprint);
    }
  });

  it('the status document carries the verdict, both lists and a repro line per finding', () => {
    const f = finding('roundtrip', 62931);
    const g = finding('lobby-law', 60003);
    const ack: NightlyAck = { fingerprint: g.fingerprint, date: '2026-09-11', reason: 'why' };
    const status = buildNightlyStatus({
      verdict: nightlyVerdict([f, g], [ack]), at: '2026-09-11T09:17:00.000Z',
      config: { runs: 6, seedBase: 60000, lobbies: 4 }, elapsedSeconds: 268, outDir: 'artifacts/docbot-nightly', notes: ['1 draft-contract disagreement'],
    });
    expect(status.verdict).toBe('red');
    expect(status.red.map((x) => x.fingerprint)).toEqual([f.fingerprint]);
    expect(status.known[0]!.ack).toEqual(ack);
    expect(status.reproCommand).toBe('npm run docbot:nightly -- --runs 6 --seed-base 60000 --lobbies 4 --out artifacts/docbot-nightly');
    const text = formatNightlyStatus(status).join('\n');
    expect(text).toContain('nightly: RED');
    expect(text).toContain(`✗ ${f.title}`);
    expect(text).toContain('known (acknowledged 2026-09-11: why)');
    expect(text).toContain('1 draft-contract disagreement');
  });
});
