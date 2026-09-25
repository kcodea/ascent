# Voiceover generator (ElevenLabs)

Write a line as text, run one command, get an mp3 in the game's voice. Generation happens on a dev machine
only: the API key never ships in the web build or the exe, and players never spend credits.

## One-time setup

1. In ElevenLabs, create an API key (profile → **API Keys**).
2. Add it to the `.env` file at the repo root (gitignored — never commit it):

   ```
   ELEVENLABS_API_KEY=your_key_here
   ```

The announcer voice is already configured in `packages/tools/vo-lines.json` (voice ID `R0MVIMlQlTPetmN2WE4N`,
the original Voice Design voice, reached through the shared ElevenLabs workspace).

## Adding lines

1. Add entries to `lines` in `packages/tools/vo-lines.json`. The `id` is the final file name:

   ```json
   { "id": "triple-3", "voice": "announcer", "text": "Triple! Now that's how it's done." }
   ```

2. Preview the cost (sends nothing): `npm run vo:generate -- --dry`
3. Generate: `npm run vo:generate` — takes land in `vo-drafts/triple-3.take1.mp3`.
   - `--takes 3` makes 3 takes of each new line; `--more 2` adds 2 more takes to lines already generated;
     `--only triple-3,tier-six-3` limits the run.
   - Re-running is free: lines already generated with the same text/voice are skipped, and lines already in
     the game are never regenerated. Editing a line's text regenerates it from take 1.
4. Listen in `vo-drafts/`, then approve the take you like: `npm run vo:approve -- triple-3 2`
   - Copies it to `apps/web/public/announcer/triple-3.mp3`. **It refuses to overwrite an existing file**, so
     the recorded clips can never be replaced by accident.
5. Wire it: add `'triple-3'` to the right event in `ANNOUNCER_LINES` (`packages/ui/src/announcer.ts`). A
   brand-new moment (a new event) also needs its trigger in `announcer.ts`; the generator only makes audio.
6. Commit the mp3 together with the `vo-lines.json` + `ANNOUNCER_LINES` change.

## Good to know

- **Cost** is per character per take (the dry run prints the total). Hundreds of short lines fit easily in a
  monthly allowance; retakes are what add up.
- **Adding a take to an existing event reshuffles which take a seed plays** (the variant is `seed % takes`),
  so an old replay may hear a different line. Voice only — gameplay is unaffected.
- **Voice settings**: omit `settings` to use the voice's own saved settings in ElevenLabs (recommended, so new
  lines match the old ones). Per-voice overrides (`stability`, `similarity_boost`, `style`, `speed`) change
  the line hash, so changing them regenerates.
- **More voices** (e.g. hero lines): add another entry under `voices` with its own `id` and `dest` folder.
