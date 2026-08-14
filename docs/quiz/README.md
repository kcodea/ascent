# Daily Ascent Code Quiz

A daily, multiple-choice quiz that teaches Mike how Ascent is coded — beginner-friendly, adaptive, and
grounded in the real codebase. It exists to slowly build up his ability to read and reason about the game's
code (and coding in general).

## How it works

- A **scheduled cloud agent** (a "routine") wakes up every morning (8:00am ET) with a fresh checkout of the
  repo and **no memory** of past days.
- It runs the instructions in [`daily-prompt.md`](daily-prompt.md): read progress, read the real source,
  generate 5 grounded multiple-choice questions, build an interactive HTML quiz, and update progress.
- The quiz is delivered as an **interactive Artifact** in that morning's run — Mike opens it, clicks
  answers, and it grades + explains instantly. A self-contained copy is also archived in `archive/`.
- All state lives on the **`quiz` branch** (this branch). The routine never touches `main`.

## Files

| File | What it is |
|---|---|
| `daily-prompt.md` | The exact instructions the routine runs each morning. **Edit this to change how quizzes work** — question count, style, difficulty rules, topics. |
| `progress.json` | The memory: difficulty level, topics covered, mastery, score history, and the beginner curriculum. The routine reads and rewrites it daily. |
| `archive/<date>.html` | A durable, self-contained copy of each day's quiz (also the fallback if the Artifact isn't available). |

## The adaptive loop

1. Morning: routine generates a quiz at the current difficulty, favoring weak/uncovered topics.
2. Mike takes it in the browser (instant grading).
3. Mike replies in a normal chat with his score (e.g. "4/5, missed the RNG one").
4. That chat updates `progress.json`: mastery goes up on topics he got right, down on misses, and the
   global difficulty ramps up **one step only after the last 3 quizzes average ≥ 80%**. It starts very
   gentle and deepens only as he masters the basics.

## Changing it

- **Different time / cadence / model:** update the routine at https://claude.ai/code/routines (or ask
  Claude to `/schedule` update it).
- **Different style / harder / more questions:** edit `daily-prompt.md` on the `quiz` branch and push —
  the next run picks it up automatically. No routine change needed.
- **Reset progress:** edit `progress.json` (e.g. clear `topics`/`history`, set `difficulty` back to 1).

## Known tradeoffs

- The routine reads source from the `quiz` branch snapshot, which can drift behind `main` over time. That's
  fine for fundamentals (they don't change); for the freshest code it can read `origin/main` directly.
- Grading happens in the browser, so the routine can't know the score at generation time — mastery and
  difficulty only update when Mike reports back.
