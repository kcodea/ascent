<!-- See CLAUDE.md → Collaboration + ONBOARDING.md for the full flow. Keep PRs small (< ~400 lines). -->

## What & why


## Checklist
- [ ] Branched off latest `main`; rebased before opening
- [ ] Stayed in scope (no unrelated "while I was in there" refactors)
- [ ] `npm run typecheck && npm run lint && npm test && npm run build:web` all green locally
- [ ] Didn't casually touch a hot/shared file (`core/src/types.ts`, `sim/src/state.ts`+`reducer.ts`, `ui/src/store.ts`, generated `opponentPool.data.ts`) — coordinated if I did
- [ ] Updated `docs/devlog.md` + `docs/roadmap.md` + README summary if this changes behavior
- [ ] Read the full diff before pushing

## Notes for the reviewer

