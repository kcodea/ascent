import { afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, prepareActionWithPresentation, type BoardCard, type RunState } from '@game/sim';
import { compileTimeline } from './compileTimeline';
import { normalizePresentationBatch } from './adapters/presentationBatchAdapter';
import { shippedBeatConfig } from './beatConfig';
import { REPEAT_PACING, legacyEotRepeatPlan, repeatChainCapMs } from './repeatPacing';
import { endTurnRefused } from './endTurnGate';
import { installVersusHandlers, type VersusFreeze } from '../versus/versusHooks';

/**
 * A REPEAT CHAIN NEVER PLAYS ONE TICK AT A TIME (owner report 2026-10-29, R-REPEAT-06):
 *
 *   "my kringle is buffing 1 by 1 again for some reason, it doesnt happen everytime but it randomly does this"
 *
 * The authoritative End of Turn batches a Kringle's ticks (R-REPEAT-04/05). But when the store REFUSED to prepare End
 * of Turn (a Versus pause or its 3-2-1, the Duos teammate view, the replay viewer), `Recruit`'s End Turn fell back to
 * the LEGACY runner, which played one fixed 930 ms beat per tick: a minute of ribbons flying to the end Dwarves one at a
 * time, End Turn locked throughout, and its closing `faceOmen` refused by the same guard anyway. Intermittent because
 * it needs End Turn to be asked in exactly that window. These tests fail if any path plays a repeat chain sequentially.
 */

const RECRUIT = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../Recruit.tsx'), 'utf8');
const LEGACY_BEAT = 760;
const LEGACY_GAP = 170;

describe('End Turn never falls back to the legacy one-beat-per-tick runner', () => {
  const endTurnBody = RECRUIT.slice(RECRUIT.indexOf('const endTurn = (): void => {'), RECRUIT.indexOf('const repeats = endOfTurnRepeats(run);'));

  it('with the choreographer on, End Turn returns after the authoritative path whatever it answers', () => {
    expect(endTurnBody).toContain('if (CHOREO_EOT) { playEndOfTurnAuthoritative(); return; }');
    expect(endTurnBody, 'the old "else fall back to legacy" form').not.toContain('CHOREO_EOT && playEndOfTurnAuthoritative()');
  });

  it('a refused End Turn stops before anything changes on screen (the Whispers included)', () => {
    const refused = endTurnBody.indexOf('if (CHOREO_EOT && endTurnRefused(useGame.getState())) return;');
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(endTurnBody.indexOf('beginWhisperDissipate();'));
  });

  it('the legacy runner (the rollback valve) paces its ticks through the shared plan', () => {
    expect(RECRUIT).toContain('const pacing = legacyEotRepeatPlan(beats.map((b) => b.uid), BEAT, GAP);');
    expect(RECRUIT).toContain('if (beatMs + gapMs <= 0) { playBeat(i + 1); return; }');
  });
});

describe('endTurnRefused — the one predicate for "End of Turn cannot resolve now"', () => {
  afterEach(() => installVersusHandlers(null));
  const versusRun = { ...createRun(1), mode: 'versus', phase: 'recruit' } as RunState;
  const withFreeze = (f: VersusFreeze): void => installVersusHandlers({ fightFor: () => null, afterCommit: () => {}, freeze: () => f });

  it('refuses in the replay viewer and the Duos teammate view (the store run is not mine)', () => {
    expect(endTurnRefused({ replaying: true, run: createRun(1) })).toBe(true);
  });
  it('refuses while a Versus match is paused, allows a held shop (End Turn is the game\'s own action) and a live one', () => {
    withFreeze('paused');
    expect(endTurnRefused({ replaying: false, run: versusRun })).toBe(true);
    withFreeze('held');
    expect(endTurnRefused({ replaying: false, run: versusRun })).toBe(false);
    withFreeze(null);
    expect(endTurnRefused({ replaying: false, run: versusRun })).toBe(false);
  });
  it('never refuses an ordinary run', () => {
    expect(endTurnRefused({ replaying: false, run: createRun(1) })).toBe(false);
  });
});

describe('legacyEotRepeatPlan — the legacy runner batches a repeat chain like the compiler does', () => {
  const totalMs = (plan: ReturnType<typeof legacyEotRepeatPlan>, from: number, to: number): number => {
    let t = 0;
    for (let i = from; i < to; i++) t += (plan[i]!.holdMs ?? LEGACY_BEAT) + (plan[i]!.gapMs ?? LEGACY_GAP);
    return t;
  };

  it('four golden Kringles of 61 ticks share the End of Turn budget (was 61 x 930 ms each)', () => {
    const uids = ['brakka', ...['k0', 'k1', 'k2', 'k3'].flatMap((u) => Array<string>(61).fill(u)), 'edward', ''];
    const plan = legacyEotRepeatPlan(uids, LEGACY_BEAT, LEGACY_GAP);
    expect(plan.length).toBe(uids.length);
    // A single beat (a plain End of Turn, a sourceless quest beat) keeps the runner's own timing.
    expect(plan[0]!.holdMs).toBeNull();
    expect(plan[uids.length - 2]!.holdMs).toBeNull();
    expect(plan[uids.length - 1]!.holdMs).toBeNull();
    let chains = 0;
    for (let k = 0; k < 4; k++) {
      const from = 1 + k * 61;
      const ms = totalMs(plan, from, from + 61);
      expect(ms, `Kringle ${k}: its chain fits its share`).toBeLessThanOrEqual(repeatChainCapMs(4) + 1);
      expect(plan[from]!.accent && plan[from + 60]!.accent).toBe(true);
      // Batched: some ticks play together (hold 0), so not every tick is its own beat on screen.
      expect(plan.slice(from, from + 61).filter((p) => p.holdMs === 0 && p.gapMs === 0).length).toBeGreaterThan(0);
      chains += ms;
    }
    expect(chains).toBeLessThanOrEqual(REPEAT_PACING.phaseCapMs + 4);
  });

  it('a Chronos double keeps its full pace; two different neighbours never merge into one chain', () => {
    const plan = legacyEotRepeatPlan(['a', 'a', 'b'], LEGACY_BEAT, LEGACY_GAP);
    expect(totalMs(plan, 0, 2)).toBeCloseTo(2 * (LEGACY_BEAT + LEGACY_GAP), 0);
    expect(plan[2]!.holdMs).toBeNull();
  });
});

// ── The authoritative path, on the owner's kind of board ────────────────────────────────────────────────────────

const body = (uid: string, cardId: string, golden: boolean, scale: number): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  const k = (golden ? 2 : 1) * scale;
  return { uid, cardId, tribe: d.tribe, attack: d.attack * k, health: d.health * k, keywords: [...d.keywords], golden };
};
const REPEATERS = ['dw_foreman', 'dw3_striker'];
const DWARVES = ['dw_foreman', 'dw3_striker', 'dw3_kneel', 'dw3_tankerchief', 'dw_brakka', 'dw_edward', 'dw_brunni', 'dw_tapkeeper', 'chronos'];

describe('every repeat tick on the authoritative End of Turn is paced (Dwarf boards, golden, huge stats, Chronos, Versus)', () => {
  it('no repeat chain of a long count is ever laid out one full beat per tick', () => {
    let seed = 2026_10_29;
    const rnd = (): number => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 2 ** 32; };
    const config = shippedBeatConfig();
    let checked = 0;
    for (let trial = 0; trial < 60; trial++) {
      const n = 3 + Math.floor(rnd() * 5);
      const board = Array.from({ length: n }, (_, i) => body(`u${i}`, DWARVES[Math.floor(rnd() * DWARVES.length)]!, rnd() < 0.6, 20 + Math.floor(rnd() * 40)));
      if (!board.some((b) => REPEATERS.includes(b.cardId))) board[0] = body('u0', 'dw_foreman', true, 30);
      const played = 5 + Math.floor(rnd() * 60);
      for (const setId of ['set2', 'set3'] as const) {
        const state = { ...createRun(trial + 1), setId, phase: 'recruit', embers: 20, tier: 6, tribes: ['dwarf'],
          pool: Object.fromEntries(poolFor(setId).buyable.map((c) => [c.id, 5])),
          board, playedThisTurn: Array.from({ length: played }, (_, i) => `x${i}`) } as RunState;
        for (const action of [{ type: 'faceOmen' }, { type: 'faceOmen', deferFight: true }]) {
          const tl = compileTimeline(normalizePresentationBatch(prepareActionWithPresentation(state, action as never).batch!), { config });
          const ticks = tl.beats.filter((b) => b.repeat && b.repeat.count >= REPEAT_PACING.longChainTicks);
          const label = `${setId} ${board.map((b) => b.cardId + (b.golden ? '*' : '')).join(',')} played=${played}`;
          expect(ticks.filter((b) => b.lane !== 'source'), `${label}: a repeat tick nested under another beat is not paced`).toEqual([]);
          expect(ticks.filter((b) => !b.pace), `${label}: an unpaced repeat tick`).toEqual([]);
          const chains = new Set(ticks.map((b) => b.source.uid));
          const repeatMs = [...chains].reduce((t, uid) => {
            const mine = ticks.filter((b) => b.source.uid === uid);
            return t + Math.max(...mine.map((b) => b.recoveryEndMs)) - Math.min(...mine.map((b) => b.startMs));
          }, 0);
          expect(repeatMs, `${label}: the repeat chains fit the End of Turn budget`).toBeLessThanOrEqual(Math.max(REPEAT_PACING.phaseCapMs, chains.size * REPEAT_PACING.minChainCapMs) + chains.size * 2);
          checked += ticks.length;
        }
      }
    }
    expect(checked, 'the boards really did carry long repeat chains').toBeGreaterThan(1000);
  });
});
