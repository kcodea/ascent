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

## Card id ↔ name

| id | name | id | name |
|----|------|----|------|
| **Beasts** | | **Mechs** | |
| `alley` | Alleycur | `drone` | Spare Part Drone ✅ |
| `pack` | Pack Scrounger | `cling` | Cling Drone |
| `kennel` | Kennelmaster | `selfless` | Selfless Sentinel |
| `cleaver` | Ravenous Cleaver | `cap` | Shield Capacitor |
| `matron` | Bristleback Matron | `arc` | Arclight Reactor |
| `gnash` | Gnasher, the Overrun | `junk` | Junkyard Titan |
| `pack6` | Spirit of the Pack | `omega` | Omega Bulwark |
| **Dragons** | | **Demons** | |
| `whelp` | Ember Whelp ✅ | `imp` | Voracious Imp ✅ |
| `cleric` | Hoard Cleric | `feed` | Soulfeeder |
| `cinder` | Cinderwing Matron | `pact` | Pactstone Acolyte |
| `razor` | Razorscale Warlord | `brood` | Brood Matron |
| `chrom` | Chromatic Caller | `maw` | Maw of the Pit |
| `nadir` | Nadir, Hoardlord | `glut` | Ravening Glutton |
| `gale` | Galewing Apex | `sov` | Abyssal Sovereign |
| **Undead** | | **Neutral** | |
| `spore` | Sporeling | `sandbag` | Pocket Sandbag |
| `toxin` | Toxin Tender | `broker` | Brightwing Broker |
| `knit` | Grave Knit | `echo` | Echo Warden |
| `rot` | Rot Weaver | `drummer` | Doublecast Drummer ✅ |
| `maex` | Webspinner Matron | **Tokens** | |
| `plague` | Plaguebringer | `pup` | Pup |
| `ghast` | Ghastweaver | `stray` | Stray |
| | | `impscrap` | Imp Scrap |
| | | `discoverspell` | Glimpse Beyond |

✅ = art added.
