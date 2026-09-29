# 2026-09-29 · The Rare hero attacks: Coin Flick, Boomerang, Bubble Pop, Backstab

Owner ask: "branch off and build 5 animations that range from rare -> epic. all of the animations we have done so far
are legendary. rare and epics should only have 2 or 3 tiers to them and generally be less exciting, but still extremely
clean and fun. get creative". This branch builds the RARES (another branch builds the two Epics). A fourth Rare was added
mid-build: "add a stealth backstab attack to the rare branch. portrait fades and attacks from behind the target back
towards the player portrait and settles. the larger version can do a "normal" lunge attack then vanish into smoke and
hit from the side, then vanish and hit from behind again".

## What shipped

Four `hero_attack` cosmetics, **Rare**, from crates (names are placeholders for the owner to rename; the ids stay):

| id / style | name | Small (shared I-II) | Big (shared III-IV, every knockout) |
|---|---|---|---|
| `attack_coin` / `coin` | Pocket Change | A gold coin flicked spinning (flat turn + edge-on flip, afterimages) pings the face (sparkle, ring, glitter) and caroms off. | Ricochet volley: ping (tick), hop off and back (tick), last ping bursts into a shower of ~10 tumbling coins. |
| `attack_boomerang` / `boomerang` | Come Back Around | A carved boomerang (teal inlay, teal ribbon trail, spin blur) curves out, THWACKS (star, ring, wood chips), loops home and is caught (a pop). | Two from either side, each swinging wide on its own side and landing on the other side of the face (an X), a double thwack, both caught. |
| `attack_bubble` / `bubble` | Bubble Trouble | An iridescent bubble swells at the hero's rim, drifts over on a floaty weave, engulfs the face, strains and POPS (droplets, a fizz of tiny bubbles). | Five little bubbles blip on the face first (ticks), then a big bubble swells round the whole portrait and pops with a pastel splash ring. |
| `attack_backstab` / `backstab` | Shadow Step | The striker PORTRAIT fades into smoke, steps out behind the target, draws back and stabs toward home (a violet / teal slash; the target jolts toward the striker), then smokes home and settles. | Classic's own lunge (tick), vanish, stab from the side (tick), vanish, stab from behind (impact, crossed slash), smoke home, settle. |

Timings after the damage formation: Small about 1.3 to 1.8 s, Big about 1.8 to 2.2 s.

## How (the non-obvious bits)

- **Two tiers, mapped locally.** Each config has a tiny `xLevel(tier)` (I-II small, III-IV big) and reads the tier from
  the shared `attackTier`, so the knockout rule (R-PROG-ATTACK-20) needs nothing extra. Dials are `small*` / `big*`.
- **A small shared kit** (only the Rares use it; the Legendaries keep their bespoke files):
  - `heroAttack/configStore.ts`: the clamp / sanitize / DEV-localStorage / Copy JSON store every style repeats inline.
  - `heroAttack/fxPool.ts`: a pooled 4-layer Pixi scene (under / glow / body / core), pre-warmed textures, and a
    fire-and-forget `Fx` with scale tween, alpha envelope, drift, drag, gravity, spin, an edge-on FLIP (scale.x = |cos|,
    shading toward an edge tint: the coins) and velocity-aligned stretch (droplets).
  - `heroAttack/ribbonTrail.ts`: one MeshSimple strip sampled back in time along any motion (the boomerang's trail).
  - **The camera applied once** (#1851's `heroAttack/stageCamera.ts`). Since #1762 the FX overlay canvas lives inside
    `#stage`, so mirroring the camera onto the Pixi root double-applies it (the Banana PR #1839 found this). The branch
    first carried its own `heroAttack/overlayCamera.ts`; on merge (after #1851 landed) all four Rares switched to the
    shared `new StageCamera(cameraEl, scene, heroFxCanvas(o))` and `overlayCamera.ts` was deleted (one approach only).
    All four are in the all-styles camera test (`heroAttack/stageCamera.test.ts`).
  - `heroAttack/rareTuner.ts`: one builder for the four DEV tuners (Copy / Reset / Play on top, no Speed / Reduced
    motion, Small and Big dial groups). The demo accepts `frames` / `safety`, so a capture rig can step it by hand.
- **Backstab moves the portrait.** Screen-px pose written in the portrait's own units (ancestor scale measured once),
  the camera folded in by hand for the foe's `<body>` portal, OPACITY for the vanishes, `.duel-attacker-*` raised for the
  whole attack; transform, opacity and the class are restored on the end, `finish()`, `cancel()` and the safety timer
  (tests pin all of them). `fitSpot` keeps a spot on screen: it first pulls in closer and may hang a little off the edge,
  then swings round the target toward the middle of the frame; every stab drives at the target's centre and always
  travels at least 40% of the way. In the real layout the foe portrait sits in the top-right corner, so "behind" lands
  behind-and-to-the-right (there is no room straight behind); the side spot takes the other flank.
- **Bubble film** is painted in colour with a conic gradient (a smooth pastel sweep round the rim, 256 px so the engulf
  stays crisp) with a fallback of arcs where `createConicGradient` is missing.

## Verification

- Targeted tests: the four new suites (55 tests) plus damageFormation / knockoutTier / attackTunerButtons (every style
  opens with the formation, lands once, never pauses, knockout plays Big), progression cosmetics (crate odds re-pinned:
  Rare 17 items at 1.765% each; after merging Grave Call, the Stampede, the Banana Cannon and Hemorrhage, hero attacks together are 11.1% of a
  first crate), Collection counts (17 attacks, 85 items).
- Real game (dev server, the tuner demos on a manual clock, stills extracted from the overlay renderer): coin flight,
  pings and shower; boomerang pair crossing and the thwack; bubble stream, engulf and pop; backstab lunge, smoke and
  slash, and the portrait restored with the body class cleared.
- Perf (dev build, 1600 x 900, per 16 ms frame: the sequence step, DOM writes and a Pixi render; layout / paint not
  included because the preview pane was hidden):

| attack | p95 | p99 | worst | peak sprites |
|---|---|---|---|---|
| Coin small / big | 0.1 / 0.2 ms | 0.4 / 0.3 ms | 1.2 / 0.8 ms | 19 / 43 |
| Boomerang small / big | 0.1 / 0.2 ms | 0.4 / 0.4 ms | 0.8 / 1.0 ms | 17 / 36 |
| Bubble small / big | 0.1 / 0.1 ms | 0.3 / 0.2 ms | 0.6 / 0.9 ms | 22 / 46 |
| Backstab small / big | 0.1 / 0.1 ms | 0.2 / 0.3 ms | 0.7 / 1.0 ms | 33 / 40 |

Caps: 220 / 200 / 240 / 220 sprites. No SQL: the items arrive with the next `progression-inventory` deploy.

Oracle: R-PROG-ATTACK-28 (the Rare shape) to 32 (one per attack). GAME-RULES and the patch notes updated.
