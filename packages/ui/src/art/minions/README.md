# Minion art

Drop a PNG here named **by card id** — `whelp.png`, `drummer.png`, etc. — and it
replaces that card's pixel sprite everywhere (shop, warband, combat). Cards with
no file here keep their generated sprite, so this is purely additive.

- **Format:** PNG, transparent background (just the creature).
- **Size:** 512×512. Larger is fine but gets bundled as-is — downsize big exports.
- **Framing:** rendered `object-fit: cover`, anchored to the top of the art panel
  (~1.45:1 landscape crop). Keep the subject centred-upper with a little margin.

The build picks up files via `import.meta.glob` (see `../../art.ts`). If you add
the **first** files to a previously-empty folder while `npm run dev` is running,
restart the dev server once — Vite compiles the glob to an empty map at startup.
Subsequent additions hot-reload fine.

A card id can ship **multiple variants** (e.g. `pup.png` + `pup2.png`); `artFor()`
picks one per instance, stable by uid (~50/50), for flavour.

## Card id ↔ name (✅ = art wired)

| id | name | id | name |
|----|------|----|------|
| **Beasts** | | **Mechs** | |
| `alley` | Alleycat ✅ | `drone` | Spare Part Drone ✅ |
| `pack` | Mama Pup ✅ | `cling` | Cling Drone ✅ |
| `kennel` | Kennelmaster ✅ | `selfless` | Selfless Sentinel ✅ |
| `cleaver` | Ravenous Cleaver | `moneybot` | Money Bot ✅ |
| `gnash` | Gnasher, the Overrun | `arc` | Arclight Reactor |
| `grim` | Grim ✅ | `junk` | Junkyard Titan ✅ |
| `shaper` | Wildwood Shaper ✅ | `combinator` | Combinator ✅ |
| `spiritpup` | Spirit Pup ✅ | `omega` | Omega Bulwark ✅ |
| `spiritworgen` | Spirit Worgen ✅ | **Demons** | |
| **Dragons** | | `feed` | Soulfeeder ✅ |
| `whelp` | Ember Whelp ✅ | `imp` | Voracious Imp ✅ |
| `cleric` | Hoard Cleric | `brood` | Brood Matron ✅ |
| `cinder` | Cinderwing Matron | `heckbinder` | Heckbinder ✅ |
| `razor` | Razorscale Warlord | `maw` | Maw of the Pit ✅ |
| `weaver` | Arcane Weaver ✅ | `ritualist` | Ritualist ✅ |
| `karwind` | Karwind ✅ | `lifebinder` | Corrupted Lifebinder ✅ |
| **Undead** | | | |
| `spore` | Sporeling ✅ | **Neutral** | |
| `knit` | Grave Knit | `broker` | Brightwing Broker ✅ |
| `rot` | Rot Weaver | `echo` | Echo Warden ✅ |
| `maex` | Webspinner Matron | `buddy` | Buddy Buddy ✅ |
| `deathsayer` | Deathsayer ✅ | `guel` | Archmagus Guel ✅ |
| **Tokens** | | `monk` | Flowing Monk ✅ |
| `pup` | Pup ✅ (pup + pup2) | `drummer` | Drakko the Drummer ✅ |
| `stray` | Stray ✅ | `sylus` | Sylus the Reaper ✅ |
| `impscrap` | Imp ✅ | `chronos` | Chronos ✅ |
| `discoverspell` | Triple Reward ✅ | `fred` | Fred (Fodder) ✅ |

## Choose One: per-branch art

A Choose One card can ship a **different illustration per branch**, and the instance wears the art of the
branch it became (owner 2026-07-25). The wiring is pure naming — no card-data change:

| Option index | File | Example |
| --- | --- | --- |
| 0 | `<id>` (the base file) | `shaper.webp` — "Give your Beasts +1/+3" |
| 1 | `<id>2` | `shaper2.webp` — "Summon a 1/1 Stray" |
| N | `<id><N+1>` | … |

Drop the file and it's live — the Choose One prompt previews each option with its own art, and the pick
carries onto the board and into combat. A branch with no art falls back to the base file, so partial art is
fine. `chooseOneArt.test.ts` fails the build on a file numbered past the card's option count (dead art) or
on a stray `<id>1` (option 0 uses the base name).
