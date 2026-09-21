# 2026-09-21 — Player-facing text: the owner's writing rule, the glossary trim, the tripwire

Owner ask (2026-09-21, verbatim intent): "we do not ever use '--' in a description. You should never either.
Whenever you write text that is player facing, write it in our writing style: clear language, to the point."
Prompted by the Orbit and Dawn / Dusk keyword pills, which named mechanics the game does not have, and by
the Watcher / Permanent / Aura definitions, which had drifted from the owner's voice.

## The rule (house style, derived from the entries the owner wrote)

One or two short plain sentences. Say what it does first. No em dash (—), no ` -- `, no ` - ` as a clause
separator, no parenthetical asides, no "e.g." / "i.e.", no rhetorical framing, no marketing. Keep every fact
the old text carried (numbers, conditions, exceptions). When a dash joined two clauses, make them two
sentences or one plain sentence. Bold markers and pill tokens stay. Code comments are not covered; only
string literals a player can read.

Reference entries (the owner's own, verbatim): Shout "Triggers when you play this minion from your hand.",
Taunt "Enemies must attack this minion before any other until it is destroyed.", Consume "Devours a minion
from shop to gain their stats."

## What changed (`packages/ui` only)

- **Glossary** (`keywordGlossary.ts`): the `orbit` and `dawndusk` rows are deleted (no pill, no Compendium
  row). Three definitions are now the owner's verbatim: Watcher "A card that triggers off other minions.",
  Permanent "Imbues/Buffs carry through the run permanently.", Aura "A run wide bonus for every minion that it
  suits. Carries through shop and combat phases."
- **Patch notes** (`patchNotes.ts`): every dash-joined summary and detail rewritten in the style above (about
  320 lines), the one "e.g." replaced with "such as", a stray space in an en-dash range fixed. Paraphrased card
  lines stay unquoted in the file's existing `Name (Tier N): Keyword, effect.` form; quotation marks would
  present a paraphrase as the card's printed text.
- **Tooltips / labels / status lines** across ~40 screens (Recruit, StatusBar, Title, EscMenu, MinionBook,
  Career, Leaderboard, Rankings, RecentGames, EndScreen, RankScreen, RefreshButton, RuneCard, QuestCard,
  PracticeOptions, AvatarPicker, the bug-report modal, the tutorial panels, the replay round rail).
- **Text helpers**: `combatGains.ts` ("Your spells permanently gain +2/+0"), `questText.ts` (the hero journey
  line), `cardText.ts` (the Dragon spell-copiers, Comet Conductor, Pack Leader, Guel, Monk, taught spells),
  `rank/rankFormat.ts` + `rank/rankSource.ts` (gate lines, outcome lines, error sentences). Their tests
  (`combatGains.test.ts`, `questText.test.ts`, `rank/rankFormat.test.ts`, `rank/rankSurfaces.test.tsx`,
  `ladderPages.test.tsx`, `bug-report/BugReportModal.test.tsx`) pin the new wording.
- The replay round rail's per-card tallies use `·` between a name and its count (`Kindled Sprite · 3×`); a
  separator between a label and a number is not a clause join.

## The tripwire: `packages/ui/src/noEmDashPlayerText.test.ts`

Fails on an em dash or ` -- ` in: every glossary name / def / alias; every patch-note label / text / detail;
every `data-tip`, `title`, `aria-label` and `hint` attribute in sixteen screen files (a brace-depth walker,
not a regex, so a literal nested three templates deep is still read, and a JSX comment never trips it); and
the direct output of `combatGains`, `questObjectiveText` / `questObjectiveLines` / `questRewardText` over
every authored quest, `copyCastSpellText` / `packLeaderText` / `guelProgressText` / `monkProgressText` /
`taughtSpellText` over every card id, `rankErrorText` for every code, and the rank gate / outcome sentences
over every fixture. A self-check case pins the scanner against every attribute form.

## Follow-up (not in this PR; it stayed inside `packages/ui`)

The same rule is not yet applied to the engine-side player copy: ~35 hero blurbs / power texts in
`packages/sim/src/heroes.ts`, ~15 printed card / equipment texts in `packages/content/src` (set1 beasts,
demons, dragons, mechs, spells, tokens; set3 kobolds; equipment; henchmen), the Fleeting Vigor ribbon in
`packages/sim/src/reducer.ts`, and the Learn Ascent course copy in `packages/sim/src/tutorial/learnAscent.ts`.
Those are content-owner files with their own golden / docbot coverage, so they get their own PR, and the
tripwire should grow HEROES / ALL_CARDS / LEARN_ASCENT cases in the same PR so card and hero text cannot
regress. Listed under Next in the roadmap.
