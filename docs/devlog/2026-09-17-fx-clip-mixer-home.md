# FX: imported `fx/<slug>` clips get a mixer-board home (so imports can ship)

## The gap
PR 2 (sound import) writes an imported clip to `packages/ui/src/audio/fx/<slug>` with the id `fx/<slug>`, and
the point is that a committed clip ships for every player. But `clipFamily.test.ts` — the "every committed clip
has a home on the mixing board" guard — resolves each clip through `familyOf`, and an `fx/*` clip fell through
to the 1:1 default (`familyOf('fx/shout-effect') === 'fx/shout-effect'`), which isn't a real mixer category. So
the moment an author committed an imported sound, CI went red. The feature couldn't actually ship its output.

(Surfaced when the owner imported clips during an audition and the guard flagged three of them.)

## Fix
- `familyOf` routes any `fx/` clip to one shared **`fx`** category (their slugs are dynamic, so they can't each
  get a 1:1 fader).
- `config.ts` registers the `fx` category (combat bus — the `sound` primitive's own default bus) with a desk
  label. Playback still routes through the layer's chosen bus via `playFxSound`; this is where the imported
  clips GROUP on the desk, which is what the completeness guard requires.
- A unit test pins `fx/*` → `fx` directly, since imported slugs are dynamic and no committed `fx` clip need
  exist to exercise the globbed guard.

Dev-authoring pipeline fix (lets PR 2's imports ship) → no patch note.

Files: `packages/ui/src/audio/clipFamily.ts`, `packages/ui/src/audio/config.ts` (+ `clipFamily.test.ts`).
