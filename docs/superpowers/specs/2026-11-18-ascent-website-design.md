# ASCENT website: landing page (design)

Date: 2026-11-18. Owner: Mike. Status: owner questions answered; awaiting owner approval of this document.

Items marked **(owner)** are the owner's words or decisions. Items marked **(call)** are choices made while
writing this up; the owner has not ruled on them and may overturn any of them.

## Intent

ASCENT has no website. The game reaches people only as the Windows installer on GitHub Releases. The owner wants
a public site that is "a hub for generating excitement over the game and a way for players to download it"
**(owner)**.

A stranger who lands on it should come away knowing what makes ASCENT different, see the style and look the game
is going for, and be one click from a free download **(owner)**. The game's own UI, which the owner loves, should
be brought forward onto the page rather than described **(owner)**.

The page does NOT explain what an auto-battler is. The first mockup did that and the owner rejected it: "I'd
rather focus on the special mechanics we have" **(owner)**. The page assumes a visitor who knows the genre and
sells what is special here.

## Goals

1. A visitor understands, within the first screen, that this is an auto-battler you play on your own time.
2. Each special mechanic is shown with the real game on screen, paired with short supporting text.
3. One obvious, working, free download for Windows, at the top and the bottom.
4. The page looks and feels like the game's title screen, not like a brochure about the game.
5. It loads fast for a stranger on an ordinary connection, on a phone as well as a desktop.

## Non-goals (this build)

- Login, account pages, or showing a player's stats on the site. The owner called this "a longshot" and said
  "we should not focus on that part yet" **(owner)**. Nothing here should block it later (see Constraints).
- A card compendium, patch notes pages, guides, leaderboards, a blog, or a news feed.
- A mailing list, wishlist, or sign-up flow. The game is free and downloadable now.
- A how-to-play tutorial.
- Mac, Linux, or in-browser play.

## Anti-goals (a failure even if it works)

- A generic "what is an auto-battler" explainer.
- A page that looks like a template with game screenshots dropped in.
- Promising a feature that is not live in the game a visitor would download.
- A slow or janky page. The game's north star is snappiness; a sluggish site contradicts the pitch.

## The page

One page, read top to bottom. The owner approved this story and order from mockup 2
(`.superpowers/brainstorm/6650-1794976101/content/page-story.html`, a throwaway sketch; its layout is a guide,
its wording and colours are not final).

1. **Top.** Title-screen sky-castle art (`apps/web/public/homescreen.webp`), the ASCENT crest
   (`apps/web/public/frames/title-logo.png`), a one-line pitch, a Download button, and "Windows, free to play".
   Working headline **(call)**: "The auto-battler that waits for you."

2. **Play on your time** (the async pitch; leads because no live-lobby competitor can claim it **(call)**).
   Four points, all **(owner)**:
   - The timer stops to give you a moment to think, during Discovers, the Runeforge, Ancient select and similar
     choices.
   - The Gold Fuse: the turn timer does not start counting down until you have spent a set amount of Gold.
   - You can still rearrange your board after your time is up.
   - You can save and quit, then return to exactly where you left off.

3. **The Runeforge.** Run-long powers bought at the forge: four are offered, you take one
   (`docs/GAME-RULES.md`, "Runes (the Runeforge)"). Shown as a real forge offer.

4. **The Ancients.** Live in the game **(owner)**. Each hero has six Ancients it can get. A player builds
   toward summoning one by earning 16 points: 1 point for each shop roll and 2 points for each completed combat
   round. They then Discover three of that hero's six at random and choose one, which modifies their hero power
   for the rest of the game **(owner)**. The six: Bonds, Death, Fortune, Genesis, Time, War
   (`packages/ui/src/art/ancients/`).

5. **Everything is tracked.** "Robust tracking" **(owner)**: the Career page, rating over time, placements, and
   opening a past game to see its board and runes; the ranked ladder medals.

6. **Earn it.** Cosmetics are earned by playing: the higher you place in a match, the more you earn
   **(owner)**. The promise on the page, in the owner's words: Aether and cosmetics "are and will always be free
   to earn and unlock" **(owner)**. Shown with the chest tiers (Standard, Rare, Epic, Legendary, Ancient) and
   what they hand out (hero attacks, portraits, frames). The page does not say "never pay to win"; it uses the
   owner's promise above.

7. **Other game modes.** A small section **(owner)** covering Versus, Duos and Gauntlet: one short line and one
   image each. It is deliberately smaller than sections 2 to 6.

8. **Bottom.** The Download button again, then a small footer.

The owner also said "and more" after tracking and cosmetics. Nothing further was named, so nothing further is in
this build; a new section is a small, additive change later.

### Text and captures together

The owner wants text that "really does well to accent and support the frames and cards" **(owner)**. So in every
section the captured game UI is the main thing and the text supports it: a short eyebrow label, one headline, one
or two sentences. No section is text-only, and no paragraph runs long.

Copy **(call)**: the builder drafts all wording in the game's player-facing voice (plain, says what the player
sees, never how it is built); the owner edits. Player-facing terms follow the rename table in
`docs/GAME-RULES.md`.

## Constraints

- **Lives in this repo** as a new workspace app, `apps/site` **(call)**, so it can use the game's art and tokens
  directly and so the later account work can sit beside it.
- **Does not import game runtime code.** No `@game/ui`, `@game/sim` or `@game/core` imports. The game UI is built
  for one scaled 1920x1080 stage with its own global styles; the site is an ordinary scrolling, responsive page.
  The game's rules about `#stage`, `stageHost()`, `--lvw` and viewport units do NOT apply to the site, and the
  site's CSS must not leak into the game.
- **Uses the game's look.** Fonts (Outfit for titles and UI, Nunito Sans for body), the colour tokens in
  `DESIGN.md`, the Gem-plate button, gold edges, and the gauntlet cursor on desktop. Art is taken from the game's
  existing files at build time, not re-exported by hand, so there is one source.
- **Only art meant to ship publicly** goes on the site.
- **Fast.** Looping motion uses `transform`/`opacity` only, as in the game. Videos are muted, lazy-loaded, have a
  poster frame, and are skipped for visitors who ask for reduced motion.
- **Repo rules still apply:** own branch and worktree off `origin/main`, PR, green `verify`, no `title=`
  tooltips.

## Approaches

Three ways to get the game's UI onto the page were considered.

1. **Captures (chosen).** A small standalone static site. Each section shows the real game as a short looping
   video or a still. Fast to load and build, and video carries the motion and effects. Cost: a capture goes stale
   when the game's UI changes, until it is re-recorded.
2. **Live game components.** Import the real card, rune and chart components. Always matches the game and allows
   hovering real cards. Cost: the game UI assumes the scaled stage and its global styles, so making pieces behave
   on a scrolling page and on phones is a project of its own, and it puts the game's weight on a page strangers
   must load instantly.
3. **Captures now, a few live pieces later.** Option 1, then one or two live pieces where interaction earns it.

Dropped early: a site builder (Squarespace, Framer) cannot carry the game's UI over; hosting the page inside the
game's own web app would make strangers load the whole game to read a pitch.

**The owner picked option 1** ("go with 1"). It is to be built so that option 3 stays possible: sections are
self-contained, so one can later swap its capture for a live piece without touching the rest.

## How it is built (calls, unless marked)

- **Stack (call):** Vite, plain HTML, CSS and a little TypeScript. No framework; the page is static.
- **Hosting (call):** Cloudflare Pages, since the project already deploys to Cloudflare. There is no domain yet
  **(owner)**, so it launches on the free Cloudflare Pages address; a domain can be attached later with no rebuild. Deployed by its own
  script (`npm run site:deploy`), separate from Ship Ascent. Ship Ascent is unchanged and never deploys the site;
  deploying the site never publishes a game release.
- **Download (verified):** the button links to
  `https://github.com/kcodea/ascent/releases/latest/download/ASCENT-Setup.exe`, the same stable link Ship Ascent
  maintains. The repo is public, so this works for anyone.
- **Non-Windows and phone visitors (call):** the button stays but reads as Windows-only, with a way to send
  themselves the link. No fake download.
- **Captures (call):** stored under `apps/site/public/captures/`, one per section slot, with a short list in the
  app's README naming each slot and what it should show, so re-recording is a known chore. The builder records the first set **(owner)**. The eight main slots:
  a Discover with the timer frozen; the Gold Fuse; rearranging the board after time is up; Save & Quit and
  Continue; a Runeforge offer and pick; Ancient select; the Career chart with a game pinned; a chest opening.
  The three "Other game modes" entries use stills **(call)**.
  Until a real capture exists, a slot shows a still built from game art, never an empty box.
- **Sharing (call):** page title, description, and a social share image so a pasted link looks right.
- **Counting visits (call):** Cloudflare Web Analytics (no cookies, no banner), so the owner can see visits and
  download clicks. Easy to leave out.
- **The Windows warning (call):** the installer is not code-signed yet, so a first install shows a SmartScreen
  "unknown publisher" warning. A short, honest note sits beside the download button saying Windows will warn and
  how to continue. It is removed when signing lands.
- **What art may appear (call):** only art for things a player can already see in the live game. Excluded:
  Secret-rarity cosmetics and cards from sets not yet live.
  Any card shown comes from the currently live set.
- **Going public (call):** the builder never deploys to the public address on their own initiative. The work
  ends at a private preview link; the owner reviews copy and captures there and gives an explicit go before the
  first public deploy, and before each later one. Whether the existing Cloudflare token covers Pages is checked
  during the build.
- **Live modes:** because Versus and Duos are on the page, no wording anywhere claims the game is never played
  live. The async pitch is about the main lobby game.
- **CI (call):** a `build:site` step in the existing checks so a broken site build fails `verify`.

## Left to the builder

- Exact layout, spacing and responsive breakpoints for each section, starting from mockup 2.
- How art is pulled from the game's folders at build time.
- Video format, length, size budget and poster generation.
- The still fallbacks for each capture slot.
- Footer contents beyond the download link. There is no Discord or community link to include **(owner)**.

## Open questions for the owner

None. The six questions raised on 2026-11-18 were answered by the owner the same day and are folded in above
(Ancients, how cosmetics are earned, other game modes, who records captures, the address, the footer).
