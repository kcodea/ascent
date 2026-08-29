### feat(ui): the two-stage combat curtain — full-scene cover, NOW FACING, staged transitions

The one-day-old clip-path board wipe (#1257/#1270) grew into a full scene-transition system through a day of
owner iteration. What ships now:

**The curtain.** A body-portaled full-viewport layer (`.wipecurtain`, the boot splash's blue gradient) at
z250 — above the whole game scene, the Pixi FX canvas (z110) and every transient float layer, below only the
deliberate full-screen overlays (Esc 300+, hero select, loss numbers). Entry: cover sweeps L→R over the
UNTOUCHED shop, holds ~900 ms on a NOW FACING announcement (foe portrait + name, clipped INTO the curtain so
the sweeps carry it), reveals L→R. Exit mirrors it R→L with RETURNING TO SHOP (~700 ms hold). The clip cycle
is a natural round trip (parked left → full → parked right → full → parked left) — zero reset hacks. Decisive
combats (gameover/victory) snap the machine to idle: no curtain to the end screen (owner ask).

**Everything stages under the blue.** `store.combatStaged` publishes the covered window
(`coveredIn…coverOut`); keyed on it: the combat backdrop swap, BOTH armies' unit mounting (the reveal exposes
them standing; the fight starts `wipe === 'combat'` + 800 ms — no more 480 ms timer), the lobby rail slide,
the foe portrait drop/instant-exit (cached seat — `playerOpponent` already points at the NEXT pairing during
the exit cover), and the shop furniture (Tier/Refresh/Freeze/Gold hidden in combat, superseding the
2026-07-16/08-17 keep-the-furniture rulings). The `combatout` unit crossfade is retired from End Combat
(Skip still uses it): `endCombat` starts the cover FIRST and defers `resolveCombat` to full cover. Shop
overlays (Runeforge/quest/power/Discover/Choose One/scout) hold their render until the exit reveal completes.
End-of-Turn beats get +500 ms padding before the phase flips (both EoT paths; zero-beat turns skip it).

**Non-obvious traps hit and fixed, for the next session:**
- *Backstop-vs-transition race*: the sweep's safety timer could outrun a hitchy clip transition and swap the
  board in view → hold states wear `.settle` (transition: none), snapping the clip to full cover in the same
  frame anything swaps. Flash impossible by construction.
- *The old `.app.combat:not(.fighting)` tavern fold-up*, retargeted to `.staged`, folded the freshly-mounted
  ENEMY row invisible (`forwards` fill) until `.fighting` — read as minions popping in after the curtain.
  Rule deleted; the offers just stand until replaced under the blue.
- *Stacking*: the hero panels/foe portrait are body-portal stacking contexts — an in-`.app` curtain can never
  cover them (why the curtain portals to body). The Pixi wipe-streak def (`board-wipe`) was retired when the
  curtain moved above the FX canvas (it would play invisibly); the def stays committed for a future
  above-curtain layer. The CSS `.wipefront` glow carries the front.

**Board art.** Both boards now export from the owner's Aug-25 twin masters (`augustboard psd.png` /
`augustboardcombat.png` — identical except the tray corner) via `npm run board:export`: per-axis transform
re-anchored on the frame's GEMS (the button anchors, ±1 px), TRANSPARENT vertical bands (the masters carry
less sky than the canvas) filled by an owner-tunable vertical blend gradient (`--board-vedge-*`, Board Edge
tuner — the vertical twin of the ultrawide side blend). Update the 0.1297/0.8927 fractions in `.boardbg`
together with the export transform.

**Also**: foe hero-power icon (display-only `.heropowerbtn` twin, seated UNDER the portrait at z41, hover tip
as a z101 fixed SIBLING — a child can't out-stack the portrait from inside the icon's stacking context),
stage-anchored against ultrawide drift; ⚔️ Hero Duel tuner gained Power X/Y/size/opacity; owner-tuned duel +
vertical-blend defaults baked; End Combat gem wears the End Turn hover glow.
