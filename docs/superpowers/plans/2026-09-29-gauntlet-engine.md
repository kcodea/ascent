# Gauntlet — PR 1 (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Gauntlet stage playable headlessly: a `gauntlet` run mode that pits the player against one authored,
never-eliminated opponent for 10 rounds, with the Gauntlet damage caps, authored tiers, golden / added keywords,
opponent runes from rounds 6 and 9, and a clear/defeat verdict.

**Architecture:** A Gauntlet run is a 2-seat lobby (player + one `authored` seat), reusing the tutorial's authored-seat
driver. Stage data is JSON in `@game/content`, zod-validated. The per-round loss cap moves onto `LobbyRules.lossCaps`
so every existing cap reader can ask one run-aware function. Opponent runes reach combat through the same
`BoardSnapshot.questMods` channel recorded seats already use.

**Tech Stack:** TypeScript monorepo (npm workspaces), Vitest, zod.

**Spec:** `docs/superpowers/specs/2026-09-29-gauntlet-design.md`

**This is plan 1 of 4.** Plans for PR 2 (Stage Builder), PR 3 (Gauntlet screens) and PR 4 (account progress + crates)
are written after this PR lands, against the real interfaces it produces (listed under "Hand-off" at the end).

## Global Constraints

- Damage cap: rounds 1–3 **5**, 4–6 **10**, 7–8 **15**, 9–10 **uncapped**.
- 10 rounds per stage. Clear = player's seat still alive after round 10's combat (a round-10 loss or tie with Resolve > 0 is a clear).
- Opponent is never eliminated. A tie deals 0 to both (existing behaviour, unchanged).
- Shop / economy / tribes are the normal game's; no fixed seed. Hero Resolve + Armor are the hero's own.
- Opponent runes: one from round 6, one from round 9; they stack. Only combat-time effects can act.
- Normal-game behaviour must not change: `lossDamageCap(wave)` keeps its current table for every non-gauntlet run.
- `Math.random` is banned in `core`/`content`/`sim` (ESLint). Never mutate shared `CardDef`s.
- Branch off latest `origin/main`; never push to `main`; squash-merge via PR once CI `verify` is green.
- Gate before claiming done: `npm run typecheck && npm run lint && npm test && npm run build:web`.
- Run `npm install` inside a new worktree before trusting local typecheck/test.

## File structure

| File | Status | Responsibility |
|---|---|---|
| `packages/content/src/gauntlet/types.ts` | create | Stage data types |
| `packages/content/src/gauntlet/schema.ts` | create | zod schema + `validateStage` (ids exist, sizes, tiers) |
| `packages/content/src/gauntlet/drift.ts` | create | `stageDrift` — minions whose card changed since save |
| `packages/content/src/gauntlet/stages/01-demons.json` … `05-beasts.json` | create | The five tribe stages (draft, empty boards) |
| `packages/content/src/gauntlet/index.ts` | create | `GAUNTLET_STAGES`, `gauntletStage(n)` |
| `packages/content/src/gauntlet/gauntlet.test.ts` | create | Every shipped stage validates; drift detection |
| `packages/content/src/index.ts` | modify | re-export `./gauntlet` |
| `packages/sim/src/lobby/types.ts` | modify | `LobbyRules.lossCaps` |
| `packages/sim/src/reducer.ts` | modify | `roundLossCap`, `runLossCap`, cap call site, `runeCombatModsFor`, mode exclusions |
| `packages/sim/src/lobby/lobby.ts`, `runLobby.ts` | modify | read `roundLossCap`; skip damage to `invulnerable` seats |
| `packages/sim/src/odds.ts` | modify | optional explicit cap |
| `packages/sim/src/lobby/tutorialSeats.ts` | modify | golden / added keywords / explicit tiers / runes on authored seats |
| `packages/sim/src/state.ts` | modify | `RunMode` += `'gauntlet'`; `RunState.gauntletStage` |
| `packages/sim/src/lobby/gauntlet.ts` | create | `createGauntletRun`, `gauntletOutcome`, `GAUNTLET_LOSS_CAPS`, `GAUNTLET_DEFAULT_TIERS` |
| `packages/sim/src/lobby/gauntlet.test.ts` | create | engine behaviour tests |
| `packages/sim/src/lobby/index.ts` | modify | re-export `./gauntlet` |
| `packages/rules/src/registry/approved/foundation.ts` | modify | `R-GAUNTLET-01..03` |
| `docs/GAME-RULES.md` | modify | Gauntlet section |

---

### Task 1: Stage data format, validation and the five stage files

**Files:**
- Create: `packages/content/src/gauntlet/types.ts`, `schema.ts`, `drift.ts`, `index.ts`, `gauntlet.test.ts`
- Create: `packages/content/src/gauntlet/stages/01-demons.json`, `02-kobolds.json`, `03-dragons.json`, `04-dwarves.json`, `05-beasts.json`
- Modify: `packages/content/src/index.ts` (add one export line)

**Interfaces:**
- Produces: `GauntletStage`, `GauntletRound`, `GauntletMinion`, `GauntletStageStatus`, `validateStage(stage): string[]`,
  `stageDrift(stage): GauntletDrift[]`, `GAUNTLET_STAGES: readonly GauntletStage[]`, `gauntletStage(n: number): GauntletStage | undefined`,
  `GAUNTLET_ROUNDS = 10`, `GAUNTLET_BOARD_MAX = 7`.

- [ ] **Step 1: Write the types**

`packages/content/src/gauntlet/types.ts`:
```ts
import type { Keyword, Tribe } from '@game/core';

/** Rounds in every Gauntlet stage. */
export const GAUNTLET_ROUNDS = 10;
/** Most minions an authored board may hold (the game's board size). */
export const GAUNTLET_BOARD_MAX = 7;

/** `draft` stages are still being authored: the Gauntlet screen shows them as "Coming soon" and may hold empty
 *  boards. `ready` stages are playable and must field a board every round. */
export type GauntletStageStatus = 'draft' | 'ready';

/** One authored opponent minion. Stats are the authored line, not the card's printed stats. */
export interface GauntletMinion {
  cardId: string;
  attack: number;
  health: number;
  golden?: boolean;
  /** Keywords granted ON TOP of the card's printed keywords. */
  addedKeywords?: Keyword[];
  /** `cardRevision` of the card when this minion was saved — drives the "changed since saved" warning. */
  cardVersion: string;
}

export interface GauntletRound {
  /** Opponent tavern tier this round (1–6). Absent = `GAUNTLET_DEFAULT_TIERS` in @game/sim. */
  tier?: number;
  board: GauntletMinion[];
}

export interface GauntletStage {
  number: number;
  name: string;
  /** Shown on the in-run opponent portrait. */
  opponentName: string;
  tribe?: Exclude<Tribe, 'neutral'>;
  status: GauntletStageStatus;
  runes: { round6?: string; round9?: string };
  /** Exactly `GAUNTLET_ROUNDS` entries; index = round − 1. */
  rounds: GauntletRound[];
}
```

- [ ] **Step 2: Write the failing validation test**

`packages/content/src/gauntlet/gauntlet.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { GAUNTLET_STAGES, gauntletStage, validateStage, stageDrift, type GauntletStage } from './index';
import { cardRevision } from '../revisions';
import { CARD_INDEX } from '../index';

const someCard = Object.values(CARD_INDEX).find((c) => !c.spell && c.tier === 1)!;
const minion = (over: Partial<GauntletStage['rounds'][number]['board'][number]> = {}) => ({
  cardId: someCard.id, attack: 2, health: 3, cardVersion: cardRevision(someCard), ...over,
});
const stage = (over: Partial<GauntletStage> = {}): GauntletStage => ({
  number: 1, name: 'Test', opponentName: 'Tester', status: 'ready', runes: {},
  rounds: Array.from({ length: 10 }, () => ({ board: [minion()] })), ...over,
});

describe('Gauntlet stage data', () => {
  it('every shipped stage validates', () => {
    for (const s of GAUNTLET_STAGES) expect(validateStage(s), `stage ${s.number}`).toEqual([]);
  });

  it('ships the five tribe stages in the owner order', () => {
    expect(GAUNTLET_STAGES.map((s) => [s.number, s.name])).toEqual([
      [1, 'Demons'], [2, 'Kobolds'], [3, 'Dragons'], [4, 'Dwarves'], [5, 'Beasts'],
    ]);
    expect(gauntletStage(3)?.name).toBe('Dragons');
    expect(gauntletStage(9)).toBeUndefined();
  });

  it('a well-formed ready stage has no issues', () => {
    expect(validateStage(stage())).toEqual([]);
  });

  it('flags an unknown card, an oversized board, a bad tier, a bad rune and a wrong round count', () => {
    const bad = stage({
      runes: { round6: 'rune_does_not_exist' },
      rounds: [
        { board: [minion({ cardId: 'no_such_card' })] },
        { board: Array.from({ length: 8 }, () => minion()) },
        { tier: 7, board: [minion()] },
      ],
    });
    const issues = validateStage(bad).join('\n');
    expect(issues).toMatch(/exactly 10 rounds/);
    expect(issues).toMatch(/no_such_card/);
    expect(issues).toMatch(/round 2.*more than 7/);
    expect(issues).toMatch(/round 3.*tier/);
    expect(issues).toMatch(/rune_does_not_exist/);
  });

  it('a ready stage may not have an empty round; a draft stage may', () => {
    const empty = { rounds: Array.from({ length: 10 }, () => ({ board: [] })) };
    expect(validateStage(stage({ ...empty, status: 'ready' })).join()).toMatch(/round 1.*empty/);
    expect(validateStage(stage({ ...empty, status: 'draft' }))).toEqual([]);
  });

  it('stageDrift reports a minion saved against an older card revision', () => {
    const s = stage({ rounds: Array.from({ length: 10 }, (_, i) => ({ board: [minion(i === 4 ? { cardVersion: 'stale' } : {})] })) });
    expect(stageDrift(s)).toEqual([{ round: 5, index: 0, cardId: someCard.id }]);
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npx vitest run packages/content/src/gauntlet`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 4: Implement schema, drift, stage files, index**

`packages/content/src/gauntlet/schema.ts`:
```ts
import { z } from 'zod';
import { CARD_INDEX } from '../index';
import { RUNE_INDEX } from '../runes';
import { GAUNTLET_BOARD_MAX, GAUNTLET_ROUNDS, type GauntletStage } from './types';

const minionSchema = z.object({
  cardId: z.string().min(1),
  attack: z.number().int().min(0),
  health: z.number().int().min(1),
  golden: z.boolean().optional(),
  addedKeywords: z.array(z.string()).optional(),
  cardVersion: z.string(),
});
const stageSchema = z.object({
  number: z.number().int().min(1).max(10),
  name: z.string().min(1),
  opponentName: z.string().min(1),
  tribe: z.string().optional(),
  status: z.enum(['draft', 'ready']),
  runes: z.object({ round6: z.string().optional(), round9: z.string().optional() }),
  rounds: z.array(z.object({ tier: z.number().optional(), board: z.array(minionSchema) })),
});

/** Every problem with a stage, as human-readable lines (empty = valid). Used by CI and the Stage Builder's Save. */
export function validateStage(stage: GauntletStage): string[] {
  const parsed = stageSchema.safeParse(stage);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  const issues: string[] = [];
  if (stage.rounds.length !== GAUNTLET_ROUNDS) issues.push(`stage ${stage.number} must have exactly ${GAUNTLET_ROUNDS} rounds (has ${stage.rounds.length})`);
  stage.rounds.forEach((r, i) => {
    const round = i + 1;
    if (r.tier !== undefined && (!Number.isInteger(r.tier) || r.tier < 1 || r.tier > 6)) issues.push(`round ${round}: tier must be 1–6 (got ${r.tier})`);
    if (r.board.length > GAUNTLET_BOARD_MAX) issues.push(`round ${round}: board has more than ${GAUNTLET_BOARD_MAX} minions`);
    if (stage.status === 'ready' && r.board.length === 0) issues.push(`round ${round}: board is empty (a ready stage fields a board every round)`);
    r.board.forEach((m, j) => {
      const def = CARD_INDEX[m.cardId];
      if (!def) issues.push(`round ${round}, slot ${j + 1}: unknown card '${m.cardId}'`);
      else if (def.spell) issues.push(`round ${round}, slot ${j + 1}: '${m.cardId}' is a spell, not a minion`);
    });
  });
  for (const [slot, id] of Object.entries(stage.runes)) {
    if (id && !RUNE_INDEX[id]) issues.push(`${slot}: unknown rune '${id}'`);
  }
  return issues;
}
```

`packages/content/src/gauntlet/drift.ts`:
```ts
import { CARD_INDEX } from '../index';
import { cardRevision } from '../revisions';
import type { GauntletStage } from './types';

export interface GauntletDrift { round: number; index: number; cardId: string }

/** Minions whose card definition changed since the board was saved (their `cardVersion` no longer matches).
 *  Informational — the Stage Builder and Doc Bot surface it; it never fails CI. Unknown cards are
 *  `validateStage`'s job, not this one's. */
export function stageDrift(stage: GauntletStage): GauntletDrift[] {
  const out: GauntletDrift[] = [];
  stage.rounds.forEach((r, i) => r.board.forEach((m, index) => {
    const def = CARD_INDEX[m.cardId];
    if (def && cardRevision(def) !== m.cardVersion) out.push({ round: i + 1, index, cardId: m.cardId });
  }));
  return out;
}
```

Each stage file — `01-demons.json` shown; the others differ only in `number` / `name` / `opponentName` / `tribe`
(`2 Kobolds "The Kobold Warren" kobold`, `3 Dragons "The Dragon Roost" dragon`, `4 Dwarves "The Dwarven Hold" dwarf`,
`5 Beasts "The Beast Pack" beast`). Before writing them, confirm the tribe string values against the `Tribe` union in
`packages/core/src/types.ts` (`grep -n "export type Tribe" -A12 packages/core/src/types.ts`) and use exactly those.
```json
{
  "number": 1,
  "name": "Demons",
  "opponentName": "The Demon Host",
  "tribe": "demon",
  "status": "draft",
  "runes": {},
  "rounds": [
    { "board": [] }, { "board": [] }, { "board": [] }, { "board": [] }, { "board": [] },
    { "board": [] }, { "board": [] }, { "board": [] }, { "board": [] }, { "board": [] }
  ]
}
```

`packages/content/src/gauntlet/index.ts`:
```ts
import type { GauntletStage } from './types';
import s1 from './stages/01-demons.json';
import s2 from './stages/02-kobolds.json';
import s3 from './stages/03-dragons.json';
import s4 from './stages/04-dwarves.json';
import s5 from './stages/05-beasts.json';

export * from './types';
export { validateStage } from './schema';
export { stageDrift, type GauntletDrift } from './drift';

/** Every authored stage, in play order. Stages 6–10 are added as their files are authored. */
export const GAUNTLET_STAGES: readonly GauntletStage[] = ([s1, s2, s3, s4, s5] as GauntletStage[])
  .slice().sort((a, b) => a.number - b.number);

export const gauntletStage = (n: number): GauntletStage | undefined => GAUNTLET_STAGES.find((s) => s.number === n);
```

Append to `packages/content/src/index.ts` (next to the `revisions` export, line ~235):
```ts
export * from './gauntlet';
```
If `schema.ts`/`drift.ts` importing `CARD_INDEX` from `'../index'` creates an import cycle that breaks at load (it
mirrors `revisions.ts`, which already does this, so it should not), import from the module that defines `CARD_INDEX`
instead.

- [ ] **Step 5: Run the test**

Run: `npx vitest run packages/content/src/gauntlet`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/content/src/gauntlet packages/content/src/index.ts
git commit -m "feat(content): Gauntlet stage data format, validation and the five tribe stage files"
```

---

### Task 2: Per-lobby loss caps (`LobbyRules.lossCaps`)

**Files:**
- Modify: `packages/sim/src/lobby/types.ts:99-111`
- Modify: `packages/sim/src/reducer.ts:478-482` (add functions) and `:3631` (call site)
- Modify: `packages/sim/src/lobby/runLobby.ts` (`playerLossDamage`, `settleRunLobbyRound`'s `cap`)
- Modify: `packages/sim/src/lobby/lobby.ts:136`
- Modify: `packages/sim/src/odds.ts:47-50` (and `computeCombatOdds`)
- Test: `packages/sim/src/lobby/gauntlet.test.ts` (created here, extended in later tasks)

**Interfaces:**
- Produces: `LobbyRules.lossCaps?: (number | null)[]` (index = round − 1; `null` = uncapped; a round past the end = uncapped),
  `roundLossCap(rules: Pick<LobbyRules, 'lossCaps'> | undefined, round: number): number`,
  `runLossCap(run: Pick<RunState, 'lobby' | 'wave'>): number`,
  `createOddsProbe(input, seed, wave, sims?, cap?)`, `computeCombatOdds(input, seed, wave, cap?)`.

- [ ] **Step 1: Write the failing test**

`packages/sim/src/lobby/gauntlet.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { lossDamageCap, roundLossCap } from '../reducer';

describe('roundLossCap', () => {
  it('falls back to the normal game table when the lobby sets no caps', () => {
    for (const r of [1, 3, 4, 7, 8, 11, 12, 15, 16, 40]) expect(roundLossCap(undefined, r)).toBe(lossDamageCap(r));
    for (const r of [1, 5, 16]) expect(roundLossCap({}, r)).toBe(lossDamageCap(r));
  });

  it('reads a per-round table, null and past-the-end meaning uncapped', () => {
    const rules = { lossCaps: [5, 5, 5, 10, 10, 10, 15, 15, null, null] };
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => roundLossCap(rules, r)))
      .toEqual([5, 5, 5, 10, 10, 10, 15, 15, Infinity, Infinity, Infinity]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run packages/sim/src/lobby/gauntlet.test.ts`
Expected: FAIL — `roundLossCap` is not exported.

- [ ] **Step 3: Implement**

`packages/sim/src/lobby/types.ts` — add to `LobbyRules` after `snapshotSeats`:
```ts
  /** Per-round loss-damage caps for THIS lobby (index = round − 1; `null` = uncapped; a round past the end is
   *  uncapped). Absent = the normal game's `lossDamageCap` table. Plain data so the lobby stays serializable.
   *  Read ONLY through `roundLossCap`. Gauntlet sets it (see `GAUNTLET_LOSS_CAPS`). */
  lossCaps?: (number | null)[];
```

`packages/sim/src/reducer.ts` — directly below `lossDamageCap` (line ~482):
```ts
/** The loss cap for `round` under a lobby's rules: its own `lossCaps` table when it has one (Gauntlet), else the
 *  normal game's `lossDamageCap`. The ONE cap every reader asks — the reducer's fight, the lobby settle, the
 *  odds probe and the HUD — so a mode with its own caps can't have two of them disagree. */
export function roundLossCap(rules: Pick<LobbyRules, 'lossCaps'> | undefined, round: number): number {
  const caps = rules?.lossCaps;
  if (!caps) return lossDamageCap(round);
  const cap = caps[round - 1];
  return cap === null || cap === undefined ? Infinity : cap;
}

/** `roundLossCap` for a run's current round. */
export const runLossCap = (run: Pick<RunState, 'lobby' | 'wave'>): number => roundLossCap(run.lobby?.rules, run.wave);
```
Add `LobbyRules` to the reducer's existing `./lobby` type imports (it already imports from `./lobby/runLobby`; add
`import type { LobbyRules } from './lobby/types';`).

In `faceOmen`'s `resolveCombatVs` (line ~3631) replace
```ts
        const roundCap = lossDamageCap(s.wave);
```
with
```ts
        const roundCap = runLossCap(s);
```

`packages/sim/src/lobby/runLobby.ts`: change the import `import { lossDamageCap } from '../reducer';` to
`import { roundLossCap } from '../reducer';`, then:
- in `playerLossDamage`: `return Math.min(roundLossCap(lobby.rules, lobby.round), result.playerDamage);`
- in `settleRunLobbyRound`: `const cap = roundLossCap(lobby.rules, lobby.round);`

`packages/sim/src/lobby/lobby.ts:136`: `const cap = roundLossCap(state.rules, state.round);` (update the import the same way).

`packages/sim/src/odds.ts`: give `createOddsProbe` a trailing `cap = lossDamageCap(wave)` parameter and delete the
`const cap = lossDamageCap(wave);` line; give `computeCombatOdds` a trailing optional `cap?: number` that it forwards
to `createOddsProbe(input, seed, wave, COMBAT_ODDS_SIMS, cap ?? lossDamageCap(wave))`. (Read `computeCombatOdds`'s
current body first and forward exactly as it constructs the probe today.) UI callers switch to passing `runLossCap(run)`
in PR 3.

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/sim/src/lobby packages/sim/src/odds.test.ts packages/sim/src/run.test.ts`
Expected: PASS — including every existing lobby test (a lobby with no `lossCaps` behaves exactly as before).

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/lobby/types.ts packages/sim/src/reducer.ts packages/sim/src/lobby/runLobby.ts packages/sim/src/lobby/lobby.ts packages/sim/src/odds.ts packages/sim/src/lobby/gauntlet.test.ts
git commit -m "feat(sim): per-lobby loss caps (LobbyRules.lossCaps + roundLossCap)"
```

---

### Task 3: Authored seats carry golden, added keywords, explicit tiers, and never die when invulnerable

**Files:**
- Modify: `packages/sim/src/lobby/tutorialSeats.ts` (`AuthoredOmen`, `omenBoardMinions`, `authoredTierFor`)
- Modify: `packages/sim/src/lobby/runLobby.ts` (`LobbySeatState` fields; `settleRunLobbyRound` hits)
- Test: `packages/sim/src/lobby/gauntlet.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AuthoredOmen { attack; health; cardId?; golden?; addedKeywords?: Keyword[] }`;
  `LobbySeatState.authoredTiers?: number[]` (index = round − 1; wins over the ramp when present),
  `LobbySeatState.invulnerable?: true` (the settle never charges this seat).

- [ ] **Step 1: Write the failing tests** (append to `gauntlet.test.ts`)

```ts
import { omenBoardMinions, authoredTierFor } from './tutorialSeats';
import { settleRunLobbyRound, type RunLobby } from './runLobby';
import { CARD_INDEX } from '@game/content';
import type { CombatResult } from '@game/core';

const tauntless = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length === 0)!;
const keyworded = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length > 0)!;

describe('authored minions', () => {
  it('keep the authored stat line and mark golden', () => {
    const [m] = omenBoardMinions([{ cardId: tauntless.id, attack: 9, health: 11, golden: true }]);
    expect(m).toMatchObject({ cardId: tauntless.id, attack: 9, health: 11, golden: true });
  });

  it('add keywords ON TOP of the printed ones, without duplicates', () => {
    const printed = keyworded.keywords!;
    const [m] = omenBoardMinions([{ cardId: keyworded.id, attack: 1, health: 1, addedKeywords: ['T', printed[0]!] }]);
    expect(new Set(m!.keywords)).toEqual(new Set([...printed, 'T']));
    expect(m!.keywords!.length).toBe(new Set([...printed, 'T']).size);
  });

  it('a real card with no added keywords still inherits its printed keywords (keywords left unset)', () => {
    const [m] = omenBoardMinions([{ cardId: keyworded.id, attack: 1, health: 1 }]);
    expect(m!.keywords).toBeUndefined();
  });
});

describe('authoredTierFor', () => {
  it('an explicit per-round tier wins over the ramp', () => {
    const seat = { authoredTierRamp: 2, authoredTiers: [1, 1, 4] };
    expect(authoredTierFor(seat, 3)).toBe(4);
    expect(authoredTierFor(seat, 5)).toBe(authoredTierFor({ authoredTierRamp: 2 }, 5)); // past the table → ramp
  });
});

describe('invulnerable seats', () => {
  it('take no damage from a round they win, and are never knocked out', () => {
    const lobby: RunLobby = {
      version: 1, seed: 1, round: 1, encounters: [], finished: false,
      rules: { seatCount: 2, startingResolve: 30, startingArmor: 0, exhaustion: 'repeatFinal', maxRounds: 10 },
      seats: [
        { id: 's0', label: 'You', heroId: 'aster', kind: 'player', seed: 1, resolve: 30, armor: 0, alive: true },
        { id: 's1', label: 'Foe', heroId: 'aster', kind: 'authored', seed: 2, resolve: 1, armor: 0, alive: true,
          invulnerable: true, authoredBoards: [[{ attack: 1, health: 1 }]] },
      ],
    };
    const playerWon = { result: 'win', playerDamage: 0, enemyDamage: 50 } as unknown as CombatResult;
    const out = settleRunLobbyRound(lobby, playerWon);
    expect(out.seats[1]).toMatchObject({ resolve: 1, alive: true });
    expect(out.encounters.at(-1)).toMatchObject({ damageToB: 0 });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run packages/sim/src/lobby/gauntlet.test.ts`
Expected: FAIL — `golden` is dropped, `authoredTiers`/`invulnerable` unknown (type errors surface as test failures / tsc errors).

- [ ] **Step 3: Implement**

`tutorialSeats.ts` — extend `AuthoredOmen` and `omenBoardMinions`:
```ts
import type { BoardMinion, Keyword, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';

export interface AuthoredOmen {
  attack: number;
  health: number;
  cardId?: string;
  /** Gauntlet: a golden (tripled) copy. */
  golden?: boolean;
  /** Gauntlet: keywords granted ON TOP of the card's printed keywords. */
  addedKeywords?: Keyword[];
}

export function omenBoardMinions(board: readonly AuthoredOmen[]): BoardMinion[] {
  return board.map((m) => {
    const base: BoardMinion = {
      cardId: m.cardId ?? 'omen',
      attack: Math.max(1, Math.round(m.attack)),
      health: Math.max(1, Math.round(m.health)),
    };
    if (!m.cardId) return { ...base, keywords: [] }; // an omen is explicitly keywordless
    // `keywords` OVERRIDES the card's printed set at instantiate, so added keywords must carry the printed ones
    // with them; with nothing added, leave it unset so the card keeps its printed keywords exactly.
    const added = m.addedKeywords ?? [];
    const keywords = added.length ? [...new Set([...(CARD_INDEX[m.cardId]?.keywords ?? []), ...added])] : undefined;
    return { ...base, ...(m.golden ? { golden: true } : {}), ...(keywords ? { keywords } : {}) };
  });
}
```
Keep the existing `attack: Math.max(1, …)` clamp as-is (it's what the tutorial and bots rely on).

`authoredTierFor` — take the new field first:
```ts
export function authoredTierFor(
  seat: Pick<LobbySeatState, 'authoredTierRamp' | 'authoredTierStart' | 'authoredTiers'>, round: number,
): number {
  const explicit = seat.authoredTiers?.[Math.max(1, round) - 1];
  if (explicit !== undefined) return Math.min(6, Math.max(1, explicit));
  // …existing body unchanged…
}
```

`runLobby.ts` — add to `LobbySeatState` (next to `authoredTierStart`):
```ts
  /** Authored seats only (Gauntlet): the opponent's tavern tier for each round (index = round − 1). Wins over
   *  `authoredTierRamp` for every round it covers. */
  authoredTiers?: number[];
  /** Gauntlet's opponent: the settle never charges this seat, so it can never be eliminated (the player's goal
   *  is to SURVIVE, not to knock it out). Its hits are still recorded as 0 dealt to it. */
  invulnerable?: true;
```
Widen the `authoredBoards` field type to `AuthoredOmen[][]` (import the type from `./tutorialSeats`) so golden /
added keywords survive serialization.

In `settleRunLobbyRound`, where each pair is charged (`hitSeat(a, dmgToA); hitSeat(b, dmgToB);`), zero the damage to an
invulnerable seat BEFORE it is charged and recorded:
```ts
    if (a.invulnerable) dmgToA = 0;
    if (b.invulnerable) dmgToB = 0;
    hitSeat(a, dmgToA);
    hitSeat(b, dmgToB);
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/sim/src/lobby`
Expected: PASS, including `practiceBots.test.ts` and the tutorial tests (no field they use changed meaning).

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/lobby/tutorialSeats.ts packages/sim/src/lobby/runLobby.ts packages/sim/src/lobby/gauntlet.test.ts
git commit -m "feat(sim): authored seats carry golden, added keywords, explicit tiers; invulnerable seats"
```

---

### Task 4: Opponent runes reach combat

**Files:**
- Modify: `packages/sim/src/reducer.ts` (export `runeCombatModsFor`, next to `questCombatMods` ~line 7495)
- Modify: `packages/sim/src/lobby/tutorialSeats.ts` (`authoredSeat` attaches a snapshot)
- Modify: `packages/sim/src/lobby/runLobby.ts` (`LobbySeatState.authoredRunes`)
- Test: `packages/sim/src/lobby/gauntlet.test.ts`

**Interfaces:**
- Produces: `runeCombatModsFor(runeIds: readonly string[]): QuestCombatMods`;
  `LobbySeatState.authoredRunes?: { fromRound: number; runeId: string }[]`.
- Consumes: `applyQuestReward` (reducer-internal), `questCombatMods`, `createRun`, `BoardSnapshot`.

Why a snapshot: the reducer's lobby path already builds the enemy side with `enemySideFrom(lobbyFoe.snapshot, tier)`
(`reducer.ts` faceOmen, "LOBBY MODE"), and `sideFromSnapshot` threads `snap.questMods` into combat. A rune's combat
behaviour lives in `QuestCombatMods` (e.g. `rune_adventuring` → `rallyExtraAlways`). So an authored seat that hands
back a snapshot carrying those mods gets real opponent runes with no combat change.

- [ ] **Step 1: Write the failing tests**

```ts
import { runeCombatModsFor } from '../reducer';
import { authoredSeat } from './tutorialSeats';
import { RUNE_INDEX } from '@game/content';

describe('opponent runes', () => {
  it('runeCombatModsFor turns a combat rune into its combat modifier', () => {
    expect(RUNE_INDEX['rune_adventuring']?.reward).toMatchObject({ kind: 'rallyRepeat', scope: 'always' });
    expect(runeCombatModsFor(['rune_adventuring']).rallyExtraAlways).toBe(1);
    expect(runeCombatModsFor([]).rallyExtraAlways).toBeUndefined();
  });

  it('an authored seat fields its runes from their round on, stacking', () => {
    const seat = {
      id: 's1', label: 'Foe', heroId: 'aster', kind: 'authored' as const, seed: 2, resolve: 30, armor: 0, alive: true,
      authoredBoards: Array.from({ length: 10 }, () => [{ attack: 1, health: 1 }]),
      authoredRunes: [{ fromRound: 6, runeId: 'rune_adventuring' }, { fromRound: 9, runeId: 'rune_adventuring' }],
    };
    const d = authoredSeat(seat);
    expect(d.prepare(5)?.snapshot).toBeUndefined();
    expect(d.prepare(6)?.snapshot?.runes).toEqual(['rune_adventuring']);
    expect(d.prepare(6)?.snapshot?.questMods?.rallyExtraAlways).toBe(1);
    expect(d.prepare(9)?.snapshot?.runes).toEqual(['rune_adventuring', 'rune_adventuring']);
    expect(d.prepare(9)?.snapshot?.questMods?.rallyExtraAlways).toBe(2);
  });
});
```
(If `rune_adventuring` stacks differently on a duplicate — check `RUNE_DUP_UNIQUE`/`RUNE_DUP_SWEETENER` in the reducer —
change the round-9 rune in this test to a different `rallyRepeat`/`always` or another combat rune and adjust the
expectation; the point is that two runes both apply.)

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run packages/sim/src/lobby/gauntlet.test.ts -t "opponent runes"`
Expected: FAIL — `runeCombatModsFor` not exported.

- [ ] **Step 3: Implement**

`reducer.ts`, directly after `questCombatMods`:
```ts
/**
 * The combat modifiers a set of runes gives a side that owns them — for an AUTHORED opponent (Gauntlet), which has
 * no run of its own. Applies each rune's reward to a scratch run through the same `applyQuestReward` the Runeforge
 * uses, then reads `questCombatMods`, so an opponent's rune behaves in combat exactly like a player's. A rune whose
 * reward only acts in the shop (Gold, refreshes, Discovers, End of Turn) leaves no combat modifier: an authored
 * opponent has no recruit phase, so such a rune does nothing for it. Pure and deterministic (fixed scratch seed).
 */
export function runeCombatModsFor(runeIds: readonly string[]): QuestCombatMods {
  const s = createRun(1, DEFAULT_HERO_ID, 'gauntlet');
  for (const id of runeIds) {
    const rune = RUNE_INDEX[id];
    if (!rune) continue;
    applyQuestReward(s, { id: rune.id, name: rune.name, reward: rune.reward } as unknown as QuestDef, true, 'rune');
    (s.ownedRunes ??= []).push(rune.id);
  }
  return questCombatMods(s);
}
```
(`createRun`, `DEFAULT_HERO_ID`, `RUNE_INDEX`, `QuestDef`, `QuestCombatMods` are already imported in reducer.ts — confirm
with grep; add any that aren't. `'gauntlet'` becomes a valid `RunMode` in Task 5; until then use `'practice'` and switch
in Task 5.)

`runLobby.ts` — add to `LobbySeatState`:
```ts
  /** Authored seats only (Gauntlet): the opponent's runes, each active from `fromRound` on (they stack). */
  authoredRunes?: { fromRound: number; runeId: string }[];
```

`tutorialSeats.ts` — in `authoredSeat`, attach a snapshot when runes are active. Add the imports
`import { runeCombatModsFor } from '../reducer';` and `import type { BoardSnapshot } from '../snapshot';`, then:
```ts
export function authoredSeat(seat: LobbySeatState): SeatDriver {
  const boards = seat.authoredBoards ?? [];
  const modsCache = new Map<string, BoardSnapshot['questMods']>();
  /** The rune snapshot for a round, or undefined when no rune is active yet — so a rune-less authored seat (the
   *  tutorial, practice bots) prepares exactly the board it always did. */
  const runeSnapshot = (round: number, minions: BoardMinion[], tier: number): BoardSnapshot | undefined => {
    const runes = (seat.authoredRunes ?? []).filter((r) => r.fromRound <= round).map((r) => r.runeId);
    if (runes.length === 0) return undefined;
    const key = runes.join('|');
    if (!modsCache.has(key)) modsCache.set(key, runeCombatModsFor(runes));
    return {
      v: 1, wave: round, heroId: seat.heroId, resolve: seat.resolve, armor: seat.armor, tier, triples: 0,
      tribes: [], threat: 'venom', power: minions.reduce((n, m) => n + m.attack + m.health, 0), minions, seed: seat.seed,
      questMods: modsCache.get(key), runes,
    };
  };
  const boardFor = (round: number): PreparedBoard | null => {
    if (boards.length === 0) return null;
    const idx = Math.min(Math.max(round - 1, 0), boards.length - 1);
    const minions = omenBoardMinions(boards[idx]!);
    const tier = authoredTierFor(seat, idx + 1);
    const snapshot = runeSnapshot(round, minions, tier);
    return { minions, tier, ...(snapshot ? { snapshot } : {}) };
  };
  // …rest of the driver unchanged…
}
```
Check `BoardSnapshot`'s required fields in `packages/sim/src/snapshot.ts:28` before writing the literal; fill any other
required field with its neutral value. Check `ThreatId` in `threats.ts` and use a real id for `threat`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/sim/src/lobby packages/sim/src/tutorial`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/reducer.ts packages/sim/src/lobby/tutorialSeats.ts packages/sim/src/lobby/runLobby.ts packages/sim/src/lobby/gauntlet.test.ts
git commit -m "feat(sim): authored opponents carry runes into combat (runeCombatModsFor)"
```

---

### Task 5: The `gauntlet` run mode, `createGauntletRun` and the verdict

**Files:**
- Modify: `packages/sim/src/state.ts:384` (`RunMode`) and the `RunState` interface (add `gauntletStage`)
- Modify: `packages/sim/src/reducer.ts:5138` and `:5254` (mode exclusions); switch Task 4's scratch mode to `'gauntlet'`
- Create: `packages/sim/src/lobby/gauntlet.ts`
- Modify: `packages/sim/src/lobby/index.ts`
- Test: `packages/sim/src/lobby/gauntlet.test.ts`

**Interfaces:**
- Consumes: `GauntletStage`, `gauntletStage` (Task 1); `roundLossCap` (Task 2); `AuthoredOmen` fields, `authoredTiers`,
  `invulnerable` (Task 3); `authoredRunes` (Task 4).
- Produces:
  - `GAUNTLET_LOSS_CAPS: (number | null)[]` = `[5, 5, 5, 10, 10, 10, 15, 15, null, null]`
  - `GAUNTLET_DEFAULT_TIERS: number[]` (a round's tier when the stage leaves it blank)
  - `createGauntletRun(seed: number, heroId: string, stage: GauntletStage, setId?: SetId): RunState`
  - `gauntletOutcome(run: Pick<RunState, 'mode' | 'phase' | 'lobby'>): 'cleared' | 'defeated' | null`
  - `RunMode` includes `'gauntlet'`; `RunState.gauntletStage?: number`

- [ ] **Step 1: Write the failing tests**

```ts
import { createGauntletRun, gauntletOutcome, GAUNTLET_LOSS_CAPS, GAUNTLET_DEFAULT_TIERS } from './gauntlet';
import { reduce, type Action, type RunState } from '../index';
import { cardRevision, type GauntletStage } from '@game/content';

const body = Object.values(CARD_INDEX).find((c) => !c.spell && c.tier === 1 && (c.keywords ?? []).length === 0)!;
const stageOf = (atk: number, hp: number): GauntletStage => ({
  number: 1, name: 'Test', opponentName: 'The Test Host', status: 'ready', runes: {},
  rounds: Array.from({ length: 10 }, () => ({ board: [{ cardId: body.id, attack: atk, health: hp, cardVersion: cardRevision(body) }] })),
});
const playRound = (s: RunState): RunState => {
  for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as Action[]) s = reduce(s, a);
  return s;
};
const playOut = (s: RunState): RunState => {
  for (let i = 0; i < 12 && s.phase !== 'gameover' && s.phase !== 'victory'; i++) s = playRound(s);
  return s;
};

describe('createGauntletRun', () => {
  it('is a 2-seat gauntlet lobby: the player and one invulnerable authored opponent', () => {
    const run = createGauntletRun(11, 'aster', stageOf(1, 1));
    expect(run.mode).toBe('gauntlet');
    expect(run.gauntletStage).toBe(1);
    expect(run.lobby!.rules).toMatchObject({ seatCount: 2, maxRounds: 10, lossCaps: GAUNTLET_LOSS_CAPS });
    expect(run.lobby!.seats.map((s) => s.kind)).toEqual(['player', 'authored']);
    expect(run.lobby!.seats[1]).toMatchObject({ label: 'The Test Host', invulnerable: true });
    expect(run.lobby!.seats[0]).toMatchObject({ resolve: run.resolve, armor: run.armor }); // the hero's own pools
  });

  it('blank tiers follow GAUNTLET_DEFAULT_TIERS; authored tiers win', () => {
    const s = stageOf(1, 1);
    s.rounds[2]!.tier = 6;
    const seat = createGauntletRun(11, 'aster', s).lobby!.seats[1]!;
    expect(seat.authoredTiers![0]).toBe(GAUNTLET_DEFAULT_TIERS[0]);
    expect(seat.authoredTiers![2]).toBe(6);
  });

  it('runes become authoredRunes from rounds 6 and 9', () => {
    const s = { ...stageOf(1, 1), runes: { round6: 'rune_adventuring', round9: 'rune_adventuring' } };
    expect(createGauntletRun(11, 'aster', s).lobby!.seats[1]!.authoredRunes)
      .toEqual([{ fromRound: 6, runeId: 'rune_adventuring' }, { fromRound: 9, runeId: 'rune_adventuring' }]);
  });
});

describe('gauntlet verdict', () => {
  it('surviving all 10 rounds against a board you cannot beat is still a CLEAR, and the foe never dies', () => {
    // A board the player can't beat (huge), so every round is a loss — but the caps keep total damage at
    // 3×5 + 3×10 + 2×15 = 75 before round 9. That kills a 30+Armor hero, so give the check a hero-agnostic shape:
    // assert the run ends, and that the verdict matches whether the player's seat survived.
    const run = playOut(createGauntletRun(3, 'aster', stageOf(999, 999)));
    expect(run.phase).toBe('gameover');
    const me = run.lobby!.seats[0]!;
    expect(gauntletOutcome(run)).toBe(me.alive ? 'cleared' : 'defeated');
    expect(run.lobby!.seats[1]!.alive).toBe(true);
  });

  it('a stage the player always beats is cleared after exactly 10 rounds, not earlier', () => {
    const run = playOut(createGauntletRun(3, 'aster', stageOf(1, 1)));
    expect(run.lobby!.round).toBe(11);
    expect(run.phase).toBe('gameover');
    expect(gauntletOutcome(run)).toBe('cleared');
  });

  it('losing on round 10 with Resolve left is a clear', () => {
    // Rounds 1–9 are a 1/1 (the player wins); round 10 is unbeatable.
    const s = stageOf(1, 1);
    s.rounds[9] = { board: [{ cardId: body.id, attack: 999, health: 999, cardVersion: cardRevision(body) }] };
    const run = playOut(createGauntletRun(3, 'aster', s));
    expect(run.history.at(-1)).toBe('lose');
    expect(run.resolve + run.armor).toBeGreaterThan(0);
    expect(gauntletOutcome(run)).toBe('cleared');
  });

  it('is null while the run is in progress and for non-gauntlet runs', () => {
    const run = createGauntletRun(3, 'aster', stageOf(1, 1));
    expect(gauntletOutcome(run)).toBeNull();
    expect(gauntletOutcome({ ...run, mode: 'lobby', phase: 'gameover' })).toBeNull();
  });

  it('applies the gauntlet caps to the player: a round-1 loss costs at most 5', () => {
    let run = createGauntletRun(3, 'aster', stageOf(999, 999));
    const before = run.resolve + run.armor;
    run = playRound(run);
    expect(before - (run.resolve + run.armor)).toBeLessThanOrEqual(5);
    expect(run.lastCombat!.damageCap).toBe(5);
  });
});
```
Note on the first verdict test: a turn-1 player board may be empty (the test does not buy anything), so "the player
always beats a 1/1" depends on the hero. If `playOut` against `stageOf(1, 1)` does not produce wins with an empty
board, make the test buy the first shop minion each round before `faceOmen` (dispatch the reducer's buy action — find
its exact shape with `grep -n "case 'buy" packages/sim/src/reducer.ts`) and play it. Keep the assertions unchanged.

- [ ] **Step 2: Run to confirm failure**

Run: `npx vitest run packages/sim/src/lobby/gauntlet.test.ts`
Expected: FAIL — `./gauntlet` not found.

- [ ] **Step 3: Implement the mode**

`state.ts:384`:
```ts
export type RunMode = 'ascent' | 'rift' | 'practice' | 'lobby' | 'tutorial' | 'gauntlet';
```
Extend the doc comment above it:
```ts
 *  `gauntlet` is a single-player STAGE: a 2-seat lobby against one authored, never-eliminated opponent for 10
 *  rounds with its own loss caps (`GAUNTLET_LOSS_CAPS`). Its own mode for the same reason as `tutorial` — it must
 *  never rate, upload boards or feed practice telemetry. Surviving round 10 clears the stage (`gauntletOutcome`).
```
Add to `RunState` (next to `tutorialCourseId`):
```ts
  /** GAUNTLET only: the stage number this run is playing (1–10). */
  gauntletStage?: number;
```

`reducer.ts:5138` and `:5254` — add `&& s.mode !== 'gauntlet'` to both mode-exclusion conditions (the non-lobby
damage path and the 17-round course clock), so a Gauntlet run is governed by its lobby exactly like `tutorial`.
Then change `runeCombatModsFor`'s scratch run to `createRun(1, DEFAULT_HERO_ID, 'gauntlet')`.

Run `npx tsc --noEmit -p packages/sim` (or `npm run typecheck:pkgs`) and fix any exhaustive `switch`/`Record<RunMode,…>`
that now misses `'gauntlet'` (e.g. `TelemetrySource` in `runTelemetry.ts` — add `'gauntlet'` where a mode maps to a
source; a Gauntlet run is not uploaded, so map it to the closest non-ladder source only if the type forces you to).

- [ ] **Step 4: Implement `gauntlet.ts`**

`packages/sim/src/lobby/gauntlet.ts`:
```ts
/**
 * GAUNTLET — the single-player stage mode (spec: docs/superpowers/specs/2026-09-29-gauntlet-design.md).
 *
 * A stage is 10 rounds against ONE authored opponent whose board grows round by round. It runs as a 2-seat lobby
 * (the player + one `authored` seat), so damage, Armor, the turn flow and save/restore are the lobby's own. Three
 * things make it a Gauntlet rather than a tiny lobby:
 *  - the opponent is `invulnerable`: the goal is to SURVIVE, so knocking it out must never end the stage early;
 *  - `lossCaps` replaces the normal cap table with the Gauntlet's (5/10/15, uncapped on rounds 9–10);
 *  - `maxRounds: 10`, so the lobby finishes after round 10 and a player still standing is placed 1st — a CLEAR,
 *    even if round 10 itself was lost or tied.
 */
import type { GauntletStage } from '@game/content';
import type { SetId } from '@game/content';
import { createRun, type RunState } from '../state';
import { DEFAULT_LOBBY_RULES } from './lobby';
import type { LobbyRules } from './types';
import { resetLobbyDrivers, type LobbySeatState, type RunLobby } from './runLobby';

/** Loss caps by round (owner 2026-09-29): 1–3 → 5, 4–6 → 10, 7–8 → 15, 9–10 → uncapped. */
export const GAUNTLET_LOSS_CAPS: (number | null)[] = [5, 5, 5, 10, 10, 10, 15, 15, null, null];

/** The opponent's tavern tier on a round the stage leaves blank — a steady tier-up pace (spec §2: "absent =
 *  normal tier-up pace"). Only a DEFAULT: the Stage Builder shows it, and any round can override it. */
export const GAUNTLET_DEFAULT_TIERS: number[] = [1, 2, 2, 3, 3, 4, 4, 5, 5, 6];

export function createGauntletRun(seed: number, heroId: string, stage: GauntletStage, setId?: SetId): RunState {
  const run = createRun(seed, heroId, 'gauntlet', undefined, setId);
  const rules: LobbyRules = { ...DEFAULT_LOBBY_RULES, seatCount: 2, maxRounds: stage.rounds.length, lossCaps: GAUNTLET_LOSS_CAPS };
  const player: LobbySeatState = {
    id: 's0', label: 'You', heroId, kind: 'player', seed, resolve: run.resolve, armor: run.armor, alive: true,
  };
  const foe: LobbySeatState = {
    id: 's1',
    label: stage.opponentName,
    // Portrait only — an authored seat never plays a run (same convention as the tutorial's seats).
    heroId: 'aster',
    kind: 'authored',
    seed: seed * 1000 + 1,
    resolve: rules.startingResolve,
    armor: rules.startingArmor,
    alive: true,
    invulnerable: true,
    authoredBoards: stage.rounds.map((r) => r.board.map((m) => ({
      cardId: m.cardId, attack: m.attack, health: m.health,
      ...(m.golden ? { golden: true } : {}),
      ...(m.addedKeywords?.length ? { addedKeywords: m.addedKeywords } : {}),
    }))),
    authoredTiers: stage.rounds.map((r, i) => r.tier ?? GAUNTLET_DEFAULT_TIERS[i] ?? 6),
    authoredRunes: [
      ...(stage.runes.round6 ? [{ fromRound: 6, runeId: stage.runes.round6 }] : []),
      ...(stage.runes.round9 ? [{ fromRound: 9, runeId: stage.runes.round9 }] : []),
    ],
  };
  resetLobbyDrivers([foe]);
  const lobby: RunLobby = { version: 1, seed, setId: run.setId, round: 1, seats: [player, foe], encounters: [], finished: false, rules };
  return { ...run, lobby, gauntletStage: stage.number };
}

/** The stage verdict once the run is over: `cleared` when the player's seat is still standing (the lobby ran its
 *  10 rounds), `defeated` when it was knocked out. Null mid-run and for any other mode. */
export function gauntletOutcome(run: Pick<RunState, 'mode' | 'phase' | 'lobby'>): 'cleared' | 'defeated' | null {
  if (run.mode !== 'gauntlet' || run.phase !== 'gameover' || !run.lobby) return null;
  return run.lobby.seats[0]!.alive ? 'cleared' : 'defeated';
}
```
If `createRun`'s 4th parameter (`line`) must be passed positionally, pass `CONFIG.defaultLine` rather than `undefined`
(match `createLobbyRun`'s call: `createRun(seed, heroId, mode, undefined, pinnedSet, …)` — it already passes `undefined`,
so `undefined` is correct).

`packages/sim/src/lobby/index.ts` — add:
```ts
export * from './gauntlet';
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run packages/sim/src/lobby/gauntlet.test.ts`
Expected: PASS. If the "always beats a 1/1" test fails because the player fields an empty board, apply the buy-a-minion
adjustment described in Step 1 — never loosen the assertions.

- [ ] **Step 6: Run the whole sim + content suites**

Run: `npx vitest run packages/sim packages/content`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sim/src/state.ts packages/sim/src/reducer.ts packages/sim/src/lobby/gauntlet.ts packages/sim/src/lobby/index.ts packages/sim/src/lobby/gauntlet.test.ts packages/sim/src/runTelemetry.ts
git commit -m "feat(sim): gauntlet run mode — createGauntletRun + gauntletOutcome"
```

---

### Task 6: Oracle rules + GAME-RULES

**Files:**
- Modify: `packages/rules/src/registry/approved/foundation.ts` (append at the END of the array)
- Modify: `docs/GAME-RULES.md` (new "Gauntlet" section)

- [ ] **Step 1: Confirm the ids are free**

Run: `grep -rn "R-GAUNTLET" packages/rules`
Expected: no output.

- [ ] **Step 2: Append the three rules**

```ts
  // ── Gauntlet (single-player stages, owner design 2026-09-29) ─────────────────────────────────────────
  {
    id: 'R-GAUNTLET-01',
    title: 'Gauntlet: the most a lost round can cost is 5 on rounds 1–3, 10 on 4–6, 15 on 7–8, and uncapped on 9–10',
    statement:
      'In a Gauntlet stage, a lost round costs the normal loss damage (the opponent\x27s tier plus the tier of each of its '
      + 'surviving minions), capped by round: at most 5 on rounds 1–3, 10 on rounds 4–6, 15 on rounds 7–8, and no cap on '
      + 'rounds 9 and 10. A tie costs nothing. Every other mode keeps its own caps.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Gauntlet design)', quote: 'on rounds 9 and 10, the damage cap is removed. on rounds 1-3, the damage cap is 5, on rounds 4-6, the damage cap is 10' },
      { kind: 'owner-chat', ref: 'Same session — asked whether "6–8 = 15" meant 7–8', quote: 'yes' },
      { kind: 'code', ref: 'packages/sim/src/lobby/gauntlet.ts GAUNTLET_LOSS_CAPS; packages/sim/src/reducer.ts roundLossCap' },
    ],
    currentBehaviour: 'Conforms as of the Gauntlet engine PR (2026-09-29).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/lobby/gauntlet.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-GAUNTLET-02',
    title: 'Gauntlet: a stage is cleared by still standing after round 10 — even if round 10 was lost or tied — and the opponent can never be knocked out',
    statement:
      'A Gauntlet stage lasts 10 rounds against one opponent. The player loses the stage the moment their Resolve (after '
      + 'Armor) reaches 0 on any round. If they are still standing when round 10\x27s combat is over, they clear the stage, '
      + 'whatever the result of that last round. The opponent takes no damage and is never eliminated, so beating it '
      + 'never ends a stage early.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Gauntlet design)', quote: 'even if the player ties or loses on round 10, but their health is not fully depleted, they still win' },
      { kind: 'code', ref: 'packages/sim/src/lobby/gauntlet.ts createGauntletRun (invulnerable seat, maxRounds 10) + gauntletOutcome; runLobby.ts settleRunLobbyRound' },
    ],
    currentBehaviour: 'Conforms as of the Gauntlet engine PR (2026-09-29).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/lobby/gauntlet.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-GAUNTLET-03',
    title: 'Gauntlet: an opponent\x27s runes are active from round 6 and round 9 and stack; only their combat effects can act',
    statement:
      'A Gauntlet opponent may have one rune that is active from round 6 onward and one that is active from round 9 '
      + 'onward; from round 9 both are active. They act in combat exactly as the same rune would for a player. A rune that '
      + 'only works during a Shop turn does nothing for an opponent, which never has one.',
    domain: 'foundation',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-29 (Gauntlet design)', quote: 'i should be able to specify what runes are active on turns 6 and 9 for each opponent' },
      { kind: 'code', ref: 'packages/sim/src/reducer.ts runeCombatModsFor; packages/sim/src/lobby/tutorialSeats.ts authoredSeat (rune snapshot)' },
    ],
    currentBehaviour: 'Conforms as of the Gauntlet engine PR (2026-09-29). The stacking assertion uses two copies of one rune.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/lobby/gauntlet.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
```
Match the surrounding file's exact field set — if its rules carry an `example` and the integrity test requires one,
add a one-line `example` to each.

- [ ] **Step 3: Add the GAME-RULES section**

Append a `## Gauntlet` section to `docs/GAME-RULES.md` (place it after the Practice/Tutorial section; read the file's
heading structure first and match its voice):
```md
## Gauntlet

Single-player stages, each a 10-round duel against one hand-built opponent whose board grows every round.

- **Win a stage** by still standing after round 10's combat, even if you lose or tie that round.
- **Lose** the moment your Resolve (after Armor) hits 0. The opponent never takes damage and can't be knocked out.
- **Loss cap:** at most 5 per lost round on rounds 1–3, 10 on 4–6, 15 on 7–8, no cap on 9–10. Ties cost nothing.
- **The shop is the normal game's** (economy, tiers, tribes, a random shop every attempt), with any hero at their
  normal Resolve and Armor. You can't see the opponent's next board before combat.
- **Opponent runes:** one from round 6, a second from round 9 (both active from then on). Only their combat effects act.
- **Stages:** 1 Demons · 2 Kobolds · 3 Dragons · 4 Dwarves · 5 Beasts; 6–10 are unique stages still to come.
  Clearing a stage unlocks the next; the first clear of each grants a crate.
```

- [ ] **Step 4: Run the rules checks**

Run: `npx vitest run packages/rules && npm run docbot:report -- --check`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/registry/approved/foundation.ts docs/GAME-RULES.md
git commit -m "docs(rules): R-GAUNTLET-01..03 + Gauntlet section in GAME-RULES"
```

---

### Task 7: Full gate, devlog, PR

- [ ] **Step 1: Devlog entry**

Create `docs/devlog/2026-09-29-gauntlet-engine.md` (follow `docs/devlog/README.md`'s format): what shipped (the mode, the
stage format, per-lobby caps, invulnerable authored seat, opponent runes), the one judgement call (`GAUNTLET_DEFAULT_TIERS`
= 1,2,2,3,3,4,4,5,5,6 for blank rounds), and that PRs 2–4 follow. No `patchNotes.ts` entry yet — nothing is player-visible
until PR 3.

- [ ] **Step 2: Full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. Report the actual output tail of each; never trust a piped `| tail` for pass/fail.

- [ ] **Step 3: Review the diff**

Run: `git diff --stat origin/main...HEAD`
Expected: only the files in this plan's file table (+ the devlog).

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/gauntlet-engine
gh pr create --title "feat(sim): Gauntlet engine — stage format, gauntlet mode, caps, opponent runes" --body "<summary + test plan>"
```
Then `gh pr checks <n> --watch` until `verify` is green, and squash-merge.

---

## Hand-off to plans 2–4 (what this PR provides)

- **Stage data:** `GauntletStage` / `GauntletRound` / `GauntletMinion`, `validateStage`, `stageDrift`, `GAUNTLET_STAGES`,
  `gauntletStage(n)`; files at `packages/content/src/gauntlet/stages/NN-<name>.json` — the Stage Builder's Save target.
- **Run:** `createGauntletRun(seed, heroId, stage, setId?)`, `gauntletOutcome(run)`, `RunState.gauntletStage`,
  `mode === 'gauntlet'`.
- **Caps:** `runLossCap(run)` / `roundLossCap(rules, round)` — PR 3 switches every UI `lossDamageCap(...)` call
  (`HudBar.tsx:36`, `LobbyPanel.tsx:138`, `FightRecap.tsx:96`, `heroBlast/heroStrikeDamage.ts:12`, `announcer.ts:1498,1599`)
  and the UI's `computeCombatOdds`/`createOddsProbe` calls to the run-aware cap.
- **Tiers:** `GAUNTLET_DEFAULT_TIERS` (the Stage Builder's "blank = …" hint).
- **Rune effect preview:** `runeCombatModsFor([id])` — an empty result is the Stage Builder's "no effect for opponents" badge.
- **Known UI follow-ups for PR 3:** the Recruit turn clock (`Recruit.tsx:1120-1122`) gains the Gauntlet rule — no clock
  until `run.goldSpentThisTurn >= 30`, then 60 s, timing out like the normal game; every `mode === 'lobby'` gate in
  `store.ts` (rating, board upload, telemetry) must stay closed for `'gauntlet'` (they are, since the mode differs —
  verify, don't assume); the Play-menu node, stage select, HUD opponent portrait, loss/win screens; removing "vs bots"
  from `PracticeOptions.tsx`.
