# 2026-09-09 — Scene Builder is a lobby game against bots; god / normal rules; the panel redesigned

**Owner ask:** "make the scene builder put you into a lobby game against bots instead of the old oath game
mode; add a button to set the rules to normal or god mode; keep the player invincible regardless; clean up the
[Scene Builder] tuning panel — make it much more sleek and easy to use."

## Scene Builder → practice-bots lobby

`startSceneBuilder` now builds a **practice-bots lobby** (`createLobbyRun(…, 'practice', { opponents: 'bots',
health: 'unlimited' }, setId)`) flagged `sandbox: true`, instead of the retired course-mode practice run. So the
rig has the eight-seat rail, real pairing, elimination and placement — what you build is tested against the flow
players actually meet. `createLobbyRun` grew an optional trailing `setId` so the rig can still pin an unreleased
set.

- **Invulnerable under every rule.** The practice invulnerability (`health !== 'normal'`) restores the seat each
  round; the sandbox additionally skips the practice **curtains** (round 15 and `courseRounds`) — a rig has no
  run length. It ends only when the lobby does.
- **Rules toggle** (`sbRules`, persisted at `ascent.sb.rules`): **God** = the classic feel (999-Gold float the
  panel keeps topped up + a 99999-second clock); **Normal** = the real shop clock at 1× (not the practice
  multiplier) and the real per-turn Gold. Flipping is live: god tops the Gold up, normal clamps it to this
  turn's `maxEmbers`. Every authoring tool (add cards, grant runes, edit either row, pin enemies) works under
  both.
- **Bot level** (`sbBotLevel`, persisted) is a dropdown; changing it relaunches, since seats are built at creation.

### The rig's enemy pin inside a lobby — `RunState.sandboxFoeWave`

A lobby fight serves the paired seat's board and ignores `servedBoards` — and the turn boundary stamps a pool
pick into `servedBoards[wave]` on every run, so "a pin exists" cannot mean "the rig wants it". The rig now marks
the wave it authored (`sandboxFoeWave = wave`; set by the Next-enemy dummies, "+ add enemy", and the click-to-edit
row), and `faceOmen`'s lobby branch serves the pin **only** when `sandbox && sandboxFoeWave === wave`. The lobby
round then settles from that fight as if the seat had brought it. A stale marker (earlier wave) is ignored.

With no authored pin, the enemy row shows the **paired seat's board** (a bot seat has bodies + tier but no
snapshot, so `foeSnapshotOf` stages one at the seat's own tier — `tier` feeds loss damage, so a level-5 bot's
tier-2 round-1 board must not become a tier-7 wall the moment you edit it). Editing it writes an authored pin.
The readout says "· the paired seat" / "· authored" so you know which you are looking at.

Tests: `packages/sim/src/sandboxLobby.test.ts` (pin override, marker semantics, invulnerability, no curtain, the
plain practice curtain still fires, set pinning), `packages/ui/src/sceneBuilderLaunch.test.ts` (the store door +
rules flip), and `foeSnapshotOf` cases appended to `sandboxEdit.test.ts`.

## The Scene Builder panel

The panel was eleven flat sections on a vellum face with dark inputs. It now wears the tuner panels' struck-brass
slate (scoped to `.scenebuilder`, so the bug-report side panel that shares the `.sb-*` classes is untouched) and
is organised as five **foldable** sections (state remembered at `ascent.sb.fold`):

- **Setup** — hero and set side by side, the God / Normal switch, the bot level + restart.
- **Table** — Gold, refill (god only), freeze and the three sweeps as one grid of same-sized tiles; the tier as a
  seven-way segmented row.
- **Enemy** — a shop-row / enemy-row switch, edit-mode, "+ enemy" and "rewatch" tiles, then the dummies and
  presets. The heading carries the live count ("1 / 7 · paired seat" or "· authored").
- **Library** — ONE search box with Cards and Runes as tabs over one taller list; ↵ adds the top card (or grants
  the top rune).
- **Scenarios** — the bug-report and QA bridges, folded by default: they are the rig's I/O, not its daily controls.

The header shows the round, seats left and the current rules, so the collapsed strip still says what the rig is
doing. (An earlier pass in this session restyled the 🛠️ Dev Tuning Menu instead; the owner clarified the ask
meant this panel, and that change was reverted before commit.)
