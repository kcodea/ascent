# Design: Daily Ascent Code Quiz

**Date:** 2026-08-14
**Author:** Mike + Claude
**Status:** Approved (brainstorming)

## Goal

A daily, beginner-friendly, multiple-choice quiz that teaches Mike how Ascent is coded — and coding
fundamentals along the way. It should get gradually deeper as he learns, and require near-zero effort to
take each day.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Delivery format | Interactive HTML page (click answers, instant grade + explanations). |
| Scheduling | Scheduled **cloud agent** (cron routine), fires each morning on its own. |
| Progression | Adaptive: tracks topics + scores, ramps difficulty only as Mike does well. Starts very gentle. |
| Questions/day | 5, all multiple-choice, 4 choices each. |
| Time | 8:00am ET (`0 12 * * *` UTC). |
| Model | Claude Sonnet 5. |

## Architecture

```
Every morning 8am ET
  routine (cloud, fresh checkout, no memory)
    -> git checkout `quiz` branch (never touches main)
    -> read docs/quiz/progress.json  (difficulty, topics, mastery, curriculum, history)
    -> read the REAL Ascent source + docs (grounding)
    -> generate 5 adaptive MCQs
    -> build self-contained interactive HTML
    -> publish as an Artifact (delivery) + archive HTML in repo (durable/fallback)
    -> update progress.json, commit + push to `quiz` branch
    -> final message = Mike's morning notification (no answers revealed)
```

**Two load-bearing ideas:**
1. **State in the repo.** The routine is stateless per run, so all memory (`progress.json`) lives on the
   `quiz` branch. That's what makes it adaptive rather than random.
2. **Grounded in real code.** The routine has a full checkout, so questions reference actual files
   (`packages/core/src/rng.ts`, the `CombatEvent` union, etc.) — teaching Mike his own game.

## Components

- `docs/quiz/daily-prompt.md` — the routine's self-contained operating instructions (the engine). Logic
  lives here, in the repo, so it can be improved without editing the routine config.
- `docs/quiz/progress.json` — the memory: difficulty, per-topic mastery, score history, curriculum.
- `docs/quiz/archive/<date>.html` — durable per-day quiz copy + fallback delivery.
- `docs/quiz/README.md` — human overview + how to change things.
- The **routine** itself: a short inline prompt that checks out `quiz` and defers to `daily-prompt.md`.

## Data flow: the adaptive loop

1. Morning run generates a quiz at current difficulty, favoring weak/uncovered topics; marks topics as
   `asked` in `progress.json` (can't know the score yet — grading is client-side).
2. Mike takes it in the browser.
3. Mike reports his score in a normal chat; that session updates mastery (+1 correct / −1 missed) and
   ramps `difficulty` by one step only after the last 3 quizzes average ≥ 80% (drops it if he tanks one).

## Error handling / edge cases

- **Artifact unavailable in a headless run:** fall back to the archived self-contained HTML; the final
  message says where it is. (Verified on first manual run.)
- **`quiz` branch missing:** the routine stops and reports rather than falling back to `main`.
- **Source drift:** the `quiz` branch snapshot can lag `main`; fine for fundamentals, and the routine may
  read `origin/main` directly for freshness.
- **No answer-key leakage:** answers/explanations are gated behind the click in the HTML and never printed
  in the notification message.

## Non-goals (YAGNI)

- No account system, no server, no database — a JSON file on a branch is the whole backend.
- No auto-grading pipeline back into progress — Mike reporting his score is simpler and fine.
- Not wired into the game build or `main` at all; it's a self-contained learning tool on its own branch.

## Verification

Create the routine, then trigger it once manually and inspect the run log to confirm: it lands on `quiz`,
reads progress, generates a grounded 5-question quiz, the Artifact renders, and it commits state back.
