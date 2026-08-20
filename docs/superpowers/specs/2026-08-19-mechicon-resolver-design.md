# Minion medallion `mechIcon` resolver — Design

**Date:** 2026-08-19
**Branch:** `feat/mechicon-resolver` (worktree off `origin/main`)
**Owner seam:** presentation (`packages/ui/**`) — Mike's domain. No engine/content/sim change.
**Source audit:** [`docs/mech-icon-glyph-audit.md`](../../mech-icon-glyph-audit.md) (PR #1110).

## Summary

Rewrite the resolver that decides the glyph shown in a minion's **medallion** (the round badge centred in the
stat cluster; it also pulses in combat). Today it is `trigger?.icon ?? keywords[0] ?? tribe` — a text-prefix
trigger check, then the first keyword, then the **tribe symbol**. The tribe fallback means **64% of minions
show a generic tribe badge**, and a rename desync (the check matches `battlecry`/`deathrattle` while card text
was renamed to `Shout`/`Echo`) silently drops many trigger glyphs.

New rule (owner ruling 2026-08-19): **the medallion always shows the card's own first-mentioned mechanic, and
never falls back to the tribe.** Detection moves from fragile text-scanning to the **same structured predicates
the Compendium glossary already uses** (effect data + keywords + `chooseOne`), so the codex and the card can
never disagree — the divergence between them is the root cause we are removing.

This is **PR 1 of a series**: the resolver rewrite plus the specific glyph changes below, using the mechanics we
already recognise. New glyphs for not-yet-defined mechanics (Orbit, Start of Turn, Improve, Rush, Ascend,
spend-Gold) are **out of scope**, deferred to follow-up PRs.

## Decisions (from brainstorming)

- **No tribe fallback, ever.** A minion with no recognised mechanic shows a **blank badge frame** (the `.cgem`
  element stays for stable geometry; no `<Icon>` inside).
- **First mechanic *mentioned* wins**, among the mechanics the card *itself has*. Detection is structural;
  text position is used only to **order** multiple own-mechanics. A card that merely *references* a mechanic it
  doesn't have (e.g. Karwind, "Whenever a **Shout** triggers…") is not a Shout — it is a **Watcher**.
- **Watcher = eye** — a new mechanic covering reactive effects (fires in response to another minion's action or
  another effect: `onSummon`, an ally's `onAttack`, on-ally-Shout/Orbit, …). Verified the effect data
  distinguishes this from a self-trigger: Den Mother is `on: 'onSummon'`, Haven Drake (a real Shout) is
  `on: 'onPlay'`.
- **Stealth → a new glyph** (freed off the eye; proposed look: a hood/mask). **Engraved → a new runic glyph**
  (replacing the anvil). **Choose One → surfaced on the medallion** using the existing `choose1` glyph.
- **Spells and Rubies are unaffected** — they already render no medallion (`Card.tsx` renders `.cgem` only in
  the non-`spellLike` branch); the resolver runs for minions only.

## Architecture

### One shared mechanic registry (the anti-drift core)

A single module — **`packages/ui/src/mechanics.ts`** (new) — is the one source of truth for the mechanic
vocabulary. Each entry:

```ts
interface Mechanic {
  id: string;                       // stable key, e.g. 'shout', 'watcher', 'engraved'
  term: string;                     // player-facing name shown in the glossary (e.g. 'Shout')
  glyph: string;                    // Icon.tsx name (e.g. 'battlecry')
  def: string;                     // one-line rule text for the glossary
  detect: (c: CardDef) => boolean;  // structural predicate (effect data / keywords / chooseOne)
  order: number;                    // tiebreak when text position can't order (see Ordering)
}
export const MECHANICS: Mechanic[];
```

It absorbs the glossary's current `kwMatch` / `grantsKeyword` / `FIXED_GRANT` helpers and its `match`
predicates. Both consumers below read `MECHANICS` — they cannot drift:

- **`packages/ui/src/mechIcon.ts`** (new): `resolveMechIcon(card: CardDef): string | null` — the medallion.
- **`packages/ui/src/MinionBook.tsx`**: the `GLOSSARY` rows are rebuilt from `MECHANICS` (term/glyph/def/`match
  → detect`), keeping the existing "click a row to filter the gallery" behaviour.

### The resolver

```ts
export function resolveMechIcon(card: CardDef): string | null {
  const owned = MECHANICS.filter((m) => m.detect(card));   // mechanics the card ITSELF has
  if (owned.length === 0) return null;                     // → blank badge
  if (owned.length === 1) return owned[0].glyph;
  // Multiple: the one MENTIONED FIRST in the card's text wins; fall back to `order` when a mechanic
  // has no text term (keyword-only / watcher clauses).
  const pos = (m: Mechanic): number => firstMentionIndex(card.text ?? '', m);   // -1 if absent
  return owned.slice().sort((a, b) => {
    const pa = pos(a), pb = pos(b);
    if (pa !== -1 && pb !== -1) return pa - pb;             // both mentioned → text order
    if (pa !== -1) return -1;                               // a mentioned, b not → a first
    if (pb !== -1) return 1;
    return a.order - b.order;                               // neither mentioned → registry order
  })[0].glyph;
}
```

`firstMentionIndex(text, mechanic)` scans the card text for the mechanic's term in **either** its raw or
renamed form (e.g. Shout|Battlecry) via a small per-mechanic term regex on the registry entry — used for
*ordering only*, never detection. Bold markers (`**`) are stripped before scanning.

### `Card.tsx`

Replace the inline block (currently ~L640–650):

```ts
const trigger = triggerPill(card.text);
const mechIcon = trigger?.icon ?? (card.keywords[0] ? KW_ICON[card.keywords[0]] : TRIBE_ICON[card.tribe]);
```

with `const mechIcon = resolveMechIcon(card);` and render the medallion as a blank frame when it is `null`:

```tsx
<span key={…} className={`cgem${…pulse classes…}`} aria-hidden="true">
  {mechIcon && <Icon name={mechIcon} />}
</span>
```

`triggerPill`, `KW_ICON`, and `TRIBE_ICON` are removed from `Card.tsx` (their roles move to the registry, and
`TRIBE_ICON` has no remaining reader here — the tribe line below uses `TRIBE_LABEL`, which stays).

## The mechanic registry (PR 1 contents)

Reusing the glossary's current icons and predicates except where a change is noted. Detection column is the
structural predicate (mirrors MinionBook today unless marked **new/changed**).

| id | term | glyph | detect | change |
|---|---|---|---|---|
| shout | Shout | `battlecry` | `effects.some(e => e.on === 'onPlay')` | — |
| echo | Echo | `echo` | `e.on === 'onDeath'` | — |
| startCombat | Start of Combat | `fist` | `kwMatch('SC')` | — |
| endTurn | End of Turn | `sc` | `e.on === 'endOfTurn'` | — |
| avenge | Avenge | `skull` | `e.on === 'avenge'` | — |
| rally | Rally | `sword` | `kwMatch('RL')` | — |
| slaughter | Slaughter | `slaughter` | `kwMatch('SL')` | — |
| bleed | Bleed | `poison` | `e.do === 'scArmBleed'` | — |
| chooseOne | Choose One | `choose1` | `!!c.chooseOne` | **new to medallion** (glyph exists) |
| taunt | Taunt | `taunt` | `kwMatch('T')` | — |
| ward | Ward | `shield` | `kwMatch('DS')` | — |
| execute | Execute | `execute` | `kwMatch('V')` | — |
| flurry | Flurry | `windfury` | `kwMatch('W')` | — |
| crit | Critical Strike | `target` | `kwMatch('CR')` | — |
| rise | Rise | `rise` | `kwMatch('R')` | — |
| cleave | Cleave | `cleave` | `kwMatch('C')` | — |
| immune | Immune | `immune` | `kwMatch('IMM')` | — |
| attachment | Attachment | `magnetic` | `kwMatch('M')` | — |
| consume | Consume | `consume` | `kwMatch('CN')` | — |
| fodder | Fodder | `fodder` | `kwMatch('FD')` | — |
| discover | Discover | `star` | `effects.some(e => /discover/i.test(e.do))` | — |
| engraved | Engraved | `engrave` | `kwMatch('EG')` | **glyph changed** anvil → new runic |
| stealth | Stealth | `stealth` | `kwMatch('ST')` | **glyph changed** eye → new |
| watcher | Watcher | `eye` | reactive triggers (see below) | **new mechanic** |

**Watcher detection** — reactive effects that fire in response to another minion or effect, distinct from the
card's own trigger. The plan MUST enumerate the exact `on:` (and reactive `do:`) values against the core
effect-trigger union; the confirmed starting set: `onSummon`, an ally-scoped `onAttack`, and the on-ally-event
watchers (on-ally-Shout, `onAllyOrbit`, "whenever an X triggers" reactions such as Karwind/Sylus/Uron). Rally
(`RL`, the minion's *own* attack) is **not** a Watcher — it keeps `sword`.

### New glyphs to author in `Icon.tsx`

- **`engrave`** — a runic symbol (owner: "just look like a runic symbol").
- **`stealth`** — a new glyph for Stealth (proposed: a hood / mask silhouette; final look tuned live with the
  owner).

## Ordering note (the one behaviour to eyeball)

Most minions have exactly one detected mechanic, so ordering never runs. Where it does, the first term in the
text wins — e.g. `b2_armadiyo` ("**Taunt. Echo:** …") → Taunt (position 0), matching today. The `order` field
handles the rare case where two owned mechanics have no text term (a keyword-only card that is also a watcher):
the plan sets `order` so the more identity-defining mechanic wins. This is worth a live eyeball pass, not a
correctness risk.

## Testing

- **Unit (`mechIcon.test.ts`)** — `resolveMechIcon` over representative cards:
  - real Shout (`onPlay`) → `battlecry`; watcher (`onSummon`, Den Mother) → `eye`; reactive payoff (Karwind) →
    `eye`, **not** `battlecry`.
  - vanilla token (no effects, Pup) → `null`.
  - keyword-only, empty text (Guardian Drake `DS`) → `shield`.
  - multi-mechanic ordering (`b2_armadiyo` Taunt+Echo) → `taunt` (first mentioned).
  - Choose One card → `choose1`; Engraved card → `engrave`; Stealth card → `stealth`.
- **No-tribe invariant** — a data test asserting that for every minion in `ALL_CARDS`, `resolveMechIcon`
  returns either `null` or a glyph that belongs to a `MECHANICS` entry. Since the resolver no longer reads the
  tribe at all, the tribe-only glyphs `paw`/`flame`/`gear`/`crown`/`clock` (and `anvil`, now that Engraved uses
  `engrave`) must never appear. `eye` and `star` are allowed only because a mechanic (Watcher, Discover) owns
  them — the test checks membership in the registry, which is exactly that guarantee.
- **Registry-shared-with-glossary** — a test that every `MinionBook` glossary row is backed by a `MECHANICS`
  entry (no hand-authored glossary rows that could drift).
- **Gates:** `npm run typecheck && npm run lint && npm test && npm run build:web` all green (worktree needs its
  own `npm install` first — CLAUDE.md).
- **Live check:** in the running app, confirm the medallion on a spread of minions — a Shout, a watcher, a
  Choose One, an Engraved, a vanilla token (blank badge), a Stealth — reads correctly in shop and combat, and
  that no card shows a tribe symbol. Author the two new glyphs (`engrave`, `stealth`) live with the owner.

## Out of scope (follow-up PRs)

- New glyphs / mechanics: **Orbit** (Celestial), **Start of Turn**, **Improve**, **Rush** ("attacks
  immediately when summoned"), **Ascend**, **spend-Gold** triggers.
- Content re-tagging: Engraved cards that read "Engraved" in text but lack the `EG` keyword (Tara, Taragosa,
  Flowing Monk) — they will show `null`/Watcher until tagged; a `@game/content` change, not this PR.
- Ruby: **not** a medallion mechanic (owner ruling — Ruby cards carry their own Shout/Avenge/etc.).

## Files touched (anticipated)

- `packages/ui/src/mechanics.ts` — **new**: the registry + shared predicates.
- `packages/ui/src/mechIcon.ts` — **new**: `resolveMechIcon` + `firstMentionIndex`.
- `packages/ui/src/mechIcon.test.ts` — **new**.
- `packages/ui/src/Icon.tsx` — **new glyphs** `engrave`, `stealth`.
- `packages/ui/src/Card.tsx` — use `resolveMechIcon`; blank-badge render; drop `triggerPill`/`KW_ICON`/`TRIBE_ICON`.
- `packages/ui/src/MinionBook.tsx` — rebuild `GLOSSARY` from `MECHANICS`.
- `docs/devlog.md`, `docs/roadmap.md`, `README.md` — history + queue + front page.
