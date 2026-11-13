# 2026-11-12: eight new hero attack styles (crate cosmetics since 2026-11-13)

Sixteen hero attack styles were scaffolded with `npm run attack:new` (see `2026-11-11-attack-scaffold.md`) and built
in parallel by separate builders on `feat/hero-attacks-16`. Eight are kept. Each has its own devlog
(`2026-11-12-hero-attack-<style>.md`) with the looks, the code layout, the sounds and what its builder measured.

## The eight

| style id | working name | intended rarity | the idea in one line |
| --- | --- | --- | --- |
| `chess` | Checkmate | Epic | a pawn, a knight or a queen moves by its own rules and takes the portrait |
| `fireworks` | Grand Finale | Epic | a bottle rocket, a roman candle, then a mortar shell and a held beat before the bloom |
| `wrestle` | Top Rope | Legendary | both portraits wrestle: a chop, a body slam, an elbow drop, a pin and a three count |
| `combo` | Flawless | Legendary | a fighting game combo with a counter that ends on the blow's real damage |
| `warhost` | Warhost (Ancient of War) | Ancient | an army of tiny soldiers: a spearman, archers, cavalry, the whole host |
| `reaping` | The Reaping (Ancient of Death) | Ancient | the scythe cuts colour: the portrait, then the whole screen, drains to grey |
| `glass` | Fourth Wall | Epic (owner 2026-11-13, was Ancient) | the screen is a pane of glass and the blow chips, webs, breaks and shatters it |
| `stars` | Written in the Stars | Ancient | constellations are drawn star by star, come alive and strike |

Eight of sixteen: the owner dropped eight after seeing them (below). What is kept is 3 Epic, 2 Legendary and 3 Ancient (Fourth Wall moved from Ancient to Epic on 2026-11-13); no Rare survived.

## Cosmetics (2026-11-13)

Built dev-only on 2026-11-12. On 2026-11-13 the owner said "merge the attack animations and run w/e you need to to get
them ... added to shop", so all eight became crate cosmetics in the same PR (#2685): `attack_chess`,
`attack_fireworks`, `attack_glass`, `attack_wrestle`, `attack_combo`, `attack_warhost`, `attack_reaping`,
`attack_stars`, at the rarities in the table. Warhost joined the Ancient Knockout variants; Fourth Wall's coded variant
stays tuner-only because it is an Epic. The wiring, the new crate odds and the production frame times are in
`2026-11-13-hero-attacks-batch-of-eight-cosmetics.md`. The names are still the builders' working ones; the ids stay
if the owner renames.

## Built and dropped: flick, train, claw, then stamp, anvil, glove, chord, pinball

Three more styles were built in the same batch and removed before this PR: `flick` (The Flick, a Rare), `train`
(Right on Schedule) and `claw` (Grabby Claw, a claw machine, an Epic). The owner rejected them: their
drawn props looked like clip art. After playing the second-pass versions on 2026-11-12 he dropped five more: `stamp` (Paid in Full), `anvil` (Look Out Below), `glove` (Sucker Punch), `chord` (Power Chord) and `pinball` (Multiball), removed the same way. Their folders, tuners, sound clips (`train-*`, `claw-*`; `flick` had none of its
own), devlogs and every registration were deleted. The code is still in the branch history if one is ever revisited.

## Sounds

The new clips in `packages/ui/src/audio/fx/` (`<style>-*.mp3`) were generated with ElevenLabs, then trimmed, folded to
mono 44.1 kHz at 128 kb/s and levelled; each style's own devlog lists its clips and lengths. They are registered in
`ATTACK_FX_CLIPS` (`audio/codeClips.ts`).

## NOT done

- ~~Cosmetics~~ and ~~production-build frame times~~: done 2026-11-13, see `2026-11-13-hero-attacks-batch-of-eight-cosmetics.md`.
- **Phones.** No style was looked at on a phone; reduced motion is covered by tests only.
- The names are working names; the owner may still rename any of them (the ids stay).
