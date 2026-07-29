# FX bindings as data — design

**Date:** 2026-07-27
**Status:** approved (owner, 2026-07-27)
**Phase:** ① of three. ② is the proc harness (stage a combat where a chosen card's effect fires and replay it
on demand); ③ is the live authoring panel that ties ① and ② together behind a "commit animation" button.

## The problem

"Which authored effect plays here?" is currently answered in two places, in two shapes, with no override
layer on either.

- **Kind-level:** a `def` string carried on an `fxDef` cue inside `SCORE_DEFAULTS` (`choreo/score.ts`).
  A kind can only play a def if someone remembered to give that kind an `fxDef` cue.
- **Card-level:** `CARD_FX[cardId][kind]` in `choreo/cardFx.ts` — a frozen constant with no runtime
  override path at all.

Both are compiled-in literals, so changing what a card plays means editing TypeScript and reloading. That is
the blocker for the "click a card, retarget its effect, commit" loop ③ is meant to deliver.

There is also a latent duplication: each side carries its own `fanOut` union — `Cue.fanOut` is
`'selfBuffed'`, `CardFxBinding.fanOut` is `'primary' | 'damaged'` — two names for one question, *which anchor
pairs does this def play at?*

A third fact shaped the design: `score.ts` already has a kind-level override mechanism (`setCue`,
`resetScore`, `scoreJson`, localStorage-persisted) whose only consumer is its own tests. The layering
machinery exists; nothing drives it, and it can't express a card-level binding at all.

## Approach

**One bindings module owns the answer** (chosen over "add a file loader to each of the two modules" and
"let each def declare its own bindings"). A single `choreo/bindings.ts` is the authority: it statically
imports `bindings.json`, layers a localStorage session patch on top, and answers one question for the cue
runner, the library browser, and later the commit button.

The rejected options, briefly:

- *Two modules, each gains a file loader.* Smaller diff, but "what plays" stays split across two resolution
  orders — and that split is what produced the bug where the fan-out searched the cast's moment while the
  damage lived in its own. Rebuilding the shape that caused it is the wrong trade.
- *Each def declares its own bindings* (`"bindsTo": {...}` inside `ruby-lance.json`). Self-describing and
  commit writes exactly one file, but it inverts the relationship: two defs can both claim `scCast` with
  nothing arbitrating, "what is bound to this kind" becomes a scan of every def, and unbinding means editing
  a def you may not otherwise be touching.

## 1. Data model

One file, one binding type.

```jsonc
// packages/ui/src/choreo/bindings.json
{
  "version": 1,
  "kinds": {
    "scCast":         { "def": "spell-cast" },
    "shieldGain":     { "def": "ward-gained" },
    "venomSpent":     { "def": "venom-spent" },
    "rally":          { "def": "rally-link" },
    "toHand":         { "def": "to-hand" },
    "keyword":        { "def": "keyword-gain" },
    "keywordLost":    { "def": "keyword-lost" },
    "hpGrant":        { "def": "hp-grant" },
    "spellProgress":  { "def": "spell-progress" },
    "reveal":         { "def": "stealth-break" },
    "questTrigger":   { "def": "quest-trigger" },
    "questComplete":  { "def": "quest-complete" },
    "attackExchange": { "def": "self-buff-gold", "fanOut": "selfBuffed" },
    "buffWave":       { "def": "self-buff-gold", "fanOut": "selfBuffed" }
  },
  "cards": {
    "bloodbinder": { "scCast": { "def": "ruby-lance", "fanOut": "damaged" } }
  }
}
```

```ts
export interface FxBinding {
  def: string;
  fanOut?: 'primary' | 'damaged' | 'selfBuffed';
}
```

The two `fanOut` unions merge into this one. `'primary'` (the default) plays once at the moment's own
source/target pair; `'damaged'` plays once per distinct unit damaged in the same resolution step;
`'selfBuffed'` plays once per unit that buffed itself in the moment.

**One binding per `kind` and per `(card, kind)`.** Not a new limit: `overrides` in `score.ts` is keyed by
*channel* within a kind, so a second `fxDef` cue on one kind could never have been overridden
independently anyway.

**Timing does not move.** `at` / `offset` / `scaled` / `enabled` stay on the cue in `score.ts`. The file owns
*what plays*; code owns *when*. This is the owner's explicit ruling and the reason the file stays small
enough to review as a diff.

## 2. Resolution

`choreo/bindings.ts` exports:

```ts
export function bindingFor(cardId: string | null, kind: MomentKind): FxBinding | null;
```

Resolution order: the card layer first (a card with its own look beats the kind's generic one), then the
kind layer. Within each layer, the file baseline with the localStorage session patch merged on top.

`cardFx.ts` keeps `damagedUidsIn` and the claim machinery (`claimDamageFx` / `isDamageFxClaimed` /
`expireDamageFxClaim` / `resetDamageFxClaims`) — that is fan-out *mechanics*, not binding *data* — and loses
`CARD_FX`, `CardFxBinding`, and `cardFxFor`. `score.ts`'s runner calls `bindingFor` in both places it
currently calls `cardFxFor` (the synchronous claim, and the deferred play).

### The cue collapse

Today a kind can only play a def if its `SCORE_DEFAULTS` row happens to contain an `fxDef` cue. Bind
`damage` in the file and nothing happens, because `damage` has no such cue — another silent-nothing of
exactly the class this work exists to remove.

So **`fxDef` moves into `BASE`**, at `start`, offset 0, and every per-kind `def:` literal disappears from
`SCORE_DEFAULTS`. The cue becomes a pure timing row present on every kind, inert until a binding exists.
Net effect on that file: ~14 cue literals get shorter, one line joins `BASE`.

This makes *adding a binding sufficient* to make an effect play — which is precisely what ③'s commit button
needs to be a one-request operation.

The `canPlayDefs()` production guard stays exactly where it is: the `fxDef` branch checks it before
scheduling anything, so a `BASE` row on every kind costs production two property reads per moment and
allocates nothing.

## 3. Session overrides and commit

The same two-tier shape defs already have (session autosave vs. Save), so there is one mental model for both.

**Session — instant.** A sparse patch held in memory, mirrored to `localStorage` under `ascent.fxBindings`:

```ts
setBinding(cardId: string | null, kind: MomentKind, binding: FxBinding | null): void;
resetBindings(): void;    // drop the session patch, back to the file baseline
bindingsJson(): string;   // the merged file + patch, ready to commit
```

`setBinding` takes the same `(cardId, kind)` key `bindingFor` reads, so the write and the read cannot
disagree about what a scope is: a `cardId` of `null` addresses the kind layer, a string addresses that
card's layer.

`null` unbinds. An explicit tombstone is required rather than an absent key: against a file baseline,
"absent" means *inherit*, so there would otherwise be no way to say "this card should play **nothing** here"
as a live change.

**Commit — durable.** A fourth dev endpoint, `POST /__fx/bindings`, writes the merged JSON to
`packages/ui/src/choreo/bindings.json` and clears the session patch.

Two properties make this a *smaller* surface than the existing def endpoint, not a bigger one:

- **The path is fixed by the plugin, never derived from the request.** The client supplies content only, so
  the traversal question `planWrite` exists to answer does not arise. It gets its own pure
  `planBindingsWrite(body, file)` — shape check, size cap, def ids re-checked against `SLUG_RE`,
  re-serialized rather than echoed so what lands on disk is stably formatted — tested without a server or a
  filesystem, exactly like `planWrite`.
- **No watcher needed.** `bindings.json` is a *static* import, so a write invalidates through the normal
  import graph and HMR picks it up. The `import.meta.glob` staleness that forced the defs-directory watcher
  does not apply to a statically imported file.

## 4. Failure handling

Because `bindings.json` is a static import, **a missing or syntactically invalid file is a build failure**,
not a runtime silent-nothing. That removes the failure mode flagged during design ("if the file is missing,
no authored FX play"). The only runtime failure left is *parseable but structurally wrong*.

`bindings.ts` validates at module load and is loud **per entry**, not all-or-nothing: a bad entry is dropped
with a `console.error` naming the exact key and the reason, and every other entry still loads. Losing one
binding should not cost the other thirteen.

### Tests

1. **Every bound def id resolves to a real def.** The dangling-reference class — the one that presents as
   "the effect just doesn't play." All 14 currently-bound ids exist on disk, so this goes in green.
2. **Every `kinds` key is a real `MomentKind`; every `cards` key is a real card id in `CARD_INDEX`.** A
   typo'd key is otherwise a permanently silent binding.
3. **Round-trip:** `bindingsJson()` after a `setBinding` parses back, validates, and yields the same
   resolution — so what commit writes is what the session was playing.

### The visible half

The library browser already renders "unbound" gaps. It now reads them from the single resolver instead of
reconciling `getScore()` against `CARD_FX` itself, and a binding pointing at a missing def shows red rather
than looking normal. Making failure *visible* is the recurring lesson of this subsystem: nearly every bug in
it so far has presented identically to "not wired yet."

## Scope

**In:** the data model, `bindings.ts` and its resolution, the `score.ts` / `cardFx.ts` migration, the
`BASE` cue collapse, the session-patch API, the `/__fx/bindings` endpoint and its pure planner, the three
tests, and the library browser reading through the new resolver.

**Out:** any new authoring UI. Clicking a card to rebind it belongs to ③, once ② can stage a combat to see
the change in. ① makes the write path exist and correct; ③ puts a button on it.

**Not touched:** cue timing (`at`/`offset`/`scaled`/`enabled`), the fan-out mechanics in `cardFx.ts`, the
def format, the def/art endpoints, `canPlayDefs()`.
