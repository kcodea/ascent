import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { completedSeeds, createJob, listJobs, loadJob, writeLobby } from './store';
import { synthesizeJob, syntheticIdentity, syntheticManifest } from './deps';

const root = mkdtempSync(join(tmpdir(), 'balance-store-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('store', () => {
  const manifest = syntheticManifest('set3', { start: 1, count: 4 }, { heroes: ['warden', 'drakko'] });
  const identity = syntheticIdentity(manifest);
  const records = synthesizeJob(manifest, identity);

  it('writes a resumable job and reads it back verbatim', () => {
    createJob('job-a', manifest, identity, root);
    for (const r of records.slice(0, 3)) writeLobby('job-a', r, root);
    expect(listJobs(root)).toEqual(['job-a']);
    expect([...completedSeeds('job-a', manifest, identity, root)].sort()).toEqual([1, 2, 3]);
    const job = loadJob('job-a', root);
    expect(job.lobbies.map((l) => l.seed)).toEqual([1, 2, 3]);
    expect(JSON.stringify(job.lobbies[0])).toBe(JSON.stringify(records[0]));
    expect(job.rejected).toEqual([]);
  });

  it('a corrupted or foreign lobby file is rejected, not resumed', () => {
    const path = join(root, 'job-a', 'lobbies', '2.json');
    const env = JSON.parse(readFileSync(path, 'utf8'));
    env.record.roundsPlayed += 1; // checksum no longer matches
    writeFileSync(path, JSON.stringify(env));
    expect([...completedSeeds('job-a', manifest, identity, root)].sort()).toEqual([1, 3]);
    const job = loadJob('job-a', root);
    expect(job.rejected).toEqual([{ seed: 2, key: '2', reason: 'checksum mismatch (incomplete or corrupted write)' }]);
    // A different identity never counts existing files as done.
    const other = syntheticIdentity(manifest, 'other');
    expect(completedSeeds('job-a', manifest, other, root).size).toBe(0);
  });

  it('re-opening a job with a different identity or manifest is an error', () => {
    expect(() => createJob('job-a', manifest, syntheticIdentity(manifest, 'other'), root)).toThrow(/different identity/);
    expect(() => createJob('job-a', { ...manifest, name: 'renamed' }, identity, root)).toThrow(/different manifest/);
    expect(() => createJob('../escape', manifest, identity, root)).toThrow(/must match/);
  });
});
