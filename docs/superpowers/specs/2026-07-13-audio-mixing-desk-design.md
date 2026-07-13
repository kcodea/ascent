# Audio Mixing Desk — Design Spec

**Date:** 2026-07-13
**Owner:** Mike (presentation / audio)
**Status:** Draft for review

## Goal

Give the game a **robust, config-driven audio mixing desk** so that as hundreds of sound clips arrive, we can
tune levels, grouping, and the master limiter from one place — with meters and realistic auditioning — instead
of hand-tuning per-clip gains and editing hardcoded limiter values.

**Success:** all audio dials live in one typed config (no hardcoded limiter, no scattered per-category
defaults); clips route through **category buses** into a **tunable, metered master limiter**; a dev console
tunes buses + master live, plays realistic **stacks**, shows **peak + gain-reduction meters**, and exports the
tuned config as the shipped default. Day-one audio is unchanged (defaults seeded from today's values).

## Chosen approach (A1)

Category buses (level faders) → one tunable, metered master limiter. Per-bus compressors are present in the
config but ship **off** (flipping them on later is Approach 2 — a config flag + a console section, no refactor).

## Current state (what this replaces)

`packages/ui/src/sfx.ts`:
- Graph: `source → per-play gain (sampleVol[cat] × masterVol) → master limiter → mute bus → destination`.
- Master limiter **hardcoded** (`threshold -6, knee 0, ratio 20, attack .001, release .25`); not tunable/visible.
- Levels **per-category** via `SAMPLE_VOL_DEFAULTS` (~30 keys), persisted (`ascent.sfxvol`), tuned in the dev
  `SfxMixer` (per-key slider + single-clip ▶ + "Copy values" JSON).
- `masterVol` (`ascent.vol`) multiplied per-play; no buses; no meters; preview is one clip at a time.

## Architecture

### 1. `audioConfig` — the single source of truth
New `packages/ui/src/audio/config.ts`:

```ts
export type BusName = 'ui' | 'combat' | 'voice' | 'hero';

export interface CompConfig { threshold: number; knee: number; ratio: number; attack: number; release: number; }
export interface BusConfig  { gain: number; comp: CompConfig | null; }   // comp === null → bypass
export interface CategoryConfig { bus: BusName; gain: number; }

export interface AudioConfig {
  masterGain: number;                          // was `masterVol` — now one node
  master: CompConfig;                          // the master limiter
  buses: Record<BusName, BusConfig>;
  categories: Record<string, CategoryConfig>;  // every sfx category → { bus, gain }
  clips: Record<string, number>;               // optional per-clip gain overrides (by sample key); default {}
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = { /* seeded from today's limiter + SAMPLE_VOL_DEFAULTS */ };
```

- `DEFAULT_AUDIO_CONFIG` is seeded so **nothing changes audibly** on day one: `master` = the current limiter
  values, per-category `gain` = the current `SAMPLE_VOL_DEFAULTS`, bus gains = 1, `comp: null`.
- Live config = `DEFAULT_AUDIO_CONFIG` deep-merged with a `localStorage` override (`ascent.audiocfg`).
- Pure helpers (unit-tested): `mergeConfig(defaults, saved)`, `effectiveGain(cfg, category, clipKey)` (=
  `categories[category].gain × (clips[clipKey] ?? 1)`), `busOf(cfg, category)`.

### 2. The audio graph (buses)
`clip/synth → playGain(effectiveGain) → busGain[bus] → busComp?[bus] → masterLimiter → masterGain → muteBus → destination`

- Four bus nodes (a `GainNode`, + a `DynamicsCompressor` only if `comp !== null`) built once when the context
  is created, wired to the master limiter.
- **Both** sample playback (`playSample`) and synth cues (`tone`) route through a bus: they gain a `category`
  argument; the player resolves `{ bus, gain }` from the config and connects into that bus's input (replacing
  today's `out(a)` → destination-or-limiter shortcut). Cues that are pure fallbacks reuse their sample's
  category; pure-synth cues (e.g. `maxGold`, `triple`, `win`, `lose`, `attack`, `tick`) get an explicit category
  in the config so they, too, are bussed and tunable.
- `masterVol` moves from a per-play multiply to a single `masterGain` node (a targeted cleanup).
- Rebuilding on config change: changing a compressor/gain updates the existing node's `.value` (no re-wire);
  toggling a bus `comp` on/off inserts/removes that bus's compressor node.

### 3. The console (dev tool)
Rebuild `SfxMixer` (opened from `DevMenu`, dev-only, stripped from prod) into a desk with sections:

- **Master** — the 5 limiter dials (threshold/knee/ratio/attack/release) + a **peak meter** + a
  **gain-reduction meter** (reads `DynamicsCompressor.reduction`).
- **Buses** (×4) — a level fader + peak meter each (+ GR meter when that bus's `comp` is on).
- **Categories** — grouped under their bus, each with a gain slider, a **bus dropdown** (reassign live), and a
  ▶ preview. (Today's per-key mixer, reorganized.)
- **Scenes** — buttons that fire realistic **stacks** so you tune against overlap, not single clips:
  - *Combat beat* — attack + 2 deaths + shield-break + a card-voice, fired within ~200 ms.
  - *Shop spam* — buy ×3 + roll + play, rapid.
  - *Hero moment* — hero select + hero power.
  - *Torture* — one of everything at once (the limiter stress test).
- **Export config** — copies the whole live `AudioConfig` as JSON to paste into `DEFAULT_AUDIO_CONFIG`.

Metering: one `AnalyserNode` tapped on each bus + the master; a single rAF loop (only while the panel is open)
reads peak/RMS into the meter bars. GR from `DynamicsCompressor.reduction`. rAF stops when the panel closes.

### 4. Default bus taxonomy (seeded; all reassignable live)
- **ui** — `buy sell roll freeze unfreeze discover inspect clickthock cardtouch reorder upgrade deny pulse cardlanding castspell`
- **combat** — `smack(attack) death divineshieldbreak rebornshatter rebornsummon skullburst triggerpulse triggerglow buff maxgold summon combatStart taunt shield`
- **voice** — `cardVoice cardEffect cardDeath`
- **hero** — `heroSelect heroPower`

(Any category not explicitly mapped defaults to `ui` gain 0.6, so a new cue is never unbussed.)

### 5. Persistence, export, migration
- Live edits persist to `localStorage` `ascent.audiocfg` (the whole `AudioConfig`).
- **Migration:** on first load, if `ascent.audiocfg` is absent, seed it from any existing `ascent.sfxvol`
  (per-category gains) + `ascent.vol` (→ `masterGain`), so a tuner's current work isn't lost. The old keys are
  then superseded (left in place, harmless).
- **Export** bakes the tuned config back into `DEFAULT_AUDIO_CONFIG` (paste-over).
- `setVolume`/`isMuted`/`toggleMute` (the Esc-menu player controls) keep working: `setVolume` writes
  `masterGain`; mute stays the mute-bus mechanism.

## Error handling / edge cases

- No `AudioContext` (SSR/headless/blocked autoplay) → config still parses; playback no-ops as today.
- A category with no config entry → falls back to `ui` / 0.6 (never throws, never unbussed).
- A saved config missing new fields (schema drift) → `mergeConfig` fills from defaults (forward-compatible).
- Meters/rAF only run while the dev panel is open (zero cost in play/prod).

## Testing

Pure, unit-tested (`config.test.ts`, no Web Audio):
- `mergeConfig`: saved overrides win; missing fields filled from defaults; unknown keys preserved.
- `effectiveGain` / `busOf`: category gain × clip override; unmapped category → `ui`/0.6 fallback.
- default seeding: every current `SAMPLE_VOL_DEFAULTS` key has a category entry with a valid bus; master
  matches the current limiter values (so day-one is unchanged).
- scene definitions: each scene references only real cue keys.

Web-Audio wiring + meters + the console: verified live in `npm run dev` (dev panel) — the node graph, the
meters responding to a *Torture* scene, and Export round-tripping. (Headless can't exercise real audio.)

## Out of scope (this spec)

- **Per-bus compressors as a shipped feature** (Approach 2) — the config field + graph slot exist and are
  bypassed; turning them on (dials in the console) is a follow-up.
- **Sidechain ducking** (voicelines duck under combat) — future; needs a sidechain graph.
- **Ingest loudness normalization** (LUFS-normalize clips in `sfx:import`) — the complementary asset-pipeline
  piece (option C from brainstorming); its own spec later.
- Music / ambient beds (none exist yet).

## Open decisions for review

1. **Bus count/names** — assumed 4 (`ui/combat/voice/hero`). Add a `spell` bus, or fold as mapped?
2. **Scenes** — the four above (Combat beat / Shop spam / Hero moment / Torture). Add/rename any?
3. **Export target** — assumed paste-over of `DEFAULT_AUDIO_CONFIG` in `config.ts` (matches today's "Copy
   values" workflow). Prefer a separate JSON asset the code imports instead?
