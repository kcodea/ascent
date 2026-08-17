# Keshi the Protector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new playable hero, Keshi the Protector, whose passive power banks the tavern tier of every card purchased and grants a Triple Reward each time the bank reaches 25.

**Architecture:** Heroes in ASCENT are pure data — an entry in the `HEROES` array in `packages/sim/src/heroes.ts` with a `power.kind` that the reducer branches on. This hero needs one new `HeroPowerKind` (`crownTally`), one new `RunState` counter (`keshiTierPoints`), and one reducer helper (`keshiCrownBuy`) called from every paid-purchase path. The payout reuses the existing `grantGoldenDiscover()` function verbatim — that *is* the Triple Reward already. Presentation is a policy-registry entry (CI-gated) plus two cases in the hero panel.

**Tech Stack:** TypeScript monorepo, Vitest, React + Zustand UI. Packages: `@game/core` (presentation policies), `@game/sim` (heroes, state, reducer), `@game/ui` (hero panel, art).

**Spec:** `docs/superpowers/specs/2026-08-16-keshi-hero-design.md`

## Global Constraints

- **Work in the worktree** `C:\Users\micha\Desktop\ascent\.claude\worktrees\hero-keshi`, branch `feat/hero-keshi`. It has its own `node_modules` (already installed). Never edit the primary checkout at `C:\Users\micha\Desktop\ascent` — concurrent sessions are actively churning it.
- **Always prefix shell commands with the absolute worktree path** (`cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && …`) and confirm with `git branch --show-current`. The shell's cwd has been observed silently reverting to the primary checkout mid-session, which makes gates run against the wrong branch and look green.
- **Never push to `main`.** One PR from `feat/hero-keshi`, squash-merged after the required `verify` check goes green.
- **`Math.random` is banned** in `core`/`content`/`sim` (ESLint-enforced). Nothing in this plan needs randomness.
- **Exact strings, copied verbatim from the spec:**
  - Hero id: `keshi`
  - Hero name: `Keshi the Protector`
  - Blurb: `Tend the tavern and it tends you — every card bought coaxes the crown into bloom.`
  - Power name: `Keshi's Crown`
  - Power kind: `crownTally`
  - Power text: `Get a **Triple Reward** every 25 shop tiers worth of cards you purchase.`
  - Resolve: `30`   Armor: `10`   `passive: true`   no henchman   no `wip` flag
  - Threshold: `25`
- **Every commit updates the docs**: `docs/devlog.md`, `docs/roadmap.md`, and the README summary. Task 5 does this once for the whole feature.
- **Note on em-dashes/apostrophes:** the codebase uses real Unicode `—` and `'` in comments and card text. `Keshi's Crown` uses a typographic apostrophe (U+2019) in display strings, matching neighbouring hero copy.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/sim/src/heroes.ts` | Hero registry (data) | Add `crownTally` to the `HeroPowerKind` union; add the `keshi` `HeroDef` |
| `packages/core/src/presentation/policies.ts` | Beat-system classification | Add `hero:keshi:crownTally` entry (CI tripwire) |
| `packages/sim/src/state.ts` | `RunState` shape + `createRun` | Add `keshiTierPoints: number`, init `0` |
| `packages/sim/src/reducer.ts` | Run-loop rules | Add `keshiCrownBuy` helper; call from 5 purchase paths |
| `packages/sim/src/keshiCrown.test.ts` | **New.** Feature tests | The whole behavioural suite |
| `packages/ui/src/StatusBar.tsx` | Hero panel | `powerTally` case + passive `powerLine` case |
| `packages/ui/src/art/heroes/keshi.webp` | **New.** Portrait | Via `npm run optimize-art` |
| `packages/ui/src/art/powers/keshi.webp` | **New.** Power button | Via `npm run optimize-art` |
| `docs/devlog.md`, `docs/roadmap.md`, `README.md` | Required per-commit docs | Task 5 |

A dedicated test file (`keshiCrown.test.ts`) is used rather than appending to `run.test.ts`, matching the existing per-feature convention (`nadjaGoldspring.test.ts`, `djinnCadence.test.ts`, `henchmen.test.ts`) and avoiding a conflict in a hot shared file.

---

### Task 1: Hero registry entry + presentation policy

Adds the hero as inert data. After this task Keshi is selectable and her panel renders, but the power does nothing. The `heroPolicies.test.ts` tripwire is the natural test: it fails the moment a hero exists without a policy entry.

**Files:**
- Modify: `packages/sim/src/heroes.ts` (the `HeroPowerKind` union ~line 53; the end of the `HEROES` array, after the `albus` entry)
- Modify: `packages/core/src/presentation/policies.ts` (end of the `PRESENTATION_POLICIES` object, after `'hero:albus:empowerment'`)
- Test: `packages/sim/src/heroPolicies.test.ts` (existing — not modified, used as the gate)

**Interfaces:**
- Consumes: nothing.
- Produces: the string literal `'crownTally'` as a member of `HeroPowerKind`; a hero resolvable as `getHero('keshi')` with `power.kind === 'crownTally'`. Task 2 branches on that kind; Task 3 reads `power.name` (`Keshi's Crown`).

- [ ] **Step 1: Add the hero entry, and watch the policy tripwire fail**

In `packages/sim/src/heroes.ts`, extend the `HeroPowerKind` union. The current last member is `empowerment` and it carries the terminating semicolon — move the semicolon to the new last member:

```ts
  | 'empowerment' // Albus: 1 Gold — a Shop minion becomes a Discover from the tier above it
  | 'crownTally'; // Keshi (passive): bank each purchased card's tier; at 25 grant a Triple Reward, then reset
```

Then append the hero to the end of the `HEROES` array, immediately after the `albus` entry's closing `},` and before the array's closing `];`:

```ts
  {
    id: 'keshi',
    name: 'Keshi the Protector',
    blurb: 'Tend the tavern and it tends you — every card bought coaxes the crown into bloom.',
    resolve: 30,
    armor: 10, // owner spec 2026-08-16 — a repeatable run-long Triple Reward engine, so the armor sits with
    //            the strong-passive band (Flint/Pete/Merrin 10) rather than the quest heroes' 13
    power: {
      name: 'Keshi\u2019s Crown',
      kind: 'crownTally',
      passive: true,
      text: 'Get a **Triple Reward** every 25 shop tiers worth of cards you purchase.',
    },
  },
```

- [ ] **Step 2: Run the tripwire to verify it fails**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npx vitest run packages/sim/src/heroPolicies.test.ts
```

Expected: FAIL on `every hero has a registry entry`, with the message `classify these in packages/core/src/presentation/policies.ts` and `hero:keshi:crownTally (Keshi the Protector)` in the array.

This proves the hero is live in the registry *and* proves the gate works.

- [ ] **Step 3: Add the presentation policy**

In `packages/core/src/presentation/policies.ts`, immediately after the `'hero:albus:empowerment'` line and before the object's closing `};`:

```ts
  'hero:keshi:crownTally': { policy: 'passive', family: 'passive' },
```

No `flagged: true` — that marker means "heuristically classified, needs owner review". This one is a deliberate classification: the power is a silent passive with no beat of its own (the Triple Reward it grants is presented by the existing Discover flow), exactly like `hero:pete:contraband` and `hero:flint:companyRate`.

- [ ] **Step 4: Run the tripwire to verify it passes**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npx vitest run packages/sim/src/heroPolicies.test.ts
```

Expected: PASS, 3 tests. (The third test, `no ghost hero entries`, also confirms the key you added exactly matches the key the surface generates.)

- [ ] **Step 5: Typecheck**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npm run typecheck
```

Expected: clean. A non-exhaustive `switch` over `HeroPowerKind` anywhere would surface here — there is none today, but this is the check that would catch it.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && git add packages/sim/src/heroes.ts packages/core/src/presentation/policies.ts && git commit -m "feat(hero): register Keshi the Protector (inert)

Adds the crownTally power kind, the keshi HeroDef (30 Resolve / 10 armor,
passive), and its presentation-policy entry. The power does nothing yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The Crown — counter, payout, and every purchase path

The behavioural core. Written test-first against a dedicated new test file.

**Files:**
- Modify: `packages/sim/src/state.ts` (field declaration after `cassenKills` ~line 660; `createRun` init after `cassenKills: 0,` ~line 1544)
- Modify: `packages/sim/src/reducer.ts` (new helper after `chronosQuestBuy`, which ends ~line 160; call sites in `case 'buy'` ~lines 947–1110 and `case 'buyHenchman'` ~line 1886)
- Create: `packages/sim/src/keshiCrown.test.ts`

**Interfaces:**
- Consumes: `getHero(id).power.kind === 'crownTally'` from Task 1.
- Produces:
  - `RunState.keshiTierPoints: number` — required, non-optional, initialised to `0`. Task 3's UI reads it directly as `run.keshiTierPoints`.
  - `function keshiCrownBuy(s: RunState, card: CardDef): void` — module-private to `reducer.ts`, not exported.

**Reference — facts already verified in the codebase, do not re-derive:**
- `grantGoldenDiscover(s: RunState): void` already exists in `reducer.ts` (~line 2584). It pushes a `discoverspell` card into `s.hand` with `grantedTier: s.tier`, returns early if `s.hand.length >= handCap(s)`, and handles the Rune of the Corrupted Tome double-grant. **Do not modify it.**
- `handCap(s)` is imported into `reducer.ts` already, from `./state`. It returns `CONFIG.handMax` (10) normally, `CONFIG.handMaxRuneTurn` (20) while the Runeforge is open.
- Every `CardDef` has `tier: 1|2|3|4|5|6|7`, spells included.
- The minion-buy path refuses the purchase outright when `s.hand.length >= handCap(s)` (reducer ~line 1023), so a buy can leave the hand *exactly* at cap but never over.
- Real card ids for tests: `sandbag` (Target Dummy, tier 1 minion, no Battlecry/End-of-Turn), `taurus` (Taurus, tier 6 minion), `shatter` (tier 3 spell, cost 1), `perfectvision` (Perfect Vision, tier 6 spell, cost 2).

- [ ] **Step 1: Write the failing tests**

Create `packages/sim/src/keshiCrown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRun, reduce, type BoardCard, type RunState } from './index';

/**
 * Keshi's Crown — "Get a Triple Reward every 25 shop tiers worth of cards you purchase."
 *
 * Every PAID card purchase banks that card's tavern tier in `keshiTierPoints`; at 25 the run gets a Triple
 * Reward (the same `discoverspell` a golden minion grants when played) and the counter resets to 0 — overflow
 * is discarded, not carried (owner spec 2026-08-16). The one exception is a full hand: the reward can't land,
 * so the bank is HELD at 25+ rather than spent into nothing.
 *
 * Card ids used: sandbag = Target Dummy (t1 minion, no triggers), taurus = Taurus (t6 minion),
 * shatter = t3 spell, perfectvision = t6 spell.
 */

/** A Keshi run parked in recruit with money, empty zones, and nothing else in flight. */
const keshiRun = (over: Partial<RunState> = {}): RunState => ({
  ...createRun(1, 'keshi'),
  embers: 99,
  board: [],
  hand: [],
  shop: [],
  spell: null,
  ...over,
});

/** Buy a card that we place into the minion row ourselves — the ordinary Shop purchase path. */
const buyFromRow = (s: RunState, cardId: string): RunState => {
  const withOffer: RunState = { ...s, shop: [...s.shop, { uid: `o_${cardId}_${s.uidSeq}`, cardId }] };
  const uid = withOffer.shop[withOffer.shop.length - 1]!.uid;
  return reduce(withOffer, { type: 'buy', uid });
};

/** A minimal filler card for stuffing the hand up to the cap. */
const filler = (n: number): BoardCard => ({
  uid: `f${n}`, cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false,
});

const rewards = (s: RunState): number => s.hand.filter((c) => c.cardId === 'discoverspell').length;

describe("Keshi's Crown", () => {
  it('starts at 0 and banks the tier of a minion bought from the Shop', () => {
    let s = keshiRun();
    expect(s.keshiTierPoints).toBe(0);
    s = buyFromRow(s, 'taurus'); // tier 6
    expect(s.keshiTierPoints).toBe(6);
    s = buyFromRow(s, 'sandbag'); // tier 1
    expect(s.keshiTierPoints).toBe(7);
    expect(rewards(s)).toBe(0); // nowhere near 25
  });

  it('banks a spell bought from the right-hand spell slot', () => {
    let s = keshiRun({ spell: { uid: 'sp', cardId: 'perfectvision' } }); // tier 6 spell
    s = reduce(s, { type: 'buy', uid: 'sp' });
    expect(s.hand.some((c) => c.cardId === 'perfectvision')).toBe(true); // the buy really happened
    expect(s.keshiTierPoints).toBe(6);
  });

  it('banks a spell bought out of the minion row (Spell Cart)', () => {
    let s = keshiRun();
    s = buyFromRow(s, 'shatter'); // tier 3 spell offered in the minion row
    expect(s.hand.some((c) => c.cardId === 'shatter')).toBe(true);
    expect(s.keshiTierPoints).toBe(3);
  });

  it('banks a held (displaced) minion bought back out of the tavern', () => {
    const held: BoardCard = {
      uid: 'held1', cardId: 'taurus', tribe: 'neutral', attack: 9, health: 9, keywords: [], golden: false,
    };
    let s = keshiRun({ shop: [{ uid: 'h', cardId: 'taurus', held }] });
    s = reduce(s, { type: 'buy', uid: 'h' });
    expect(s.hand.some((c) => c.cardId === 'taurus')).toBe(true);
    expect(s.keshiTierPoints).toBe(6); // tier 6, same as a fresh Taurus
  });

  it('grants exactly one Triple Reward at 25, frozen to the current tavern tier', () => {
    let s = keshiRun({ keshiTierPoints: 24, tier: 3 });
    s = buyFromRow(s, 'sandbag'); // +1 → exactly 25
    expect(rewards(s)).toBe(1);
    const reward = s.hand.find((c) => c.cardId === 'discoverspell')!;
    expect(reward.grantedTier).toBe(3); // peeks one tier above the tavern it was earned on
    expect(s.keshiTierPoints).toBe(0);
  });

  it('discards the overflow — 24 + a tier 6 buy resets to 0, not 5', () => {
    let s = keshiRun({ keshiTierPoints: 24 });
    s = buyFromRow(s, 'taurus'); // +6 → 30
    expect(rewards(s)).toBe(1);
    expect(s.keshiTierPoints).toBe(0);
  });

  it('is repeatable — a second 25 pays out again', () => {
    let s = keshiRun({ keshiTierPoints: 24 });
    s = buyFromRow(s, 'sandbag');
    expect(rewards(s)).toBe(1);
    s = { ...s, keshiTierPoints: 24 };
    s = buyFromRow(s, 'sandbag');
    expect(rewards(s)).toBe(2);
    expect(s.keshiTierPoints).toBe(0);
  });

  it('holds the bank when the hand is full instead of eating the reward', () => {
    // handCap is 10. Nine fillers + the bought minion = exactly full, so the reward cannot land.
    let s = keshiRun({ keshiTierPoints: 24, hand: Array.from({ length: 9 }, (_, i) => filler(i)) });
    s = buyFromRow(s, 'sandbag');
    expect(s.hand.length).toBe(10); // the buy itself succeeded
    expect(rewards(s)).toBe(0); // …but the Triple Reward had nowhere to go
    expect(s.keshiTierPoints).toBe(25); // held, NOT reset

    // Free a slot and buy again — the held bank pays out now.
    s = { ...s, hand: s.hand.slice(0, 5) };
    s = buyFromRow(s, 'sandbag');
    expect(rewards(s)).toBe(1);
    expect(s.keshiTierPoints).toBe(0);
  });

  it('does nothing for a hero who is not Keshi', () => {
    let s: RunState = { ...createRun(1, 'indy'), embers: 99, board: [], hand: [], shop: [], spell: null };
    s = buyFromRow(s, 'taurus');
    expect(s.keshiTierPoints).toBe(0);
    expect(s.hand.filter((c) => c.cardId === 'discoverspell').length).toBe(0);
  });

  it('banks only PURCHASES — spending Gold on a roll, or selling, never advances it', () => {
    const sold: BoardCard = {
      uid: 'own1', cardId: 'taurus', tribe: 'neutral', attack: 9, health: 9, keywords: [], golden: false,
    };
    let s = keshiRun({ keshiTierPoints: 10, board: [sold] });
    s = reduce(s, { type: 'roll' }); // Gold spent, but no card acquired
    expect(s.keshiTierPoints).toBe(10);
    s = reduce(s, { type: 'sell', uid: 'own1' }); // a tier 6 minion leaves the board
    expect(s.keshiTierPoints).toBe(10);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npx vitest run packages/sim/src/keshiCrown.test.ts
```

Expected: FAIL. TypeScript will report `Property 'keshiTierPoints' does not exist on type 'RunState'` — the field doesn't exist yet. That is the correct first failure.

- [ ] **Step 3: Add the state field**

In `packages/sim/src/state.ts`, add the declaration immediately after the `cassenKills: number;` line (~660):

```ts
  /** Keshi hero: shop tiers banked toward the next Triple Reward. Every PAID card purchase adds that card's
   *  tier; at 25 Keshi's Crown grants a Triple Reward and this resets to 0 (overflow is discarded, unlike
   *  Cassen's counter which subtracts). Can sit ABOVE 25 while the hand is full — the payout is held, not
   *  spent into nothing. */
  keshiTierPoints: number;
```

And the initialiser in `createRun`, immediately after `cassenKills: 0,` (~line 1544):

```ts
    keshiTierPoints: 0,
```

`RunState` is a plain serialisable object, so saves, restores and replay determinism need no further work.

- [ ] **Step 4: Re-run the tests — they should now fail on behaviour, not types**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npx vitest run packages/sim/src/keshiCrown.test.ts
```

Expected: the file compiles and runs; the first test fails with `expected 0 to be 6` (the counter never moves). Tests that only assert `0`/no-reward may pass already — that is fine and expected.

- [ ] **Step 5: Write the helper**

In `packages/sim/src/reducer.ts`, add immediately after the `chronosQuestBuy` function (it ends ~line 160, just before `minionCostOf`):

```ts
/** Keshi's Crown: every PAID card purchase banks that card's tavern tier; at 25 the run gets a Triple Reward
 *  (the same `discoverspell` a golden minion grants) and the bank resets to 0 — the overflow is DISCARDED, not
 *  carried (owner spec 2026-08-16; Cassen's counter subtracts instead, so both patterns exist in here).
 *
 *  Spells count too — "25 shop tiers worth of CARDS" — so this is called from all four `buy` branches plus
 *  `buyHenchman`, the same split-path hazard that once left `applySpellBought` firing from only one of them.
 *
 *  Full hand: `grantGoldenDiscover` silently drops the card when there's no room. Every other hand-capped
 *  grant accepts that, but this is Keshi's ENTIRE power, so the bank is HELD at 25+ and pays out on the next
 *  purchase that finds room. `keshiTierPoints` can therefore legitimately read above 25. */
function keshiCrownBuy(s: RunState, card: CardDef): void {
  if (getHero(s.heroId).power.kind !== 'crownTally') return;
  s.keshiTierPoints += card.tier;
  // A `while` (not an `if`) purely for safety: max tier 7 against a threshold of 25 means one purchase can
  // never pay twice today, but this can't silently break if either number is retuned later.
  while (s.keshiTierPoints >= 25) {
    if (s.hand.length >= handCap(s)) break; // hold the bank — see above
    grantGoldenDiscover(s);
    s.keshiTierPoints = 0;
  }
}
```

- [ ] **Step 6: Wire the four `buy` branches**

All four edits are in `case 'buy':` in `packages/sim/src/reducer.ts`. Add the call alongside the existing buy hooks in each branch.

**(a) Right-hand spell slot** — after the `applySpellBought(s, spellDef.id);` line (~968):

```ts
        keshiCrownBuy(s, spellDef); // Keshi: a bought spell banks its tier toward the Crown
```

**(b) Spell offer in the minion row** — after the `applySpellBought(s, card.id);` line (~988):

```ts
        keshiCrownBuy(s, card); // Keshi: same for a spell bought out of the minion row
```

**(c) Held / displaced minion buy** — after the `gorrQuestBuy(s, card);` line (~1009):

```ts
        keshiCrownBuy(s, card); // …and a re-bought displaced minion is still a paid purchase
```

**(d) Normal minion buy** — after the `gorrQuestBuy(s, card);` line (~1109):

```ts
      keshiCrownBuy(s, card); // Keshi: bank this minion's tier toward the Crown
```

Mind the indentation: branches (a)–(c) sit at 8 spaces, branch (d) at 6.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npx vitest run packages/sim/src/keshiCrown.test.ts
```

Expected: PASS, 9 tests.

If `banks a held (displaced) minion` fails because the buy was refused, check that the `held` `BoardCard` in the test carries every required field — the branch restores it verbatim and an incomplete object can trip the guard above it.

- [ ] **Step 8: Wire `buyHenchman`**

In `case 'buyHenchman':`, after the `grantMinionToHandOrBoard(s, def, false, true);` line (~1897):

```ts
      keshiCrownBuy(s, def); // Keshi: Gold spent on your henchman is Gold spent on a card
```

**Be aware this path is unreachable today and has no test.** Keshi carries no `henchman`, so `henchmanOffer(s)` returns `null` and the case returns before reaching this line. It is wired now so the rule stays true if Keshi is ever given one. Note also that the surrounding comment says henchman recruitment deliberately fires no on-buy watchers (`applyCardsBought` is absent by design); Keshi's Crown is a deliberate exception to that, because the owner's rule is "any Gold spent on a card" — keep the comment above so the next reader doesn't "fix" it.

- [ ] **Step 9: Run the full sim test suite**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npx vitest run packages/sim
```

Expected: all green. Pay particular attention to determinism/golden tests — `synthesize.ts` indexes opponent hero avatars with `HEROES[(wave * 7 + i) % HEROES.length]`, so adding a hero shifts which avatar synthesized boards display. The committed opponent pool (`opponentPool.data.ts`) is pre-generated and unaffected, and no test asserts a specific synthesized `heroId`, so this should be clean — but if a snapshot does move, report it rather than regenerating the pool.

- [ ] **Step 10: Commit**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && git add packages/sim/src/state.ts packages/sim/src/reducer.ts packages/sim/src/keshiCrown.test.ts && git commit -m "feat(hero): Keshi's Crown — bank purchased tiers, Triple Reward at 25

Every paid card purchase (minion, held minion, spell slot, spell in row,
henchman) banks its tavern tier in keshiTierPoints. At 25 the run gets a
Triple Reward via the existing grantGoldenDiscover and the bank resets to
0; overflow is discarded. A full hand holds the bank instead of eating
the reward.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Hero panel — live counter

Surfaces the bank on the hero frame. CLAUDE.md requires the printed number be the real live value, never a placeholder.

**Files:**
- Modify: `packages/ui/src/StatusBar.tsx` (the `powerTally` switch ~lines 155–180; the `powerLine` passive chain ~lines 182–195)

**Interfaces:**
- Consumes: `run.keshiTierPoints` (Task 2), `power.kind === 'crownTally'` and `power.name` = `Keshi's Crown` (Task 1).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Add the tally case**

In `packages/ui/src/StatusBar.tsx`, inside the `powerTally` switch, add immediately after the `case 'archive':` line and before `default: return null;`:

```ts
      case 'crownTally': return `${run.keshiTierPoints}/25`; // Keshi — shop tiers banked toward the Triple Reward
```

Deliberately unclamped: when the hand is full the bank legitimately sits above 25 and the panel should show that (`27/25`), because it tells the player the reward is waiting on hand space.

- [ ] **Step 2: Add the passive power line**

Still in `StatusBar.tsx`, in the `powerLine` nested-ternary chain, replace the `recurringGoldcrafter` tail. Find:

```tsx
            : power.kind === 'recurringGoldcrafter'
                ? `${power.name} · ${run.wave % 4 === 0 ? 'this turn' : `in ${4 - (run.wave % 4)}t`}`
                : `${power.name} · passive`
```

Replace with:

```tsx
            : power.kind === 'recurringGoldcrafter'
                ? `${power.name} · ${run.wave % 4 === 0 ? 'this turn' : `in ${4 - (run.wave % 4)}t`}`
                : power.kind === 'crownTally'
                  ? `${power.name} · ${run.keshiTierPoints}/25`
                  : `${power.name} · passive`
```

- [ ] **Step 3: Typecheck the web side**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npm run typecheck
```

Expected: clean. `npm run typecheck` runs `typecheck:pkgs` then `typecheck:web`; the UI is genuinely typechecked, so a wrong field name fails here.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && git add packages/ui/src/StatusBar.tsx && git commit -m "feat(ui): show Keshi's Crown progress on the hero panel

Tally numerals read <banked>/25 and the passive power line reads
\"Keshi's Crown · 14/25\". Unclamped on purpose: a held bank above 25
tells the player the reward is waiting on hand space.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Art

Portrait and power-button art through the established drop-in pipeline. No wiring code — `art.ts` globs both directories by hero id.

**Files:**
- Create: `packages/ui/src/art/heroes/keshi.webp` (generated)
- Create: `packages/ui/src/art/powers/keshi.webp` (generated)

**Interfaces:**
- Consumes: hero id `keshi` from Task 1. The filename **must** be exactly `keshi.webp` in both directories — `heroArt('keshi')` and `heroPowerArt('keshi')` key off the glob filename.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Copy the owner's masters in as PNGs**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && cp "/c/Users/micha/Desktop/Reference Art/Keshi the Protector.png" packages/ui/src/art/heroes/keshi.png && cp "/c/Users/micha/Desktop/Reference Art/keshi hero power.png" packages/ui/src/art/powers/keshi.png && ls -la packages/ui/src/art/heroes/keshi.png packages/ui/src/art/powers/keshi.png
```

Expected: both files listed.

- [ ] **Step 2: Optimize**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && npm run optimize-art
```

This downscales to ≤512px WebP and **deletes the source PNGs** (masters stay out of the repo, which is why we copied rather than moved).

- [ ] **Step 3: Verify the result**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && ls -la packages/ui/src/art/heroes/keshi.* packages/ui/src/art/powers/keshi.*
```

Expected: exactly `keshi.webp` in each directory, no `.png` left behind. Sizes should land in the same ballpark as neighbours (~40–70 KB; compare `hunch.webp` at 61 KB / 49 KB). If a `.png` survives, the optimizer didn't process it — do not commit the PNG; investigate instead.

Known and accepted: the power button is a circle with `object-fit: cover` and its README asks for a transparent background, but the supplied wreath image has the full forest backdrop, so the button shows green around the wreath. Not a defect — swapping in a cutout later is a drop-in file replacement.

- [ ] **Step 4: Commit**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && git add packages/ui/src/art/heroes/keshi.webp packages/ui/src/art/powers/keshi.webp && git commit -m "feat(art): Keshi portrait + hero-power button art

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Docs, full gates, and the PR

**Files:**
- Modify: `docs/devlog.md` (prepend a dated entry — newest first)
- Modify: `docs/roadmap.md` (remove anything this completes; add follow-ups)
- Modify: `README.md` (the **Recent changes** list)

**Interfaces:**
- Consumes: everything above.
- Produces: the merged feature.

- [ ] **Step 1: Prepend the devlog entry**

Add to the top of the entry list in `docs/devlog.md`, matching the surrounding format:

```markdown
## 2026-08-16 — Keshi the Protector (new hero)

A new hero whose passive, **Keshi's Crown**, banks the tavern tier of every card purchased and grants a
**Triple Reward** each time the bank reaches 25, then resets.

- **Engine.** New `crownTally` `HeroPowerKind` and `keshi` `HeroDef` (30 Resolve / 10 armor, passive, no
  henchman) in `packages/sim/src/heroes.ts`. New `RunState.keshiTierPoints` counter. New `keshiCrownBuy`
  helper in the reducer, called from all four `buy` branches (normal minion, held/displaced minion, the
  right-hand spell slot, and a spell offer in the minion row) plus `buyHenchman` — spells count, because the
  rule is "25 shop tiers worth of **cards**".
- **The payout is not new machinery.** It calls the existing `grantGoldenDiscover`, i.e. literally the Triple
  Reward a golden minion grants when played, with `grantedTier` frozen to the tavern tier it was earned on.
  Rune of the Corrupted Tome's double-grant is inherited for free.
- **Overflow is discarded** — the bank resets to 0, not to the remainder (owner spec). The one exception is a
  full hand: `grantGoldenDiscover` would silently drop the card, so instead the bank is **held** at 25+ and
  pays out on the next purchase with room. The panel shows the raw number, so `27/25` is a real state.
- **Armor 10** places Keshi with the strong-passive band (Flint / Pete / Merrin) rather than the quest heroes
  at 13 — projected ~5–6 Triple Rewards over a 17-round course, so the engine has to survive to cash in.
- **UI.** `StatusBar.tsx` gains the `crownTally` tally (`14/25` numerals) and passive power line. Portrait and
  power-button art added via `npm run optimize-art`.
- **Verified.** New `packages/sim/src/keshiCrown.test.ts` (9 tests) covers accumulation, each purchase path,
  the payout and its frozen tier, overflow discard, repeatability, the full-hand hold and its later payout,
  and hero-gating. Full `typecheck` + `lint` + `test` + `build:web` green.
- **Follow-ups.** No henchman yet (the `buyHenchman` hook is wired but unreachable until she has one). The
  power-button art is not a transparent cutout, so the circle shows its forest backdrop. The 25 threshold is
  a single-number retune if playtest says it lands wrong.
```

- [ ] **Step 2: Update the roadmap and README**

In `docs/roadmap.md`, add any follow-up worth queueing (a Keshi henchman; a transparent cutout for the power button) under the appropriate section. If a roadmap item covered "new heroes", move it along.

In `README.md`, add a line to **Recent changes**:

```markdown
- **Keshi the Protector** — new hero. Keshi's Crown banks the tavern tier of every card you buy and hands you a Triple Reward every 25.
```

- [ ] **Step 3: Run every gate**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && git branch --show-current && npm run typecheck && npm run lint && npm test && npm run build:web
```

Expected: all four green. Confirm the branch printed is `feat/hero-keshi` before trusting the result — a reverted cwd would run these against the primary checkout on a different branch and look green for the wrong code.

Report the actual output. Do not claim done on any gate that was not run.

- [ ] **Step 4: Commit the docs**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && git add docs/devlog.md docs/roadmap.md README.md && git commit -m "docs: Keshi the Protector devlog, roadmap and README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Rebase on latest main and push**

`main` moves fast and several sessions are active, so take it in before pushing.

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && git fetch origin && git rebase origin/main && git push -u origin feat/hero-keshi
```

If `docs/devlog.md` or `README.md` conflict, resolve by **keeping both sides** (union) — these are append-only logs and another session's entry is not a competing edit.

If the rebase pulls in new heroes from another session, re-run `npx vitest run packages/sim/src/heroPolicies.test.ts` before pushing — that tripwire is the one most likely to catch a bad merge.

- [ ] **Step 6: Open the PR and wait for `verify`**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && "/c/Program Files/GitHub CLI/gh.exe" pr create --title "feat(hero): Keshi the Protector — Keshi's Crown" --body "$(cat <<'BODY'
## What

A new hero, **Keshi the Protector**. Her passive, **Keshi's Crown**, banks the tavern tier of every card you
purchase and grants a **Triple Reward** every 25, then resets.

- 30 Resolve / 10 armor, passive, no henchman.
- Counts every paid purchase: Shop minions, held/displaced minions, spells from the right-hand slot, and
  spells offered in the minion row. Spells count because the rule is "25 shop tiers worth of **cards**".
- The reward is the existing `grantGoldenDiscover` — the same Triple Reward a golden minion grants, with its
  tier frozen at grant time. No new reward machinery.
- Overflow is discarded (bank resets to 0). A **full hand holds the bank** at 25+ rather than eating the
  reward, so the panel can legitimately read `27/25`.

## Verification

`npm run typecheck && npm run lint && npm test && npm run build:web` — all green. New
`packages/sim/src/keshiCrown.test.ts` (9 tests) covers every purchase path, the payout and its frozen tier,
overflow discard, repeatability, the full-hand hold, and hero-gating.

## Notes

- The `buyHenchman` hook is wired but unreachable until Keshi is given a henchman.
- The power-button art keeps its forest backdrop rather than being a transparent cutout — cosmetic, and a
  drop-in file swap later.

Spec: `docs/superpowers/specs/2026-08-16-keshi-hero-design.md`
Plan: `docs/superpowers/plans/2026-08-16-keshi-the-protector.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

Then watch the required check — `main` blocks the merge until `verify` is green:

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && "/c/Program Files/GitHub CLI/gh.exe" pr checks --watch
```

It can report "no checks" for a minute or two before `verify` starts — that is not CI being disabled, just not-yet-started. Wait and re-poll. Never reach for `--admin`.

- [ ] **Step 7: Merge once green**

```bash
cd /c/Users/micha/Desktop/ascent/.claude/worktrees/hero-keshi && "/c/Program Files/GitHub CLI/gh.exe" pr merge --squash
```

`--delete-branch` can report failure *after* a successful merge when a worktree holds the branch; if it errors, confirm with `gh pr view <n> --json state,mergedAt` before assuming it didn't land, and clean the branch up by hand.

---

## Definition of done

- Keshi the Protector is selectable on the hero-select screen with her portrait.
- Buying cards advances the `n/25` counter on her hero panel by each card's tier.
- Reaching 25 puts a Triple Reward in hand at the current tavern tier and resets the counter to 0.
- A full hand holds the bank instead of losing the reward.
- `npm run typecheck && npm run lint && npm test && npm run build:web` all green.
- Devlog, roadmap and README updated; PR squash-merged after `verify` passed.
