# 2026-10-18: Iggy Blast hero attack (Legendary, Recoil Ward)

**Ask (owner):** "make a new attack that resembles or pulls concepts from iggy. it should be a dragon blast attack that
has increasing magnitude, with powerful back blasting/ward effects". Three concepts were pitched
(`docs/design/attack-dragon-blast-pitch.md`) and the owner picked: "go with A, legendary rarity, name Iggy Blast". The
first build was "pretty uninspired", so it was pushed to a showstopper the same day.

**What shipped:**
- `attack_iggy_blast` ("Iggy Blast", Legendary, style `iggy`) in the catalog. It drops from crates like every hero
  attack. The Supabase mirror was regenerated with `npm run progression:shared`.
- The runner lives in `packages/ui/src/heroIggy/` (config + pure plan, scene, textures, runner, test). The tuner is
  `HeroIggyTuner.tsx` in the Dev Menu. The style is wired in `heroAttackStyle.ts`, `HeroAttackPreview.tsx` and
  `Recruit.tsx`.
- The beats:
  - The inhale: crimson flame wings, cyan eyes, motes pulled into the mouth, a riser.
  - The staged breath: 1 / 2 / 3 / 3 stages, layered outer, mid and core `pixiFire` line emitters. Each stage lights a
    hex ring, shoves the hero back and flattens the ward.
  - A short hit-stop, then the ward slams outward behind the hero and the mega-surge carries the blow.
  - IV and knockouts also shatter the ward into shards and leave a blue-fire scorch on the target.
- Oracle rule: R-PROG-ATTACK-36.

**Non-obvious:**
- **Hit-stop vs. the 2026-09-28 ruling.** The owner ruled out hit-stop on 2026-09-28 ("it looks like lag"). The
  2026-10-18 redo brief asked for one, so it ships as the tunable `hitStopMs` (default 75 ms; 0 = none). It is the
  owner's call.
- **The ward art is a placeholder.** It is built from existing FX textures (glow, shock ring, the Blast's ring), per
  the no-code-drawn-props rule. When the painted hex dome arrives, swap the `wardBody` / `wardRim` / `wardCells` slots
  in `heroIggyTextures.ts`.
- **Budget.** The wings run on a second `PixiFire` with a crimson palette, capped at 300 particles. The breath is
  capped at 900. The inhale and the breath together sit near the caps at every tier.
