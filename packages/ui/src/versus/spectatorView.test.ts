/**
 * VERSUS spectator protocol (blueprint 13 "Spectators"; owner ruling 8): keyframes + top-level deltas with explicit
 * removals, sequence-gap recovery, stale-message tolerance, the secret keys never sent, and the size bound.
 */
import { describe, expect, it } from 'vitest';
import { createVersusRun, reduce, VERSUS_LIMITS } from '@game/sim';
import {
  applySpectatorMessage, KEYFRAME_EVERY, messageBytes, newPublisher, newReceiver, nextSpectatorMessage, projectSpectatorView,
  VERSUS_SPECTATOR_SECRET_KEYS, type SpectatorMessage,
} from './spectatorView';

const run0 = () => createVersusRun(42, 'warden', 'set2');

describe('Versus spectator view', () => {
  it('carries the visible shop state and never a secret key', () => {
    const run = run0();
    const view = projectSpectatorView(run);
    expect(view.shop).toEqual(run.shop);
    expect(view.board).toEqual(run.board);
    expect(view.embers).toBe(run.embers);
    for (const k of VERSUS_SPECTATOR_SECRET_KEYS) expect(k in view, k).toBe(false);
    const text = JSON.stringify(view);
    expect(text).not.toMatch(/access_token|refresh_token|apikey|authorization/i);
  });

  it('a mid-shop join renders from the keyframe; deltas apply in order and clear removed fields', () => {
    let run = run0();
    const pub = newPublisher('p1');
    const first = nextSpectatorMessage(pub, run, 1)!;
    expect(first.kind).toBe('key');
    let rx = applySpectatorMessage(newReceiver(), first).rx;
    // A buy changes several top-level keys.
    const offer = run.shop[0]!;
    run = reduce(run, { type: 'buy', uid: offer.uid });
    const d1 = nextSpectatorMessage(pub, run, 1)!;
    expect(d1.kind).toBe('delta');
    rx = applySpectatorMessage(rx, d1).rx;
    expect(rx.view!.hand).toEqual(run.hand);
    expect(rx.view!.embers).toBe(run.embers);
    // An explicitly cleared field travels as a removal (JSON would otherwise drop the clear).
    const withOffer = { ...run, questOffer: ['q1'] };
    rx = applySpectatorMessage(rx, nextSpectatorMessage(pub, withOffer, 1)!).rx;
    expect(rx.view!.questOffer).toEqual(['q1']);
    const cleared = { ...withOffer, questOffer: undefined };
    const d3 = nextSpectatorMessage(pub, cleared, 1)! as Extract<SpectatorMessage, { kind: 'delta' }>;
    expect(d3.removed).toContain('questOffer');
    const wire = JSON.parse(JSON.stringify(d3)) as SpectatorMessage;
    rx = applySpectatorMessage(rx, wire).rx;
    expect('questOffer' in rx.view!).toBe(false);
    // Nothing changed: no message at all.
    expect(nextSpectatorMessage(pub, cleared, 1)).toBeNull();
  });

  it('a sequence gap asks for the keyframe; stale and duplicate messages are ignored', () => {
    let run = run0();
    const pub = newPublisher('p2');
    const key = nextSpectatorMessage(pub, run, 1)!;
    run = reduce(run, { type: 'buy', uid: run.shop[0]!.uid });
    const d1 = nextSpectatorMessage(pub, run, 1)!;
    run = { ...run, embers: run.embers + 5 };
    const d2 = nextSpectatorMessage(pub, run, 1)!;
    let rx = applySpectatorMessage(newReceiver(), key).rx;
    const gap = applySpectatorMessage(rx, d2);
    expect(gap.needKeyframe).toBe(true);
    expect(gap.rx).toBe(rx); // unchanged until recovery
    rx = applySpectatorMessage(rx, d1).rx;
    rx = applySpectatorMessage(rx, d2).rx;
    expect(applySpectatorMessage(rx, d1).rx).toBe(rx); // stale
    expect(applySpectatorMessage(newReceiver(), d1).needKeyframe).toBe(true); // a delta with no base
  });

  it('forces a keyframe periodically and on demand, and stays under the persisted frame cap', () => {
    let run = run0();
    const pub = newPublisher('p1');
    nextSpectatorMessage(pub, run, 1);
    let kinds: string[] = [];
    for (let i = 0; i < KEYFRAME_EVERY + 2; i++) {
      run = { ...run, embers: run.embers + 1 };
      kinds.push(nextSpectatorMessage(pub, run, 1)!.kind);
    }
    expect(kinds.filter((k) => k === 'key')).toHaveLength(1);
    kinds = [];
    const forced = nextSpectatorMessage(pub, run, 1, true)!;
    expect(forced.kind).toBe('key');
    expect(messageBytes(forced)).toBeLessThan(VERSUS_LIMITS.spectatorFrameBytes);
  });

  it('R-SPECTATE-RESUME-01: a player who reloads mid-game is followed again (the new session outranks the old one)', () => {
    const run = run0();
    const before = newPublisher('p1', Date.now() - 60_000); // a session a minute ago
    let rx = newReceiver();
    for (let i = 0; i < 40; i++) rx = applySpectatorMessage(rx, nextSpectatorMessage(before, { ...run, embers: i } as typeof run, 1, i === 0, true)!).rx;
    const heldSeq = rx.seq;
    // The player reloads: a fresh publisher, a little later.
    const after = newPublisher('p1'); // the default: the clock
    const key = nextSpectatorMessage(after, { ...run, wave: 2 } as typeof run, 2, true)!;
    expect(key.seq).toBeGreaterThan(heldSeq);
    const next = applySpectatorMessage(rx, key);
    expect(next.rx.view?.wave).toBe(2);
  });
});
