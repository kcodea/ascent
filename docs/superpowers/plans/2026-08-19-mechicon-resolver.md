# Minion Medallion `mechIcon` Resolver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the minion medallion always show the card's own first-mentioned mechanic (never the tribe), detected from effect data via one registry shared with the Compendium glossary.

**Architecture:** A new `mechanics.ts` holds a single `MECHANICS` registry (each entry: detect predicate + glyph + glossary text + ordering info). `mechIcon.ts`'s `resolveMechIcon(view)` looks the card's def up in `CARD_INDEX` (since `CardView` lacks `effects`), builds a `MechInput`, filters the registry to the mechanics the card has, and returns the first-mentioned one's glyph (or `null` → blank badge). `Card.tsx` and `MinionBook.tsx` both consume the registry so they can't drift.

**Tech Stack:** TypeScript, React (`packages/ui`), Vitest. No engine/content/sim change.

## Global Constraints

- **No tribe fallback, ever.** No recognised mechanic → `resolveMechIcon` returns `null` → the medallion renders a **blank badge frame** (the `.cgem` element stays, no `<Icon>` inside).
- **First mechanic *mentioned* wins**, among mechanics the card *itself has* (structural detection; text position only orders). A card that merely references a mechanic it lacks is not that mechanic.
- **`CardView` has no `effects`/`chooseOne`** — resolve the def via `CARD_INDEX[view.cardId]` (public `@game/content` export). Keyword checks use the **live** `view.keywords`; effect/chooseOne checks use the def.
- **Spells/Rubies are untouched** — they render no medallion already (`spellLike` branch). The resolver runs for minions only, via `Card.tsx`.
- **Performance north star:** the resolver is a cheap synchronous map filter per card render; no per-frame layout reads, no new React state. `Card`/`Unit` memoisation is unchanged.
- **Scope:** existing mechanics + Watcher (eye) + Choose One (choose1) + new glyphs `engrave` (Engraved) & `stealth` (Stealth). Orbit / Start of Turn / Improve / Rush / Ascend / spend-Gold and content re-tagging are OUT (later PRs). Ruby is NOT a medallion mechanic.
- **Branch/PR:** work on `feat/mechicon-resolver` (worktree off `origin/main`). `npm install` in the worktree before trusting gates (CLAUDE.md). Never push to `main`; PR → green `verify` → squash-merge. Update `docs/devlog.md` + `docs/roadmap.md` + `README.md` in the same PR.
- **Gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green before "done".

## File Structure

- `packages/ui/src/mechanics.ts` — **new.** `MechInput`/`Mechanic` types, `kwMatch`/`grantsKeyword` (moved from `MinionBook`), and the `MECHANICS` registry (all mechanics incl. Watcher). One responsibility: "the mechanic vocabulary + how to detect each."
- `packages/ui/src/mechanics.test.ts` — **new.** Per-mechanic detection over representative real cards.
- `packages/ui/src/mechIcon.ts` — **new.** `resolveMechIcon(view)` + `firstMentionIndex`. One responsibility: "pick the glyph for a card view."
- `packages/ui/src/mechIcon.test.ts` — **new.** Resolver ordering / null / CARD_INDEX path + the no-tribe invariant.
- `packages/ui/src/Icon.tsx` — **modify.** Add `engrave`, `stealth` glyphs.
- `packages/ui/src/Card.tsx` — **modify.** Use `resolveMechIcon`; blank-badge render; drop `triggerPill`/`KW_ICON`/`TRIBE_ICON`.
- `packages/ui/src/MinionBook.tsx` — **modify.** Rebuild `GLOSSARY` from `MECHANICS`; import `kwMatch` from `mechanics.ts`.
- `docs/devlog.md`, `docs/roadmap.md`, `README.md` — **modify.**

---

### Task 1: The mechanic registry (everything except Watcher)

**Files:**
- Create: `packages/ui/src/mechanics.ts`
- Test: `packages/ui/src/mechanics.test.ts`

**Interfaces:**
- Consumes: `CardDef`, `EffectDef`, `Keyword` from `@game/core`; `ALL_CARDS`, `CARD_INDEX` from `@game/content` (test only).
- Produces:
  - `interface MechInput { keywords: Keyword[]; effects: EffectDef[]; chooseOne?: CardDef['chooseOne']; text: string }`
  - `interface Mechanic { id: string; term: string; glyph: string; def: string; detect: (m: MechInput) => boolean; termRe?: RegExp; kw?: Keyword; order: number }`
  - `const kwMatch: (code: Keyword) => (m: MechInput) => boolean`
  - `function toMechInput(c: CardDef): MechInput`
  - `const MECHANICS: Mechanic[]` (all entries below; Watcher added in Task 2)

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/mechanics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { MECHANICS, toMechInput } from './mechanics';

const has = (cardId: string, mechId: string): boolean => {
  const def = CARD_INDEX[cardId];
  if (!def) throw new Error(`no such card ${cardId}`);
  const m = MECHANICS.find((x) => x.id === mechId);
  if (!m) throw new Error(`no such mechanic ${mechId}`);
  return m.detect(toMechInput(def));
};

describe('MECHANICS detection', () => {
  it('detects Shout on an onPlay card, not on an onSummon watcher', () => {
    expect(has('havendrake', 'shout')).toBe(true);   // effects: onPlay
    expect(has('mamabear', 'shout')).toBe(false);    // effects: onSummon (a watcher, not a Shout)
  });
  it('detects Echo (onDeath), Avenge, End of Turn', () => {
    expect(has('impking', 'echo')).toBe(true);
    expect(has('dm_grobbus', 'avenge')).toBe(true);
    expect(has('aeonguard', 'endTurn')).toBe(true);
  });
  it('detects keyword mechanics via kwMatch', () => {
    expect(has('gryphon', 'taunt')).toBe(true);      // T
    expect(has('bronzewarden', 'ward')).toBe(true);  // DS
  });
  it('detects Choose One', () => {
    expect(has('shaper', 'chooseOne')).toBe(true);   // Wildwood Shaper
  });
  it('detects Engraved (glyph is the new runic one, not anvil)', () => {
    expect(has('thundeer', 'engraved')).toBe(true);
    expect(MECHANICS.find((m) => m.id === 'engraved')!.glyph).toBe('engrave');
  });
  it('Stealth uses its own glyph, not the eye', () => {
    expect(MECHANICS.find((m) => m.id === 'stealth')!.glyph).toBe('stealth');
  });
  it('every mechanic has a unique id and a non-empty glyph/term/def', () => {
    const ids = MECHANICS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MECHANICS) { expect(m.glyph).toBeTruthy(); expect(m.term).toBeTruthy(); expect(m.def).toBeTruthy(); }
  });
});
```

> Card ids used above are real (verify with `grep "id: 'havendrake'"` etc. if any fails). `mamabear`/`havendrake` are the self-vs-watcher pair confirmed in the spec.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/mechanics.test.ts`
Expected: FAIL — `Cannot find module './mechanics'`.

- [ ] **Step 3: Write the registry module**

Create `packages/ui/src/mechanics.ts`:

```ts
/**
 * The single source of truth for the minion mechanic vocabulary: how to detect each mechanic (from effect
 * data + keywords + chooseOne), its medallion glyph, and its glossary text. Consumed by BOTH the medallion
 * resolver (mechIcon.ts) and the Compendium glossary (MinionBook.tsx) so they can never drift.
 */
import type { CardDef, EffectDef, Keyword } from '@game/core';

/** The card fields a predicate needs. A full CardDef satisfies it; the resolver builds one per CardView. */
export interface MechInput {
  keywords: Keyword[];
  effects: EffectDef[];
  chooseOne?: CardDef['chooseOne'];
  text: string;
}

export interface Mechanic {
  id: string;
  term: string;              // player-facing name (glossary)
  glyph: string;             // Icon.tsx name
  def: string;               // one-line glossary rule
  detect: (m: MechInput) => boolean;
  termRe?: RegExp;           // how the term appears in text (raw + renamed) — used ONLY to order multi-mechanic cards
  kw?: Keyword;              // set for keyword-based mechanics — used to break ties by keyword order
  order: number;             // final global tiebreak
}

export function toMechInput(c: CardDef): MechInput {
  return { keywords: c.keywords, effects: c.effects, chooseOne: c.chooseOne, text: c.text ?? '' };
}

/** Factories whose name alone fixes the keyword they grant (moved verbatim from MinionBook). */
const FIXED_GRANT: Record<string, Keyword> = {
  deathrattleGrantReborn: 'R',
  deathrattleGrantShield: 'DS',
  scGrantShieldTribe: 'DS',
  onShieldBreakGrantShield: 'DS',
};

/** Does this card GRANT keyword `code` (Mumi → Rise, Selfless Sentinel → Ward, …)? Reads fixed-grant
 *  factories + any params.keyword(s), across top-level and Choose-One effects. */
function grantsKeyword(m: MechInput, code: Keyword): boolean {
  const effs = [...m.effects, ...(m.chooseOne?.flatMap((o) => o.effects) ?? [])];
  return effs.some((e) => {
    if (FIXED_GRANT[e.do] === code) return true;
    const p = e.params as { keyword?: string; keywords?: string[] } | undefined;
    return p?.keyword === code || (Array.isArray(p?.keywords) && p.keywords.includes(code));
  });
}

/** A keyword-code predicate — carries the keyword OR grants it (mirrors the glossary). */
export const kwMatch = (code: Keyword) => (m: MechInput): boolean =>
  m.keywords.includes(code) || grantsKeyword(m, code);

const hasOn = (on: EffectDef['on']) => (m: MechInput): boolean => m.effects.some((e) => e.on === on);
const hasDo = (re: RegExp) => (m: MechInput): boolean => m.effects.some((e) => re.test(e.do));

/**
 * The registry. `order` is only consulted for the rare card whose several own-mechanics have no text term;
 * lower wins. Triggers are ordered ahead of passive keywords. Watcher is appended in Task 2.
 */
export const MECHANICS: Mechanic[] = [
  // — Triggers (fire on the card's own play/death/turn/kill/etc.) —
  { id: 'shout', term: 'Shout', glyph: 'battlecry', def: 'Fires when you play this minion from your hand.', detect: hasOn('onPlay'), termRe: /battlecr(?:y|ies)|shouts?/i, order: 10 },
  { id: 'echo', term: 'Echo', glyph: 'echo', def: 'Fires when this minion dies.', detect: hasOn('onDeath'), termRe: /deathrattles?|echoe?s?/i, order: 11 },
  { id: 'startCombat', term: 'Start of Combat', glyph: 'fist', def: 'Fires once, the moment the battle begins.', detect: kwMatch('SC'), kw: 'SC', termRe: /start of combat/i, order: 12 },
  { id: 'endTurn', term: 'End of Turn', glyph: 'sc', def: 'Fires at the end of each recruit turn, before you fight.', detect: hasOn('endOfTurn'), termRe: /end of turn/i, order: 13 },
  { id: 'avenge', term: 'Avenge', glyph: 'skull', def: 'Fires after every N of your minions die in a combat.', detect: hasOn('avenge'), termRe: /\bavenge\b/i, order: 14 },
  { id: 'rally', term: 'Rally', glyph: 'sword', def: 'Fires each time this minion attacks.', detect: kwMatch('RL'), kw: 'RL', termRe: /\brally\b|\brallies\b/i, order: 15 },
  { id: 'slaughter', term: 'Slaughter', glyph: 'slaughter', def: 'Fires each time this minion kills an enemy minion.', detect: kwMatch('SL'), kw: 'SL', termRe: /\bslaughters?\b/i, order: 16 },
  { id: 'bleed', term: 'Bleed', glyph: 'poison', def: "Marks enemies at Start of Combat; every few attacks, they each take this minion's Attack.", detect: hasDo(/^scArmBleed$/), termRe: /\bbleed\b/i, order: 17 },
  { id: 'chooseOne', term: 'Choose One', glyph: 'choose1', def: 'Pick one of two effects as you play the minion.', detect: (m) => !!m.chooseOne, termRe: /choose one/i, order: 18 },
  // — Combat keywords —
  { id: 'taunt', term: 'Taunt', glyph: 'taunt', def: 'Enemies must attack this minion first.', detect: kwMatch('T'), kw: 'T', termRe: /\btaunt\b/i, order: 30 },
  { id: 'ward', term: 'Ward', glyph: 'shield', def: 'Blocks the first hit it would take, then breaks.', detect: kwMatch('DS'), kw: 'DS', termRe: /divine shields?|\bwards?\b/i, order: 31 },
  { id: 'execute', term: 'Execute', glyph: 'execute', def: 'Destroys any minion it damages — spent after one hit.', detect: kwMatch('V'), kw: 'V', termRe: /venomous|\bexecutes?\b/i, order: 32 },
  { id: 'flurry', term: 'Flurry', glyph: 'windfury', def: 'Attacks twice each turn.', detect: kwMatch('W'), kw: 'W', termRe: /windfury|flurr(?:y|ies)/i, order: 33 },
  { id: 'crit', term: 'Critical Strike', glyph: 'target', def: 'Each attack has a chance to deal double damage.', detect: kwMatch('CR'), kw: 'CR', termRe: /critical strike/i, order: 34 },
  { id: 'rise', term: 'Rise', glyph: 'rise', def: 'The first time it dies, it returns once with 1 Health.', detect: kwMatch('R'), kw: 'R', termRe: /reborn|\brises?\b/i, order: 35 },
  { id: 'cleave', term: 'Cleave', glyph: 'cleave', def: 'Also damages the minions beside its target.', detect: kwMatch('C'), kw: 'C', termRe: /\bcleaves?\b/i, order: 36 },
  { id: 'immune', term: 'Immune', glyph: 'immune', def: "Can't take damage.", detect: kwMatch('IMM'), kw: 'IMM', termRe: /\bimmune\b/i, order: 37 },
  { id: 'stealth', term: 'Stealth', glyph: 'stealth', def: "Can't be attacked until it has attacked once.", detect: kwMatch('ST'), kw: 'ST', termRe: /\bstealth\b/i, order: 38 },
  // — Build & shop —
  { id: 'attachment', term: 'Attachment', glyph: 'magnetic', def: 'Play it onto a friendly minion to merge its stats and keywords in.', detect: kwMatch('M'), kw: 'M', termRe: /magneti[cz]e?[sd]?|attachments?|\battaches?\b|\battach\b/i, order: 40 },
  { id: 'consume', term: 'Consume', glyph: 'consume', def: 'Devours your Fodder to grow.', detect: kwMatch('CN'), kw: 'CN', termRe: /\bconsumes?\b/i, order: 41 },
  { id: 'fodder', term: 'Fodder', glyph: 'fodder', def: 'A cheap token your minions consume for stats.', detect: kwMatch('FD'), kw: 'FD', termRe: /\bfodder\b/i, order: 42 },
  { id: 'engraved', term: 'Engraved', glyph: 'engrave', def: 'Stat gains during combat carry back to your board.', detect: kwMatch('EG'), kw: 'EG', termRe: /engraved?/i, order: 43 },
  { id: 'discover', term: 'Discover', glyph: 'star', def: 'Peek at three cards and add one to your hand.', detect: hasDo(/discover/i), termRe: /\bdiscover\b/i, order: 44 },
];
```

> **Before writing:** open `packages/ui/src/MinionBook.tsx` (the `GLOSSARY`, `kwMatch`, `grantsKeyword`,
> `FIXED_GRANT` around L131–220) and copy those helpers **verbatim** — do not re-derive them. Confirm
> `EffectDef` exposes `on`, `do`, `params` (it does; the glossary reads them). Keep the `def` strings identical
> to the glossary's so Task 6 (rebuild glossary) is a no-op for the player.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/mechanics.test.ts`
Expected: PASS. If a card id is wrong, `grep -rn "id: '<name>'" packages/content/src/cards` for the right one.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: green (worktree `npm install` done first).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/mechanics.ts packages/ui/src/mechanics.test.ts
git commit -m "feat(ui): mechanic registry shared by the medallion + glossary"
```

---

### Task 2: The Watcher mechanic

**Files:**
- Modify: `packages/ui/src/mechanics.ts` (add the `watcher` entry + `isWatcher`)
- Test: `packages/ui/src/mechanics.test.ts` (append)

**Interfaces:**
- Consumes: `MechInput` (Task 1).
- Produces: a `MECHANICS` entry `{ id: 'watcher', glyph: 'eye', … }`; internal `isWatcher(m: MechInput): boolean`.

**Definition:** a Watcher fires **in response to another minion or your actions** — not on this card's own
play/death/turn/avenge/consume. Detected by a reactive effect trigger, plus ally-attack/ally-kill (an
`onAttack`/`onKill` effect on a card WITHOUT the self-attack/kill keyword `RL`/`SL`).

- [ ] **Step 1: Enumerate the reactive triggers**

Open `packages/core/src/types.ts` and read the full effect-`on` union (search `| 'onPlay'` and read down
through the `EffectFactoryId`/trigger list). Classify every `on:` value:
- **Own trigger** (already a mechanic, do NOT add): `onPlay`, `onDeath`, `endOfTurn`, `avenge`, `onConsume`.
- **Own economy/undefined** (NOT a watcher, leave `null` for now): `onSell`, `onBuy`, `startOfTurn`.
- **Reactive → Watcher**: everything that fires because *another* unit/effect did something. Confirmed set to
  seed `REACTIVE_ON`: `onSummon`, `onGainAttack`, `onDamaged`, `onFriendDeath`, `onGainCard`, `onGetRuby`,
  `onRubyPlayed`. Add any other reactive `on:` you find in the union (e.g. spell-cast / rally / shout reaction
  triggers named `on…`), but do NOT add own/economy triggers.
- `onAttack` / `onKill` are handled by the keyword rule below (ally vs self), not by the set.

- [ ] **Step 2: Write the failing test (append to `mechanics.test.ts`)**

```ts
describe('Watcher', () => {
  const isW = (id: string) => {
    const def = CARD_INDEX[id]!;
    return MECHANICS.find((m) => m.id === 'watcher')!.detect(toMechInput(def));
  };
  it('is a watcher: onSummon, ally-attack, and reaction cards', () => {
    expect(isW('mamabear')).toBe(true);   // onSummon
    expect(isW('raptor')).toBe(true);     // ally onAttack, no RL keyword
    expect(isW('karwind')).toBe(true);    // reacts to Shouts
  });
  it('is NOT a watcher: a real Shout, or a self-attack Rally', () => {
    expect(isW('havendrake')).toBe(false);       // onPlay only
    expect(isW('b2_echohorn')).toBe(false);      // RL keyword → self-attack, not a watcher
  });
  it('has the eye glyph', () => {
    expect(MECHANICS.find((m) => m.id === 'watcher')!.glyph).toBe('eye');
  });
});
```

> Verify `raptor`/`karwind` effect triggers with `grep -rn -A10 "id: 'raptor'" packages/content/src/cards`.
> If `raptor` is not `onAttack`, pick another ally-attack watcher from the audit's call-out list (e.g.
> `d2_skald`, "When another friendly Dragon attacks") and use that id.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/mechanics.test.ts -t Watcher`
Expected: FAIL (no `watcher` mechanic yet).

- [ ] **Step 4: Add the Watcher entry**

In `mechanics.ts`, above the closing `]` of `MECHANICS`, add the predicate and entry:

```ts
/** Effect triggers that fire in response to ANOTHER minion / your actions (not this card's own trigger). */
const REACTIVE_ON = new Set<EffectDef['on']>([
  'onSummon', 'onGainAttack', 'onDamaged', 'onFriendDeath', 'onGainCard', 'onGetRuby', 'onRubyPlayed',
  // + any other reactive `on:` found while enumerating the union in Step 1
]);
function isWatcher(m: MechInput): boolean {
  const kw = new Set(m.keywords);
  return m.effects.some((e) => {
    if (e.on && REACTIVE_ON.has(e.on)) return true;
    if (e.on === 'onAttack' && !kw.has('RL')) return true; // watches an ALLY attack (self-attack = Rally)
    if (e.on === 'onKill' && !kw.has('SL')) return true;   // watches an ALLY kill (self-kill = Slaughter)
    return false;
  });
}
```

and the registry entry (Watcher has no clean text term → no `termRe`; it sorts last via `order`):

```ts
  { id: 'watcher', term: 'Watcher', glyph: 'eye', def: 'Reacts to your other minions and actions — e.g. when another minion is summoned or attacks.', detect: isWatcher, order: 50 },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/mechanics.test.ts`
Expected: PASS (all, including the Task-1 cases).

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add packages/ui/src/mechanics.ts packages/ui/src/mechanics.test.ts
git commit -m "feat(ui): Watcher mechanic (eye) — reactive triggers + ally attack/kill"
```

> **Reviewer note for the controller:** Watcher membership is the judgment-heavy piece. The final live pass
> should sanity-check that no card lands on the eye that shouldn't, and that reaction cards (Karwind, Sylus,
> Uron, Beardsley, Den Mother) do.

---

### Task 3: New glyphs — `engrave` and `stealth`

**Files:**
- Modify: `packages/ui/src/Icon.tsx`

**Interfaces:**
- Produces: `Icon` renders `name="engrave"` and `name="stealth"` (referenced by Task 1's registry).

- [ ] **Step 1: Read the Icon map**

Open `packages/ui/src/Icon.tsx`. Icons are entries in one object mapping name → JSX `<path>`/`<g>` inside a
shared `<svg viewBox="0 0 24 24">` (see `anvil`, `eye`, `skull`). Add two entries.

- [ ] **Step 2: Add the glyphs**

Add to the icon map (near `anvil`):

```tsx
  // Engraved — a rune mark (angular strokes), replacing the anvil for the Engraved keyword.
  engrave: (
    <g fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18M12 3l-4 4M12 3l4 4M12 12l-4 4M12 12l4 4" />
    </g>
  ),
  // Stealth — a hood/cowl silhouette (freed off the eye, which is now Watcher).
  stealth: (
    <path fill="currentColor" d="M12 3c-4 0-7 3.4-7 8v9h3v-4c0-2.4 1.8-4 4-4s4 1.6 4 4v4h3v-9c0-4.6-3-8-7-8zm0 4a3 3 0 013 3c0 1-3 2-3 2s-3-1-3-2a3 3 0 013-3z" />
  ),
```

> These are placeholder-but-real SVGs so the pipeline works and tests pass; the owner tunes the final look
> live (Task 7). Keep them monochrome `currentColor` like every sibling glyph, inside the 24×24 viewBox.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build:web`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Icon.tsx
git commit -m "feat(ui): add engrave + stealth medallion glyphs"
```

---

### Task 4: The resolver `resolveMechIcon`

**Files:**
- Create: `packages/ui/src/mechIcon.ts`
- Test: `packages/ui/src/mechIcon.test.ts`

**Interfaces:**
- Consumes: `MECHANICS`, `Mechanic`, `MechInput` (Task 1/2); `CARD_INDEX` from `@game/content`; `CardView` from `./Card`.
- Produces: `function resolveMechIcon(view: CardView): string | null`; `function firstMentionIndex(text: string, m: Mechanic): number`.

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/mechIcon.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ALL_CARDS, CARD_INDEX } from '@game/content';
import type { CardView } from './Card';
import { resolveMechIcon } from './mechIcon';
import { MECHANICS, toMechInput } from './mechanics';

// A minimal CardView from a real card def (the resolver only reads cardId, keywords, text).
const view = (cardId: string): CardView => {
  const d = CARD_INDEX[cardId]!;
  return { name: d.name, cardId: d.id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: d.keywords, text: d.text ?? '' };
};

describe('resolveMechIcon', () => {
  it('real Shout → battlecry; onSummon watcher → eye (not battlecry)', () => {
    expect(resolveMechIcon(view('havendrake'))).toBe('battlecry');
    expect(resolveMechIcon(view('mamabear'))).toBe('eye');
  });
  it('reaction card (Karwind) → eye, not battlecry', () => {
    expect(resolveMechIcon(view('karwind'))).toBe('eye');
  });
  it('keyword-only empty-text card → its keyword glyph', () => {
    expect(resolveMechIcon(view('bronzewarden'))).toBe('shield'); // Guardian Drake, DS (+CR), no text
  });
  it('multi-mechanic in text → first mentioned wins', () => {
    // b2_armadiyo text: "**Taunt. Echo:** …" — Taunt appears first.
    expect(resolveMechIcon(view('b2_armadiyo'))).toBe('taunt');
  });
  it('Choose One → choose1; Engraved → engrave', () => {
    expect(resolveMechIcon(view('shaper'))).toBe('choose1');
    expect(resolveMechIcon(view('thundeer'))).toBe('engrave');
  });
  it('vanilla token → null (blank badge)', () => {
    expect(resolveMechIcon(view('pup'))).toBeNull();
  });
});

describe('no-tribe invariant', () => {
  it('no minion resolves to a tribe-only glyph; every result is a registry glyph or null', () => {
    const registryGlyphs = new Set(MECHANICS.map((m) => m.glyph));
    const tribeOnly = new Set(['paw', 'flame', 'gear', 'crown', 'clock', 'anvil']);
    for (const c of ALL_CARDS) {
      if ((c as { spell?: unknown }).spell || (c as { ruby?: unknown }).ruby) continue; // no medallion
      const g = resolveMechIcon(view(c.id));
      if (g === null) continue;
      expect(tribeOnly.has(g), `${c.id} → ${g}`).toBe(false);
      expect(registryGlyphs.has(g), `${c.id} → ${g}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/ui/src/mechIcon.test.ts`
Expected: FAIL — `Cannot find module './mechIcon'`.

- [ ] **Step 3: Write the resolver**

Create `packages/ui/src/mechIcon.ts`:

```ts
/**
 * The minion medallion glyph. Detects the mechanics the card ITSELF has (via the shared MECHANICS registry),
 * and returns the FIRST one mentioned in the card's text — or null for a blank badge. Never the tribe.
 * CardView has no `effects`, so the def is looked up in CARD_INDEX; keywords come from the live view.
 */
import { CARD_INDEX } from '@game/content';
import type { CardView } from './Card';
import { MECHANICS, type Mechanic, type MechInput } from './mechanics';

/** Index of the mechanic's first term in the text (bold markers stripped), or -1 if absent. Ordering only. */
export function firstMentionIndex(text: string, m: Mechanic): number {
  if (!m.termRe) return -1;
  const match = m.termRe.exec(text.replace(/\*\*/g, ''));
  return match ? match.index : -1;
}

export function resolveMechIcon(view: CardView): string | null {
  const def = CARD_INDEX[view.cardId];
  const input: MechInput = {
    keywords: view.keywords,
    effects: def?.effects ?? [],
    chooseOne: def?.chooseOne,
    text: view.text ?? '',
  };
  const owned = MECHANICS.filter((m) => m.detect(input));
  if (owned.length === 0) return null;
  if (owned.length === 1) return owned[0]!.glyph;
  const kwPos = (m: Mechanic): number => (m.kw ? input.keywords.indexOf(m.kw) : -1);
  const winner = owned.slice().sort((a, b) => {
    const pa = firstMentionIndex(input.text, a), pb = firstMentionIndex(input.text, b);
    if (pa !== -1 && pb !== -1) return pa - pb;        // both in text → text order
    if (pa !== -1) return -1;                          // only a in text → a wins
    if (pb !== -1) return 1;                            // only b in text → b wins
    const ka = kwPos(a), kb = kwPos(b);                 // neither in text: keyword order…
    if (ka !== -1 && kb !== -1) return ka - kb;
    if (ka !== -1) return -1;
    if (kb !== -1) return 1;
    return a.order - b.order;                           // …then global order
  })[0]!;
  return winner.glyph;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/ui/src/mechIcon.test.ts`
Expected: PASS. If the no-tribe invariant flags a card, read its def — either it exposes a real mechanic the
registry should already catch (fix the predicate) or it is a genuinely-undefined mechanic that should resolve
`null` (out of scope — confirm it's `null`, not a tribe glyph). Record any surprises for the live pass.

- [ ] **Step 5: Typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`

```bash
git add packages/ui/src/mechIcon.ts packages/ui/src/mechIcon.test.ts
git commit -m "feat(ui): resolveMechIcon — first-mentioned own mechanic, no tribe fallback"
```

---

### Task 5: Wire `Card.tsx` to the resolver

**Files:**
- Modify: `packages/ui/src/Card.tsx`

**Interfaces:**
- Consumes: `resolveMechIcon` (Task 4).

- [ ] **Step 1: Import the resolver**

Add near the other local imports in `Card.tsx`:

```ts
import { resolveMechIcon } from './mechIcon';
```

- [ ] **Step 2: Replace the mechIcon computation**

Replace L648–650 (the comment + `const mechIcon = trigger?.icon ?? …`):

```ts
  // The card's primary mechanic glyph for the medallion — the first mechanic the card itself has (see
  // mechIcon.ts). `null` → a blank badge. Never the tribe.
  const mechIcon = resolveMechIcon(card);
```

Delete the now-unused `const trigger = triggerPill(card.text);` (L640) — but first confirm `trigger` has no
other reader: `grep -n "\btrigger\b" packages/ui/src/Card.tsx`. If the only hits are L640 + L650, remove both.

- [ ] **Step 3: Render a blank badge when null**

Find the medallion span (search `className={\`cgem`), currently `…><Icon name={mechIcon} /></span>`. Make the
icon conditional:

```tsx
    …aria-hidden="true">{mechIcon && <Icon name={mechIcon} />}</span>
```

- [ ] **Step 4: Remove the dead maps**

Delete `triggerPill`, `KW_ICON`, and `TRIBE_ICON` from `Card.tsx` (they no longer have a reader — the
medallion was their only consumer). **Keep `TRIBE_LABEL`** (the tribe footer line still uses it — confirm with
`grep -n "TRIBE_LABEL\|TRIBE_ICON\|KW_ICON\|triggerPill" packages/ui/src/Card.tsx`). Remove any now-unused
imports flagged by the next step.

- [ ] **Step 5: Typecheck, lint, build**

Run: `npm run typecheck && npm run lint && npm run build:web`
Expected: green. Fix any unused-import/variable lint errors from the deletions.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/Card.tsx
git commit -m "feat(ui): medallion uses resolveMechIcon (blank badge, no tribe fallback)"
```

---

### Task 6: Rebuild the glossary from the registry + drift test

**Files:**
- Modify: `packages/ui/src/MinionBook.tsx`
- Test: `packages/ui/src/mechIcon.test.ts` (append the drift test)

**Interfaces:**
- Consumes: `MECHANICS`, `kwMatch`, `toMechInput` (Task 1).

- [ ] **Step 1: Write the failing drift test (append to `mechIcon.test.ts`)**

```ts
import { GLOSSARY_MECHANIC_IDS } from './MinionBook';

describe('glossary ↔ registry (no drift)', () => {
  it('every glossary mechanic row is backed by a MECHANICS entry', () => {
    const ids = new Set(MECHANICS.map((m) => m.id));
    for (const id of GLOSSARY_MECHANIC_IDS) expect(ids.has(id), `glossary row ${id}`).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/ui/src/mechIcon.test.ts -t drift`
Expected: FAIL — `MinionBook` has no `GLOSSARY_MECHANIC_IDS` export.

- [ ] **Step 3: Rebuild `GLOSSARY` from `MECHANICS`**

In `MinionBook.tsx`:
1. Delete the local `kwMatch`, `grantsKeyword`, `FIXED_GRANT` and import from the registry:
   `import { MECHANICS, kwMatch, toMechInput } from './mechanics';`
2. The glossary keeps its **3 section groupings** (Triggers / Combat keywords / Build & shop) plus the two
   non-mechanic rows it already has (**Gilded**, which has no `match`, and any pure-text rows). Build the
   mechanic rows from `MECHANICS` by id, preserving the current section order. Replace each hand-authored row
   `{ icon, term, def, match }` with one derived from the registry entry:

```tsx
const byId = Object.fromEntries(MECHANICS.map((m) => [m.id, m]));
const row = (id: string): GlossItem => {
  const m = byId[id]!;
  return { icon: m.glyph, term: m.term, def: m.def, match: (c: CardDef) => m.detect(toMechInput(c)) };
};
const GLOSSARY: { title: string; items: GlossItem[] }[] = [
  { title: 'Triggers', items: ['shout','echo','startCombat','endTurn','avenge','rally','slaughter','bleed','chooseOne'].map(row) },
  { title: 'Combat keywords', items: ['taunt','ward','execute','flurry','crit','rise','cleave','immune','stealth','watcher'].map(row) },
  { title: 'Build & shop', items: [...['attachment','consume','fodder','engraved','discover'].map(row),
    { icon: 'crown', term: 'Gilded', def: 'Collect three copies to fuse one doubled-stat Gilded minion.' }] },
];
export const GLOSSARY_MECHANIC_IDS = ['shout','echo','startCombat','endTurn','avenge','rally','slaughter','bleed','chooseOne','taunt','ward','execute','flurry','crit','rise','cleave','immune','stealth','watcher','attachment','consume','fodder','engraved','discover'] as const;
```

   This adds **Watcher** to the codex (new row) and swaps Engraved's icon to `engrave` and Stealth's to
   `stealth` automatically. Player-facing `def` strings are unchanged (Task 1 copied them verbatim), so no
   copy review is needed beyond the two new/changed rows.

- [ ] **Step 4: Run tests + typecheck + build**

Run: `npx vitest run packages/ui/src/mechIcon.test.ts && npm run typecheck && npm run build:web`
Expected: green. Open the Compendium glossary in the live app later (Task 7) to confirm it renders + filters.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/MinionBook.tsx packages/ui/src/mechIcon.test.ts
git commit -m "feat(ui): glossary reads the shared mechanic registry (adds Watcher; no drift)"
```

---

### Task 7: Live verification + docs

**Files:**
- Modify: `docs/devlog.md`, `docs/roadmap.md`, `README.md`.

- [ ] **Step 1: Full gate**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. Report the test count.

- [ ] **Step 2: Live check**

Start the dev server (`preview_start` name `web`), open in a focused tab. Confirm on a spread of minions in
shop AND combat:
- a real Shout → megaphone; a watcher (Den Mother / Karwind) → **eye**; a Choose One → the `choose1` glyph; an
  Engraved minion → the new **runic** glyph; a Stealth minion → the new stealth glyph; a vanilla token (Pup) →
  **blank badge**.
- **no** card shows a tribe symbol as its medallion.
- open the Compendium → Glossary: the Watcher row is present; Engraved/Stealth show the new glyphs; clicking a
  row still filters the gallery.
Screenshot the shop + a combat frame for the owner. Then author the final `engrave` + `stealth` glyph art with
the owner (the Task-3 SVGs are placeholders).

- [ ] **Step 3: Update docs**

- `docs/devlog.md` — prepend a dated entry: the resolver rewrite (structured detection via the shared registry;
  first-mentioned own mechanic; no tribe fallback; blank badge); the new Watcher (eye) + Stealth glyph +
  Engraved runic + Choose One on the medallion; the glossary now reads the registry (drift-proof); how verified
  (unit tests incl. the no-tribe invariant + drift test, full gate, live pass). Note the deferred follow-ups
  (Orbit / Start of Turn / Improve / Rush / Ascend / spend-Gold glyphs; Engraved re-tagging of Tara/Taragosa).
- `docs/roadmap.md` — move the "Minion mechanic-icon fixes" item's PR-1 scope to done; leave the deferred
  glyph work under Next/Later.
- `README.md` — add a Recent-changes line.

- [ ] **Step 4: Commit + PR**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: log the medallion mechIcon resolver rewrite"
git push -u origin feat/mechicon-resolver
"<gh path>" pr create --fill --base main
```

Watch `verify` to green, then squash-merge (full `gh` path; no `--admin`; confirm state after
`--delete-branch`).

---

## Self-Review

**Spec coverage:**
- Shared registry, both consumers read it → Tasks 1, 6. ✔
- Structured detection (effects/keywords/chooseOne), CardView + CARD_INDEX + MechInput → Tasks 1, 4. ✔
- First-mentioned own mechanic; ordering (text → keyword → global) → Task 4. ✔
- No tribe fallback; blank badge on null → Tasks 4, 5 + invariant test. ✔
- Watcher = eye (reactive); Stealth new glyph; Engraved runic; Choose One surfaced → Tasks 1, 2, 3. ✔
- Spells/Rubies untouched (medallion only on minions) → invariant test skips them; Card.tsx branch unchanged. ✔
- Glossary rebuilt from registry (+ Watcher), no drift → Task 6 + drift test. ✔
- Deferred scope (Orbit/etc., Ruby dropped, Engraved re-tagging) → stated in constraints + docs. ✔
- Tests: detection, resolver ordering/null, no-tribe invariant, drift → Tasks 1, 2, 4, 6. ✔
- Docs + gates → Task 7. ✔

**Placeholder scan:** none — every code step is concrete. `<gh path>` in Task 7 is the runtime gh binary path
(per the environment), not unresolved design. The Task-3 SVGs are explicitly interim, to be finalized live.

**Type consistency:** `MechInput`, `Mechanic` (fields `id/term/glyph/def/detect/termRe/kw/order`), `MECHANICS`,
`toMechInput`, `kwMatch`, `resolveMechIcon(view: CardView): string | null`, `firstMentionIndex(text, m)`,
`GLOSSARY_MECHANIC_IDS` — identical across Tasks 1, 2, 4, 6.

**Risk notes for the implementer:**
- Watcher membership (Task 2) is the one judgment call — enumerate the real `on:` union, don't trust the seed
  set blindly, and lean on the tests. Flag anything surprising for the live pass.
- Confirm card ids in tests against `packages/content/src/cards` before trusting a red — a wrong id reads like a
  logic failure.
- Line numbers (Card.tsx L640/648-650) are from `feat/mechicon-resolver` at plan time; match on the quoted
  code if they've shifted.
