/**
 * BALANCE BOT B0 — LEGACY-DEFECT FIXTURES (docs/balance-bot-roadmap.md, "Measurement defects to retire first").
 *
 * Every `it` here is a small deterministic reproduction that ASSERTS THE DEFECT EXISTS TODAY. The suite is green
 * on purpose: each expectation describes CURRENT behaviour, tagged `DEFECT — retire in Bx`, so whoever fixes the
 * defect has to flip the test consciously (and the roadmap row with it) rather than discover a silent change in
 * a measurement they trusted. None of these are regressions to preserve — they are the legacy instrument's known
 * blind spots, pinned so B1/B3/B5 can prove they no longer have them.
 *
 * Roadmap defect (e) — `productionBots/bots.test.ts` "every difficulty is far stronger than the legacy greedy
 * policy" never runs the greedy policy — is a documentation finding (the test's title overclaims), recorded in the
 * B0 report rather than fixtured here: there is no runtime behaviour to pin.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type Action, type RunState } from '../state';
import { reduce } from '../reducer';
import { CONFIG } from '../config';
import { DEFAULT_BOT, type BotPolicy } from '../bots';
import { createReportAccumulator, playAndRecordInto } from '../balanceReport';
import { OPPONENT_POOL } from '../opponents';
import { buildEnemyBoard, THREAT_IDS } from '../threats';
import { fightScore, toBotVisibleState } from '../productionBots';
import { botSeat } from '../lobby/seats';
import { snapshotBoard } from '../snapshot';


const SIM = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string): string => readFileSync(join(SIM, rel), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('legacy defect (a): balanceReport records an intended purchase BEFORE reducer acceptance', () => {
  /** A policy that buys the first offer (accepted), then tries to buy a DIFFERENT offer with 0 Gold (rejected),
   *  then ends every turn / resolves every combat. Deterministic; no search. */
  function scriptedPolicy(log: { rejectedId: string | null; boughtId: string | null }): BotPolicy {
    let tried = false;
    return {
      ...DEFAULT_BOT,
      id: 'b0-scripted',
      name: 'B0 scripted',
      act(s: RunState): Action {
        if (s.phase === 'combat') return { type: 'resolveCombat' };
        if (s.phase !== 'recruit') return { type: 'faceOmen' };
        if (!tried && s.wave === 1) {
          if (log.boughtId === null) {
            const first = s.shop[0]!;
            log.boughtId = first.cardId;
            return { type: 'buy', uid: first.uid };
          }
          // Second buy: Gold is 0 now (turn 1 = 3 Gold, one Tier-1 minion = 3). Pick an offer whose card differs
          // from the one we own, so the tally row is unambiguous.
          const other = s.shop.find((o) => o.cardId !== log.boughtId);
          tried = true;
          if (other) { log.rejectedId = other.cardId; return { type: 'buy', uid: other.uid }; }
        }
        return { type: 'faceOmen' };
      },
    };
  }

  it('counts a purchase the reducer REJECTED as picked (DEFECT — retire in B5: record accepted transitions only)', () => {
    const log = { rejectedId: null as string | null, boughtId: null as string | null };
    const acc = createReportAccumulator();
    // Precondition the script relies on: turn 1 starts with exactly enough Gold for one minion.
    expect(CONFIG.startEmbers).toBe(3);
    playAndRecordInto(acc, 7, 'warden', scriptedPolicy(log));

    expect(log.boughtId).not.toBeNull();
    expect(log.rejectedId).not.toBeNull();
    expect(log.rejectedId).not.toBe(log.boughtId);

    // The rejected buy never happened — prove it independently by replaying the same two actions by hand.
    let s = createRun(7, 'warden');
    const first = s.shop[0]!;
    s = reduce(s, { type: 'buy', uid: first.uid });
    expect(s.embers).toBe(0);
    const other = s.shop.find((o) => o.cardId !== first.cardId)!;
    const after = reduce(s, { type: 'buy', uid: other.uid });
    expect(after).toBe(s); // rejected: identity unchanged

    // …yet the report tallied it as a pick, indistinguishable from the accepted one.
    const rejectedRow = acc.minion.get(log.rejectedId!);
    const boughtRow = acc.minion.get(log.boughtId!);
    expect(boughtRow?.picked).toBe(1);
    expect(rejectedRow?.picked).toBe(1); // DEFECT — the pick is recorded before `reduce` decides
  });

  it('the no-op safety net FORCES end-turn / combat instead of failing the run (DEFECT — retire in B1: a rejected action is a pilot failure)', () => {
    const body = src('balanceReport.ts');
    // The loop applies the action, and when the reducer returns its input it silently force-progresses.
    expect(body).toMatch(/const n = reduce\(s, action\);\s*if \(n !== s\) \{ s = n; continue; \}/);
    expect(body).toMatch(/No-op safety net[\s\S]*?reduce\(s, \{ type: 'faceOmen' \}\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('legacy defect (b): fightScore falls back to the procedural threat curve when no pool is registered', () => {
  /** `panelSeed` from fightScore.ts, reproduced verbatim so the fallback can be recomputed from outside. */
  const panelSeed = (wave: number): number => {
    let h = 2166136261 >>> 0;
    h ^= wave >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    return h;
  };

  it('scores against `buildEnemyBoard` threats and the result carries NO record of the panel source (DEFECT — retire in B3: versioned opponent panels, missing pool = visible failure)', () => {
    // Precondition: nothing has registered a pool in this process (the CLI never does either — roadmap).
    expect(OPPONENT_POOL.length).toBe(0);

    // A real turn-1 board: buy + play the first offer.
    let s = createRun(11, 'warden');
    s = reduce(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = reduce(s, { type: 'play', uid: s.hand[0]!.uid, toIndex: 0 });
    expect(s.board.length).toBe(1);
    const v = toBotVisibleState(s);

    const r = fightScore(v);
    expect(r.fights).toBe(THREAT_IDS.length);
    expect(Object.keys(r).sort()).toEqual(['averageDamage', 'fights', 'margin', 'winRate']); // no `source` / `panel` field

    // Recompute the FALLBACK panel by hand — if the two agree exactly, the procedural path is what scored it.
    const mine: BoardMinion[] = s.board.map((c) => ({ cardId: c.cardId, attack: c.attack, health: c.health, keywords: [...c.keywords], golden: c.golden })) as BoardMinion[];
    const seed = panelSeed(v.wave);
    let wins = 0; let draws = 0;
    for (let i = 0; i < THREAT_IDS.length; i++) {
      const enemy = buildEnemyBoard(THREAT_IDS[i]!, v.wave, makeRng(seed + i * 7919));
      const f = simulate(mine, enemy, makeRng(seed + i * 104_729), CARD_INDEX, combatSide({ tier: s.tier }), combatSide({ tier: s.tier }));
      if (f.result === 'win') wins++; else if (f.result === 'draw') draws++;
    }
    expect(r.winRate).toBeCloseTo((wins + draws * 0.5) / THREAT_IDS.length, 10); // DEFECT — silent fallback
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('legacy defect (c): lobby combat builds a TIER-ONLY combat context; the reducer fight carries the run', () => {
  const TIER_ONLY = /combatSide\(\{ tier: \w+\.tier \}\)/g;

  it('lobby/lobby.ts + lobby/runLobby.ts pass `combatSide({ tier })` for BOTH sides at every fight (DEFECT — retire in B1: shared authoritative preparation)', () => {
    const lobby = src('lobby/lobby.ts');
    const runLobby = src('lobby/runLobby.ts');
    const lobbyCalls = lobby.match(/combatSide\([^)]*\)/g) ?? [];
    const runLobbyCalls = runLobby.match(/combatSide\([^)]*\)/g) ?? [];
    expect(lobbyCalls.length).toBeGreaterThan(0);
    expect(runLobbyCalls.length).toBeGreaterThan(0);
    // EVERY call in both files is the tier-only shape — none passes poolIds / spell power / quest mods / …
    for (const call of [...lobbyCalls, ...runLobbyCalls]) expect(call).toMatch(TIER_ONLY);
    expect(lobbyCalls.length).toBe(2);
    expect(runLobbyCalls.length).toBe(4);
  });

  it('the player\'s reducer fight (`faceOmen`) passes the run-level scalers the lobby drops', () => {
    const reducer = src('reducer.ts');
    const start = reducer.indexOf('const playerState: CombatSideState = combatSide({');
    expect(start).toBeGreaterThan(0);
    const block = reducer.slice(start, reducer.indexOf('});', start));
    for (const field of ['poolIds', 'spellsCast', 'spellPowerAtk', 'spellPowerHp', 'rubyBonus', 'tribes', 'cardBuffs', 'handSpellIds', 'questMods', 'pendingQuests', 'handMinions']) {
      expect(block, field).toContain(`${field}:`);
    }
  });

  it('a tier-only side really is empty of run context at runtime', () => {
    const side = combatSide({ tier: 5 });
    expect(side.spellPowerAtk).toBe(0);
    expect(side.spellPowerHp).toBe(0);
    expect(side.spellsCast).toBe(0);
    expect(side.poolIds).toBeUndefined();
    expect(side.questMods).toEqual({});
    expect(side.handMinions ?? []).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('legacy defect (d): lobby/seats.ts::botSeat `prepare` only shops while the board is EMPTY', () => {
  /** Replay `botSeat`'s `advanceTo` with the run exposed, so its Gold/phase can be inspected. Same policy
   *  (`legacy` = DEFAULT_BOT), same guards, same stop conditions. */
  function replicaAdvanceTo(run: RunState, wave: number): RunState {
    const terminal = (r: RunState): boolean => r.phase === 'gameover' || r.phase === 'victory';
    let guard = 0;
    while (run.wave < wave && !terminal(run) && guard++ < 4000) {
      const next = reduce(run, DEFAULT_BOT.act(run));
      if (next === run) break;
      run = next;
    }
    let shopGuard = 0;
    while (run.phase === 'recruit' && run.board.length === 0 && !terminal(run) && shopGuard++ < 60) {
      const action = DEFAULT_BOT.act(run);
      if (action.type === 'faceOmen') break;
      const next = reduce(run, action);
      if (next === run) break;
      run = next;
    }
    return run;
  }
  const bodies = (b: { minions: readonly { cardId: string; attack: number; health: number }[] } | null) =>
    (b?.minions ?? []).map((m) => `${m.cardId}:${m.attack}/${m.health}`);

  it('round 2 is fielded with the round-1 board and the FULL turn income unspent; a second prepare(2) does nothing (DEFECT — retire in B1: every living seat shops until it legally ends recruitment)', () => {
    const seed = 3;
    const seat = botSeat(seed, 'warden', 'b0', 'legacy');
    const r1 = seat.prepare(1);
    expect(r1).not.toBeNull();
    expect(r1!.minions.length).toBeGreaterThan(0);

    const r2 = seat.prepare(2);
    const r2again = seat.prepare(2);
    expect(bodies(r2)).toEqual(bodies(r2again)); // repeated preparation: no shopping, no progress, no replay

    // The replica shows WHY: after reaching wave 2 the board is non-empty, so the shop loop never runs.
    let run = createRun(seed, 'warden', 'lobby');
    run = replicaAdvanceTo(run, 1);
    expect(bodies(snapshotBoard(run))).toEqual(bodies(r1)); // the replica mirrors the seat at round 1
    run = replicaAdvanceTo(run, 2);
    expect(bodies(snapshotBoard(run))).toEqual(bodies(r2)); // …and at round 2
    expect(run.wave).toBe(2);
    expect(run.phase).toBe('recruit');
    expect(run.board.length).toBeGreaterThan(0);
    // Wave-2 income is the full turn's Gold — untouched. The seat fights round 2 without having shopped for it.
    expect(run.embers).toBe(CONFIG.startEmbers + CONFIG.embersPerWave); // DEFECT — incomplete recruitment
    expect(run.embers).toBeGreaterThan(0);
    // And a further prepare(2) on the replica is a no-op for the same reason.
    const again = replicaAdvanceTo(run, 2);
    expect(again).toBe(run);
  });
});
