/**
 * REPLAY V2 — draft persistence across a resume.
 *
 * The bug these pin (found 2026-08-20 in a public leaderboard row): frames lived only in memory, so quitting
 * and continuing threw away every round before the reload and uploaded a `partial` replay that began at the
 * resumed wave — rounds 7-18 for a run whose board snapshots and result history covered all 18.
 *
 * The harness drives the REAL reducer with the REAL bot (same shape as `roundDrawer.test.ts`), splits the run
 * at a chosen wave, persists the first half exactly as the store's round-boundary write does, and rebuilds it
 * on the far side exactly as `hydrateReplayDraft` does. Nothing here simulates or re-derives — the whole point
 * of state replay is that the recording is the truth.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOT, combatFrameOf, createLobbyRun, deltaShopFrameOf, expandFrames, reduce, roundMarks,
  shopFrameOf,
  type InspectEvent, type ReplayFrame, type RunState, type ShopView,
} from '@game/sim';
import {
  RESUME_GAP_MS, REPLAY_DRAFT_SCHEMA, draftRunId, firstRecordedWave, isValidChunk, lastRecordedTMs,
  memoryDraftStore, mergeDraftChunks, runRecordsDraft, shiftFrames, shiftInspect, splitIntoChunks,
  trimToBaseline, type ReplayDraftMeta,
} from './replayDraft';

/** Capture a bot run under the store's exact rules. `stopAtWave` cuts the recording where a player quits. */
function captureBotRun(seed: number, heroId: string, opts: { stopAtWave?: number; resumeFrom?: RunState } = {}): {
  final: RunState; frames: ReplayFrame[]; tMs: number;
} {
  let s = opts.resumeFrom ?? createLobbyRun(seed, heroId);
  const first = shopFrameOf(s, 'turnStart', 0);
  const frames: ReplayFrame[] = s.phase === 'recruit' ? [first] : [];
  let lastView: ShopView = first.view;
  let t = 0;
  let guard = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 4000) {
    if (opts.stopAtWave != null && s.wave >= opts.stopAtWave && s.phase === 'recruit') break;
    const action = DEFAULT_BOT.act(s);
    const next = reduce(s, action);
    if (next === s) break;
    t += 100;
    if (action.type === 'faceOmen' && next.lastCombat) {
      frames.push(combatFrameOf(s, next, t));
    } else if (next.phase === 'recruit' && s.phase !== 'recruit') {
      const kf = shopFrameOf(next, 'turnStart', t);
      frames.push(kf);
      lastView = kf.view;
    } else if (next.phase === 'recruit' && s.phase === 'recruit') {
      const d = deltaShopFrameOf(lastView, next, action.type, t);
      frames.push(d.frame);
      lastView = d.view;
    }
    s = next;
  }
  return { final: s, frames, tMs: t };
}

const metaFor = (run: RunState): ReplayDraftMeta => ({
  runId: draftRunId(run), seed: run.seed, heroId: run.heroId, mode: run.mode ?? 'lobby',
  createdAtMs: 1, updatedAtMs: 1, currentWave: run.wave, schemaVersion: REPLAY_DRAFT_SCHEMA,
});

describe('splitIntoChunks / mergeDraftChunks round-trip', () => {
  const cap = captureBotRun(4242, 'brackus', { stopAtWave: 6 });

  it('splits a real capture into one chunk per recorded wave, losing no frame', () => {
    const chunks = splitIntoChunks('r', cap.frames);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.reduce((n, c) => n + c.frames.length, 0)).toBe(cap.frames.length);
    // Every frame in a chunk belongs to that chunk's wave — the key the store writes under.
    for (const c of chunks) for (const f of c.frames) expect(f.wave).toBe(c.wave);
  });

  it('merges back to the identical frame list, in the identical order', () => {
    const merged = mergeDraftChunks(splitIntoChunks('r', cap.frames));
    expect(merged.frames).toEqual(cap.frames);
  });

  it('assigns each inspect event to the round the player was looking at', () => {
    // Two events: one during the first recorded wave, one after the last wave opened.
    const waves = [...new Set(cap.frames.map((f) => f.wave))].sort((a, b) => a - b);
    const lastWaveStart = cap.frames.find((f) => f.wave === waves[waves.length - 1]!)!.tMs;
    const trail: InspectEvent[] = [
      { tMs: 1, inspect: { cardId: 'early' } },
      { tMs: lastWaveStart + 10, inspect: { cardId: 'late' } },
    ];
    const chunks = splitIntoChunks('r', cap.frames, trail);
    const early = chunks.find((c) => c.inspectTrail.some((e) => e.inspect?.cardId === 'early'))!;
    const late = chunks.find((c) => c.inspectTrail.some((e) => e.inspect?.cardId === 'late'))!;
    expect(early.wave).toBe(waves[0]);
    expect(late.wave).toBe(waves[waves.length - 1]);
    // …and merging restores both, in clock order.
    expect(mergeDraftChunks(chunks).inspectTrail.map((e) => e.inspect?.cardId)).toEqual(['early', 'late']);
  });

  it('an inspect event before any frame lands on the first wave rather than vanishing', () => {
    const chunks = splitIntoChunks('r', cap.frames, [{ tMs: -50, inspect: { cardId: 'stray' } }]);
    expect(mergeDraftChunks(chunks).inspectTrail).toHaveLength(1);
  });
});

describe('a run persisted, resumed and finished produces ONE complete recording', () => {
  // Play to wave 6, "quit", reload, and play the rest — the exact sequence that used to amputate the replay.
  const first = captureBotRun(4242, 'brackus', { stopAtWave: 6 });
  const second = captureBotRun(4242, 'brackus', { resumeFrom: first.final });

  it('the two halves are contiguous and neither is empty', () => {
    expect(first.frames.length).toBeGreaterThan(0);
    expect(second.frames.length).toBeGreaterThan(0);
    expect(second.final.phase === 'gameover' || second.final.phase === 'victory').toBe(true);
  });

  it('restores every earlier round, so the rail starts at wave 1', async () => {
    const store = memoryDraftStore();
    const runId = draftRunId(first.final);
    for (const chunk of splitIntoChunks(runId, first.frames)) await store.putChunk(metaFor(first.final), chunk);

    // …the reload. This is `hydrateReplayDraft` in miniature.
    const draft = await store.load(runId);
    const restored = mergeDraftChunks(draft!.chunks);
    const offset = lastRecordedTMs(restored.frames) + RESUME_GAP_MS;
    const stitched = [...trimToBaseline(restored.frames), ...shiftFrames(second.frames, offset)];

    expect(firstRecordedWave(stitched)).toBe(1);
    const waves = roundMarks(expandFrames(stitched)).map((m) => m.wave);
    expect(waves[0]).toBe(1);
    // No gap: every wave from the first to the last is represented.
    for (let i = 1; i < waves.length; i++) expect(waves[i]).toBe(waves[i - 1]! + 1);
    // …which is exactly what the bug did NOT do: the post-reload half alone starts at the resumed wave.
    // (This is the shape of the shipped defect — "rounds 7-18 recorded" for an 18-round run.)
    expect(firstRecordedWave(second.frames)).toBeGreaterThan(1);
    expect(waves.length).toBeGreaterThan(roundMarks(expandFrames(second.frames)).length);
  });

  it('keeps the clock monotonic across the resume seam, with one human-sized gap', async () => {
    const store = memoryDraftStore();
    const runId = draftRunId(first.final);
    for (const chunk of splitIntoChunks(runId, first.frames)) await store.putChunk(metaFor(first.final), chunk);
    const restored = mergeDraftChunks((await store.load(runId))!.chunks);
    const offset = lastRecordedTMs(restored.frames) + RESUME_GAP_MS;
    const stitched = [...restored.frames, ...shiftFrames(second.frames, offset)];

    for (let i = 1; i < stitched.length; i++) {
      expect(stitched[i]!.tMs, `frame ${i} must not travel backwards`).toBeGreaterThanOrEqual(stitched[i - 1]!.tMs);
    }
    // The seam is the deliberate beat, NOT the real time the tab was closed.
    const seam = stitched[restored.frames.length]!.tMs - restored.frames[restored.frames.length - 1]!.tMs;
    expect(seam).toBe(RESUME_GAP_MS);
  });

  it('the stitched recording expands — every delta frame still has its keyframe baseline', async () => {
    const store = memoryDraftStore();
    const runId = draftRunId(first.final);
    for (const chunk of splitIntoChunks(runId, first.frames)) await store.putChunk(metaFor(first.final), chunk);
    const restored = mergeDraftChunks((await store.load(runId))!.chunks);
    const stitched = [...trimToBaseline(restored.frames), ...shiftFrames(second.frames, lastRecordedTMs(restored.frames) + RESUME_GAP_MS)];

    const expanded = expandFrames(stitched);
    expect(expanded).toHaveLength(stitched.length);
    // An unexpanded delta would surface as a shop frame with no view — the empty-shop failure mode.
    for (const f of expanded) if (f.kind === 'shop') expect(f.view).toBeTruthy();
  });

  it('inspect events on both sides of the reload stay ordered', async () => {
    const store = memoryDraftStore();
    const runId = draftRunId(first.final);
    const before: InspectEvent[] = [{ tMs: 50, inspect: { cardId: 'pre_reload' } }];
    for (const chunk of splitIntoChunks(runId, first.frames, before)) await store.putChunk(metaFor(first.final), chunk);
    const restored = mergeDraftChunks((await store.load(runId))!.chunks);
    const offset = lastRecordedTMs(restored.frames, restored.inspectTrail) + RESUME_GAP_MS;
    const after: InspectEvent[] = [{ tMs: 10, inspect: { cardId: 'post_reload' } }];
    const trail = [...restored.inspectTrail, ...shiftInspect(after, offset)];

    expect(trail.map((e) => e.inspect?.cardId)).toEqual(['pre_reload', 'post_reload']);
    for (let i = 1; i < trail.length; i++) expect(trail[i]!.tMs).toBeGreaterThan(trail[i - 1]!.tMs);
  });
});

describe('the draft store contract', () => {
  const cap = captureBotRun(4242, 'brackus', { stopAtWave: 4 });
  const runId = draftRunId(cap.final);

  it('a mid-round flush is REPLACED by the complete round, never duplicated', async () => {
    const store = memoryDraftStore();
    const full = splitIntoChunks(runId, cap.frames)[0]!;
    const partial = { ...full, frames: full.frames.slice(0, 1) };
    await store.putChunk(metaFor(cap.final), partial); // the quit-mid-shop write
    await store.putChunk(metaFor(cap.final), full);    // …superseded at the round boundary
    const draft = await store.load(runId);
    expect(draft!.chunks).toHaveLength(1);
    expect(draft!.chunks[0]!.frames).toEqual(full.frames);
  });

  it('discarding a run deletes its draft', async () => {
    const store = memoryDraftStore();
    for (const c of splitIntoChunks(runId, cap.frames)) await store.putChunk(metaFor(cap.final), c);
    expect(await store.load(runId)).not.toBeNull();
    await store.remove(runId);
    expect(await store.load(runId)).toBeNull();
  });

  it('garbage-collects stale drafts but never the live one', async () => {
    const store = memoryDraftStore();
    const stale = { ...metaFor(cap.final), runId: 'old', updatedAtMs: 1 };
    const live = { ...metaFor(cap.final), runId, updatedAtMs: 10_000 };
    const chunk = splitIntoChunks(runId, cap.frames)[0]!;
    await store.putChunk(stale, { ...chunk, runId: 'old' });
    await store.putChunk(live, chunk);
    await store.gc(5_000, runId);
    expect(await store.load('old')).toBeNull();
    expect(await store.load(runId)).not.toBeNull();
  });

  it('a missing draft reads as null rather than throwing — capture is best-effort', async () => {
    expect(await memoryDraftStore().load('never-written')).toBeNull();
  });
});

describe('validation keeps a corrupt draft out of the player', () => {
  const cap = captureBotRun(4242, 'brackus', { stopAtWave: 3 });

  it('accepts a real chunk', () => {
    expect(isValidChunk(splitIntoChunks('r', cap.frames)[0])).toBe(true);
  });

  it('rejects the shapes a half-written or foreign record can take', () => {
    expect(isValidChunk(null)).toBe(false);
    expect(isValidChunk({ runId: 'r', wave: 1, frames: [] })).toBe(false);          // empty
    expect(isValidChunk({ runId: 'r', wave: 'x', frames: [{}] })).toBe(false);       // bad key
    expect(isValidChunk({ runId: 'r', wave: 1, frames: [{ kind: 'nope', wave: 1, tMs: 0 }] })).toBe(false);
    expect(isValidChunk({ runId: 'r', wave: 1, frames: [{ kind: 'shop', wave: 1 }] })).toBe(false); // no clock
  });

  it('trimToBaseline drops leading deltas that have no keyframe to expand against', () => {
    const delta = cap.frames.find((f) => f.kind === 'shopDelta')!;
    const keyed = cap.frames.find((f) => f.kind === 'shop')!;
    expect(trimToBaseline([delta, keyed])[0]).toBe(keyed);
    expect(trimToBaseline([delta])).toEqual([]);            // nothing salvageable
    expect(trimToBaseline(cap.frames)).toEqual([...cap.frames]); // a healthy recording is untouched
  });
});

describe('which runs record a draft at all', () => {
  const run = (mode: RunState['mode'], sandbox = false): RunState =>
    ({ ...createLobbyRun(1, 'brackus'), mode, sandbox } as RunState);

  it('records lobby and ascent runs', () => {
    expect(runRecordsDraft(run('lobby'))).toBe(true);
    expect(runRecordsDraft(run('ascent'))).toBe(true);
  });

  it('skips the runs that can never upload a watchable replay', () => {
    // Writing these would be pure storage traffic for a payload nothing can ever watch — and a Scene Builder
    // run must never leave anything resumable behind (it already can't reach the autosave).
    expect(runRecordsDraft(run('practice'))).toBe(false);
    expect(runRecordsDraft(run('tutorial'))).toBe(false);
    expect(runRecordsDraft(run('lobby', true))).toBe(false);
  });

  it('keys the draft by the run seed — the identity a resumed run can rediscover', () => {
    expect(draftRunId({ seed: 1234 })).toBe('1234');
  });
});

describe('the round-boundary write only ever writes IMMUTABLE rounds', () => {
  /**
   * The store writes a wave's chunk at the recruit flip, once every wave below the newly-opened one has
   * stopped changing. That is only safe if a closed wave really is final — and one field is patched LATE: a
   * combat frame's `resolveLost` lands on the settle action, after the fight. This replays the store's exact
   * write schedule against a real bot run and asserts that nothing written was ever touched again.
   */
  it('a chunk written at a round boundary is byte-identical to the final recording of that wave', () => {
    let s = createLobbyRun(4242, 'brackus');
    const first = shopFrameOf(s, 'turnStart', 0);
    const frames: ReplayFrame[] = [first];
    let lastView: ShopView = first.view;
    let t = 0;
    let persistedWave = 0;
    const written = new Map<number, string>(); // wave → the chunk as written, serialized

    for (let guard = 0; guard < 4000 && s.phase !== 'gameover' && s.phase !== 'victory'; guard++) {
      const action = DEFAULT_BOT.act(s);
      const next = reduce(s, action);
      if (next === s) break;
      t += 100;
      // The LATE patch runs FIRST — the store's verbatim order (store.ts: `healthLost` is applied to the last
      // combat frame BEFORE the frame-push/write chain below). This replica used to run it after, which
      // wrote a stale `resolveLost` whenever the resolve loss landed on the same action as the recruit flip —
      // a real trajectory (hit 2026-08-22 when three new roster heroes shifted the bot seats), not a real
      // store bug: the store's ordering was always patch-then-write.
      {
        const lost = s.phase === 'combat' ? Math.max(0, (s.resolve + s.armor) - (next.resolve + next.armor)) : 0;
        if (lost > 0) {
          for (let i = frames.length - 1; i >= 0; i--) {
            const f = frames[i]!;
            if (f.kind === 'combat') { frames[i] = { ...f, resolveLost: f.resolveLost + lost }; break; }
          }
        }
      }
      if (action.type === 'faceOmen' && next.lastCombat) {
        frames.push(combatFrameOf(s, next, t));
      } else if (next.phase === 'recruit' && s.phase !== 'recruit') {
        const kf = shopFrameOf(next, 'turnStart', t);
        frames.push(kf);
        lastView = kf.view;
        // …the store's `persistClosedWaves`, verbatim.
        for (const chunk of splitIntoChunks('r', frames)) {
          if (chunk.wave >= next.wave || chunk.wave <= persistedWave) continue;
          written.set(chunk.wave, JSON.stringify(chunk));
          persistedWave = Math.max(persistedWave, chunk.wave);
        }
      } else if (next.phase === 'recruit' && s.phase === 'recruit') {
        const d = deltaShopFrameOf(lastView, next, action.type, t);
        frames.push(d.frame);
        lastView = d.view;
      }
      s = next;
    }

    expect(written.size, 'the run must actually have closed several rounds').toBeGreaterThan(2);
    const final = new Map(splitIntoChunks('r', frames).map((c) => [c.wave, JSON.stringify(c)]));
    for (const [wave, asWritten] of written) {
      expect(asWritten, `wave ${wave} changed after it was written to the draft`).toBe(final.get(wave));
    }
  });
});
