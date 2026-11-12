# Portrait frames batch 10 and skins batch 19: more of the 8 Bit set (2026-11-12)

Owner: "added a few more".

## Portrait frames (6), all Epic by the folder

| id | Name | Master | Hole | Centre |
|---|---|---|---|---|
| `frame_8_bit_cyber` | 8 Bit Cyber | `Epic/8 Bit Cyber.png` | 0.7775 | 0.4956, 0.4825 |
| `frame_8_bit_electric` | 8 Bit Electric | `Epic/8 Bit Electric.png` | 0.7193 | 0.4944, 0.4772 |
| `frame_8_bit_jade_energy` | 8 Bit Jade Energy | `Epic/8 Bit Jade Energy.png` | 0.7648 | 0.4983, 0.4798 |
| `frame_8_bit_pearl` | 8 Bit Pearl | `Epic/8 Bit Pearl.png` | 0.815 | 0.4907, 0.4892 |
| `frame_8_bit_ruby` | 8 Bit Ruby | `Epic/8 Bit Ruby.png` | 0.7767 | 0.4935, 0.4803 |
| `frame_8_bit_water` | 8 Bit Water | `Epic/8 Bit Water.png` | 0.7616 | 0.4952, 0.4916 |

Wired with `npm run art:frames -- --apply`. Every hole is centred within the usual 0.05. Not yet seen on a portrait in game.

## Minion skin (1)

8 Bit Wrangler, a Legendary skin for Rope Wrangler (`skin_ropewrangler_3`, master `8 Bit Wrangler.png`).

## What moved

64 frames (10 Common, 10 Rare, 28 Epic, 9 Legendary, 7 Ancient). A first crate holds 92 Common, 145 Rare, 146 Epic, 107
Legendary and 33 Ancient items (each Epic 0.151%, Legendary 0.084%). Portrait frames are 11.6% of a first crate (was
10.8%). The Collection total is 572. Rules R-PROG-FRAME-05 and R-PROG-SKINS-27; GAME-RULES lists the new frames.

## Deploy

After the merge, deploy `progression-inventory` from `main`. No SQL. The art reaches players with the next release.
