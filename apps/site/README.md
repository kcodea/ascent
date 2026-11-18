# ASCENT site

The static landing page for ASCENT. Plain HTML, CSS and a little TypeScript, built with Vite. It never imports game
code; art is copied in, not imported.

## Run and build

From the repo root:

- `npm run dev -w apps/site` starts the dev server (copies the art first).
- `npm run build -w apps/site` makes the production build in `apps/site/dist`.
- `npm run sync-art -w apps/site` copies the art from the game's own folders into the site.
- `node apps/site/scripts/make-placeholders.mjs` regenerates the placeholder stills in `public/captures`,
  `public/share.jpg` and the mode stills. Run it only to fill a gap; real captures replace the placeholders.

## Deploying

- `npm run site:preview` makes a preview deploy. It may be run freely.
- `npm run site:deploy` is the production deploy. Run it only after Mike has explicitly said go for that deploy.

Both scripts arrive in Task 7 of the site plan.

## Captures

Each capture slot is a still poster (`public/captures/<slot>.jpg`) that shows first. If a clip exists for the slot, the
visitor allows motion, and the clip actually plays, it replaces the poster. Otherwise the poster stays. To add a
clip, drop `<slot>.webm` and `<slot>.mp4` in `public/captures` and add the slot to `CLIPS` in `src/captures.ts`.

Clip rules:

- 4 to 8 seconds, and it loops cleanly.
- Cropped to the subject, not the whole screen.
- Two files: webm (VP9) and mp4 (H.264, faststart).
- No audio.
- At most 1280px wide and 1.5 MB per file.
- The poster is the clip's first frame.

After a UI change, re-record the affected slots from this table.

| Slot | What it must show |
| --- | --- |
| `discover-timer` | A Discover open with the turn timer visibly frozen. |
| `gold-fuse` | The Gold Fuse filling as Gold is spent, then the timer starting. |
| `rearrange` | A minion being dragged to a new slot after the turn's time is up. |
| `save-continue` | Save & Quit, then the title screen's Continue. |
| `runeforge` | A four-rune offer and one being bought. |
| `ancient-select` | The three-of-six Ancient Discover and a pick. |
| `career-chart` | The Career chart with a game pinned, its board and runes showing. |
| `chest-opening` | A chest opening through to the reward. |

Mode stills (one still each, 640x360, no clip):

| Still | What it must show |
| --- | --- |
| `mode-versus` | One representative Versus screen. |
| `mode-duos` | One representative Duos screen. |
| `mode-gauntlet` | One representative Gauntlet screen. |
