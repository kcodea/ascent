# Pack Opening: the tactile 5-card opening (design)

Date: 2026-11-23 · Owner: Mike · Status: draft for owner review

## 1. Intent

ASCENT is moving from **chest opening** to **pack opening**. A chest gave one cosmetic. A pack gives **five**, and opening
it should feel physical: you **tear the top off a foil pack with your own hand, pull the sleeve down off the cards, the
stack comes toward you, and you flip the cards one at a time.** The owner's words: "a very tactile feeling experience
where we are legitimately ripping open a pack of cards to reveal the deck."

The whole overhaul is two projects that meet at one boundary (owner agreed 2026-11-23):

1. **This doc: the opening experience.** Presentation only. It takes a finished 5-card result and plays it.
2. **Later: the pack economy.** Pack types, the 5-card roll, duplicates, prices, removing focus, and what happens to the
   chests players already own. That is server/SQL work with open decisions, brainstormed as its own project (section 12
   lists what it must settle). This doc only fixes the **result shape** it must hand the opening (section 5).

## 2. Goals, non-goals, anti-goals

**Goals**
- The tear and the sleeve pull feel like your hand is doing it: you hold the foil's loose **edge** (not the bend), the
  foil hangs and bends between your hand and the tear, it resists, it catches, it rips free with momentum.
- Five cards revealed one click at a time, each card back telling you its rarity before you flip it (anticipation).
- Every cosmetic category gets a proper face from day one: art where the chest reveal has art today, an emblem + name
  for the rest (section 6).
- Snappy at all times (CLAUDE.md "Performance is the north star"): no hitch at the rip, the sleeve drop, the zoom or a flip.
- Tunable by the owner live, like the card plate editor, starting from the values he already tuned (section 7).

**Non-goals (this project)**
- No pack economy: no server roll, no prices, no pack shelf, no duplicate rules, no migration of owned chests.
- Players do not see packs yet. The experience ships behind the dev **Pack Lab** (section 9) and plugs into the
  Collection and the shop when the economy lands.
- No new rarity rules, odds display or pack art pipeline beyond placeholders + the hooks for real art.

**Anti-goals (a failure even if it works)**
- Feeling like a canned animation you watch: the tear and the sleeve are **driven by the drag**, never a timeline the
  drag merely starts.
- Holding the bend instead of the edge (owner rejected this in the prototype, 2026-11-23).
- Tearing when you pull the wrong way (owner bug report, fixed in the prototype: only a pull along the tear line opens it).
- A hitch or frame drop anywhere in the sequence.
- Breaking or changing today's chest opening before the economy replaces it.

## 3. The sequence (owner-approved in the mockup + prototype)

| Stage | What the player does | What happens |
|---|---|---|
| **Sealed** | Sees the pack (art per pack type), a "pinch here" cue at the top-left corner of the tear strip. | Idle shimmer (opacity-only loop). |
| **Tear** | Presses on the top-left corner and drags. | The corner sticks, stretches a few px, then **pops** loose. From then on the pinched corner stays under the cursor; the peeled foil hangs as a curve from the tear to the hand. Pulling it taut **along the tear line** (rightward, a little upward allowed) advances the tear; pulling back the other way only goes taut and holds. Letting go: the flap stands up and sags; grab the loose edge again to continue. At the right edge the strip rips free and flies off with the hand's velocity, spinning and fading. |
| **Sleeve** | Live **the instant the strip rips free** (owner 2026-11-23: transition faster). Grabs the pack body and pulls down. | The sleeve grips the cards (stretches with the pull, drags the cards down a few px), then breaks free with a snap; the cards settle back with a bounce. While sliding: the pack pinches in at the fingers, the rim trails as it rubs the cards, a slide hiss follows speed. Released early, it slides back up. Pulled past the let-go distance (or flicked down, or dragged past the stack's bottom), it drops away with the throw's speed, tips and fades. |
| **Zoom** | — | The 5-card stack springs toward the camera (scale + recentre, small overshoot). |
| **Reveal** | Clicks the top card, one at a time. | The top card's **back shows its rarity** (colour + gem count; Legendary and Ancient backs pulse). On click it flips off to the right and lands large ("featured"); the previous featured card tucks into a tray below. A duplicate shows its item, then a **DUPLICATE** stamp and the Aether it dismantles into. The **guaranteed card is always the last flip**, with a "Guaranteed <rarity>+" ribbon on its back, and gets the biggest flip. |
| **Summary** | — | All five line up in a row with the total Aether from duplicates. Buttons: **Open next** (if more packs are queued) and **Done**. |

Reference builds (open in a browser; the prototype loads Pixi from `/files/pixi.min.js`, so copy
`node_modules/pixi.js/dist/pixi.min.js` beside it or change the script tag):
- `docs/superpowers/specs/2026-11-23-pack-opening-flow-mockup.html`: the whole sequence in CSS (flow and layout only).
- `docs/superpowers/specs/2026-11-23-pack-opening-prototype.html`: the **real technique** for the tear and the sleeve
  in Pixi v8, with the owner's tuned values as defaults. The production code is a port of this, not a reinvention.

## 4. Approach (owner picked A, 2026-11-23)

- **A. Pixi for the physical parts, the game's existing reward art for the faces. (Chosen.)** The pack, the tear, the
  sleeve, the stack, the card backs and the **first half of each flip** are one Pixi scene. At the instant a card is
  edge-on (90°), a DOM card face mounts at that card's exact on-screen rect and finishes the flip (90° → 0°) and the move
  to its slot. Faces reuse what the chest opener already draws per category, so every category works on day one and
  new categories come free. Cost: the edge-on handoff must be pixel-matched.
- B. Everything in Pixi. Smoothest single scene, but every category's preview (titles, announcers, music, attacks…)
  rebuilt in Pixi and drifting from the Collection's look. Rejected.
- C. DOM/CSS for everything, Pixi only for the curl. Cheapest, but the sleeve, zoom and flip lose the physical feel that
  is the point. Rejected.

## 5. The contract: what the opening plays

The opening never computes a reward. It is handed one result per pack:

```ts
/** One opened pack, as the opening plays it. Order = flip order; the guaranteed card is LAST. */
interface PackOpenResult {
  packId: string;               // the owned pack that was opened (idempotency is the server's job)
  pack: PackLook;               // which art/name/colour to show (see below)
  cards: readonly PackCard[];   // exactly 5 when the economy ships; the opening must not assume more than 1..5
  aether?: number;              // the player's balance after any duplicate refunds, if the server reports it
}
interface PackCard {
  rewardId: string;             // a cosmetic id (cosmeticOf). Unknown ids show the "update the game" face (as rewardLabel does today)
  rarity: CrateRarity;          // drives the card back; the server's word, not re-derived from the catalog
  guaranteed: boolean;          // exactly one card per pack; it is the last in `cards`
  duplicate: { aether: number } | null;  // null = new to the player; otherwise the Aether it dismantled into
}
interface PackLook { kind: 'rarity' | 'category' | 'themed'; id: string; name: string; guaranteedFloor: CrateRarity }
```

- **Where it lives:** the types + a strict parser (`parsePackOpenResult`, null on anything malformed, like
  `parseBuyCrateResult`) go in `@game/progression` (new `packs.ts`), because the economy project's server answers in
  this shape. Builder's call on the exact file names.
- **The opening asks for the result through an injected `open(packId) => Promise<PackOpenOutcome>`**, like
  `CrateOpener`'s `open` prop today. The Pack Lab passes a local fake; the economy project passes the server call.
- **When it asks:** at the **pop** (the moment the seal gives), not at the first press, so a press-and-cancel never
  spends a pack. The tear + sleeve take seconds, which hides the request. The result is needed at the **zoom** (card
  backs show rarity). If it has not arrived: the stack holds at the zoom with a "Still opening" note (as the chest's
  anticipation does today). If it fails: the stack slides back into a fresh sleeve, the pack is sealed again, "Could not
  open the pack. Try again." Nothing is consumed on a failure (the server guarantees that; the UI must not claim more).
- **A failure that arrives mid-tear or mid-sleeve** stops input at once: the note shows, and the scene resets to the
  sealed pack with a short fade (no rewind animation). The player never finishes a tear they know failed. *(My call.)*
- **Card backs before the result:** every back starts as the plain pack-brand back. The top card's back takes its rarity
  look the moment the result arrives (normally mid-tear, before the cards are visible), with a short opacity shimmer if
  the cards are already showing. Only the top card's back is ever visible in the stack, so nothing below gives a rarity
  away early. *(My call.)*
- **Leaving mid-opening:** before the pop, closing leaves the pack sealed (nothing was asked). After the pop the pack is
  spent: closing jumps straight to the summary of all five cards, so a reward is never lost unseen. *(My call.)*

## 6. Architecture

New, beside the chest opener (the chest opener stays untouched until the economy project retires it):

```
packages/ui/src/progression/packOpening/
  PackOpener.tsx        React shell: portal into stageHost(), phases, buttons, DOM card faces, summary, a11y
  packScene.ts          the Pixi scene: pack, tear strip mesh, sleeve mesh, stack, card backs, flip first half
  peelModel.ts          PURE math: the hanging-foil curve, tear advance (direction-aware), keep-in-reach, sleeve
                        grip/slide/drop state. No Pixi, no DOM: unit-tested.
  packFxConfig.ts       every feel number (section 7), owner defaults, persisted overrides for the Pack Lab
  packSounds.ts         the sound layer (section 8)
  packFaces.tsx         the DOM card face per category (reuses the shared reward preview, below)
  packOpening.css
```

- **Shared reward preview.** `CrateOpener.tsx` computes a reward's label, category kind and preview art inline
  (`rewardLabel`, the `skinKind` / `skinUrl` block). Lift that into one shared helper both openers call, so a new
  category's preview is added once. This is the one refactor this project makes outside its folder; it must not change
  how the chest opener looks.
- **Card faces by category** (owner 2026-11-23, "Icon + name"): hero skin, minion skin, emote, card plate and portrait
  frame show their art (the chest's subset). Title, announcer, music, hero attack and board show a **category emblem**
  in the art area (reuse the game's existing category icons where they exist, else a simple drawn emblem) with the name
  and rarity. No animation or audio plays on a face. Every face shares one layout: category label, art area, name,
  rarity, NEW or DUPLICATE + Aether.
- **One Pixi Application** per opening, created on mount, destroyed on close (as `crateFx` does). The ticker stops when
  nothing moves (settled summary) and restarts on input.
- **Stage rules (CLAUDE.md):** portal into `stageHost()`. Pixi works in screen space (pointer `clientX/Y`, canvas rects
  raw). When the DOM face takes over a card, its rect is measured in screen space and converted with `rectToStage` only
  where it becomes a CSS length. No raw `vw/vh`. No `title=`. No bare `cursor: pointer` (the gauntlet cursor; the pinch
  and grab cursors use the gauntlet URL form or the global rule).
- **Touch:** pointer events throughout, so a finger drag tears and pulls exactly like the mouse. Touch-only styling, if
  any, goes in `touchUi.css` under `html[data-touch-ui]`; desktop stays pixel-identical.

### The flip handoff (the one fiddly part)
1. Pixi rotates the card back from 0° to 90° about its vertical axis with real perspective (a `PerspectiveMesh` or the
   strip's own per-vertex projection; builder's choice), while translating toward its featured slot.
2. At 90° the Pixi card hides and a DOM face mounts at the same screen rect, at `rotateY(90deg)` with the same
   perspective, and continues 90° → 0° plus the remaining translate/scale to the featured slot, in CSS (transform only).
3. Tray and summary moves are DOM transforms. Card backs still in the stack stay in Pixi.
Acceptance: no visible pop, size jump or position jump at the handoff at 1× and in slow-mo, at the stage's 1920×1080 and
at a scaled-down window.

## 7. Feel tuning: the owner's values are the starting defaults

From the prototype (owner, 2026-11-23: "i like these settings for now"). Names are the prototype's knobs; the port keeps
them as `packFxConfig` fields and the Pack Lab shows the same sliders.

| Knob | Value | | Knob | Value |
|---|---|---|---|---|
| Peel-off angle at the tear | 0.4 rad | | Sleeve: grip before it slides | 80 px |
| Edge toward camera | 139 | | Sleeve: follows hand | 0.36 |
| Slack before it tears | 0.92 | | Sleeve: rim drags on cards | 1.0 |
| Edge follows hand | 0.1 | | Sleeve: finger pinch | 0.08 |
| Max tear speed | 18 px/frame | | Sleeve: pull to let go | 295 px |
| Fibre catch (stutter) | 0.7 | | Stack zoom | +0.3 scale |
| Pinch twist | 0.65 | | Tears when pulled straight up | 0.15 |
| Highlight | 0.65 | | Volume | 0.45 |
| Perspective | 1780 | | | |

Pixel values are at the prototype's pack size (300 × 476). The port scales them with the pack's on-stage size so the feel
survives a different pack size. Frame-based rates become dt-scaled (the prototype already multiplies by Pixi's
`deltaTime`); keep that so 60 Hz and 144 Hz feel the same.

## 8. Sound

Every stage has a speed-driven or one-shot cue (the prototype synthesises them from noise, live):
seal pop · tearing crinkle loop (volume and pitch follow tear speed) · fibre crackles (rate follows speed) · final rip ·
sleeve grip release · sleeve slide hiss loop (follows speed) · sleeve drop thump · stack whoosh · card flip (per rarity,
biggest on the guaranteed card) · duplicate stamp · Aether chime · summary.

**v1 ships the prototype's synthesised cues** (Web Audio, routed through the game's master volume / mute settings) so the
experience is complete without waiting on assets; each cue is a named slot that a recorded clip from the sfx pipeline
replaces later with no code change beyond the mapping. Card flip / stamp / chime / summary have no prototype version:
use existing game sfx where one fits (the chest's reveal cues), else a synthesised placeholder. *(Builder's call which
existing cues; the owner swaps clips later.)*

## 9. The Pack Lab (dev only)

A DevMenu panel in the standard draggable frame (`useDraggablePanel`), like the Card Plate Editor:
- All section 7 sliders, live, persisted to localStorage, with "Reset to defaults".
- Sample packs: a pack-type picker (rarity / category / themed placeholders) and preset results: all new; mixed with
  duplicates; a Legendary and an Ancient guaranteed card; one card of **every cosmetic category** (to check every face);
  an unknown reward id; a slow answer (5 s); a failed answer.
- Open, Reset, Slow-mo (0.25×).
This is how the owner tunes and reviews the experience until the economy wires it to real packs.

## 10. Reduced motion, skip, accessibility

- **Reduced motion** (`prefersReducedMotion()`, as the chest opener): no Pixi scene. The pack shows sealed with an
  **Open** button; pressing it fades the pack away to the five card backs in a row; clicking each flips with a simple
  fade/crossfade; summary as normal. Same result, same order, same duplicate handling.
- **Keyboard:** Enter/Space on the sealed pack performs an automatic tear and sleeve (the same scene, driven by a short
  scripted drag) so the experience is reachable without a pointer; Enter/Space flips the next card. *(My call.)*
- **Quick open** (owner 2026-11-23): the sealed pack always offers a **"Quick open"** button beside the pinch cue. It
  runs the same scene through a scripted drag (the tear, then the sleeve) in about a second, so a player opening many
  packs chooses per pack. Tactile is the default; nothing auto-plays on its own. The keyboard path above is this same
  scripted drag.
- **Reveal all:** a quiet button appears once the stack has zoomed; it flips the remaining cards in quick succession and
  goes to the summary. Clicking the scene never skips the tear or sleeve (the click IS the interaction).
- Screen readers: the dialog is labelled "Opening a pack"; each revealed card announces "<name>, <rarity>, new" or
  "<name>, <rarity>, duplicate, +N Aether" via a status region.

## 11. Performance budget (non-negotiable)

- Per frame during the tear: one strip mesh (≈60×8 quads, per-triangle vertices so a face can be hidden) rebuilt in place
  (no allocation per frame), four meshes sharing it, a few particles. No `getBoundingClientRect` per frame: rects are
  cached at drag start (the `insertRectsRef` pattern).
- The sleeve is a `MeshPlane` (≈12×20) deformed in place.
- DOM: card faces animate `transform` / `opacity` only. Breathing glows on Legendary/Ancient backs are opacity loops on
  a static shadow (the `kwglow` pattern). No looping paint-property animation.
- Art: the pack and card-back textures for the queued packs are preloaded when the theatre mounts; card-face art for a
  result is decoded (`decoding="sync"` on every `<img>`, and warmed before the flip) as soon as the result arrives,
  so the handoff never shows a blank face.
- Verify on the **prod build** (`npm run build:web` + preview), with a Chrome performance capture of one full opening:
  no long task over 50 ms and no dropped-frame run during tear, rip, drop, zoom or a flip. Report the capture.

## 12. Left to the economy project (not decided here)

Pack lineup and names (Rarity packs Standard→Ancient, a pack per cosmetic category, themed packs like Plushie Beasts),
the 4 + 1 guaranteed roll and its odds, duplicate Aether values per rarity, pack prices, removing category focus,
what happens to sealed chests players already own and to the Welcome / milestone rewards, where packs are bought and
held (Collection, shop), "Open all" for several packs, the SQL + Edge Function changes and their parity tests, the odds
display, and the player-facing patch notes. When that project lands, it wires `PackOpener` into the Collection and the
shop and retires `CrateOpener`.

### Owner rulings on what a pack holds (2026-11-27, for the economy project's roll)

- **Rarity packs.** Cards 1–4 roll at Common-pack rarity odds; card 5 is the pack's rarity. Each card's rarity is drawn
  first, then its category, every category at equal odds ("When that rarity is determined or drawn, then from there, any
  category has equal odds of showing up"). Any card may be a duplicate of what the player owns (duplicates pay Aether).
- **Category packs (style packs count as category packs).** Cards 1–4 come "from whole catalog": Common-pack rarity odds,
  any category, duplicates allowed. Card 5 must be from the pack's own category and must not be a duplicate of what the
  player owns.
- **Owning the whole category.** When the player already owns every cosmetic a category pack can give, the shop lightly
  greys the pack and shows "You own every cosmetic from this pack. You may continue purchasing more of the "<pack
  name>" at your own discretion." The pack stays buyable; its card 5 is then necessarily a duplicate (Aether). Built on
  the shop side (`ownsEveryCosmetic` / `ownedEveryNotice` in `packages/progression/src/packShop.ts`); the quote marks
  around the name are pending the owner's call.

## 13. Testing

- `peelModel.ts`: unit tests for the owner's two rulings: the tear never advances on a pull away from the tear line;
  the held edge stays within the peeled length of the tear. Plus: the sleeve does not move before the grip distance;
  an early release returns it; the drop fires past the let-go distance and past the stack's bottom.
- The result parser: strict (5 cards max, exactly one guaranteed and it is last, duplicate shape), with fixtures.
- `PackOpener`: the reduced-motion path end to end in jsdom (open → five flips → summary, duplicates announced, Aether
  total); request timing (asked at the pop, not at the press); slow and failed answers.
- The shared reward-preview helper: the chest opener's existing tests stay green and unchanged.
- Visual feel is verified by the owner in the Pack Lab (memory: don't drive the game to verify; the owner eyeballs it).

## 14. Rollout

1. PR(s) for this project ship the Pack Lab + `PackOpener` + the shared preview refactor. Players see no change. No patch
   notes entry (no player-facing change yet).
2. The economy project wires it in for players, with its patch notes.

**The pack reward (owner 2026-11-27, replaces the "Legendary guaranteed within N packs" pity gauge):** "Every 15 packs
purchased gives the player one free Legendary Rarity Pack. it should glow and say 'Click to receive your reward' and when
the player clicks it, it sparks and a legendary pack is sent to their counter. if it cant fit, send to their backpack."
Rule: `PACK_REWARD_EVERY = 15` / `packRewardAfter` in `packages/progression/src/packShop.ts`. Every pack in a paid
purchase counts (a box counts each pack); free packs and the reward itself do not. Unclaimed rewards stack (`ready`) and
are claimed one per click. With no room on the counter the pack waits beside it with the other packs waiting for space
(our reading of "backpack": there is no separate backpack yet). The real server must own the count and the claim.
