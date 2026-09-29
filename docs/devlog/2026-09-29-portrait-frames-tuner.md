# 2026-09-29 — Portrait frames dev tuner (one frame renderer for every hero portrait)

Owner ask: "i added frames here: C:\Game Assets\Ascent Art\Ranked Rewards\Frames — can you branch off and put a
tuner in so i can swap out the hero portrait frames? this should reflect in career/leaderboard/in-game as well for
both player and opponents."

## Art

The eight masters were wired through the normal pipeline into `packages/ui/src/art/frames/`: `frame_default`
(the existing copper ring, byte-identical to `hero-select/heroportrait.png`), `frame_bronze`, `frame_silver`,
`frame_gold`, `frame_platinum`, `frame_diamond`, `frame_ascendant`, `frame_rank1`. `scripts/optimize-art.mjs`
gained the `frames` directory with a 768px cap (`MAX_BY_DIR`), because the in-game portrait and Now Facing paint
the ring at about 350 design px and 512 would soften it on a 1440p / 4K stage. 6.1 MB of PNG became 0.56 MB of WebP.

## One renderer

`packages/ui/src/portraitFrame/` holds the config (`portraitFrameConfig.ts`) and the renderer (`PortraitFrame.tsx`).
A surface calls `usePortraitFrame('self' | 'opp')`; `null` means "keep today's look". Otherwise it adds `pf-on`
plus `frame.hostStyle` to the element whose box is the round portrait disc and renders `<PortraitFrame>` inside it.
`pf-on` drops the surface's old CSS border or copper `::after` ring (border width kept, so nothing reflows),
un-clips the disc so the ring can overhang it, and rounds the art. The ring is one static image with an inline
percentage box computed once per tuner change; resolved frames are cached so memoised parents see a stable
reference, and production never notifies.

Surfaces (self = your portrait, opp = anyone else):

| Surface | Side |
| --- | --- |
| Hero select cards + the ceremony ring the champion snaps into | self |
| Shop / combat hero portrait (`StatusBar`, rides the lunge) | self |
| Combat opponent portrait (`CombatOpponent`, rides the lunge) | opp |
| Now Facing splash (`Recruit` wipe curtain) | opp |
| Lobby rail seat faces | self for your seat, opp for the rest |
| Fight recap foe face | opp |
| End screen (non-lobby modes) | self |
| Non-lobby HUD opponent frame (`OpponentFrame`) | opp |
| Career favourite hero, match rows, Heroes tab | self on your Career, opp on someone else's |
| Hall of Champions, Recent Games (`LbHeroFrame`) | opp |
| Rankings rows | self on your row, opp otherwise |
| Match details scoreboard | self for your seat, opp for the rest |
| Title-screen avatar corner | self |

The medal rank crests (`RankCrest`, also a `.portring`) deliberately do not change: they are medals, not portraits.

## Tuner

Dev hub, Stage & Layout: "Portrait frames". Your frame, Opponents' frame, Same for everyone, then Fit: Fit applies to
(all frames, or one frame's override), Frame scale, Portrait scale, Frame offset X / Y. Live preview of both sides
at 48 / 96 / 176 px, Clear frame override, Copy JSON (the whole state, for pasting into `DEFAULTS`).

Fit model: each frame's transparent hole was measured off its master's alpha (diameter + centre), so every ring
starts seated with the disc edge tucked under the inner lip (the same 0.9 / 0.86 overlap as the old `.portring`
recipe; `frame_default` reproduces that recipe exactly). The dials then adjust on top: scale multiplies the
measured size, offsets are % of the disc, and Portrait scale scales the art inside the disc.

Dev reads `ascent.portraitframes` from localStorage; production always plays `DEFAULTS`, which is `current` for both
sides, so shipping this changes nothing until a choice is baked.

Judgement call: the picker has a "Current (today's look)" entry as the baked default in addition to the eight art
frames, because today's look differs per surface (CSS borders in-game, the copper ring on Career / ladder rows) and
the brief says production keeps it.

## Ranked rewards later

Not built. The resolver already takes a per-player `frameId` (`usePortraitFrame(side, frameId)`), which wins over
the tuner. A future `frameForRank(division)` can map a medal to `bronze` … `ascendant` (and `rank1` for the ladder's
#1), and the chosen id can ride `RunCosmeticSnapshot` the way titles and skins do, so opponents' seats, Hall rows and
match details show the frame the player had when the snapshot was recorded.
