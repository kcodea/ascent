# 2026-10-29 — Spectator stands + emote bubbles: no mirroring, no overlap, bigger

Owner ask: "Need to clean up spectators and their emotes. It's cluttered and emotes cover each other. They are also
kinda small. Emotes are too. Also, mirrored emotes on the lobby rail come out backwards so text doesn't work".
Rule: R-EMOTE-LAYOUT-01.

**What.** Emote art has its words painted in, so the old `scaleX(-1)` mirror for right-edge speakers (rail rows, the
Versus foe block, the combat foe) printed them backwards. Bubbles are now never mirrored: a right-edge speaker's bubble
sits to the LEFT of the face, as painted, level with it (`side: 'left'`); your portrait and spectator plates keep the
painted up-and-right placement (`side: 'right'`). Bubbles are larger (self 340, rail 236, foe 270, spectator 232 stage
px, x1.25 on a phone). The stands (player's Spectating indicator and a spectator's own HUD) are one column at the top
left: 88 px rings, larger names, max three (two under a spectator's own plate) then "+N".

**How.** `emoteBubble.ts` keeps each live bubble's box. `settleBubble` (pure) tries the natural spot, then slides along
the anchor (quarter-height steps, down/up, up to `slide`) until the box (inset 6% for the art's transparent margin)
clears every live box. No room, or the caps (9 live, 3 spectators) full: the bubble waits, one per speaker, and is
admitted when a bubble leaves; stale after 4 s. Layout is read once per bubble (and per admitted waiting one), never
per frame; the WAAPI pop still animates transform + opacity only.

**Judgement calls.** No hand-painted right-tailed bubble exists, so a left-side bubble's tail points away from the face
(the art can't be mirrored); a painted variant could restore the tail later. A spectator bubble can briefly cover the
left edge of the tier gem on desktop (the only free lane right of the stands column).
