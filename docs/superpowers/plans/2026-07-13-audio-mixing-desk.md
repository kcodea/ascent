# Audio Mixing Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all audio dials (per-category levels, category buses, master limiter) live in one typed `audioConfig`, route clips through buses into a tunable/metered master, and rebuild the dev `SfxMixer` into a mixing desk (bus faders, master limiter dials, live meters, realistic test-scenes, export).

**Architecture:** Phase 1 — a pure `config.ts` (types + defaults seeded from today's values + helpers) and a `sfx.ts` graph refactor (category buses + a master-gain node, playback routed by category→bus). Phase 2 — a config live-edit + meter + scene API on `sfx.ts`, and the desk UI. Day-one audio is unchanged (defaults = current limiter + gains). Per-bus compressors are wired but bypassed (Approach 1).

**Tech Stack:** TypeScript, Web Audio API, React (dev panel), Vitest.

---

## File Structure

- **Create** `packages/ui/src/audio/config.ts` — types, `CATEGORY_GAINS` (moved from sfx.ts), `CATEGORY_BUS`, `DEFAULT_AUDIO_CONFIG`, pure helpers (`mergeConfig`, `effectiveGain`, `busOf`).
- **Create** `packages/ui/src/audio/config.test.ts` — pure unit tests.
- **Create** `packages/ui/src/audio/scenes.ts` — test-scene definitions (pure data + a fire helper) + test.
- **Modify** `packages/ui/src/sfx.ts` — build buses + master-gain; route `playSample`/`tone` by category; load/persist/apply config; add the config/meter/scene API; convert callers from `sampleVol.X` → category key.
- **Rewrite** `packages/ui/src/SfxMixer.tsx` — the desk UI (master, buses, categories, scenes, export, meters).
- **Modify** `packages/ui/src/styles.css` (or the mixer's styles) — desk layout + meter bars.

---

## PHASE 1 — config + graph foundation

### Task 1: `config.ts` — types, defaults, pure helpers

**Files:**
- Create: `packages/ui/src/audio/config.ts`
- Test: `packages/ui/src/audio/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ui/src/audio/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_AUDIO_CONFIG, mergeConfig, effectiveGain, busOf, CATEGORY_GAINS } from './config';

describe('DEFAULT_AUDIO_CONFIG', () => {
  it('keeps the current master-limiter values (day-one unchanged)', () => {
    expect(DEFAULT_AUDIO_CONFIG.master).toEqual({ threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.25 });
    expect(DEFAULT_AUDIO_CONFIG.masterGain).toBe(1);
  });
  it('gives every current category a bus + its current gain', () => {
    for (const key of Object.keys(CATEGORY_GAINS)) {
      const c = DEFAULT_AUDIO_CONFIG.categories[key];
      expect(c, key).toBeDefined();
      expect(c.gain).toBe(CATEGORY_GAINS[key]);
      expect(['ui', 'combat', 'voice', 'hero']).toContain(c.bus);
    }
  });
  it('buses default to unity gain, compressor bypassed', () => {
    for (const b of ['ui', 'combat', 'voice', 'hero'] as const) {
      expect(DEFAULT_AUDIO_CONFIG.buses[b]).toEqual({ gain: 1, comp: null });
    }
  });
});

describe('mergeConfig', () => {
  it('overlays saved values and fills missing fields from defaults', () => {
    const merged = mergeConfig(DEFAULT_AUDIO_CONFIG, { masterGain: 0.5, categories: { buy: { bus: 'combat', gain: 0.9 } } });
    expect(merged.masterGain).toBe(0.5);
    expect(merged.categories.buy).toEqual({ bus: 'combat', gain: 0.9 });
    expect(merged.categories.cardVoice).toEqual(DEFAULT_AUDIO_CONFIG.categories.cardVoice); // untouched
    expect(merged.master).toEqual(DEFAULT_AUDIO_CONFIG.master);                              // filled from defaults
  });
});

describe('effectiveGain + busOf', () => {
  it('multiplies category gain by a per-clip override', () => {
    const cfg = mergeConfig(DEFAULT_AUDIO_CONFIG, { categories: { cardVoice: { bus: 'voice', gain: 0.2 } }, clips: { 'cards/alley': 0.5 } });
    expect(effectiveGain(cfg, 'cardVoice', 'cards/alley')).toBeCloseTo(0.1);
    expect(effectiveGain(cfg, 'cardVoice', 'cards/none')).toBeCloseTo(0.2); // no override → ×1
    expect(busOf(cfg, 'cardVoice')).toBe('voice');
  });
  it('falls an unmapped category back to ui / 0.6', () => {
    expect(busOf(DEFAULT_AUDIO_CONFIG, 'brand_new_cue')).toBe('ui');
    expect(effectiveGain(DEFAULT_AUDIO_CONFIG, 'brand_new_cue')).toBe(0.6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/ui/src/audio/config.test.ts`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 3: Write the implementation**

Create `packages/ui/src/audio/config.ts`. **Move the existing `SAMPLE_VOL_DEFAULTS` object verbatim** from
`sfx.ts` into this file as `CATEGORY_GAINS` (so the exact current gains carry over and stay one source of
truth), then add the bus map + config builder:

```ts
/** Audio config — the single source of truth for levels, buses, and the master limiter. Pure (no Web Audio):
 *  sfx.ts reads it to build/tune the graph; the dev desk edits it; helpers here are unit-tested. */

export type BusName = 'ui' | 'combat' | 'voice' | 'hero';
export const BUS_NAMES: BusName[] = ['ui', 'combat', 'voice', 'hero'];

export interface CompConfig { threshold: number; knee: number; ratio: number; attack: number; release: number; }
export interface BusConfig { gain: number; comp: CompConfig | null; }
export interface CategoryConfig { bus: BusName; gain: number; }
export interface AudioConfig {
  masterGain: number;
  master: CompConfig;
  buses: Record<BusName, BusConfig>;
  categories: Record<string, CategoryConfig>;
  clips: Record<string, number>;
}

/** Per-category gains — MOVED VERBATIM from sfx.ts's former SAMPLE_VOL_DEFAULTS (keep the exact numbers). */
export const CATEGORY_GAINS: Record<string, number> = {
  // <<< paste the exact former SAMPLE_VOL_DEFAULTS object contents here >>>
};

/** Which bus each category feeds (seeded default; reassignable live in the desk). */
export const CATEGORY_BUS: Record<string, BusName> = {
  buy: 'ui', sell: 'ui', roll: 'ui', freeze: 'ui', unfreeze: 'ui', discover: 'ui', inspect: 'ui',
  clickthock: 'ui', cardtouch: 'ui', reorder: 'ui', upgrade: 'ui', deny: 'ui', pulse: 'ui',
  cardlanding: 'ui', castspell: 'ui',
  smack: 'combat', death: 'combat', divineshieldbreak: 'combat', rebornshatter: 'combat', rebornsummon: 'combat',
  skullburst: 'combat', triggerpulse: 'combat', triggerglow: 'combat', buff: 'combat', maxgold: 'combat',
  summon: 'combat', combatStart: 'combat', taunt: 'combat', shield: 'combat',
  cardVoice: 'voice', cardEffect: 'voice', cardDeath: 'voice',
  heroSelect: 'hero', heroPower: 'hero',
};

const UNMAPPED: CategoryConfig = { bus: 'ui', gain: 0.6 };

function buildCategories(): Record<string, CategoryConfig> {
  const out: Record<string, CategoryConfig> = {};
  for (const [key, gain] of Object.entries(CATEGORY_GAINS)) {
    out[key] = { bus: CATEGORY_BUS[key] ?? 'ui', gain };
  }
  return out;
}

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  masterGain: 1,
  master: { threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.25 },
  buses: { ui: { gain: 1, comp: null }, combat: { gain: 1, comp: null }, voice: { gain: 1, comp: null }, hero: { gain: 1, comp: null } },
  categories: buildCategories(),
  clips: {},
};

/** Deep-merge a saved (partial) config over the defaults: saved scalars/entries win; missing fields filled. */
export function mergeConfig(base: AudioConfig, saved: Partial<AudioConfig> | null | undefined): AudioConfig {
  const s = saved ?? {};
  return {
    masterGain: s.masterGain ?? base.masterGain,
    master: { ...base.master, ...(s.master ?? {}) },
    buses: {
      ui: { ...base.buses.ui, ...(s.buses?.ui ?? {}) },
      combat: { ...base.buses.combat, ...(s.buses?.combat ?? {}) },
      voice: { ...base.buses.voice, ...(s.buses?.voice ?? {}) },
      hero: { ...base.buses.hero, ...(s.buses?.hero ?? {}) },
    },
    categories: { ...base.categories, ...(s.categories ?? {}) },
    clips: { ...base.clips, ...(s.clips ?? {}) },
  };
}

/** The category's bus (unmapped → ui). */
export function busOf(cfg: AudioConfig, category: string): BusName {
  return (cfg.categories[category] ?? UNMAPPED).bus;
}

/** category gain × optional per-clip override (unmapped category → 0.6). */
export function effectiveGain(cfg: AudioConfig, category: string, clipKey?: string): number {
  const g = (cfg.categories[category] ?? UNMAPPED).gain;
  const o = clipKey != null ? (cfg.clips[clipKey] ?? 1) : 1;
  return g * o;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/ui/src/audio/config.test.ts`
Expected: PASS (all cases green). If a `CATEGORY_GAINS` key is missing a `CATEGORY_BUS` entry it still passes
(falls to `ui`), but review the mapping so every real category is intentional.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/audio/config.ts packages/ui/src/audio/config.test.ts
git commit -m "feat(audio): audioConfig — typed levels/buses/limiter + pure helpers"
```

---

### Task 2: `sfx.ts` graph refactor — buses + master gain + config-driven routing

**Files:**
- Modify: `packages/ui/src/sfx.ts`

- [ ] **Step 1: Replace the hardcoded limiter + SAMPLE_VOL_DEFAULTS with config-built nodes**

In `sfx.ts`: remove the local `SAMPLE_VOL_DEFAULTS`/`sampleVol` machinery (now sourced from `config.ts`) and
build the bus graph in `audio()`. Add module state + imports:

```ts
import { DEFAULT_AUDIO_CONFIG, mergeConfig, effectiveGain, busOf, BUS_NAMES, type AudioConfig, type BusName } from './audio/config';

let cfg: AudioConfig = mergeConfig(DEFAULT_AUDIO_CONFIG, readSavedConfig());
const busNodes = new Map<BusName, { input: GainNode; comp: DynamicsCompressor | null }>();
let masterGain: GainNode | null = null;

function readSavedConfig(): Partial<AudioConfig> | null {
  try {
    const raw = localStorage.getItem('ascent.audiocfg');
    if (raw) return JSON.parse(raw) as Partial<AudioConfig>;
    // migrate the pre-desk keys the first time (per-category gains + master volume)
    const gains = JSON.parse(localStorage.getItem('ascent.sfxvol') ?? 'null');
    const vol = parseFloat(localStorage.getItem('ascent.vol') ?? '');
    const mig: Partial<AudioConfig> = {};
    if (gains && typeof gains === 'object') mig.categories = Object.fromEntries(Object.entries(gains).map(([k, g]) => [k, { bus: (DEFAULT_AUDIO_CONFIG.categories[k]?.bus ?? 'ui'), gain: Number(g) }]));
    if (Number.isFinite(vol)) mig.masterGain = vol;
    return Object.keys(mig).length ? mig : null;
  } catch { return null; }
}
```

In `audio()`'s `if (isNew)` block, after creating `master` (the limiter) and `bus` (the mute bus), build the
master-gain node + the buses, and set the master from config:

```ts
      applyMaster(master);                                  // (helper below) set limiter dials from cfg.master
      masterGain = ctx.createGain();
      masterGain.gain.value = cfg.masterGain;
      master.connect(masterGain);
      masterGain.connect(bus);                              // was: master.connect(bus)
      bus.connect(ctx.destination);
      for (const b of BUS_NAMES) {                          // build each bus feeding the master limiter
        const input = ctx.createGain();
        input.gain.value = cfg.buses[b].gain;
        let comp: DynamicsCompressor | null = null;
        if (cfg.buses[b].comp) { comp = ctx.createDynamicsCompressor(); applyComp(comp, cfg.buses[b].comp!); input.connect(comp); comp.connect(master); }
        else input.connect(master);
        busNodes.set(b, { input, comp });
      }
```

Add the apply helpers (near `audio()`):

```ts
function applyComp(node: DynamicsCompressor, c: { threshold: number; knee: number; ratio: number; attack: number; release: number }): void {
  node.threshold.value = c.threshold; node.knee.value = c.knee; node.ratio.value = c.ratio; node.attack.value = c.attack; node.release.value = c.release;
}
function applyMaster(node: DynamicsCompressor): void { applyComp(node, cfg.master); }

/** The node a clip in `category` should connect into (its bus input, or the raw destination pre-init). */
function busInput(a: AudioContext, category: string): AudioNode {
  const b = busNodes.get(busOf(cfg, category));
  return b ? b.input : (master ?? a.destination);
}
```

- [ ] **Step 2: Route playback by category (not a raw vol)**

Change `playSample`/`tone` to take a **category** and resolve gain + bus from config:

```ts
function playSample(name: string, category: string, delay = 0): boolean {
  if (isHidden() || audioSuspended) return false;
  const a = audio();
  if (!a || muted) return false;
  const buf = buffers.get(name);
  if (!buf) { loadSample(name); return false; }
  const src = a.createBufferSource(); src.buffer = buf;
  const g = a.createGain(); g.gain.value = effectiveGain(cfg, category, name);   // masterGain now lives on a node
  src.connect(g).connect(busInput(a, category));
  src.start(a.currentTime + Math.max(0, delay));
  return true;
}

function tone(o: ToneOpts & { category?: string }): void {
  // …unchanged oscillator setup…
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, o.vol ?? 0.18), t0 + 0.008);   // synth vol stays literal
  osc.connect(gain).connect(busInput(a, o.category ?? 'ui'));
}
```

- [ ] **Step 3: Convert every cue call site to pass its category**

In the `sfx` object, change each `playSample('buy1', sampleVol.buy)` → `playSample('buy1', 'buy')`, each
`playSample('cards/${cardId}', sampleVol.cardVoice)` → `playSample(\`cards/${cardId}\`, 'cardVoice')`, etc.
For synth-only cues, pass a category: `tone({ …, category: 'combat' })` (e.g. `attack`, `maxGold`→'maxgold',
`triple`/`win`/`lose`→'ui', `tick`→'ui', `temper`→'ui'). The `cardEffect`/`cardDeath` per-card layers pass
`'cardEffect'`/`'cardDeath'`; `heroSelect`/`heroPower` pass their keys.

- [ ] **Step 4: Keep the Esc-menu controls working**

`setVolume(v)` now sets `cfg.masterGain = v` + updates the `masterGain` node + persists; `getVolume` returns
`cfg.masterGain`. `isMuted`/`toggleMute`/`stopAllAudio`/`resumeAudio` (the mute bus) are unchanged.

```ts
export function getVolume(): number { return cfg.masterGain; }
export function setVolume(v: number): void {
  cfg.masterGain = Math.min(1, Math.max(0, v));
  const a = audio(); if (a && masterGain) masterGain.gain.setTargetAtTime(cfg.masterGain, a.currentTime, 0.01);
  persistConfig();
}
function persistConfig(): void { try { localStorage.setItem('ascent.audiocfg', JSON.stringify(cfg)); } catch { /* ignore */ } }
```

- [ ] **Step 5: Verify day-one audio is unchanged + it compiles**

Run: `npm run typecheck`
Expected: 0 errors — and specifically grep that no caller still passes the removed `sampleVol`:
`grep -n "sampleVol" packages/ui/src/sfx.ts` → **no matches** (all converted).
Then `npm run build:web` (0 errors). Live check (Step 7 of Task 4) confirms sound still plays; because
`DEFAULT_AUDIO_CONFIG` mirrors the old values and bus gains are unity, the mix is audibly identical.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/sfx.ts
git commit -m "refactor(audio): route sfx through category buses + master-gain, driven by audioConfig"
```

---

## PHASE 2 — the console (config API + meters + scenes + desk UI)

### Task 3: config live-edit + meter + scene API + scenes

**Files:**
- Create: `packages/ui/src/audio/scenes.ts`
- Test: `packages/ui/src/audio/scenes.test.ts`
- Modify: `packages/ui/src/sfx.ts` (exported desk API)

- [ ] **Step 1: Write the scenes test (failing)**

Create `packages/ui/src/audio/scenes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SCENES } from './scenes';
import { CATEGORY_GAINS } from './config';

describe('SCENES', () => {
  it('every scene references only real cue methods', () => {
    const cues = new Set(['buy', 'sell', 'roll', 'play', 'castSpell', 'attack', 'death', 'shieldBreak',
      'cardVoice', 'summon', 'heroSelect', 'heroPower', 'discover', 'skullBurst', 'buff', 'combatStart']);
    for (const scene of SCENES) {
      expect(scene.name.length).toBeGreaterThan(0);
      for (const step of scene.steps) expect(cues.has(step.cue), `${scene.name}:${step.cue}`).toBe(true);
    }
  });
  it('has the four planned scenes', () => {
    expect(SCENES.map((s) => s.id).sort()).toEqual(['combat', 'hero', 'shop', 'torture']);
  });
  // sanity: keeps the config import used (so a category rename breaks a test somewhere)
  it('config has categories', () => { expect(Object.keys(CATEGORY_GAINS).length).toBeGreaterThan(10); });
});
```

- [ ] **Step 2: Run it (fails — no module)**

Run: `npx vitest run packages/ui/src/audio/scenes.test.ts` → FAIL (`Cannot find module './scenes'`).

- [ ] **Step 3: Write `scenes.ts`**

```ts
/** Test scenes for the mixing desk: realistic stacks so you tune against overlap, not single clips.
 *  Each step names an `sfx` cue + a delay (ms). The desk fires them via `playScene` (sfx.ts). */
export interface SceneStep { cue: string; delay: number; arg?: string }
export interface Scene { id: string; name: string; steps: SceneStep[] }

export const SCENES: Scene[] = [
  { id: 'combat', name: 'Combat beat', steps: [
    { cue: 'attack', delay: 0 }, { cue: 'death', delay: 40 }, { cue: 'death', delay: 70 },
    { cue: 'shieldBreak', delay: 55 }, { cue: 'cardVoice', delay: 90, arg: '__first__' }, { cue: 'buff', delay: 120 },
  ] },
  { id: 'shop', name: 'Shop spam', steps: [
    { cue: 'buy', delay: 0 }, { cue: 'buy', delay: 90 }, { cue: 'buy', delay: 180 },
    { cue: 'roll', delay: 250 }, { cue: 'play', delay: 320 },
  ] },
  { id: 'hero', name: 'Hero moment', steps: [
    { cue: 'heroSelect', delay: 0, arg: '__first__' }, { cue: 'heroPower', delay: 300, arg: '__first__' },
  ] },
  { id: 'torture', name: 'Torture (all at once)', steps: [
    { cue: 'attack', delay: 0 }, { cue: 'death', delay: 0 }, { cue: 'skullBurst', delay: 0 },
    { cue: 'buy', delay: 0 }, { cue: 'summon', delay: 0 }, { cue: 'combatStart', delay: 0 },
    { cue: 'discover', delay: 0 }, { cue: 'buff', delay: 0 }, { cue: 'shieldBreak', delay: 0 },
  ] },
];
```

- [ ] **Step 4: Run it (passes)**

Run: `npx vitest run packages/ui/src/audio/scenes.test.ts` → PASS.

- [ ] **Step 5: Add the desk API to `sfx.ts`**

Export functions the desk uses. `AnalyserNode` taps on each bus + master feed the meters; setters mutate `cfg`
+ the live nodes + persist; `playScene` fires a scene; `exportConfig` returns the JSON.

```ts
const analysers = new Map<string, AnalyserNode>(); // 'master' + each bus name

function tapAnalyser(a: AudioContext, node: AudioNode, key: string): void {
  const an = a.createAnalyser(); an.fftSize = 256; node.connect(an); analysers.set(key, an);
}
// (call tapAnalyser(ctx, master, 'master') and per-bus input in audio()'s init block)

export function getAudioConfig(): AudioConfig { return cfg; }
export function setBusGain(b: BusName, v: number): void { cfg.buses[b].gain = v; const a = audio(); busNodes.get(b)?.input.gain.setTargetAtTime(v, a?.currentTime ?? 0, 0.01); persistConfig(); }
export function setMasterComp<K extends keyof CompConfig>(k: K, v: number): void { cfg.master[k] = v; if (master) (master as any)[k].value = v; persistConfig(); }
export function setCategory(cat: string, patch: Partial<CategoryConfig>): void { cfg.categories[cat] = { ...(cfg.categories[cat] ?? { bus: 'ui', gain: 0.6 }), ...patch }; persistConfig(); }
/** Peak level 0..1 for a meter key ('master' | bus name). */
export function meterLevel(key: string): number {
  const an = analysers.get(key); if (!an) return 0;
  const buf = new Uint8Array(an.fftSize); an.getByteTimeDomainData(buf);
  let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128); return peak;
}
export function gainReduction(): number { return master ? -master.reduction.value / 20 : 0; } // 0..~1 for the bar
export function exportConfig(): string { return JSON.stringify(cfg, null, 2); }

import { SCENES, type Scene } from './audio/scenes';
export { SCENES };
export function playScene(id: string): void {
  const scene = SCENES.find((s) => s.id === id); if (!scene) return;
  const firstCard = firstCardClip();  // helper: first cards/* sample name present, for cardVoice/etc.
  for (const step of scene.steps) {
    window.setTimeout(() => {
      const fn = (sfx as Record<string, (arg?: string) => void>)[step.cue];
      if (fn) fn(step.arg === '__first__' ? firstCard : step.arg);
    }, step.delay);
  }
}
```

- [ ] **Step 6: Typecheck + tests + commit**

Run: `npm run typecheck && npx vitest run packages/ui/src/audio` → 0 errors, scenes+config green.

```bash
git add packages/ui/src/audio/scenes.ts packages/ui/src/audio/scenes.test.ts packages/ui/src/sfx.ts
git commit -m "feat(audio): desk API — config setters, meters, gain-reduction, scenes"
```

---

### Task 4: The desk UI (rebuild `SfxMixer`) + live verification

**Files:**
- Rewrite: `packages/ui/src/SfxMixer.tsx`
- Modify: `packages/ui/src/styles.css` (desk + meter styles)

- [ ] **Step 1: Rewrite `SfxMixer.tsx` as the desk**

Sections: Master (limiter dials + peak/GR meters), Buses (fader + meter each), Categories (grouped by bus:
gain slider + bus dropdown + ▶ preview), Scenes (buttons → `playScene`), Export. A single rAF loop (only while
mounted) polls `meterLevel`/`gainReduction` into refs and updates the meter bars. Use the existing
`useDraggablePanel('sfx')`.

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  getAudioConfig, setBusGain, setMasterComp, setCategory, previewSfx,
  meterLevel, gainReduction, exportConfig, playScene, SCENES,
} from './sfx';
import { BUS_NAMES, type BusName, type CompConfig } from './audio/config';
import { useDraggablePanel } from './useDraggablePanel';

const MASTER_DIALS: { k: keyof CompConfig; min: number; max: number; step: number }[] = [
  { k: 'threshold', min: -60, max: 0, step: 1 }, { k: 'ratio', min: 1, max: 20, step: 0.5 },
  { k: 'knee', min: 0, max: 40, step: 1 }, { k: 'attack', min: 0, max: 0.05, step: 0.001 },
  { k: 'release', min: 0.01, max: 1, step: 0.01 },
];

export function SfxMixer() {
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('sfx');
  const [, force] = useState(0);                    // re-render on config edits
  const cfg = getAudioConfig();
  const meters = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      for (const key of ['master', ...BUS_NAMES]) {
        const el = meters.current[key]; if (el) el.style.transform = `scaleX(${meterLevel(key).toFixed(3)})`;
      }
      const gr = meters.current.gr; if (gr) gr.style.transform = `scaleX(${gainReduction().toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const catsByBus = (b: BusName) => Object.entries(cfg.categories).filter(([, c]) => c.bus === b);
  const meterBar = (key: string) => <div className="mtr"><div className="mtr-fill" ref={(el) => { meters.current[key] = el; }} /></div>;

  return (
    <div className="desk" ref={panelRef} style={panelStyle}>
      <div className="desk-h drag" onPointerDown={headerPointerDown}>Mixing Desk <span>dev · drag</span></div>

      <section className="desk-master">
        <h4>Master {meterBar('master')}<span className="gr">GR <div className="mtr"><div className="mtr-fill" ref={(el) => { meters.current.gr = el; }} /></div></span></h4>
        {MASTER_DIALS.map(({ k, min, max, step }) => (
          <label key={k} className="dial"><span>{k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg.master[k]}
              onChange={(e) => { setMasterComp(k, Number(e.target.value)); force((n) => n + 1); }} />
            <b>{cfg.master[k]}</b>
          </label>
        ))}
      </section>

      {BUS_NAMES.map((b) => (
        <section className="desk-bus" key={b}>
          <h4>{b} {meterBar(b)}</h4>
          <label className="fader"><span>level</span>
            <input type="range" min={0} max={150} value={Math.round(cfg.buses[b].gain * 100)}
              onChange={(e) => { setBusGain(b, Number(e.target.value) / 100); force((n) => n + 1); }} />
            <b>{Math.round(cfg.buses[b].gain * 100)}</b>
          </label>
          {catsByBus(b).map(([cat, c]) => (
            <div className="desk-cat" key={cat}>
              <span className="cn">{cat}</span>
              <input type="range" min={0} max={100} value={Math.round(c.gain * 100)}
                onChange={(e) => { setCategory(cat, { gain: Number(e.target.value) / 100 }); force((n) => n + 1); }} />
              <select value={c.bus} onChange={(e) => { setCategory(cat, { bus: e.target.value as BusName }); force((n) => n + 1); }}>
                {BUS_NAMES.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
              <button onClick={() => previewSfx(cat)} title={`Preview ${cat}`}>▶</button>
            </div>
          ))}
        </section>
      ))}

      <section className="desk-scenes">
        <h4>Scenes</h4>
        {SCENES.map((s) => <button key={s.id} onClick={() => playScene(s.id)}>{s.name}</button>)}
      </section>

      <button className="desk-export" onClick={() => void navigator.clipboard?.writeText(exportConfig())}>Export config</button>
    </div>
  );
}
```

- [ ] **Step 2: Add desk + meter styles**

Add to `styles.css` (or a colocated block): `.desk` panel container; `.desk-master/.desk-bus/.desk-scenes`
sections; `.dial/.fader/.desk-cat` rows; and the meter — `.mtr` a thin track, `.mtr-fill` a bar with
`transform-origin:left; transform:scaleX(0); background:linear-gradient(90deg,var(--good),var(--threat)); will-change:transform;`
(animate `transform` only — never a paint property in the rAF loop, per the perf rules). Keep it compact/dev-styled.

- [ ] **Step 3: Live-verify in the browser (the real test for Web Audio + meters)**

Start the dev server and drive it:
```
npm run dev
```
Then, via the browser preview: open the Dev menu → SFX Mixer. Verify:
- the desk shows Master + 4 bus sections + categories grouped under their bus + Scenes + Export;
- click **Torture** → the Master + bus meters jump and the **GR** bar moves (the limiter clamping);
- drag the **combat** bus fader down → its meter (and the combat clips in a scene) get quieter;
- reassign a category's bus via the dropdown → its preview now feeds the new bus's meter;
- **Export config** puts valid JSON on the clipboard.

Capture a screenshot of the desk with meters active as proof.

- [ ] **Step 4: Full green gate + commit**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all pass.

```bash
git add packages/ui/src/SfxMixer.tsx packages/ui/src/styles.css
git commit -m "feat(audio): mixing desk UI — buses, master dials, live meters, scenes, export"
```

---

### Task 5: Docs

- [ ] **Step 1: devlog + roadmap + README** (per the repo rule)

Add a devlog entry (the mixing desk: config-as-data, buses, metered/tunable master, scenes, export; verified
via config/scene unit tests + a live desk drive), note it in the roadmap audio section, and a README "Recent
changes" bullet. Commit them.

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: mixing desk"
```

> If the append-only devlog (fragments) has shipped by now, add a `docs/devlog/<date>-audio-desk.md` fragment
> and run `npm run devlog` instead of editing `docs/devlog.md` directly.

---

## Self-Review

**Spec coverage:**
- `audioConfig` single source of truth, seeded day-one-unchanged (spec §1) → Task 1 (`config.ts` + tests). ✅
- Graph: category buses → master limiter → master gain → mute bus; both sample + synth routed by category; masterVol → node (spec §2) → Task 2. ✅
- Console: master dials, bus faders, categories(+bus dropdown), scenes, export, peak + GR meters (spec §3) → Task 4 + the API in Task 3. ✅
- Bus taxonomy (spec §4) → `CATEGORY_BUS` in Task 1. ✅
- Persistence (`ascent.audiocfg`) + migration from `ascent.sfxvol`/`ascent.vol` + Esc-menu controls (spec §5) → Task 2 Steps 1 & 4. ✅
- Edge cases: no context / unmapped category / schema drift (spec Error handling) → `busInput` fallback, `UNMAPPED`, `mergeConfig` (Task 1/2). ✅
- Testing: config/scene unit tests + live desk verify (spec Testing) → Tasks 1, 3, 4 Step 3. ✅
- Out of scope (per-bus comp shipped, ducking, ingest normalization) → not implemented (comp field bypassed). ✅
- Open decisions: 4 buses, 4 scenes, export = paste-over — all as the spec's assumed defaults.

**Placeholder scan:** One deliberate paste marker — `CATEGORY_GAINS` says "paste the exact former
SAMPLE_VOL_DEFAULTS contents" (a *move* of existing verbatim values, not an invention); every other step has
complete code + expected results. The graph refactor (Task 2) + desk UI (Task 4) are shown in full and
finished by the live-verify step, which is the correct test surface for Web Audio + meters. ✅

**Type consistency:** `AudioConfig`/`BusConfig`/`CompConfig`/`CategoryConfig`/`BusName`, `CATEGORY_GAINS`,
`mergeConfig`/`effectiveGain`/`busOf`, and the sfx API (`getAudioConfig`/`setBusGain`/`setMasterComp`/
`setCategory`/`meterLevel`/`gainReduction`/`exportConfig`/`playScene`/`SCENES`) are used identically across
`config.ts`, `scenes.ts`, `sfx.ts`, and `SfxMixer.tsx`. ✅
