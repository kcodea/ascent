# Expedition art prompts (2026-10-17)

One-line image prompts for **EXPEDITION**, the co-op PvE mode in
[`docs/design/2026-10-17-coop-mode-scope-v3.md`](../design/2026-10-17-coop-mode-scope-v3.md) (v3). The format and
the style block follow `docs/art-prompt-system.md`. Each line starts with the item's exact v3 name, which is the name
`art:wire` matches on. Lines that do not use a v3 name are listed under **Naming notes**.

This is design and art only. Nothing here is wired into the game. v3 23.8 says: placeholders first, and the owner
names files before any wiring.

## 1. Generate these first (the MVP, v3 23.8, Phase 0a): 44 lines

| Group | Count | Lines | File |
|---|---|---|---|
| Enemy portraits | 21 | Hollowling, Egg Sac, Brood Nurse, Hollow Spitter, Gobbling, Crumb Thief, Pot-Belly, Glutton Brute, Thorn Cutpurse, Briar Guard, Hexer, Bandit Chief, Glowmoth, Moth Swarm, Lamplighter, Vault Guardian, Sentinel, Squire, Gob, Goblin, The Gobbler King | Expedition Enemies |
| Boss cards | 2 | Sentinel Pair, Gob and Gobbo (the third MVP boss card, The Gobbler King, reuses his enemy portrait) | Expedition Boss Cards |
| Hero power icons | 1 | Cleanser (the other 7 MVP powers reuse existing icons, see section 3) | Expedition Hero Powers |
| Curse icons | 5 | Rot, Supper, Junk, Toll, Debt | Expedition Runes and Curses |
| Mode rune | 1 | Rune of the Belly | Expedition Runes and Curses |
| Seal icon | 1 | Seal | Expedition Runes and Curses |
| Painted UI | 9 | Gold Gap Edge, Haul Row Backing, Shared Pill, Enemy Frame, Enemy Taunt Frame, Curse Frame, Curse Frame Oval, Boss Pill, Elite Pill | Expedition UI and Backdrops |
| Generic loot art | 4 | Generic Link, Generic Graft, Generic Burst, Generic Card | Expedition Loot |

Two of these are my calls, not v3's:
- **Generic loot art.** v3's MVP art list has no loot row, so I read that as placeholder kind art. The four generic
  pieces cover all MVP loot until each entry gets its own painting.
- **Enemy Taunt Frame and Curse Frame Oval.** v3 names one enemy frame and one curse frame. ASCENT draws Taunt minions
  in a shield frame and other minions in an oval, so enemies with Taunt (Egg Sac, Pot-Belly, Briar Guard, Sentinel)
  need the shield version. Junk is a Shop minion, so it needs an oval curse frame. Curse cards use the arched frame.

Worth adding if there is room: **The Hollows Backdrop**, the Act 1 backdrop. v3 lists it under full run, not MVP.

## 2. Per-file counts: 228 lines

| File | Lines | What |
|---|---|---|
| `Expedition Enemies.txt` | 57 | Act 1: 23 (15 pack units, Vault Guardian, Sentinel, Squire, Gob, Goblin, Mother Hollow, Hollow Half, The Gobbler King). Act 2: 16 (Jormun, Jormun Head, Jormun Tail, Coil, Scale, The Grand Tithe, Collector, Aurex, Noctra, Sunscale, Moonscale, Eclipse, Glasswing, Shard, Grubb, Grubb's Guard). Act 3: 8 (Voltara, Vel, The Hungering Star, Star Seed, The Linkbreaker, Severer, Colossus, Gearguard). Finale: 10 (The Seven-Crowned Engine, the 7 heads, The Pendulum, The Titan) |
| `Expedition Boss Cards.txt` | 4 | Aurex and Noctra, Sentinel Pair, Gob and Gobbo, One Crown |
| `Expedition Hero Powers.txt` | 7 | Cleanser, Tether, Rally Cry, Shared Pulse, Arc, Gravity Well, Spell Amplify |
| `Expedition Runes and Curses.txt` | 25 | 8 mode runes, 15 Curse icons (Scorched and Chilled are separate), 1 generic Curse pill icon, the Seal |
| `Expedition Loot.txt` | 112 | catalogue 1 to 57, Comeback C1 to C4, Both boards B1 to B12, Shared Slot S1 to S6, 8 boss-themed Wild cards, 6 Haul spells, 15 Link minions (plus Hinge, already counted in S6), 4 generic kind pieces |
| `Expedition UI and Backdrops.txt` | 23 | 12 frames, plaques and strips, 4 act backdrops, 7 doors |

**Order in the loot file** (by real keyword; files have no header lines because the automator reads one prompt per
line):
1. Shout
2. Echo
3. Rise and Rebirth
4. Avenge and Overflow
5. Taunt, Ward, Armor and Engraved
6. Rally
7. Slaughter and Pummel
8. Start of Combat and End of Turn
9. Gold
10. Gild
11. Shop spells, Rubies, Ales and Whispers
12. Starform
13. Aura
14. Wild and Shared Slot
15. Haul spells
16. Card minions (Copycat, Hinge, the Link minions)
17. Generic kind art

**Not prompted, because v3 does not name them yet:**
- Act 2 and Act 3 Brawl packs (about 14 units each)
- the Titan's seven Limbs
- Voltara's "Arcs"
- the Ghost's unnamed gift Burst

These make up most of the gap between the 57 enemies here and v3's estimate of about 95. Name them in the design doc
first, then prompt them.

**v3 count error:** v3 12.2 says "22 enemy portraits" for Act 1, but its own list adds up to 23. The MVP's 21 plus
Mother Hollow and Hollow Half also gives 23.

## 3. Reuse notes

**Boss cards.** v3 14.3 and 23.8 say a boss card reuses the enemy's painting inside the card frame. So 11 of the 15
boss cards need no new art: Mother Hollow, The Gobbler King, Jormun, The Grand Tithe, Voltara, Vel, The Hungering Star,
Glasswing, Grubb, The Linkbreaker and Colossus.

The other 4 get their own line because no single enemy painting fits them:
- **Aurex and Noctra** is one card showing two dragons.
- **Sentinel Pair** shows both Sentinels.
- **Gob and Gobbo** shows Gob plus a Gobbo, and Gobbo is not an enemy unit.
- **One Crown** has no enemy portrait at all.

To make the reuse a straight filename match, the enemy lines for those 11 use the boss-card spelling: Grubb, Colossus
and The Linkbreaker, not the unit labels "Breaker" or "Colossus of Counts".

**Boss portraits** (door panel, ribbon) are crops of the same paintings. Eclipse and The Seven-Crowned Engine have
their own enemy lines, so no separate portrait lines are needed.

**Hero powers.** v3 says 14 reuse existing icons and 6 are new. I reuse 13 and write 7 new ones, because Spell Amplify
cannot honestly reuse its old icon:

| Power | Reuses (`packages/ui/src/art/powers/`) | Hero |
|---|---|---|
| Aegis | `warden.webp` | Warden |
| Masterwork | `indy.webp` | Indy |
| Pulse | `myra.webp` | Auctioneer |
| Undying | `risen.webp` | Lord of the Risen |
| Goldspring | `nadja.webp` | Nadja |
| Reclaim | `soren.webp` | Soren |
| Copy Machine | `xerox.webp` | Xerox |
| Soulkeeper | `underdweller.webp` | Underdweller |
| All Hands | `djinn.webp` | Djinni (Cadence) |
| Displace | `darah.webp` | Darah (Swap) |
| Gildcrafter | `gildmaster.webp` | Gildmaster |
| Blade Mastery | `gorun.webp` | Gorun |
| Empowering Vines | `rayse.webp` | Rayse |
| **Spell Amplify** | **new line** | `spellAmplify` was retired off Rohan (now Yirin) on 2026-08-16, and `rohan.webp` now shows Yirin's Reflector, a stone hand |

The 7 new icons follow the existing look: one ornate gilded central object, one dominant glow colour, a dark blurred
backdrop lit by that glow, and the subject centred with margin for the circular crop.

**Mode runes** use the fixed rune template. v3 has no colour row for co-op mechanics, so I extended the table:

| Mechanic | Colour |
|---|---|
| Co-op, pair, Gold and Link (Belly, Coil, Rebate, Lightning Rod) | warm gold, the pair's colour from v3 17.2 |
| Curse (Brood) | violet, the Curse colour |
| Sun and Moon | gold and silver-blue split |
| Glass | pale silver |
| Seed | gold and cyan, the Starform row |

**Curses** use one fixed CURSE template: a cracked obsidian medallion with violet seams, a thorn rim and a violet gem.
Only the symbol changes. Junk and Bad Omen are also cards, so their icon can serve as their card art inside the curse
frames.

## 4. Naming notes and collisions (fix before export)

`art:wire` matches on filename. These names already belong to live content, or they are not v3 names.

| Line | Collides with | Proposed export name |
|---|---|---|
| **Rune of the Brood** (mode rune) | the live Demon rune `rune_brood`, "Rune of the Brood" (Imp summons). The v3 collision audit missed it | **Rune of the Split Brood** (rename it in v3 too) |
| **Leech** (Curse) | the Set 2 Demon minion Leech (roster and master `Set 2 Minions/Demons/Leech.png`) | **Leech Curse** |
| **Copycat** (loot card minion #56) | the Set 1 token Copycat (roster and master) | **Twin Copycat** (rename in v3) |
| **Echo Chamber** (starter Link) | the Set 1 quest "Echo Chamber" (`q_echo_chamber.webp`) | **Echo Chamber Link** |
| **Star Seed** (Hungering Star object) | the Set 4 Celestial "Star Seed" | **Hungering Star Seed** |
| **The Titan** (finale) | the old-style hero master `Heroes/Old Artstyle/Titan.png` (not an exact match, but close) | keep **The Titan** |
| Aegis, Masterwork, Pulse, Undying, Goldspring, Reclaim, Copy Machine, Soulkeeper, Gildcrafter, Blade Mastery, Empowering Vines | the existing hero powers with these names | intended: these are reused, not prompted |
| Mother Hollow, The Gobbler King, Gob and Gobbo | enemy and boss card (or elite) share a name | intended: one painting, one file |

**Names that are not in v3, which I made up (please confirm):**
- **Jormun Head and Jormun Tail.** v3 just says "Head" and "Tail", which would clash with the finale's "Echo Head" and
  the others.
- **Grubb's Guard.** v3 only says "3 guards 5/5".
- **Generic Link, Generic Graft, Generic Burst and Generic Card.** The bare words would collide with any future card
  named "Link" or "Card".
- **Frames and pills:** Shared Pill, Boss Pill, Enemy Taunt Frame, Boss Frame, Curse Frame Oval and Vel Frame.
- **Backdrops:** `<Act> Backdrop`, so they don't collide with the boss name "The Seven-Crowned Engine".
- **Doors:** `<Door> Door`. "Vault" alone is in Rune of the Vault.

## 5. Format notes

- **Character lines** use the doc's §5 style block and self-contained negatives, verbatim. There is one size and build
  anchor per subject, and bosses are anchored "three times the height of a person" or bigger. Each line has one action
  with an explicit facing. The camera rotates so no two neighbouring lines share a slot, and each background is
  graded in the complement of the subject's colour.
- **Enemies** add one fixed ENEMY clause: a menacing expression and a thin red rim light. Red is the enemy colour in
  v3 17.2. Each pack also keeps its own palette:
  - Hollow Brood: plum chitin and sickly-yellow egg glow
  - Gobble Gang: greasy olive and burlap
  - Thornback Bandits: rust-red cloaks and black brambles
  - Lantern Moths: midnight-blue wings and cyan lantern glow
  - Act 2: jade, gold and silver-blue
  - Act 3: storm, glass, void and iron
  - Finale: black iron and white marble, the boss colours
- **The spell block** is the live Whisper spell block from `docs/art-prompts-set3-missing.txt`, with its Whisper-only
  "electric-blue" clause swapped for "the colour named above". Each loot card glows in its keyword's colour, and its
  kind gets a small mark:
  - Link: a gold chain link
  - Graft: gold root-stitches
  - Burst: a one-shot flare

  The keyword colours are my first pass, so check them against the in-game pills:

  | Keyword | Colour |
  |---|---|
  | Shout | orange |
  | Echo | teal |
  | Rise | white-gold |
  | Avenge | wine-red |
  | Taunt | steel-blue |
  | Ward | sky-blue |
  | Rally | scarlet |
  | Slaughter | crimson |
  | Pummel | burnt orange |
  | Start of Combat | electric yellow |
  | End of Turn | indigo |
  | Gold and Gild | gold |
  | Shop spells | magenta |
  | Rubies | crimson |
  | Whispers | electric blue |
  | Starform | gold and cyan |
  | Aura | emerald |
  | Wild | prismatic |
- **UI pieces** are painted only (no vector or code-drawn look), with exact sizes:
  - Backdrops: 16:9, 1920 by 1080, the same as `backdrops/hall.webp`.
  - Minion-frame overlays: 1059 by 1427, matching `frames/oval-*.webp`.
  - Taunt overlays: 1086 by 1448, matching `frames/taunt-*.webp`.
  - The arched curse frame: 705 by 862, matching `spell-frame-arch.webp`.
  - The gold gap edge: a vertical strip, 128 by 2048, tileable.
  - The Haul backing: 4:1.
  - Pills: 3:1.
  - Doors: 2:3.

  Frame overlays describe an "empty dark centre to be masked" on a transparent background. After masking, measure
  the window again and retune the frame constants in `styles.css`, as `apps/web/public/frames/README.md` says.
