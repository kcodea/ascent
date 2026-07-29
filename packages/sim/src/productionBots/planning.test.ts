import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRun, type RunState } from '../state';
import { reduce } from '../reducer';
import { DEFAULT_BOT } from '../bots/index';
import { __unsafeStateForTests, applyCandidate, createPlanningRoot, liveHandleCount, release, releaseAll, revealOf, visibleOf } from './transition';
import { fingerprint, toBotVisibleState } from './visibleState';
import { assertIdentity, currentRulesIdentity, rulesHashFor } from './rulesIdentity';

/**
 * TICKET 0 — the planning-safety boundary.
 *
 * Two guarantees, and these tests are what make them true rather than merely intended:
 *
 *  1. Speculation cannot touch the live run, the search root, or a sibling candidate.
 *  2. The bot cannot see what a player cannot — no seed, no RNG cursor, no pinned future opponent.
 *
 * Both are easy to believe and easy to break silently, because breaking them produces a bot that plays BETTER.
 * A leak makes the tests pass everywhere else and only shows up as a bot that seems to know things.
 */
afterEach(() => releaseAll());

/** A run advanced a few turns, so board/hand/shop/counters are all populated rather than empty. */
function midRun(seed = 918_273, waves = 5): RunState {
  let s = createRun(seed, 'drakko');
  let guard = 0;
  while (s.wave < waves && s.phase !== 'gameover' && s.phase !== 'victory' && guard++ < 4000) {
    const next = reduce(s, DEFAULT_BOT.act(s));
    if (next === s) break;
    s = next;
  }
  return s;
}

describe('planning safety — speculation is isolated', () => {
  it('creating a root does not retain or mutate the caller’s run', () => {
    const live = midRun();
    const before = JSON.stringify({ ...live, lastCombat: undefined });
    const root = createPlanningRoot(live);
    applyCandidate(root, { type: 'roll' });
    expect(JSON.stringify({ ...live, lastCombat: undefined }), 'the live run was mutated by planning').toBe(before);
  });

  it('expanding a candidate leaves the ROOT byte-identical', () => {
    // The specific hazard: `reduce()` writes to its INPUT before cloning — it resets the FX scratch buffers and
    // pins this wave's opponent into `servedBoards`. Handing it a shared node would decide the player's next
    // fight as a side effect of merely considering an action.
    //
    // Compared on the RAW state, not through `visibleOf`. Every field `reduce()` corrupts is one the projection
    // deliberately redacts, so checking through the projection is checking through a lens built to hide the
    // damage — measured: removing the defensive clone left this test green when it was written that way.
    const root = createPlanningRoot(midRun());
    const before = JSON.stringify(__unsafeStateForTests(root));
    for (const action of [{ type: 'roll' }, { type: 'upgrade' }, { type: 'freeze' }] as const) {
      applyCandidate(root, action);
    }
    expect(JSON.stringify(__unsafeStateForTests(root)), 'the root was mutated while expanding its candidates').toBe(before);
  });

  it('…including the fields the projection hides, which is where the damage actually lands', () => {
    // The hazard is CONSTRUCTED, not waited for. In a bare test process every input-mutation `reduce()` performs
    // is coincidentally a no-op — the FX buffers start empty, so clearing them changes nothing, and no opponent
    // pins because the board pool is only registered by the running app. A test that merely expanded a
    // candidate therefore passed with the defensive clone REMOVED, twice, and proved nothing.
    //
    // So the root is seeded with exactly the state `reduce()` clobbers: a populated FX buffer, a live aura
    // batch, and a stamped weld sequence. Now an unguarded `reduce(base, …)` is visibly destructive.
    const base = midRun();
    const root = createPlanningRoot({
      ...base,
      recruitBuffFx: [{ targetUid: 'sentinel', sourceUid: 'sentinel', attack: 1, health: 1 }] as RunState['recruitBuffFx'],
      auraFx: [{ tribe: 'demon', attack: 1, health: 1, targets: ['sentinel'] }] as RunState['auraFx'],
      weldFxBaseSeq: 4242,
    });
    const raw = () => __unsafeStateForTests(root)!;
    expect(raw().recruitBuffFx?.length, 'the fixture failed to seed the hazard').toBe(1);

    applyCandidate(root, { type: 'freeze' });

    expect(raw().recruitBuffFx?.length, 'the root’s FX buffer was cleared by a speculative action').toBe(1);
    expect(raw().auraFx, 'the root’s aura batch was cleared by a speculative action').toBeTruthy();
    expect(raw().weldFxBaseSeq, 'the root’s weld sequence was restamped by a speculative action').toBe(4242);
    expect(JSON.stringify(raw().servedBoards ?? {}), 'a speculative action pinned this wave’s opponent on the root')
      .toBe(JSON.stringify(base.servedBoards ?? {}));
  });

  it('siblings do not see each other', () => {
    const root = createPlanningRoot(midRun());
    const a = applyCandidate(root, { type: 'upgrade' });
    const beforeA = a.fingerprint;
    const b = applyCandidate(root, { type: 'roll' });
    expect(b.child.id).not.toBe(a.child.id);
    expect(fingerprint(visibleOf(a.child)), 'expanding a sibling changed this candidate').toBe(beforeA);
  });

  it('candidate ORDER does not change candidate results', () => {
    // A shared-state bug often survives the tests above and only shows up as order dependence.
    const forward = (() => {
      const root = createPlanningRoot(midRun());
      const x = applyCandidate(root, { type: 'upgrade' }).fingerprint;
      const y = applyCandidate(root, { type: 'roll' }).fingerprint;
      return [x, y];
    })();
    const reversed = (() => {
      const root = createPlanningRoot(midRun());
      const y = applyCandidate(root, { type: 'roll' }).fingerprint;
      const x = applyCandidate(root, { type: 'upgrade' }).fingerprint;
      return [x, y];
    })();
    expect(reversed).toEqual(forward);
  });

  it('a rejected action reports `changed: false` rather than throwing', () => {
    let s = midRun();
    s = { ...s, embers: 0 }; // can't afford anything
    const root = createPlanningRoot(s);
    const t = applyCandidate(root, { type: 'upgrade' });
    expect(t.changed).toBe(false);
    expect(t.child, 'a rejected candidate still needs a handle so callers need not branch').toBeTruthy();
  });

  it('handles are released, so planning memory cannot accumulate across decisions', () => {
    const root = createPlanningRoot(midRun());
    applyCandidate(root, { type: 'roll' });
    expect(liveHandleCount()).toBeGreaterThan(1);
    release(root);
    releaseAll();
    expect(liveHandleCount()).toBe(0);
  });
});

describe('information fairness — the bot sees only what a player sees', () => {
  const HIDDEN_KEYS = ['seed', 'rngCursor', 'servedBoards', 'lastCombat', 'scoutedNextOpponent'];

  it('the visible state contains no hidden field, by key', () => {
    const v = toBotVisibleState(midRun());
    const keys = new Set<string>();
    const walk = (o: unknown): void => {
      if (!o || typeof o !== 'object') return;
      for (const [k, val] of Object.entries(o as Record<string, unknown>)) { keys.add(k); walk(val); }
    };
    walk(v);
    for (const k of HIDDEN_KEYS) expect([...keys], `"${k}" leaked into BotVisibleState`).not.toContain(k);
  });

  it('…and no hidden VALUE either — a seed can leak without its key', () => {
    // The stricter check: a projection could copy the seed under another name. Searching the serialized view
    // for the actual value catches that — which is why the fixture seed is deliberately large and distinctive:
    // a single-digit seed matches any stat on the board and the assertion means nothing.
    const s = midRun();
    expect(String(s.seed).length, 'the fixture seed is too short to search for meaningfully').toBeGreaterThan(4);
    const serialized = JSON.stringify(toBotVisibleState(s));
    expect(serialized, 'the run seed appears in the visible state').not.toContain(String(s.seed));
    expect(serialized, 'the RNG cursor appears in the visible state').not.toContain(String(s.rngCursor));
  });

  it('the PINNED next opponent is invisible even though the run already knows it', () => {
    // `servedBoards` records the exact board a wave will fight, stamped on the first recruit action of the
    // turn — so the run genuinely holds it while the player has only seen the opponent frame's summary. A bot
    // that could read it would position perfectly against a board it is not allowed to know.
    //
    // The board is INJECTED rather than played into: the opponent pool is registered by the app at startup, so
    // in a bare test process every wave falls back to the procedural threat and `servedBoards` is all nulls.
    // Waiting for a natural pin made this silently vacuous. What is under test is the projection, not
    // matchmaking, so a hand-placed board tests exactly the right thing.
    const base = midRun();
    const secret = 'lab-experiment-marker-card';
    const s: RunState = {
      ...base,
      servedBoards: {
        ...(base.servedBoards ?? {}),
        [base.wave]: {
          v: 1, wave: base.wave, heroId: 'warden', resolve: 30, tier: 4, triples: 0,
          tribes: ['beast', 'dragon', 'undead', 'mech', 'demon'], threat: 'glass', power: 40,
          minions: [{ cardId: secret, attack: 9, health: 9, keywords: [] }],
          seed: 1234567,
        },
      } as RunState['servedBoards'],
    };
    expect(s.servedBoards?.[s.wave], 'the fixture failed to pin anything').toBeTruthy();
    const serialized = JSON.stringify(toBotVisibleState(s));
    expect(serialized, 'the pinned opponent board leaked into the visible state').not.toContain(secret);
  });

  it('changing ONLY hidden RNG does not change the visible state or its fingerprint', () => {
    // The contract search relies on: two states a player could not tell apart must be indistinguishable to the
    // bot, or the fairness guarantee leaks through the plan cache.
    const s = midRun();
    const twisted: RunState = { ...s, rngCursor: (s.rngCursor ?? 0) + 999_983, seed: s.seed + 1 };
    expect(fingerprint(toBotVisibleState(twisted))).toBe(fingerprint(toBotVisibleState(s)));
  });

  it('a refresh is a reveal boundary; a deterministic action is not', () => {
    expect(revealOf({ type: 'roll' })?.kind).toBe('refresh');
    expect(revealOf({ type: 'rerollRuneforge' })?.kind).toBe('forge');
    expect(revealOf({ type: 'upgrade' })).toBeNull();
    expect(revealOf({ type: 'freeze' })).toBeNull();
    expect(revealOf({ type: 'sell', uid: 'x' })).toBeNull();
  });

  it('applying a refresh REPORTS the boundary, so search knows to stop', () => {
    const root = createPlanningRoot(midRun());
    const t = applyCandidate(root, { type: 'roll' });
    expect(t.reveal, 'a refresh was expanded with no boundary — search would read the future shop').toBeTruthy();
  });
});

describe('module boundary — scoring code cannot reach RunState', () => {
  it('no scoring-side module imports RunState or the reducer', () => {
    // Structural, not a convention: the projection is only a guarantee if a scoring function CANNOT reach
    // around it. The distinction the rule draws:
    //
    //  - Importing `type Action` is FINE anywhere. Actions are what the bot PRODUCES; naming them reveals
    //    nothing about hidden state.
    //  - Importing `RunState`, or the reducer, is the leak — that is reaching past the redaction.
    //
    // `transition` and `visibleState` exist to perform the conversion, and `controller` is the entry point that
    // receives the live run and hands it straight to a planning root. Everything else — the evaluator, search,
    // candidate generation, difficulty, future strategy and tracing — must go through them.
    const dir = __dirname;
    const SANCTIONED = new Set(['transition.ts', 'visibleState.ts', 'controller.ts', 'rulesIdentity.ts', 'index.ts', 'types.ts']);
    const offenders: string[] = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || SANCTIONED.has(file)) continue;
      const src = readFileSync(join(dir, file), 'utf8');
      if (/RunState/.test(src)) offenders.push(`${file} (RunState)`);
      if (/from '\.\.\/reducer'/.test(src)) offenders.push(`${file} (reducer)`);
    }
    expect(offenders, 'these modules reach past the projection — route them through transition.ts').toEqual([]);
  });

  it('the sanctioned list is not a blanket exemption — it names the conversion layer only', () => {
    // Guards the obvious way to "fix" a failure of the test above: adding the offending file to SANCTIONED.
    const dir = __dirname;
    const scoring = ['evaluate.ts', 'search.ts', 'legalActions.ts', 'difficulties.ts', 'actionCatalog.ts'];
    for (const file of scoring) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(/RunState/.test(src), `${file} must not know about RunState`).toBe(false);
    }
  });
});

describe('rules identity — a stored artifact knows what it was made under', () => {
  it('the hash depends on CONTENT, and the two sets differ', () => {
    expect(rulesHashFor('set1')).toBe(rulesHashFor('set1')); // stable
    expect(rulesHashFor('set1')).not.toBe(rulesHashFor('set2'));
  });

  it('an identity matching itself passes', () => {
    const id = currentRulesIdentity('set1');
    expect(() => assertIdentity(id, currentRulesIdentity('set1'))).not.toThrow();
  });

  it('a drifted content hash fails LOUDLY, naming what changed', () => {
    // The failure mode this prevents: an old fixture replaying under new content and reporting itself as the
    // same run. Silence there is worse than an error.
    const stored = { ...currentRulesIdentity('set1'), rulesHash: 'deadbeef' };
    expect(() => assertIdentity(stored, currentRulesIdentity('set1'))).toThrow(/rulesHash/);
  });

  it('a different SET fails, but a different build does not', () => {
    const current = currentRulesIdentity('set1');
    expect(() => assertIdentity(currentRulesIdentity('set2'), current)).toThrow(/setId/);
    // buildId/contentVersion change on every build; failing on them would make every artifact stale in a day.
    const otherBuild = { ...current, buildId: 'someOtherBuild', contentVersion: '9.9.9' };
    expect(() => assertIdentity(otherBuild, current)).not.toThrow();
  });
});
