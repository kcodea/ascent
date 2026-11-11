# 2026-11-11: Void, a new hero attack (dev only, no cosmetic yet)

Mike wanted to try building a hero attack himself, "an intense one like arcana", and picked the theme from a short
list: "lets do void!". The brief: dark orbs with a bright rim (one, two, a volley), and a top tier where the orbs merge
into a black hole over the target, everything pulls toward it, then it collapses to a point and blasts outward.

**Nothing changes for players.** The Void has no cosmetic, so nobody can equip it. It plays only through the dev
"Attack style" override and its own tuner ("Hero Attack: Void", 🕳️ in the dev menu).

## How it was built

`packages/ui/src/heroVoid/` started as a renamed copy of `heroArcana/` (the reference bar, see
`2026-09-28-hero-attack-arcana.md`). The plan, the cues, the flight and vortex paths and the camera are Arcana's, so
the timing was proven from the first frame. A "ribbon" in the Void's names is an orb's flight and its dark trail.

What is the Void's own:

- **The look inverts Arcana's: the subject is dark.** The orb is a near-black disc on a NORMAL-blend layer (so it stays
  black on any board), a thin hot rim, a swirl of light spinning into it and a halo behind. The trail is a black streak
  edged in light: the additive glow strip sits under the dark body strip, so only its edges show.
- **Two new textures** (`heroVoidTextures.ts`), painted once per session on top of Arcana's: the disc and the swirl.
- **Gravity motes** (Mike: "particles circling the orbs and pulling in, like it has major gravitational force"). Each
  orb carries sparks that are caught at an outer reach, circle faster as they fall and vanish at the rim. They are
  sprites placed from the orb's clock, not free particles, because a fast orb would outrun those. The glitter Arcana
  sheds off the head was removed: nothing escapes the orb.
- **A nearly flat throw** (Mike: "it shouldnt arc as much, it would defy those phsysics"). The rise went from about 30%
  of the distance to 5 to 7%, and the fan on II to IV was roughly halved.
- **Tier IV, the black hole.** A hole opens in the eye of the orbit and grows as the ring tightens; long streaks of
  light are dragged in from far out; the striking portrait leans toward it (`pullPx`) and the struck portrait is
  crushed toward its centre (`crush`). On the collapse it shrinks to a pinpoint that flares white, then a dark
  shockwave goes out under the light rings.
- **Mike's tune is the default.** His Copy JSON from the tuner is baked into `HERO_VOID_DEFAULTS`: a short trail with no
  twist or strand, a bigger orb with a smaller swirl, 12 motes caught further out and spinning faster, no streaks flung
  out of the blast, and a bigger Tier IV burst.
- **Sound is a placeholder**: Arcana's cues pitched down, `fx/whoosh-03` on the launch, and a lower swirl tone.

## Registration

The style is `void` in `HERO_ATTACK_STYLES` and the dev choices; it is wired into `Recruit.tsx`,
`HeroAttackPreview.tsx`, the dev menu, `tunerAll.ts`, the tuner icon map and `ATTACK_FX_CLIPS`. The shared sweeps
(damage formation, knockout tier, stage camera, tuner buttons) include it, and the ten tests that pin the whole style
list were updated.

## Verified

- `heroVoid.test.ts` (Arcana's suite, adapted): the plan, the paths, the camera, the runner landing the consequence
  exactly once, the pooled scene draining and destroying clean. The lob test now pins the flat throw.
- Mike played it in the tuner on the dev server ("looks great") and tuned it there. The builder never saw it rendered.

## Open

- **No cosmetic.** `packages/progression/src/cosmetics.ts` is Kevin's side and feeds the generated Supabase copy. The
  catalog entry (id, name, rarity), the Collection preview, patch notes and `GAME-RULES.md` belong to that follow-up.
- **The Knockout variant ("Tier V") is dormant.** The machinery came across with the copy and is marked as inherited;
  its two tuner buttons were removed. If the Void ships as an Ancient it needs its own variant designed.
- **Not profiled.** Arcana's pools and caps are unchanged, and each orb adds at most 16 sprites, but nobody has run the
  prod-build frame capture the Arcana entry did. Do that before it reaches players.
- **Blast streaks are tuned to 0.** The code that flings them is still there so the slider works; remove it if the
  cut is final.
