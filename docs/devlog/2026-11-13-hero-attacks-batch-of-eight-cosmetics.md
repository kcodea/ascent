# 2026-11-13: the batch of eight hero attacks become crate cosmetics

Owner (relayed): "merge the attack animations and run w/e you need to to get them and the new art pieces added to
shop". The eight styles built dev-only on 2026-11-12 (`2026-11-12-hero-attacks-batch-of-eight.md`) are now catalog
items that drop from chests and equip from the Collection's Attack Animations tab. PR #2685.

| id | name (working) | rarity | style | Ancient |
| --- | --- | --- | --- | --- |
| `attack_chess` | Checkmate | Epic | `chess` | |
| `attack_fireworks` | Grand Finale | Epic | `fireworks` | |
| `attack_glass` | Fourth Wall | Epic (owner moved it down from Ancient) | `glass` | |
| `attack_wrestle` | Top Rope | Legendary | `wrestle` | |
| `attack_combo` | Flawless | Legendary | `combo` | |
| `attack_warhost` | Warhost | Ancient | `warhost` | the Ancient of War |
| `attack_reaping` | The Reaping | Ancient | `reaping` | the Ancient of Death |
| `attack_stars` | Written in the Stars | Ancient | `stars` | none |

No existing cosmetic used these ids or names. The Ancient ties are the same kind as Soul Stitch (Bonds) and Timebreak
(Time): comments, labels and rules text, no data field.

## Wired

The same files as Golazo (#2536) and Charge the Mound (#2535); the runners, tuners, the damage formation / camera /
knockout tier test lists, the Collection preview runners, the in-game runner switch and the sound clips were already in
place from the dev-only build.

- `packages/progression/src/cosmetics.ts`: eight `heroAttack(...)` entries after Golazo; the Edge mirror
  `supabase/functions/_shared/progressionCosmetics.ts` regenerated with `npm run progression:shared`.
- `cosmetics.test.ts`: the crate counts, every pinned per-item chance, a pin for each of the eight, the category split.
- Collection tests: Attack Animations is now `/32`, the album total `583`; one parametrised tile / preview / Equip test
  for the eight.
- `KNOCKOUT_VARIANT_STYLES` gains `warhost` (it is an Ancient now and its runner reads `isKnockoutVariant`). `glass` is
  NOT added: it is an Epic, the rarity gate keeps it on Tier 4, and the shared test requires every listed style to be
  an Ancient. Its Knockout buttons stay in its tuner only. Reaping and Stars have no variant, so as Ancients they fall
  back to Tier 4.
- `DEV_HERO_ATTACK_LABELS`, the DevMenu hints, the runner / tuner / test header comments: the "(in progress, no cosmetic
  yet)" wording is gone. The fireworks and glass registration tests now assert the cosmetic exists.
- Rules: R-PROG-ATTACK-38 to 45 (one per attack), R-PROG-ATTACK-01's crate history, R-PROG-ATTACK-20's variant list.
- `docs/GAME-RULES.md`, the 2026-11-13 patch note.
- The phone pre-warm needs nothing: it decodes the clips of the styles in play (yours and the foe's equipped
  attack, R-AUDIO-PREWARM-ATTACKS-01), and the eight's clips were already in `ATTACK_FX_CLIPS`.

## The new crate numbers

A first crate holds 92 Common, 146 Rare, **150 Epic** (was 147), **109 Legendary** (was 107) and **37 Ancient** (was 34)
items. Each item's chance: Common 0.38%, Rare 0.212%, Epic **0.147%** (was 0.15%), Legendary **0.083%** (was 0.084%),
Ancient **0.081%** (was 0.088%). So Checkmate, Grand Finale and Fourth Wall are 0.147% each, Top Rope and Flawless
0.083% each, Warhost, The Reaping and Written in the Stars 0.081% each. Hero attacks are 3.5% of a first crate (was
2.7%; 4 Rare, 5 Epic, 16 Legendary and 7 Ancient attacks). The Collection total is 583 (was 575); Attack Animations
holds 32.

## Perf (PROD bench build)

`VITE_PERF_BENCH=1` + `vite preview`, headless Chrome (ANGLE d3d11), 1920 x 1080, vsync and frame cap off, sound off,
live backend blocked. A temporary, uncommitted bench hook (`window.__bench.attack`) played each runner through the
tuners' `playAttackDemo` between the real portraits in a Scene Builder shop. Each style played Tier 4 (40 damage, 7
parts): one warm-up play (dropped), then three as you and three as the foe. Frame times in ms over every frame while
the attack ran. The machine was not otherwise idle (light editing alongside), so treat single worst frames as noisy.

| style | frames | median | p99 | worst | frames > 6.25 ms |
| --- | --- | --- | --- | --- | --- |
| soccer (control, shipped) | 25551 | 1.3 | 2.5 | 12.8 | 60 |
| chess | 22297 | 1.3 | 2.7 | 14.8 | 35 |
| fireworks | 44310 | 1.0 | 3.1 | 51.4 | 90 |
| glass | 38822 | 0.9 | 2.7 | 20.3 | 61 |
| wrestle | 31009 | 1.3 | **4.7** | 21.5 | 190 |
| combo | 27172 | 1.3 | **6.4** | 36.9 | 298 |
| warhost | 26044 | 1.2 | 3.7 | 21.1 | 83 |
| reaping | 33899 | 1.2 | 2.5 | 19.9 | 72 |
| stars | 35711 | 1.0 | 3.7 | 37.2 | 124 |

Every median is at or under the control. **Combo** (p99 6.4, right at the 6.25 ms bar) and **Wrestle** (p99 4.7) are
clearly above the control's 2.5; Warhost and Stars (3.7) somewhat above. Every style, the control included, has single
frames over 6.25 ms; Fireworks' 51 ms worst is one spike. Not blocking (owner call); Combo and Wrestle are the first to
profile (both move the two portraits' DOM elements every frame).

## Deploy

After the merge, deploy `progression-inventory` from `main` (the catalog sync that opens crates). No SQL: the equip SQL
already accepts the `hero_attack` slot. The animations reach players with the next client release.
