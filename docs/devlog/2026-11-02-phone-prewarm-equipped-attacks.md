# 2026-11-02: phones decode ahead only the hero attacks in play (R-AUDIO-PREWARM-ATTACKS-01)

Found while adding the soccer attack (PR #2536): every hero attack's clips were in the `fx/` code clips a phone (and
desktop, since R-AUDIO-MEMORY-02) decodes ahead in EVERY game, so each new attack ate into the phone working set
whether anyone had it equipped or not. The soccer attack's real crowd and commentator clips could not fit
(`phoneAudioQuality.test.ts` at 39.1 MB against its 37.75 MB ceiling), and baseball had fit by about 20 KB.

## What changed

- `audio/codeClips.ts` is split by where a clip is named: `CODE_FX_CLIPS` (shared, outside any `hero<Style>/` folder:
  entrances, crate, lobby reveal) and `ATTACK_FX_CLIPS` (each style's own, inside its `hero<Style>/` folder, keyed by
  the folder name lower-cased). The scan test pins both and checks every key is a real hero-attack style.
- `clipIndex`: `forAttack(style)`, and `prewarmList` takes `attackStyles`: the shared code clips plus only those styles'
  clips.
- `phonePrewarm`: `attackStylesOf(state)` resolves yours (your equipped attack) and your current opponent's (its seat's
  recorded cosmetic, only with "Show opponent cosmetics" on) exactly as the fight does (the DEV override included;
  Classic has no clips). A change of equipped attack, opponent (the lobby) or that setting re-prewarms.
- Not known ahead (rare): the attack's runner already asks for its own clips the moment it starts (`AttackVoices.warm`).
- The budget test counts the shared clips plus the TWO LARGEST attack styles (a fight plays at most two). The 40 MB
  cache and its 90% ceiling are unchanged.

## Numbers

Unit working set (the test's worst case): 36.85 MB with every attack -> 36.31 MB with the two largest (basketball
2.36 MB, then 1.81 MB), against the same 37.75 MB ceiling. The headroom for a new attack is now "be no bigger than the two
largest together allow" instead of "fit in what is left of the whole roster".

`npm run perf:phone-run -- --interact --budget 300 --max-gl 6 --max-audio 80 --max-img 140` (the phone-budgets CI
command), prod build, Playwright's headless shell, no attack equipped:

| | before (main) | after |
| --- | --- | --- |
| decoded SFX at the fight | 146 clips, 56.2 MB | 132 clips, 53.2 MB |
| peak audio | 62.2 MB | 60.9 MB |
| peak iOS estimate | 294 MB | 284 MB |
| missed plays | 1 | 1 |
