# The Pack Shop: design

**Status:** concept approved by the owner 2026-11-25 ("Yes, write it up"). Four product choices were put to him and not
answered; each is settled below as **my call** and listed in section 13 for him to overrule.

**Builds on:** the pack opening (`docs/superpowers/specs/2026-11-23-pack-opening-design.md`, PR kcodea/ascent#2865).
The shop ends where the opening starts: a pack played from the hand hands off to `PackOpener`.

## 1. Intent

The owner's ask: "we need to create the shop experience. i want this to be extremely fun and exciting, like you are
shopping through a card shop sort of. and buying packs should emulate the shop experience in game, where you drag a pack
to hand, and then play it from hand to initiate the open experience."

He rated his own wireframe (a tab row, one pack between two arrows) 5/10 and asked for a 9/10. The wireframe is a menu:
one item in view, nothing to browse, no reason to want a pack before paying, and the hand is not on screen. The 9/10
version is a **place**: a lit shelf you browse with your hands, where paying is a physical act and the hand is always
in view.

## 2. Goals, non-goals, anti-goals

**Goals**
- Browsing feels like standing at a card shop counter: several packs in view, each one a physical object that reacts.
- Buying is the in-game shop's gesture: drag a pack to your hand. Opening is the in-game play gesture: drag it from
  your hand to the middle.
- Paying is a visible, deliberate moment, never a hidden side effect.
- Every pack on the shelf gives a reason to want it before it is bought.
- The shop and the opening are one continuous stage: same light, same foil, same sounds, no cut between them.

**Non-goals (this project)**
- The pack economy. No pack lineup, prices, odds, server roll, ownership storage or guest rules are decided here. They
  belong to the economy project (pack-opening spec, section 12), exactly as for the opening.
- Changing today's Chest Shop (`CrateShop.tsx`). It keeps working untouched until the economy project replaces it.
- A shopkeeper character or voice lines (section 13, call 4).

**Anti-goals**
- A purchase the player did not mean to make.
- A shop that is slower to use than a button for someone who just wants to buy five packs.
- Any hitch while dragging. Drag stutter is a defect (CLAUDE.md, performance).

## 3. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| A | **The owner's carousel, polished.** One pack, arrows, a Buy button, then the hand. | Cheapest. Still a menu: nothing to browse, buying is a button. About 6/10. |
| B | **The card counter** (chosen). A shelf of packs, a counter line, the hand, the pedestal. | More to build (a shelf scene, a drag across two zones, a hand). It is the only one where browsing, buying and opening are all things you do with the pack itself. |
| C | **A machine** (vending or claw). Pay, a pack drops out. | Fun once, but the machine owns the action, not the player, and it has no answer to "drag a pack to hand". |

B was picked with the owner. It keeps his two gestures (to hand, from hand) and adds what the wireframe lacked: a full
shelf, a paying moment, and a reason to want each pack.

## 4. The experience

One stage, three zones, top to bottom (the owner's 1920 x 1080 stage; everything scales with it):

```
[ shelf tabs ........................................ ]   [ Aether wallet ]
  pack   pack        FEATURED (on the pedestal)        pack   pack        <- the shelf
- - - - - - - - - - - - - - the counter line - - - - - - - - - - - - - -
                    [ your hand: owned packs, fanned ]
```

### 4.1 The shelf
- The opening's stage (`STAGE_FRAG`: dark, spot-lit, drifting dust) with a shelf across the upper half. Five packs are in
  view: two each side and one featured pack on a pedestal in the centre, larger and under the spotlight.
- **Tabs are shelves.** Choosing a tab slides the rack sideways; the packs sway as it stops and settle. Within a shelf
  with more than five packs, the rack scrolls by drag, wheel or the arrow keys, and the pack nearest the centre takes
  the pedestal. (The owner's two arrows stay as the buttons for this.)
- A pack at rest breathes slightly and catches the light, as the sealed pack does in the opening.

### 4.2 Looking at a pack
- Hover: the pack lifts off the shelf, grows a little, and tilts toward the pointer with the opening's foil sheen and holo
  (`packTilt`, the masked sheen and gloss). Its neighbours lean away a touch.
- A tag appears beside it with three things: the **price**, the **guaranteed rarity**, and **how many items in it the
  player does not own yet** ("14 of 40 new to you"). The third number is the reason to want the pack. A pack with
  nothing new says so plainly.
- Clicking the tag (or pressing Enter on a focused pack) opens the odds, as the Chest Shop publishes them today.

### 4.3 Picking it up
- Press and hold: the pack comes off the shelf into the grip with the opening's crinkle and squeeze. It follows the
  pointer with the in-game drag feel (`dragFeel.ts`), its price tag hanging from it and swinging with the motion.
- Its place on the shelf shows a faint outline, so it is clear where it came from.
- **Shake to listen:** shake a held pack quickly and the cards inside rattle (`fx/pack-cards`). It tells the player
  nothing; it is a toy.

### 4.4 Buying is crossing the counter
- A line across the stage separates the shelf from the hand. While a pack is held, the line lights and shows the price.
- **Carry the pack across the line and release it over the hand: it is bought.** Aether streams out of the wallet into
  the pack (the duplicate dissolve's dust, `packAether.ts`, reversed), the wallet counter rolls down (the `AetherTally`
  odometer), a till rings, and the pack drops into the hand with weight.
- **Release above the line: nothing is spent.** The pack flies back to its place.
- **Cannot afford it:** the line stays dark and shows how much is missing; below the line the pack pulls back like a
  rubber band and returns to the shelf on release; the wallet pulses once.
- **No confirm box** (section 13, call 2). The line is the confirmation: it is lit, it shows the price, and crossing it
  back before releasing cancels.
- The Aether is shown leaving only after the server confirms the purchase; until then the pack hangs at the hand with a
  short "buying" shimmer. A refused or failed purchase sends it back to the shelf with the reason in one line.

### 4.5 The hand
- Owned, unopened packs fan out along the bottom like cards in the in-game hand: hover lifts one, the rest make room.
- Packs earned outside the shop (achievements, gifts, milestones) are here too. The shop is also where packs are opened.
- More than about seven packs stack into a counted pile at the fan's end ("+12"); dragging from the pile takes one.

### 4.6 Playing a pack
- Drag a pack from the hand up to the pedestal and release. The shelf slides out of view, the wallet and tabs fade, the
  pack lands on the pedestal with a thump, and `PackOpener` takes over from its sealed state. There is no cut: it is the
  same canvas light and the same pack.
- After the opening's end screen, "Done" brings the shelf back with the hand as it now stands. If packs remain in the
  hand, the end screen also offers "Open next", which plays the next one without returning to the shelf.

### 4.7 The four extras (what lifts it from good to 9)
Each is an optional field on the data the shop is given (section 6). The experience supports them; whether they exist is
the economy project's decision.
1. **Booster box:** a sealed box of several packs on its own shelf. Dragged across the counter, it bursts and its packs
   fan into the hand one after another.
2. **Free daily pack:** a pack standing on the counter itself with a "Free" tag. It teaches the drag at no cost.
3. **Guarantee meter:** a gauge on the counter ("Legendary guaranteed within 6 packs").
4. **New arrivals:** a pack marked new sits on the pedestal with its own light until the player has looked at it.

## 5. Architecture

Same shape as the opening: a Pixi scene for the things that move, DOM for words and controls, pure maths in small tested
files, and a dev-only lab until the economy wires it to real data.

New folder `packages/ui/src/progression/packShop/`:

| File | Responsibility |
|---|---|
| `PackShop.tsx` | The shell: phases, tabs, wallet, tags, the hand's DOM labels, focus and keyboard, the handoff to `PackOpener`. |
| `shopScene.ts` | The Pixi scene: stage, shelf, packs, the held pack, the counter line, the hand fan. One ticker, pooled objects. |
| `shopLayout.ts` | Pure: where each shelf slot, the pedestal, the line and each hand slot sit for a stage size and a pack count. |
| `shopDrag.ts` | Pure: the held pack's state machine (shelf, held, over-line, buying, to-hand, back-to-shelf, from-hand, to-pedestal) and which zone a point is in. |
| `shopModel.ts` | Pure: the tag's text, affordability, the "new to you" line, shelf ordering. |
| `shopSounds.ts` | The shop's cues (pick up, cross line, till, drop in hand, cannot afford, rack slide). |
| `packShop.css` | The DOM layer. Every looping animation is transform or opacity only. |
| `PackShopLab.tsx` | Dev-only (DevMenu): a fake catalog, wallet and hand, with knobs. |

Reused as they are: `packFx.ts` (stage, masked sheen and gloss), `packTilt`, `packTextures` and `packArt` (pack art),
`packAether.ts` (the stream), `AetherTally` (the odometer), `PackOpener`, `dragFeel.ts`.

The pack on the shelf and the sealed pack in the opener are drawn by the same code. The build should lift the opener's
sealed-pack view (body mesh, strip, sheen, holo) into something both scenes can make, not copy it. The shop and the
opener each own a Pixi application; at the handoff the opener's canvas fades in over the shop's with the pack at the same
place and pose, then the shop's scene stops its ticker.

## 6. The contract with the economy project

`@game/progression` gains `packShop.ts` (dependency-free, like `packs.ts`):

```ts
export interface PackOffer {
  offerId: string;
  look: PackLook;                 // what it shows (packs.ts)
  price: number;                  // Aether; 0 = free
  shelf: string;                  // which tab it stands on
  contains: number;               // 1 for a pack; more for a box
  newToYou?: { unowned: number; total: number };
  badge?: 'new' | 'free' | 'featured';
  soldOut?: boolean;
}
export interface PackShelf { id: string; name: string }
export interface OwnedPack { packId: string; look: PackLook }
export type BuyPackOutcome =
  | { status: 'ok'; packs: readonly OwnedPack[]; aether: number }
  | { status: 'error'; reason: 'insufficient' | 'price_changed' | 'sold_out' | 'guest' | 'failed'; aether?: number };
```

`PackShop` props:

```ts
interface PackShopProps {
  shelves: readonly PackShelf[];
  offers: readonly PackOffer[];
  hand: readonly OwnedPack[];
  aether: number;
  guarantee?: { rarity: CrateRarity; within: number };
  buy: (offerId: string, requestId: string) => Promise<BuyPackOutcome>;
  open: (packId: string) => Promise<PackOpenOutcome>;   // passed straight to PackOpener
  onClose?: () => void;
  reducedMotion?: boolean;
}
```

Rules the shop keeps, whoever supplies the data:
- **The server prices and charges.** Every number shown is a quote. `buy` sends a `requestId` made once per attempt; a
  retry of an unanswered attempt reuses it (the Chest Shop's never-charged-twice rule).
- **One purchase at a time.** While `buy` is pending, no other pack can be picked up.
- **Guests** (R-PROG-AETHER-02): a `guest` outcome sends the pack back to the shelf and the caller shows its sign-in gate.
- The shop never invents ownership: the hand is exactly `hand`, plus the packs of a purchase the moment `buy` answers ok.

## 7. Input, accessibility, reduced motion

- **Mouse and touch:** drag as described. A tap on a shelf pack selects it and shows its tag with a "Buy" button; a tap
  on a hand pack shows "Open". Touch-only styling lives in `touchUi.css` under `html[data-touch-ui]`; desktop stays
  pixel-identical.
- **Keyboard:** tabs, shelf packs and hand packs are focusable. Arrow keys move along the shelf or the hand, Enter on a
  shelf pack buys it (the same line animation plays on its own), Enter on a hand pack opens it, Esc closes the shop. A
  buy by Enter needs a second Enter on a "Buy for N Aether" button that takes focus: the keyboard has no counter line
  to cross, so it gets one explicit confirmation.
- **Screen readers:** the Pixi canvas is `aria-hidden`. A visually hidden list mirrors the shelf ("Rare Pack, 200 Aether,
  guaranteed Rare or better, 14 of 40 new to you, Buy") and the hand, and a live region announces purchases and refusals.
- **Reduced motion, or Pixi unavailable:** a plain grid of pack cards with Buy buttons, a row of owned packs with Open
  buttons, no drag and no stream. `PackOpener` already has its own reduced path.
- The game cursor: no bare `cursor: pointer`; a held pack uses the gauntlet's closed form if one exists, else the
  default. No `title=` attributes.

## 8. Sound

Reuse first: `fx/pack-crinkle-*`, `fx/pack-squeeze` (pick up), `fx/pack-cards` (shake), `fx/pack-drop` (into the hand),
the Aether stream's rush, `tallycounter` (the wallet rolling down). New cues needed: a till ring, a rack slide, a soft
"cannot afford" knock. Existing clips will be tried first (`cartoon-music-cha-ching`, `chess-slide`, `deny`); generating
new ones spends the owner's ElevenLabs credits and needs his go-ahead each time.

## 9. Performance

- One ticker, no per-frame allocation, no layout reads while dragging (rects cached at pick-up; `stage.ts` conversions
  only where a measured value becomes a CSS length).
- Shelf packs off screen are not drawn. At most the five in view, the held pack and the hand fan run their sheen.
- The stage shader is full-screen; on a weak GPU it drops its dust first (the opening's rule).
- Pack art is decoded before a shelf slides into view (`decoding="sync"`, warmed on tab hover).
- Verified on the prod build with a Chrome capture of: a rack slide, a hover sweep across five packs, a buy, a play.
  No long task over 50 ms and no dropped-frame run.

## 10. What a builder decides

Exact sizes, timings and easing (tuned by eye in the lab with the owner, as the opening was); the tag's layout; the
hand fan's maths; how the sealed-pack view is shared between the two scenes; knob names in the lab.

## 11. Testing

- Pure files (`shopLayout`, `shopDrag`, `shopModel`) get unit tests: every zone boundary, the full drag state machine
  including each refusal, affordability at the exact price, the hand pile's count.
- `PackShop.test.tsx` with a fake scene: a buy calls `buy` once per drop with one request id; a pending buy blocks a
  second pick-up; an error returns the pack and announces the reason; a guest outcome calls the gate; playing a hand pack
  mounts `PackOpener` with that pack; keyboard buy needs the second Enter; reduced motion renders the grid.
- Edge cases that must have tests because a player will hit them: releasing exactly on the line (counts as above it:
  not bought); the price changing between pick-up and release (`price_changed`: pack returns, new price shown);
  dropping a hand pack anywhere but the pedestal (returns to the hand); a window resize mid-drag (the pack returns to
  where it came from); an empty shelf and an empty hand.
- No oracle rule is added by this spec (no bug fixed). Rules follow when the economy project ships it to players.

## 12. Delivery

1. **The Shop Lab (this project):** shelf, hover, pick up, the counter, the hand, play into `PackOpener`, with a fake
   catalog. Dev-only, no patch notes.
2. **The extras** (section 4.7), in the lab, once the core feels right.
3. **The economy project** wires real offers, prices, ownership and guests, retires the Chest Shop, and writes the
   patch notes.

## 13. Calls I made that are the owner's to overrule

1. **Multi-buy:** the experience supports a booster box (`contains` > 1). Whether one is sold, and at what price, is the
   economy's decision. If wrong: one shelf and one burst animation go unused.
2. **No confirm box on a drag purchase.** The lit, priced line is the confirmation. The alternative is a short "hold to
   buy" at the line. If wrong: accidental purchases; the fix is adding the hold, a small change.
3. **Chests:** this spec does not touch the Chest Shop. The sixth tab in the owner's wireframe is left for the economy
   project to fill (chests as a shelf, or not). If wrong: nothing built here changes.
4. **No shopkeeper voice in this project.** It would need new generated voice lines. If wanted, it is its own small
   project on top.
5. **Keyboard purchases need one confirmation** (section 7), because there is no line to cross.

## 14. Answers for the builder (from the builder check, 2026-11-25)

All settled by me; none changes what the owner approved.

1. **The handoff.** Changing `PackOpener` and `createPackScene` is in scope. Add an optional entry to the opener (start
   faded out, fade in over a given time) and an "Open next" path that plays the next queued pack without remounting.
   **The pedestal matches the opener:** a pack on the pedestal is drawn at the opener's sealed pack size and place, so
   nothing has to move at the handoff. "Larger" in 4.1 means larger than the other shelf packs.
2. **Sharing the sealed pack.** Extract the sealed-pack builder from `packViews.ts` as a behaviour-preserving refactor,
   as its own first task, with the opener's tests unchanged and passing. The shop then uses the extracted builder. Not a
   thin wrapper, not a copy.
3. **The Aether stream, reversed.** Generalise `AetherStream.emit` (a source rectangle of any size to a target point is
   already its shape): the wallet gem is the source, the pack the target. Add what that needs to the existing class; no
   second class. `AetherTally` already rolls toward any target, up or down, and is a standalone component; give it an
   optional prop to drop the "+" prefix for a wallet.
4. **The drag.** The held pack is Pixi, with its price tag. Read the in-game tuning with `getDragFeel()` and apply the
   same follow and tilt parameters in the scene's ticker. `shopDrag.ts` takes pointer positions in stage px.
5. **Mounting and types.** The Shop Lab is the only mount in this project. Only the data types of section 6 go in
   `@game/progression`; `PackShopProps` and `PackOpenOutcome` stay in the UI package.
6. **The booster box.** No new `PackLook` kind: a box is an offer with `contains` > 1 and its own `look`. Paint a
   placeholder box in canvas (the pack's colours, a band, a count); real art is the owner's to supply later.
7. **Tap to buy.** Tap selects and shows the tag with its Buy button; pressing Buy is the confirmation (no second
   press) and plays the counter animation on its own. The keyboard path is the same: Enter selects, Enter on Buy buys.
8. **Sounds.** Existing clips may be registered in `audio/codeClips.ts` and used freely. Only generating new audio needs
   the owner's go-ahead.
