# Doc Bot retro-validation harness

Measures Doc Bot's GENERIC detection against real historical bugs: each entry in `reinject.py` reintroduces
one shipped bug's core defect as a minimal source patch (anchored on today's code), `reinject.sh` runs the
Doc Bot suite against it and classifies CAUGHT / MISSED / UNPATCHABLE. Run from a THROWAWAY worktree — the
script hard-resets `packages/` between bugs:

```bash
git worktree add --detach ../ascent-retro HEAD && cd ../ascent-retro && npm install
bash packages/tools/retro/reinject.sh
```

Full `git revert` was tried first and is not viable on churned files (13 of 18 conflicts). The catalog grows
one entry per interesting historical fix; a MISS is the signal to build a generic oracle (see tripwires 16
and 17, both born from this harness's first run — which measured **0 of 7** out-of-sample catches and
corrected the estimated 65–75% coverage claim to a measured one).

Measured verdicts live in docs/docbot-roadmap.md.
