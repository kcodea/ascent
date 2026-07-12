# ASCENT — Audio Recording & Usage Guide

Everything you need to add sound to the game. The whole system is **data-driven and silent-by-default**:
a clip plays purely because a file with the right name exists — no code changes, ever. Drop a file, run one
command, hear it in game.

> **New here?** Read the TL;DR, then open **[`sfx-guide.html`](sfx-guide.html)** (double-click it) for the
> visual checklist of every sound to record. `sfx-manifest.md` is the same list in text form.

---

## TL;DR — the loop

```
1. Record a short .mp3 (~0.3–0.5s).
2. Name it by card/hero + what it's for:   Pennycat death.mp3   warden power.mp3   alley effect.mp3
3. Drop it in   audio-inbox/
4. Run          npm run sfx:import        → it moves to the exact path + updates the manifest/guide
5. Run          npm run dev               → trigger the action in game and listen
```

That's it. Repeat per sound. The importer figures out the exact filename and folder for you.

---

## 1. What sound plays when

Every sound is **optional and layered**: the game always plays a generic "bed" for an action, and *if* a
matching per-card/hero clip exists, it plays on top. Nothing errors when a clip is missing — it's just silent.

| Sound | Fires when | File (under `packages/ui/src/audio/`) |
|---|---|---|
| Minion **play** | a minion is played from hand to the board | `cards/<id>.mp3` |
| Minion **death** | that minion dies in combat | `cards/<id>.death.mp3` |
| Card **effect** | its Battlecry fires in the shop, **or** its Deathrattle / Start-of-Combat / trigger fires in combat | `cards/<id>.effect.mp3` |
| Spell **cast** (unique) | that spell is played from hand | `cards/<id>.mp3` |
| Spell **default bed** | *any* spell is cast (plays under the unique clip) | `castspell.mp3` |
| Hero **select** | you pick that hero in Hero Select | `heroes/<id>.mp3` |
| Hero **power** | you use that hero's power | `heroes/<id>.power.mp3` |
| **System / UI** cues | buys, sells, rolls, tavern-up, discover, deaths, etc. | top-level `*.mp3` (already shipped) |

`<id>` is the card/hero's **internal id** (e.g. Pennycat = `alley`, Yirin = `rohan`). You don't have to know
these — the importer maps display names to ids for you, and every filename is listed in the guide.

**"Vanilla" minions** (no Battlecry/Deathrattle/effect) have no `.effect.mp3` — the manifest marks those rows
`➖`. Recording an effect clip for one does nothing (it never fires).

---

## 2. Recording a sound — the full workflow

### Step 1 — Record & export
Export a short **`.mp3`**. Most cues want to be ~0.3–0.5s; a hero power or a big death can be a touch longer.
Keep levels moderate — the game has a master limiter, and you can fine-tune per-clip loudness later (§5).

### Step 2 — Name the file
Name it by **card or hero name (or its id)** + a **variant word** at the end:

| You're recording… | Name it like | Also accepted |
|---|---|---|
| a minion's play/cast clip | `Pennycat.mp3` | `alley.mp3` |
| a minion's death | `Pennycat death.mp3` | `alley death.mp3`, `pennycat_death.mp3` |
| a Battlecry/Deathrattle clip | `Pennycat effect.mp3` | `pennycat battlecry.mp3`, `alley deathrattle.mp3` |
| a hero's select clip | `Warden.mp3` | `warden select.mp3` |
| a hero's power | `Warden power.mp3` | `warden_power.mp3` |
| the default spell bed | `castspell.mp3` | — |

Separators (space, `_`, `-`, `.`) all work, and the name-matching is **fuzzy** (a small typo still resolves).
The variant word must be **last**. If you'd rather be exact, use the guide's **"copy path"** button to get the
precise filename and name your file that (e.g. `alley.death.mp3`) — that works too.

### Step 3 — Drop it in `audio-inbox/`
Drag the file(s) into the `audio-inbox/` folder at the repo root. (It's created automatically the first time
you run the importer, and it's git-ignored — nothing in it gets committed.)

### Step 4 — Import
From the repo root:
```
npm run sfx:import
```
It resolves each file to its exact target, **moves confident matches** into `packages/ui/src/audio/…`, and
prints a report:
- **moved** — `Pennycat death.mp3 → cards/alley.death.mp3`
- **skipped** — target already exists (use `--force` to overwrite), or not an `.mp3`
- **left in inbox** — couldn't match confidently, with suggestions (rename and re-run)

Then it auto-runs `npm run sfx:manifest` to refresh the manifest + guide (statuses flip `⬜ → 🎙️`).

**Preview first:** `npm run sfx:import -- --dry` shows what *would* happen without moving anything.

### Step 5 — Hear it in game
```
npm run dev
```
Trigger the action: play the card, use the hero power, start a combat, etc. (see §6). If you don't hear a
new clip, reload the page; if it still doesn't pick up, restart `npm run dev` (Vite indexes the audio folders
at startup).

---

## 3. Import command reference

```
npm run sfx:import                 # move confident matches, then refresh the manifest/guide
npm run sfx:import -- --dry        # preview only; move nothing
npm run sfx:import -- --keep       # copy instead of move (leaves originals in audio-inbox/)
npm run sfx:import -- --force      # overwrite targets that already exist
npm run sfx:import -- --no-manifest# skip the manifest/guide refresh
npm run sfx:import -- --inbox DIR  # use a different drop folder
```
> Note the `--` before flags (that's how npm passes them through to the script).

---

## 4. The manifest & the visual guide

Two files in `docs/audio/`, **both generated by `npm run sfx:manifest`** from the real card/hero/spell data —
so they can never fall out of sync with the card set:

- **`sfx-guide.html`** — the interactive worklist. **Double-click to open** in any browser (offline, no
  server). Search, filter to "to record", collapse by section, copy the exact save-path, and check off rows
  as you go (your check-offs save in that browser). This is what you record against.
- **`sfx-manifest.md`** — the same list in Markdown. The **Status** column is the shared source of truth:
  `⬜` to record · `🎙️` recorded (file exists) · `✅` shipped · `➖` N/A. The **Creative brief** column is
  yours to edit (it's preserved across regenerations); the Filename/Trigger columns are regenerated.

Run `npm run sfx:manifest` any time to refresh both (the importer does it for you automatically). Edit only
the **Creative brief** and **Status** columns in the `.md`; never hand-edit the Filename/Trigger columns or
`sfx-guide.html` (regenerated from `sfx-guide.template.html`).

---

## 5. Volume & mixing

Each **category** has a default loudness multiplier (in `packages/ui/src/sfx.ts`, `SAMPLE_VOL_DEFAULTS`):

| Category | Default | Category | Default |
|---|---|---|---|
| `cardVoice` (play/cast) | 0.18 | `heroSelect` | 0.50 |
| `cardEffect` | 0.18 | `heroPower` | 0.50 |
| `cardDeath` | 0.18 | `castspell` (spell bed) | 0.68 |

Two ways to adjust:
- **Per-clip, live (dev):** run `npm run dev`, open the **Dev menu → 🔊 SFX Mixer**, and drag the sliders while
  triggering sounds. Levels persist to your browser (`localStorage` key `ascent.sfxvol`). Great for balancing
  a loud clip against the mix without re-exporting.
- **Per-clip, permanent:** normalize/trim the `.mp3` itself and re-import with `--force`.

**Players** control the overall mix from the in-game **Esc menu**: a master **Volume** slider and a **Mute**
toggle (persisted as `ascent.vol` / `ascent.muted`). All audio also routes through a master limiter, so
overlapping clips can't clip the output.

---

## 6. Verifying a sound in game

Run `npm run dev`, then trigger the sound:

| Sound | How to trigger |
|---|---|
| play / cast | buy the card, then play it from hand |
| card **effect** (shop) | play a minion whose Battlecry fires |
| card **effect** (combat) / **death** | build a board with the card, **Face the Omen**, watch the fight |
| hero **select** | start a run and pick that hero |
| hero **power** | in a run, press the hero-power button |

Combat sounds only play during the replay, so you need an actual fight to hear death/combat-effect clips.
(Headless/preview browsers can't reliably play or capture audio — verify in a real `npm run dev` tab.)

---

## 7. Adding clips as a team (Kevin + Mike)

Audio files are normal committed assets. To add a batch:

1. Branch off latest `main`: `git switch -c chore/audio-<batch>`.
2. Record → drop in `audio-inbox/` → `npm run sfx:import` (this moves the `.mp3`s into `packages/ui/src/audio/`
   and updates `docs/audio/sfx-manifest.md` + `sfx-guide.html`).
3. Commit the new `.mp3`s **and** the regenerated manifest/guide together, open a PR, let CI go green, merge.
4. After merging, whoever's recording next: `git pull` — the manifest shows the updated `🎙️` statuses for both
   of you (the guide's check-offs are per-browser; the manifest is the shared record).

`audio-inbox/` is git-ignored, so half-processed drops never get committed.

---

## 8. Troubleshooting

- **A clip I added isn't playing.** Confirm the file is at the exact path the guide shows (the importer
  handles this). Reload the page; if still silent, restart `npm run dev` (the audio folders are indexed at
  startup). Check the Esc-menu volume isn't muted/zero.
- **The importer left my file in the inbox.** It couldn't match the name confidently — read its suggestion,
  rename (e.g. use the display name or the id from the guide + a variant word), and re-run. Use `--dry` to
  test names safely.
- **It says "`<id>` has no effect to voice."** That minion is vanilla (no Battlecry/Deathrattle), so a
  `.effect.mp3` would never fire — nothing to record there.
- **Wrong hero/minion matched.** Names can collide; be explicit (use the id, or add the variant word). Check
  with `--dry` before committing to a batch.
- **The manifest/guide look stale.** Run `npm run sfx:manifest`. They regenerate from the current card set;
  never hand-edit the Filename/Trigger columns or `sfx-guide.html`.

---

## Where things live

```
packages/ui/src/audio/
  *.mp3                     system/UI cues + castspell.mp3 (the spell bed)
  cards/<id>.mp3            minion play / spell cast
  cards/<id>.death.mp3      minion death
  cards/<id>.effect.mp3     Battlecry / Deathrattle / trigger
  heroes/<id>.mp3           hero select
  heroes/<id>.power.mp3     hero power
packages/ui/src/sfx.ts      the sound bank (loader, categories, volumes, mixer API)
packages/tools/src/sfx-import.{ts,lib.ts}    the drop-folder importer
packages/tools/src/sfx-manifest.{ts,lib.ts}  the manifest + guide generator
docs/audio/sfx-manifest.md  the canonical checklist (shared status)
docs/audio/sfx-guide.html   the visual worklist (double-click to open)
audio-inbox/                the drop folder (git-ignored)
```
