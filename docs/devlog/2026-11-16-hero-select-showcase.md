# 2026-11-16 — Hero Select showcase layout (DEV-only trial)

A new layout for the Hero Select screen, built behind a DEV switch and **off by default**. Turn it on with `?heroshowcase=1` in the URL or the DEV menu entry "Hero Select: showcase layout" (remembered on this machine; `?heroshowcase=0` turns it off). It needs the party home look. With the switch off, or in Practice and Gauntlet (any offer of more than six heroes keeps the browse grid), the screen is exactly today's.

**What it is.** Instead of three big banners: a row of hero tiles (portrait, name, Health, Armor) with one gold glow that slides to the selected tile, a re-roll button on each tile's top-right corner, the large hero card for the selected hero underneath with previous / next arrows, and a big Select Hero button. Clicking a tile or an arrow, or pressing Left / Right, only selects; Up / Down step the Ancient on show. The pick, its guards, the re-roll rules, Versus, Duos and watch mode all stay in `HeroSelect`. The body is loaded lazily, so it never reaches the switch-off path.

**What is shared.** The card is now `HeroInspectCard`, used by both the Compendium's `PhHeroPop` and the pick screen, including the Ancients row. The Compendium markup moved into it as it was.

**The ceremony.** `HeroSelectCeremony` has an optional `splash` source. With it, the clone is the card's splash art instead of a hero card, it travels to `splashDest` (the party-home 667×844 art frame) and the focus travel targets `coverSquare`; the tiles leave at the dismiss beat. Without it, the card path is untouched.

**Forced jumps.** A Versus timeout pick or a watched pick selects its hero first, then reads the splash art a frame later. While that holds, the root carries `hss-snap` so the card shows without its entrance animation and the art is measured at its settled size. `hss-snap` is cleared when the player selects another tile and when a new offer arrives. If the lazily loaded body has not resolved by the next frame, the jump retries each frame, giving up after 120 frames.

**Cleanup in this entry.** After a re-roll the focused re-roll button unmounts, so the body takes focus back and the arrow keys keep working. The sliding glow, the difficulty chip (now read from `heroTip`) and the `hss-snap` reset have tests.

**What version one leaves out.** The phone layout, the small-touch portrait position, and players.

**For the owner to judge by eye.** The tests cover behaviour, not looks: whether everything fits at 1920×1080 with the longest power text, and how the splash-to-portrait crossfade reads. The sizes in `heroShowcase.css` are first guesses.
