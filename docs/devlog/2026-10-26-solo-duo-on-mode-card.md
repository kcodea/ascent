# 2026-10-26 — Solo | Duo moves onto the Ranked card

Branch `fix/solo-duo-on-mode-card`. Oracle `R-RANKED-DUOS-MODECARD-01` (and `R-RANKED-DUOS-PARTY-01`'s statement
updated). Owner, on a screenshot of the Choose a mode screen: "move the solo/duo toggle so that it is here, not at the
main menu. put it in the bottom left corner below/eclipsing the play art".

## What changed

- **One switch, on the Ranked card.** `PlayPartyToggle` (`versus/playParty.tsx`) renders once, in `Title.tsx`'s mode
  picker, as a SIBLING of the Ranked card's `<button>` (a button can't hold buttons) sharing its grid cell
  (`grid-area: hero; align-self: end; justify-self: start`). A negative bottom margin (not a transform, so the card's
  `menu-rise` entrance keyframe never fights it) puts it half on the art and half below, as PLAY eclipses the bottom
  centre. Looks: PLAY's family (`--cta-edge` pill and `--cta-depth` drop, the picked side in `--cta-face`, the other on a
  dark plate). Static; it rises in with the card (same one-shot).
- **Removed** from the menu sidebar and the main menu/title, with their phone rules (`phoneMenus.css`). The
  `onDuoPlayRequest` / `requestDuoPlay` plumbing (the sidebar asking the title for the Duos confirmation) is gone.
- **Play elsewhere opens the mode screen.** The sidebar's Play and the main menu's Play are back to opening the mode
  screen whichever side is picked (the least surprising: the switch you set is on the screen you land on, and nothing
  starts a game a click earlier than the card's PLAY).
- **The card's PLAY**: Solo is unchanged (tutorial nudge for a new player, then the ranked confirmation); Duo asks the
  Ranked Duos confirmation, whose Yes opens the party (as the old switch did; a new player is not nudged to the
  tutorial on the Duo path, as before).
- **Phone**: same corner, 40 pt tall, 13 pt text, sized through `--hs-zoom` like the tiles' name tags.
- Patch note line: "Pick Duo on the Ranked card, then Play." GAME-RULES "Getting in" updated.

## Tests

`rankedEntry.test.tsx`: one switch beside the card (not inside its button); none on the main menu, whose Play opens the
mode screen even with Duo; Duo + PLAY = Duos confirmation, Yes calls `enterDuosParty` and starts no solo entry; Solo +
PLAY = solo confirmation. `MenuSidebar.test.tsx`: no switch on the rail; Play opens the mode screen with Duo picked.
