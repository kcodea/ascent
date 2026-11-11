# 2026-11-11: `npm run attack:new`, a scaffold for new hero attacks

Mike, after building the Void: "i want to make more attack animations. how can we make more without it taking so long
for each one?" On the Void, most of the time went on work that was not the look: copying Arcana's folder, renaming it,
and registering the style in about twenty files.

## What it does

```
npm run attack:new -- <name> [--from void] [--icon ✨] [--label "Frost Lance"] [--dry-run]
```

`scripts/new-hero-attack.mjs` copies `packages/ui/src/hero<From>/` and `Hero<From>Tuner.tsx` under the new name, renames
the identifiers, and registers the style in: `HERO_ATTACK_STYLES`, the dev override list and its label,
`Recruit.tsx`, `HeroAttackPreview.tsx`, the dev menu, `tunerAll.ts`, `tunerSchema.ts`, `ATTACK_FX_CLIPS`, and the four
shared test sweeps under `heroAttack/`. The new style plays at once as a **dev-only style with no cosmetic**, looking
exactly like the one it was copied from. From there the work is the look.

- Every edit is anchored on text that must be present. A missing anchor stops the run before anything is written, so a
  failed run leaves the tree untouched. `--dry-run` lists the files without writing.
- It never touches `packages/progression`, patch notes or the rules docs. Those belong to the PR that gives the style
  a cosmetic.
- Each copied file opens with a banner saying its comments still describe the source style. The Void build copied
  Arcana's owner quotes into Void files by accident; the banner is the guard against that.
- A copied test's `describe('the cosmetic', …)` block is removed (there is no cosmetic to resolve). That can leave an
  unused import, which shows as a lint warning.

## The pinned style lists

Ten style tests (`heroBanana`, `heroBeast`, `heroBlades`, `heroBleed`, `heroEnraged`, `heroFire`, `heroFrost`,
`heroHoly`, `heroPoison`, `heroUndead`) each asserted a hard-coded copy of the whole `HERO_ATTACK_STYLES` list, so every
new style had to edit all ten, and two style PRs open at once always conflicted there. Each now asserts only that its
own style is in the list. Nothing else read those copies; `codeClips.test.ts` still checks that every attack folder is
a real style.

## Verified

Scaffolded a throwaway style from `void`, `arcana`, `frost` and `bullettime` in turn. Each time: typecheck clean, lint
0 errors (unused-import warnings only), and the new style's own tests plus the shared sweeps and the clip scan green.
The throwaway was then removed; this PR adds no style.

## Not done

- **A shared base for projectile attacks.** A scaffolded style is still a full copy (about 2,800 lines from the Void).
  Pulling the plan, paths and camera that Arcana and the Void share into one place would make a new attack a few
  hundred lines, but it means refactoring Arcana. Worth doing after a third attack shows what really varies.
- The scaffold only copies flat style folders and one-word names.
