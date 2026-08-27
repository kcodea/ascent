/**
 * BUG REPORTER (PR 1) — capture tests (blueprint §14.3) + validator coverage.
 *
 * Pure-function level: `captureIncidentCapsule` over a fabricated store slice — no store import, no DOM.
 * The store-integration side (open-does-not-dispatch, timer untouched, excluded surfaces) lives in
 * `bugReportHotkey.test.ts` against the real store.
 */
import { describe, expect, it } from 'vitest';
import type { CombatEvent, CombatResult } from '@game/core';
import { createRun, deserialize, type Action, type ReplayFrame, type RunState } from '@game/sim';
import { turnClock } from '../turnClock';
import {
  bugReportAvailability,
  buildBugReportEnvelope,
  buildClientContext,
  captureIncidentCapsule,
  captureMenuCapsule,
  type BugCaptureSource,
} from './bugReportCapture';
import { validateBugReportDraft, validateBugReportEnvelope } from './bugReportValidation';
import { BUG_REPORT_SCHEMA_VERSION } from './bugReportTypes';

const EVENTS = [{ kind: 'attack', src: 'u1' }, { kind: 'death', src: 'u2' }] as unknown as CombatEvent[];
const LAST_COMBAT = { events: EVENTS, result: 'win', playerDamage: 0, playerDeathrattles: 0 } as unknown as CombatResult;

const ACTIONS = [{ type: 'roll' }, { type: 'buy', uid: 'x' }, { type: 'endTurn' }] as unknown as Action[];

const frameAt = (wave: number): ReplayFrame =>
  ({ kind: 'shopDelta', wave, tMs: 0, cause: 'buy', changed: {}, removed: [] } as unknown as ReplayFrame);

function runAtWave3(): RunState {
  return { ...createRun(123), wave: 3, lastCombat: LAST_COMBAT };
}

function sourceOf(run: RunState, over: Partial<BugCaptureSource> = {}): BugCaptureSource {
  return {
    run,
    replayActions: ACTIONS,
    replayFrames: [frameAt(1), frameAt(2), frameAt(2), frameAt(3), frameAt(4)],
    inspect: null,
    showLeaderboard: false,
    showRankings: false,
    showRecentGames: false,
    showCareer: false,
    showBook: false,
    showBalance: false,
    showPatchNotes: false,
    combatSpeed: 1,
    ...over,
  };
}

describe('captureIncidentCapsule', () => {
  it('stamps identity: seed, hero, set, wave, phase, tier, mode', () => {
    const run = runAtWave3();
    const cap = captureIncidentCapsule(sourceOf(run));
    expect(cap.seed).toBe(run.seed);
    expect(cap.heroId).toBe(run.heroId);
    expect(cap.setId).toBe(run.setId ?? 'set1');
    expect(cap.wave).toBe(3);
    expect(cap.phase).toBe('recruit');
    expect(cap.shopTier).toBe(run.tier);
    expect(cap.mode).toBe(run.mode ?? 'ascent');
    expect(cap.runId).toBe(`${run.seed}:${run.heroId}`);
    expect(cap.contextTruncated).toEqual([]);
  });

  it('serializedRun deserializes back to the captured state', () => {
    const run = runAtWave3();
    const cap = captureIncidentCapsule(sourceOf(run));
    const back = deserialize(cap.serializedRun!); // a run capsule always carries one (null is menu-only)
    expect(back.wave).toBe(3);
    expect(back.heroId).toBe(run.heroId);
    expect(back.seed).toBe(run.seed);
    expect(back.board.length).toBe(run.board.length);
  });

  it('selects current-wave and previous-wave frames exactly (§3.4)', () => {
    const cap = captureIncidentCapsule(sourceOf(runAtWave3()));
    expect(cap.currentWaveFrames.map((f) => f.wave)).toEqual([3]);
    expect(cap.previousWaveFrames.map((f) => f.wave)).toEqual([2, 2]);
  });

  it('actions end at the report-open state and are a cloned copy', () => {
    const src = sourceOf(runAtWave3());
    const cap = captureIncidentCapsule(src);
    expect(cap.actions).toHaveLength(ACTIONS.length);
    expect(cap.actions).toEqual(ACTIONS);
    expect(cap.actions).not.toBe(src.replayActions);
  });

  it('combat payload carries the SAME structured event log as lastCombat, as a clone', () => {
    const run = runAtWave3();
    const cap = captureIncidentCapsule(sourceOf(run));
    expect(cap.combat).not.toBeNull();
    expect(cap.combat!.result.events).toEqual(EVENTS);
    expect(cap.combat!.result).not.toBe(run.lastCombat);
    expect(cap.combat!.result.events).not.toBe(EVENTS);
    // Pre-first-combat: no lastCombat → null context.
    const fresh = { ...createRun(7) };
    delete (fresh as { lastCombat?: CombatResult }).lastCombat;
    expect(captureIncidentCapsule(sourceOf(fresh)).combat).toBeNull();
  });

  it('reads the recruit clock without writing it; null outside recruit', () => {
    turnClock.set(23);
    const cap = captureIncidentCapsule(sourceOf(runAtWave3()));
    expect(cap.timerSecondsRemaining).toBe(23);
    expect(turnClock.get()).toBe(23);
    const combatRun = { ...runAtWave3(), phase: 'combat' as const };
    expect(captureIncidentCapsule(sourceOf(combatRun)).timerSecondsRemaining).toBeNull();
  });

  it('is immutable after capture (deep-frozen) and never mutates its source', () => {
    const src = sourceOf(runAtWave3());
    const actionsBefore = JSON.stringify(src.replayActions);
    const framesBefore = JSON.stringify(src.replayFrames);
    const cap = captureIncidentCapsule(src);
    expect(Object.isFrozen(cap)).toBe(true);
    expect(Object.isFrozen(cap.actions)).toBe(true);
    expect(Object.isFrozen(cap.ui)).toBe(true);
    expect(Object.isFrozen(cap.combat)).toBe(true);
    expect(() => (cap.actions as Action[]).push({} as Action)).toThrow();
    expect(() => { (cap as { wave: number }).wave = 99; }).toThrow();
    // Source untouched by capture.
    expect(JSON.stringify(src.replayActions)).toBe(actionsBefore);
    expect(JSON.stringify(src.replayFrames)).toBe(framesBefore);
  });

  it('records UI diagnostics (inspect card, overlay kind) without touching run state', () => {
    const cap = captureIncidentCapsule(sourceOf(runAtWave3(), { inspect: { cardId: 'wolf' }, showBook: true }));
    expect(cap.ui.selectedCardId).toBe('wolf');
    expect(cap.ui.modalKind).toBe('book');
    expect(cap.ui.draggingCardUid).toBeNull();
  });
});

describe('captureMenuCapsule (menu reports, owner ask 2026-08-27)', () => {
  const overlays = {
    inspect: null,
    showLeaderboard: false, showRankings: false, showRecentGames: false, showCareer: false,
    showBook: false, showBalance: false, showPatchNotes: false,
  };

  it('stamps the intake sentinels and carries NO run evidence', () => {
    const cap = captureMenuCapsule(overlays);
    expect(cap.phase).toBe('menu');
    expect(cap.mode).toBe('menu');
    expect(cap.heroId).toBe('none');
    expect(cap.seed).toBe(0);
    expect(cap.wave).toBe(0);
    expect(cap.shopTier).toBe(0);
    expect(cap.serializedRun).toBeNull();
    expect(cap.actions).toEqual([]);
    expect(cap.currentWaveFrames).toEqual([]);
    expect(cap.previousWaveFrames).toEqual([]);
    expect(cap.combat).toBeNull();
    expect(cap.timerSecondsRemaining).toBeNull();
    expect(cap.setId.length).toBeGreaterThan(0); // the LIVE set — pins which card data was showing
    expect(Object.isFrozen(cap)).toBe(true);
    expect(Object.isFrozen(cap.ui)).toBe(true);
  });

  it('still records the open overlay for diagnostics', () => {
    const cap = captureMenuCapsule({ ...overlays, showPatchNotes: true, inspect: { cardId: 'wolf' } });
    expect(cap.ui.modalKind).toBe('patchNotes');
    expect(cap.ui.selectedCardId).toBe('wolf');
  });

  it('builds a menu envelope that PASSES validation (the queue/upload path accepts it unchanged)', () => {
    const cap = captureMenuCapsule(overlays);
    const client = buildClientContext({ account: { userId: null }, playerName: '', setId: cap.setId });
    const envelope = buildBugReportEnvelope(cap, 'Saw a glitchy card frame earlier — logging it from the menu.', 'ui', client);
    expect(validateBugReportEnvelope(envelope).ok).toBe(true);
  });

  it('a menu capsule may not smuggle a serializedRun; a run capsule still requires one', () => {
    const cap = captureMenuCapsule(overlays);
    const client = buildClientContext({ account: { userId: null }, playerName: '', setId: cap.setId });
    const envelope = buildBugReportEnvelope(cap, 'A long enough description here.', 'ui', client);
    const smuggled = { ...envelope, context: { ...cap, serializedRun: 'not-null' } };
    expect(validateBugReportEnvelope(smuggled).ok).toBe(false);
    const runCap = captureIncidentCapsule(sourceOf(runAtWave3()));
    const runEnv = buildBugReportEnvelope(runCap, 'A long enough description here.', 'ui', client);
    expect(validateBugReportEnvelope({ ...runEnv, context: { ...runCap, serializedRun: null } }).ok).toBe(false);
  });
});

describe('envelope + privacy (§12 / §14.3)', () => {
  it('serialized envelope contains no email or auth-token strings', () => {
    const cap = captureIncidentCapsule(sourceOf(runAtWave3()));
    // Hand the builder an account object that ALSO carries an email (as the store's does) — the builder must
    // only ever read the UUID.
    const account = { userId: 'user-uuid-1', email: 'secret@example.com', anonymous: false } as { userId: string | null };
    const client = buildClientContext({ account, playerName: 'Kev', setId: cap.setId });
    const envelope = buildBugReportEnvelope(cap, 'Something broke during my Echo trigger.', 'mechanics', client);
    const json = JSON.stringify(envelope);
    expect(json).not.toContain('secret@example.com');
    expect(json).not.toContain('@example');
    expect(json.toLowerCase()).not.toContain('auth-token');
    expect(json.toLowerCase()).not.toContain('access_token');
    expect(json).toContain('user-uuid-1'); // the UUID is the sanctioned ownership handle
    expect(envelope.client.contentRevision).toContain(cap.setId);
  });

  it('a built envelope validates; a wrong schemaVersion fails', () => {
    const cap = captureIncidentCapsule(sourceOf(runAtWave3()));
    const client = buildClientContext({ account: { userId: null }, playerName: '', setId: cap.setId });
    const envelope = buildBugReportEnvelope(cap, 'Long enough description.', 'ui', client);
    expect(envelope.schemaVersion).toBe(BUG_REPORT_SCHEMA_VERSION);
    expect(validateBugReportEnvelope(envelope).ok).toBe(true);
    expect(validateBugReportEnvelope({ ...envelope, schemaVersion: 2 as unknown as 1 }).ok).toBe(false);
  });
});

describe('validateBugReportDraft', () => {
  it('enforces the 10–2000 character description bounds', () => {
    expect(validateBugReportDraft({ description: 'too short', issueType: 'other' }).ok).toBe(false);
    expect(validateBugReportDraft({ description: '          ', issueType: 'other' }).ok).toBe(false); // trims
    expect(validateBugReportDraft({ description: 'this one is long enough', issueType: 'other' }).ok).toBe(true);
    expect(validateBugReportDraft({ description: 'x'.repeat(2001), issueType: 'other' }).ok).toBe(false);
    expect(validateBugReportDraft({ description: 'valid text here', issueType: 'nope' }).ok).toBe(false);
  });
});

describe('bugReportAvailability (excluded surfaces + §4.3)', () => {
  const base = {
    showTitle: false,
    heroChoices: null as unknown,
    practiceSetupOpen: false,
    replaying: false,
    presentationTx: null as unknown,
    run: { mode: 'lobby', sandbox: undefined, phase: 'recruit' } as Pick<RunState, 'mode' | 'sandbox' | 'phase'>,
  };
  it('allows live lobby + practice play', () => {
    expect(bugReportAvailability(base)).toBe('ok');
    expect(bugReportAvailability({ ...base, run: { ...base.run, mode: 'practice' } })).toBe('ok');
  });
  it('the MAIN MENU opens the reduced menu report — leftover run flags cannot veto it', () => {
    expect(bugReportAvailability({ ...base, showTitle: true })).toBe('menu');
    // The run held while the title is up is leftover from the previous game — its excluded-surface flags
    // (tutorial / sandbox / gameover) must not silence a menu report.
    expect(bugReportAvailability({ ...base, showTitle: true, run: { ...base.run, mode: 'tutorial' } })).toBe('menu');
    expect(bugReportAvailability({ ...base, showTitle: true, run: { ...base.run, sandbox: true } })).toBe('menu');
    expect(bugReportAvailability({ ...base, showTitle: true, run: { ...base.run, phase: 'gameover' } })).toBe('menu');
    // Ceremony screens layered over/after the title still decline.
    expect(bugReportAvailability({ ...base, showTitle: true, heroChoices: ['a'] })).toBe('silent');
    expect(bugReportAvailability({ ...base, showTitle: true, practiceSetupOpen: true })).toBe('silent');
  });
  it('silently declines every excluded surface', () => {
    expect(bugReportAvailability({ ...base, heroChoices: ['a'] })).toBe('silent');
    expect(bugReportAvailability({ ...base, practiceSetupOpen: true })).toBe('silent');
    expect(bugReportAvailability({ ...base, replaying: true })).toBe('silent');
    expect(bugReportAvailability({ ...base, run: { ...base.run, sandbox: true } })).toBe('silent');
    expect(bugReportAvailability({ ...base, run: { ...base.run, mode: 'tutorial' } })).toBe('silent');
    expect(bugReportAvailability({ ...base, run: { ...base.run, phase: 'gameover' } })).toBe('silent');
    expect(bugReportAvailability({ ...base, run: { ...base.run, phase: 'victory' } })).toBe('silent');
  });
  it('asks for the toast during an in-flight presentation transaction', () => {
    expect(bugReportAvailability({ ...base, presentationTx: {} })).toBe('toast');
  });
});
