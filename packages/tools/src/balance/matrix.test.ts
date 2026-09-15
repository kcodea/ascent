import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveLobbyManifest, matrixHeroes, matrixProgress, planMatrix, relabelLobby, runMatrix, type LobbyRunner } from './matrix';
import { completedKeys, createJob, loadJob, manifestMatches, writeLobby } from './store';
import { playableHeroes, synthesizeLobby, syntheticIdentity, syntheticManifest, type ExperimentManifest, type LobbyRecord } from './deps';

const root = mkdtempSync(join(tmpdir(), 'balance-matrix-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const base: ExperimentManifest = syntheticManifest('set2', { start: 100, count: 999 }, { name: 'base' });
const HEROES4 = ['warden', 'drakko', 'myra', 'soren'];

describe('planMatrix', () => {
  it('every playable hero of the set, minus tribe-gated heroes the set cannot seat', () => {
    const all = matrixHeroes('set2');
    expect(all.length).toBe(playableHeroes().length); // set 2 rolls every tribe: no gate can miss
    expect(() => matrixHeroes('set2', ['nobody'])).toThrow(/unknown hero/);
    expect(matrixHeroes('set2', ['drakko', 'warden'])).toEqual(['drakko', 'warden']);
  });

  it('is paired and deterministic: every hero gets the SAME N seeds, in a stable order', () => {
    const a = planMatrix(base, { runsPerHero: 3, heroes: HEROES4 });
    const b = planMatrix(base, { runsPerHero: 3, heroes: HEROES4 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.seeds).toEqual([100, 101, 102]);
    expect(a.entries).toHaveLength(12);
    for (const h of HEROES4) expect(a.entries.filter((e) => e.heroId === h).map((e) => e.seed)).toEqual([100, 101, 102]);
    // Seed-major: an interrupted job has every hero on the first seeds.
    expect(a.entries.slice(0, 4).map((e) => e.heroId)).toEqual(HEROES4);
    expect(a.entries[0].key).toBe('warden-100');
    expect(a.entries[0].lobbyId).toBe('selfPlayLobby:set2:synthetic:warden:100');
    // The base carries the plan; the derived manifests pin one hero, one seed, and never carry `matrix`.
    expect(a.base.matrix).toEqual({ runsPerHero: 3, heroes: HEROES4 });
    expect(a.base.seeds).toEqual({ start: 100, count: 3 });
    for (const e of a.entries) {
      expect(e.manifest.pinnedHero).toBe(e.heroId);
      expect(e.manifest.seeds).toEqual({ start: e.seed, count: 1 });
      expect(e.manifest.matrix).toBeUndefined();
      expect(e.manifest.exploration).toBeUndefined(); // no rotation asked → natural play, field absent
      expect(manifestMatches(a.base, e.manifest)).toBe(true);
    }
    expect(manifestMatches(a.base, { ...a.entries[0].manifest, policy: { ...base.policy, id: 'other' } })).toBe(false);
  });

  it('rotates exploration (seed − start) mod K when asked', () => {
    const p = planMatrix(base, { runsPerHero: 6, heroes: ['warden'], explorationRotate: true, explorationK: 4 });
    expect(p.entries.map((e) => e.exploration)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(p.entries.map((e) => e.manifest.exploration)).toEqual([0, 1, 2, 3, 0, 1]);
    expect(p.base.matrix?.explorationK).toBe(4);
    // Every hero sees the same exploration index on the same seed (paired on exploration too).
    const q = planMatrix(base, { runsPerHero: 4, heroes: HEROES4, explorationRotate: true });
    for (const s of q.seeds) expect(new Set(q.entries.filter((e) => e.seed === s).map((e) => e.exploration)).size).toBe(1);
    expect(deriveLobbyManifest(p.base, 'warden', 103, 3).exploration).toBe(3);
  });
});

describe('runMatrix', () => {
  // A fake runner: the synthetic fixture, which honours the manifest's seed and stamps the pinned hero in seat 0.
  const runner: LobbyRunner = (manifest, seed, _pilotFor, _recorder, identity) => {
    const rec = synthesizeLobby(seed, { ...manifest, heroes: [manifest.pinnedHero!, ...HEROES4.filter((h) => h !== manifest.pinnedHero)] }, identity);
    // The fixture does not pin seat 0 — force it, as the real runner does, so the pinned-hero check is exercised;
    // and stamp the manifest it was GIVEN (a real runner records the manifest verbatim).
    rec.seats[0] = { ...rec.seats[0], heroId: manifest.pinnedHero! };
    return { ...rec, manifest };
  };
  const noop = { onAction() {}, onEffect() {}, onRound() {}, onRun() {} };
  const pilot = { id: 'synthetic', decide: () => null };

  it('writes one keyed lobby per (hero, seed), relabels the lobby id, and resumes by skipping complete lobbies', () => {
    const plan = planMatrix(base, { runsPerHero: 2, heroes: HEROES4 });
    const identity = syntheticIdentity(plan.base);
    createJob('m1', plan.base, identity, root);
    const log: string[] = [];
    const first = runMatrix(plan, { jobId: 'm1', identity, runner, pilotFor: () => pilot, recorderFor: () => noop, root, log: (l) => log.push(l) });
    expect(first).toMatchObject({ planned: 8, ran: 8, skipped: 0, failed: 0 });
    expect(log.some((l) => /ETA/.test(l))).toBe(true);
    expect([...completedKeys('m1', plan.base, identity, root)].sort()).toEqual(plan.entries.map((e) => e.key).sort());
    const job = loadJob('m1', root);
    expect(job.rejected).toEqual([]);
    expect(job.lobbies).toHaveLength(8);
    for (const L of job.lobbies) {
      expect(L.lobbyId).toMatch(/^selfPlayLobby:set2:synthetic:[a-z]+:10[01]$/);
      expect(L.seats.every((s) => s.lobbyId === L.lobbyId)).toBe(true);
      expect(L.actions.every((a) => a.lobbyId === L.lobbyId)).toBe(true);
      expect(L.seats[0].heroId).toBe(L.manifest.pinnedHero);
    }
    // Resume: nothing runs again; a record's identity/manifest mismatch would not count as complete.
    const again = runMatrix(plan, { jobId: 'm1', identity, runner, pilotFor: () => pilot, recorderFor: () => noop, root, log: () => {} });
    expect(again).toMatchObject({ ran: 0, skipped: 8 });
    expect(matrixProgress('m1', plan, root)).toEqual({ complete: 8, failed: 0, missing: [] });
    // A sharded worker runs only its slice and resumes the rest.
    const bigger = planMatrix(base, { runsPerHero: 3, heroes: HEROES4 });
    const shard0 = runMatrix(bigger, { jobId: 'm1', identity: syntheticIdentity(bigger.base), runner, pilotFor: () => pilot, recorderFor: () => noop, root, shard: { index: 0, count: 2 }, log: () => {} });
    expect(shard0.ran + shard0.skipped).toBe(6);
  });

  it('a lobby whose seat 0 did not get the pinned hero, or whose runner threw, is written FAILED — never dropped', () => {
    const plan = planMatrix(base, { runsPerHero: 1, heroes: ['warden', 'drakko'] });
    const identity = syntheticIdentity(plan.base);
    createJob('m2', plan.base, identity, root);
    const bad: LobbyRunner = (manifest, seed, _p, _r, id) => {
      if (manifest.pinnedHero === 'drakko') throw new Error('boom');
      return { ...synthesizeLobby(seed, { ...manifest, heroes: ['myra', 'soren'] }, id), manifest }; // pinned hero never seated
    };
    const res = runMatrix(plan, { jobId: 'm2', identity, runner: bad, pilotFor: () => pilot, recorderFor: () => noop, root, log: () => {} });
    expect(res).toMatchObject({ ran: 2, failed: 2 });
    const job = loadJob('m2', root);
    expect(job.lobbies.map((L) => L.failure)).toEqual([expect.stringMatching(/runner threw: boom/), expect.stringMatching(/pinned hero warden was not seated/)]);
  });

  it('relabelLobby rewrites every sub-record and is idempotent', () => {
    const rec: LobbyRecord = synthesizeLobby(1, base, syntheticIdentity(base));
    const out = relabelLobby(rec, 'x:1');
    expect(out.lobbyId).toBe('x:1');
    expect(out.rounds.every((r) => r.lobbyId === 'x:1') && out.effects.every((e) => e.lobbyId === 'x:1')).toBe(true);
    expect(relabelLobby(out, 'x:1')).toBe(out);
    // The store keys a pinned record by hero-seed and a plain one by seed.
    writeLobby('m2', out, root); // plain (no pinnedHero) → 1.json alongside the matrix keys
    expect(loadJob('m2', root).rejected.map((r) => r.key)).toEqual(['1']); // rejected: its manifest is not the job's base
  });
});
