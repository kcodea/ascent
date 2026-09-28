# 2026-09-28: the Blast hero attack, and hero attacks as cosmetics

Owner asks, in order (2026-09-28):

- "branch off and make a new attack animation. instead of the hero attacking for this animation, i want the numbers
  to all combine, and then the screen slightly shakes and zooms as he blasts pixi blasts from the hero to the opponent
  to deal the damage."
- "the new blast attack is going to be a cosmetic unlock, not a new default"
- "blast is a 2/10, i need a 11/10 experience. AAA extremely polished. better impact, more readability, thicker and
  cleaner animations and sounds that match it."
- "keep iterating on the blast animation until it looks literally blizzard quality pristine. the animation timing
  should be satisfying and chunky, not rushed. it should be fun to watch, especially at higher dmg thresholds."

**Nothing changes for players until the owner runs the runbook below** (one SQL paste, one deploy). Classic stays
everyone's default; Blast only plays for a player who owns and equips "Arcane Barrage".

## What shipped

- **Blast** (`packages/ui/src/heroBlast/`): presentation only. The numbers that make up the blow (the attacker's Tier,
  then each surviving minion) pop in big and outlined, fly into ONE total that ticks up per landing with a rising pitch,
  and slam on the engine's number. The hero absorbs it and charges (a riser timed so its climax lands on the release),
  the view pushes in on the hero, bolts with white-hot cores and tapering comet tails fly to the target, and the impact
  freezes for a hit-stop on its brightest frame, squashes and knocks back the struck portrait, punches the camera in on
  the target and shakes it along the line of fire. A big outlined hit number (`-N`) punches onto the struck hero above
  every flash. The consequence (the health drop through `settleCombat`, Armor first) lands exactly once on that frame.
- **Damage tiers** (engine caps are 5 / 10 / 15 / 20 by round): I 1-5, II 6-11, III 12-19, IV 20+. Each escalates the
  numbers' flight, the slam, the charge, the volley, the hit-stop, the camera, the sparks and the audio. III adds
  secondary explosions, embers and a scorch; II-IV dim everything but the two heroes; IV fires one colossal beam.
- **Timeline** (ms, at 1x, 1600 px between the heroes, impact / end including the hit-stop): I (3 dmg) 1251 / 1950;
  II (8) 1556 / 2375; III (14) 2046 / 3036; IV (40) 2609 / 4004. Classic runs about 2.7 to 3 s.
- **Layers.** The foe portrait is a `#stage` portal that paints above everything inside `#root`, so Blast draws its
  Pixi on the above-portrait slot, moves the camera on `#stage` (composed with the stage's own scale) and mirrors it
  onto the Pixi root, dims inside `#stage`, and puts its numbers in a top-level layer above the FX.
- **The cosmetic** (`packages/progression/src/cosmetics.ts`): `hero_attack` enabled; `attack_blast` (placeholder name
  "Arcane Barrage", Legendary, crate, global target, `assets.style: 'blast'`). The loadout and run snapshot carry
  `heroAttack`; `scopeCosmetics` and the seat union keep it, so an opponent's attack plays when they strike you, and
  replays play the recorded one. Unknown or retired ids play Classic. `equip_cosmetic` accepts slot `hero_attack` with
  target `''` (new migration). The Collection's Attack Animations tab is live, with a sandbox preview.
- **Setting renamed**: "Show opponent skins" is now "Show opponent cosmetics" (same stored key) and also covers an
  opponent's hero attack: off, they strike you with Classic. One switch for everything other players wear.
- **Owner approval**: "those are good thresholds, this blast animation looks good! make it a legendary reward". So
  `attack_blast` is **Legendary** (it landed as Epic) and the tier thresholds 6 / 12 / 20 are the approved defaults.
- **Crate odds** re-pinned (first crate): Common 47.3%, Rare 31.3%, Epic 19.2%, Legendary 2.2%; a non-title 31.0%;
  the attack 0.6% (was 47.6 / 31.5 / 19.3 / 1.7, non-title 30.6 before it; 46.5 / 30.8 / 21.0 / 1.6 while Epic).
- **Tuner** (dev menu, "Hero Attack: Blast"): every global and per-tier dial, colours, a clip / gain / pitch per sound
  cue, Play both directions, Small / Medium / Huge, reduced motion, 1x / 0.5x / 0.25x, Copy JSON, and the Attack style
  row (Auto / Classic / Blast) that forces a style in dev builds. Production plays the baked defaults.
- **Oracle**: R-PROG-ATTACK-01..03; R-PROG-SKINS-02 and -06 updated.

## Perf (dev server, headless Chrome, 1920x1080, 240 Hz)

| run | frames | p50 | p95 | p99 | worst | > 16.7 ms | long tasks | runner step p99 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IV you hit (40) | 1327 | 4.2 | 4.4 | 5.3 | 16.1 | 0 | 0 | 0.3 ms |
| IV they hit (40) | 1329 | 4.2 | 4.4 | 4.6 | 14.2 | 0 | 0 | 0.2 ms |
| III (14) | 1092 | 4.2 | 4.4 | 4.7 | 14.2 | 0 | 0 | 0.2 ms |
| I (3) | 835 | 4.2 | 4.3 | 5.3 | 17.3 | 1 | 0 | 0.2 ms |

No DOM left behind, the `#stage` transform restored. DOM moves are transform / opacity only; sprites are pooled (cap
420); the updater unhooks when the scene drains. A prod-build check needs an equipped cosmetic (production ignores
the dev override), so it is part of the owner's post-deploy pass.

## Owner runbook

1. Supabase SQL Editor: paste and Run `supabase/migrations/2026-09-28-progression-hero-attack.sql` (after the
   achievements file). Idempotent; it only replaces `equip_cosmetic` and re-grants it.
2. Deploy the inventory function from this worktree (it syncs the catalog: the `hero_attack` category on, and
   `attack_blast`):
   `npx supabase functions deploy progression-inventory --project-ref zcwhbejpqcdcfdpfxeza`
3. Verify with the anon REST probe: `cosmetic_categories?category=eq.hero_attack` shows `enabled: true`, and
   `cosmetic_catalog?cosmetic_id=eq.attack_blast` exists.
4. Emergency off switch (no deploy): `update public.cosmetic_categories set admin_off = true, updated_at = now() where
   category = 'hero_attack';` (everyone falls back to Classic; ownership is kept).

## Open for the owner

- The name "Arcane Barrage" is a placeholder (the Legendary rarity is the owner's call).
- Sounds are layered from existing clips (listed in the PR). Purpose-made clips would lift it further: a short
  bright number tick, a punchy total slam, a 0.3 to 0.8 s riser, a beam tear, and a tight impact with a low thump.
