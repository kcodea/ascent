# Voiceover generator (ElevenLabs)

Write a line as text, run one command, get an mp3 in the game's voice. Generation happens on a dev machine
only: the API key never ships in the web build or the exe, and players never spend credits.

## One-time setup

1. In ElevenLabs, create an API key (profile → **API Keys**).
2. Add it to the `.env` file at the repo root (gitignored — never commit it):

   ```
   ELEVENLABS_API_KEY=your_key_here
   ```

The announcer voice is already configured in `packages/tools/vo-lines.json` (voice ID `GFNPDbkiJBcXfkZZsunT`,
an Instant Voice Clone of the original announcer on the owner's PAID account). Generate from that account: its
plan carries the commercial licence. The original Voice Design voice (`R0MVIMlQlTPetmN2WE4N`) lives on a free
plan, which grants no commercial rights, so it is not used.

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
- **Adding a take to an existing event** just adds it to the no-repeat bag the announcer draws from; nothing
  else changes.
- **Voice settings**: omit `settings` to use the voice's own saved settings in ElevenLabs (recommended, so new
  lines match the old ones). Per-voice overrides (`stability`, `similarity_boost`, `style`, `speed`) change
  the line hash, so changing them regenerates.
- **More voices** (e.g. hero lines): add another entry under `voices` with its own `id` and `dest` folder.

## Unit sounds and the voice cast

Every card can have its own clips, and the game plays them with no code: drop `<cardId>.mp3` (when it is
played), `<cardId>.death.mp3` (when it dies in combat) or `<cardId>.effect.mp3` (when its effect fires) into
`packages/ui/src/audio/cards/`. The generator can make all three.

The plan lives in the tracker's **Unit sounds** tab: each tribe has a small **cast** of voices (about 5), and
each unit is a **Talker** (speaks a short line in its cast voice) or a **Grunter** (a sound only). Death clips
are sound effects. The row id in the tracker is the clip id here.

### 1. Design the cast (once per tribe)

Cast voices are listed under `designs` in `vo-lines.json`: a `key`, a `name`, and a `description` (the Voice
Design prompt, 20-1000 characters).

1. `npm run vo:design -- --dry` lists what it would preview.
2. `npm run vo:design` asks ElevenLabs for a few preview voices per description, saved as
   `vo-drafts/voices/<key>.preview1.mp3`, `.preview2.mp3`, ... Previews cost credits (the sample text is billed
   like a line). `--only <key>` limits the run; `--redo` re-rolls a design that already has previews.
3. Keep the one you like: `npm run vo:design -- save dwarf-oldguard 2`. It becomes a permanent voice in the
   account and is added to `voices` under the same key, with `dest` = the card audio folder. Paste the new voice
   ID into the tracker's cast card too.

Mind the account's custom-voice limit (it depends on the plan): the cast is kept small for that reason.

### 2. Lines for talkers

A talker's line is an ordinary line in a cast voice. Its id is the card id:

```json
{ "id": "dw_orin", "voice": "dwarf-oldguard", "text": "Shield up. Oath sworn." }
```

A line may also carry its own `"dest"`, which overrides the voice's folder.

### 3. Sound effects for grunts, growls and deaths

Sound effects go under `sfx`:

```json
{ "id": "dw_brakka.death", "dest": "packages/ui/src/audio/cards",
  "prompt": "gruff older male dwarf soldier pained death groan, single short vocal sound, no words, no music, dry, close-mic",
  "duration": 1 }
```

- `duration` is in seconds (0.5-30). Short is cheaper and better: unit sounds should stay under about a second.
  If you leave it out, ElevenLabs picks a length.
- `influence` (0-1, default 0.3) sets how literally the prompt is followed.
- Saying "no words, no music, dry, close-mic" in the prompt keeps the sound clean.

`npm run vo:generate` makes lines and sound effects together (`--sfx` or `--lines` limits it to one kind). The
dry run prints both costs: characters for lines, and seconds for sound effects. `npm run vo:approve -- <id> <take>`
copies a take into the game. For card clips no wiring is needed: restart `npm run dev` (the audio folder is read
once at startup), run `npm run sfx:manifest`, and commit the mp3.

