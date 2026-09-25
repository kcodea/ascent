# 2026-09-25 — ElevenLabs voiceover generator (`vo:generate` / `vo:approve`)

Owner ask: generate announcer voice lines from text with the team's ElevenLabs subscription instead of supplying
audio files, without disturbing the existing announcer.

- **Build-time, not runtime.** A runtime call would ship the API key in the build, add latency to a game moment
  and bill per player. `npm run vo:generate` calls ElevenLabs on a dev machine; the game only ever sees mp3s.
- **Two-step, overwrite-proof.** Takes land in the gitignored `vo-drafts/`; `npm run vo:approve -- <id> <take>`
  copies one into the voice's `dest` folder and refuses to overwrite, so the 77 recorded announcer clips cannot be
  replaced by accident. Wiring the new name into `ANNOUNCER_LINES` stays a deliberate hand edit.
- **Never re-bills.** A per-line hash (text + voice + model + settings) in `vo-drafts/state.json` skips lines
  already generated; lines already shipped are skipped outright; `--dry` prints the character cost first.
- **Voice:** the announcer's original Voice Design voice (`R0MVIMlQlTPetmN2WE4N`). Voice Design voices cannot be
  published to the Voice Library, so the owner joined the creator's ElevenLabs workspace to use it directly.

Files: `packages/tools/src/vo.lib.ts` (+ test), `vo-generate.ts`, `vo-approve.ts`, `packages/tools/vo-lines.json`,
`docs/voiceover.md`.
