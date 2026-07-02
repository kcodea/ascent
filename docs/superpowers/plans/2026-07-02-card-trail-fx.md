# Card Trail FX + Dev Tuning Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A subtle wind-whoosh trail behind dragged cards and lunging attackers, a gold divine-shield variant that replaces it, a live Trail tuner, and one Dev Tuning Menu consolidating all dev tuners.

**Architecture:** The trail is a new emitter on the existing pooled-particle PixiJS overlay (`pixiFx.ts`), fed by the rAF drag handler in `Recruit.tsx` and a GSAP `onUpdate` in `useCombatReplay.ts`. Config follows the `lungeConfig.ts` localStorage pattern. Six tuner components become panel-only children of a new `DevMenu`.

**Tech Stack:** React 18, PixiJS v8 (existing overlay), GSAP (existing lunge), Vitest/tsc/ESLint via workspace scripts.

**Spec:** `docs/superpowers/specs/2026-07-02-card-trail-fx-design.md`

**Branch:** `feat/card-trail-fx` (already created; spec committed).

**Testing note:** The particle emitter and tuner panels are visual/canvas code with no unit-test precedent in this repo (`lungeConfig`/`dragFeel`/etc. ship untested; verification is the check suite + live play per CLAUDE.md). This plan follows that repo convention: every task runs `npm run typecheck && npm run lint`, the final task runs the full suite + live verification. No new unit tests are added.

---

### Task 1: `trailConfig.ts` — the tunable dials

**Files:**
- Create: `packages/ui/src/trailConfig.ts`

- [ ] **Step 1: Write the config module**

```ts
/**
 * Tunable parameters for the card motion trail (`pixiFx.trail`) — the wind-whoosh wisps left behind a
 * dragged card and behind a combat attacker's lunge, plus the gold divine-shield variant. Same pattern as
 * `lungeConfig.ts`: one mutable, localStorage-persisted config, dialed by eye via the DEV Trail tuner
 * (`TrailTuner.tsx`); `getTrailConfig()` is read at emit time, so changes apply to the next wisps.
 */
export interface TrailConfig {
  /** Px of card travel between wisp emits (lower = denser trail). */
  emitSpacing: number;
  /** Wisp lifetime (ms). */
  lifeMs: number;
  /** Wisp size — the sprite's starting scale. */
  size: number;
  /** Base (wind) wisp peak alpha. */
  alpha: number;
  /** Streak elongation — X-axis stretch multiplier on the wisp texture. */
  stretch: number;
  /** Lateral drift speed (px/s) — sideways wander that sells "displaced air". */
  drift: number;
  /** Gold (divine-shield) wisp peak alpha. */
  goldAlpha: number;
  /** Gold only: chance per emit of an extra tiny spark mote (the glassy glint). */
  sparkChance: number;
}

const DEFAULTS: TrailConfig = {
  emitSpacing: 14,
  lifeMs: 300,
  size: 1.0,
  alpha: 0.3,
  stretch: 1.0,
  drift: 30,
  goldAlpha: 0.45,
  sparkChance: 0.25,
};

/** Slider bounds for the DEV tuner — [min, max, step] per key. */
export const TRAIL_RANGES: Record<keyof TrailConfig, [number, number, number]> = {
  emitSpacing: [4, 60, 1],
  lifeMs: [80, 900, 10],
  size: [0.3, 2.5, 0.05],
  alpha: [0.05, 1, 0.01],
  stretch: [0.5, 3, 0.05],
  drift: [0, 120, 2],
  goldAlpha: [0.05, 1, 0.01],
  sparkChance: [0, 1, 0.05],
};
export const TRAIL_KEYS = Object.keys(DEFAULTS) as (keyof TrailConfig)[];

const KEY = 'ascent.trail';
let cfg: TrailConfig = (() => {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(saved && typeof saved === 'object' ? (saved as Partial<TrailConfig>) : {}) };
  } catch {
    return { ...DEFAULTS };
  }
})();

export function getTrailConfig(): TrailConfig {
  return cfg;
}
export function setTrailValue(key: keyof TrailConfig, value: number): void {
  cfg = { ...cfg, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}
export function resetTrailConfig(): void {
  cfg = { ...DEFAULTS };
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npm run typecheck`
Expected: clean (0 errors).

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/trailConfig.ts
git commit -m "feat(ui): trailConfig — localStorage-tunable dials for the card motion trail"
```

---

### Task 2: `pixiFx.ts` — wisp texture, X-stretch support, `trail()` emitter

**Files:**
- Modify: `packages/ui/src/pixiFx.ts`

- [ ] **Step 1: Import the trail config**

At the top of `pixiFx.ts`, next to the existing `import { getTauntConfig } from './tauntConfig';`, add:

```ts
import { getTrailConfig } from './trailConfig';
```

- [ ] **Step 2: Add X-stretch to the particle model**

The `Particle` interface (~line 322) applies a single uniform scale. Wisps are elongated streaks, so add a non-uniform X multiplier. In `interface Particle`, after `gravity: number;`, add:

```ts
  stretchX: number;  // X-axis scale multiplier (1 = uniform) — elongates streak wisps along their heading
```

In `spawn()` (~line 1086): add `stretchX?: number` to the inline options type (next to `gravity?: number`), and in the `this.live.push({...})` call add `stretchX: cfg.stretchX ?? 1,`. Also change the initial scale set from `sprite.scale.set(cfg.fromScale);` to:

```ts
    sprite.scale.set(cfg.fromScale * (cfg.stretchX ?? 1), cfg.fromScale);
```

In `update()` (~line 1139), change `s.scale.set(p.fromScale + (p.toScale - p.fromScale) * t);` to:

```ts
      const sc = p.fromScale + (p.toScale - p.fromScale) * t;
      s.scale.set(sc * p.stretchX, sc);
```

- [ ] **Step 3: Add the wisp texture**

Add a private field next to the other textures (~line 397): `private wispTex: Texture | null = null;`
In `init()`, next to `this.veinTex = this.makeVeinTexture(app);`, add `this.wispTex = this.makeWispTexture(app);`
In `detach()`, next to `this.veinTex = null;`, add `this.wispTex = null;`
Add the maker method next to `makeVeinTexture` (bottom of the class):

```ts
  /** A wind wisp — a soft, heavily feathered horizontal streak (layered ellipses → airy falloff), drawn
   *  pointing +X so a spawn rotation aligns it along the card's motion. Softer sibling of the vein. */
  private makeWispTexture(app: Application): Texture {
    const g = new Graphics();
    g.ellipse(0, 0, 26, 5).fill({ color: 0xffffff, alpha: 0.10 }); // outer haze
    g.ellipse(0, 0, 22, 3.2).fill({ color: 0xffffff, alpha: 0.18 });
    g.ellipse(-2, 0, 16, 1.8).fill({ color: 0xffffff, alpha: 0.30 }); // brighter core, biased to the tail
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }
```

- [ ] **Step 4: Add the `trail()` emitter**

Add as a public method after `clickPuff()` (~line 707):

```ts
  /**
   * One step of a motion trail behind a moving card — a wind-whoosh wisp left at (x, y), oriented along
   * the movement vector (dx, dy). Callers distance-gate on `getTrailConfig().emitSpacing` (the drag rAF
   * handler + the combat lunge's onUpdate), so emission density tracks speed — no movement, no trail.
   * `gold` = the card has Divine Shield → the glassy gold variant (replaces, never layers on, the wind).
   */
  trail(x: number, y: number, dx: number, dy: number, gold: boolean): void {
    if (!this.ready) return;
    const c = getTrailConfig();
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const angle = Math.atan2(uy, ux) + (Math.random() - 0.5) * 0.16;
    // left behind the card: a touch of backward velocity + lateral drift (displaced air swirling off)
    const back = 30 + Math.random() * 40;
    const side = (Math.random() - 0.5) * 2 * c.drift;
    this.spawn(this.wispTex!, {
      x: x - ux * 8 + (Math.random() - 0.5) * 6,
      y: y - uy * 8 + (Math.random() - 0.5) * 6,
      vx: -ux * back + -uy * side,
      vy: -uy * back + ux * side,
      drag: 0.3, // the whoosh settles quickly
      life: c.lifeMs * (0.8 + Math.random() * 0.4),
      fromScale: c.size * (0.85 + Math.random() * 0.3),
      toScale: 0.05,
      spin: 0,
      rotation: angle,
      stretchX: c.stretch,
      tint: gold ? 0xffe9a8 : 0xf5efe0,
      blend: gold ? 'add' : 'normal',
      peakAlpha: (gold ? c.goldAlpha : c.alpha) * (0.85 + Math.random() * 0.3),
    });
    // gold only: an occasional tiny glint mote, mimicking the shield bubble's glassy sparkle
    if (gold && Math.random() < c.sparkChance) {
      this.spawn(this.sparkTex!, {
        x: x + (Math.random() - 0.5) * 14,
        y: y + (Math.random() - 0.5) * 14,
        vx: -ux * back * 0.5 + (Math.random() - 0.5) * 30,
        vy: -uy * back * 0.5 + (Math.random() - 0.5) * 30,
        drag: 0.3,
        life: c.lifeMs * 0.8,
        fromScale: 0.5 + Math.random() * 0.4,
        toScale: 0.05,
        spin: 0,
        tint: 0xffd24a,
        blend: 'add',
        peakAlpha: 0.9,
      });
    }
  }
```

- [ ] **Step 5: Verify + smoke-test in dev**

Run: `npm run typecheck && npm run lint`
Expected: clean.
Optional eyeball: `npm run dev`, then in the browser console: `for (let i=0;i<20;i++) setTimeout(()=>window.__pixiFx.trail(400+i*16, 400, 16, 0, i%2===0), i*30)` — a horizontal run of wind + gold wisps.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/pixiFx.ts
git commit -m "feat(ui): pixiFx.trail — wind-whoosh wisp emitter + gold divine-shield variant"
```

---

### Task 3: Drag hookup in `Recruit.tsx`

**Files:**
- Modify: `packages/ui/src/Recruit.tsx` (the rAF drag-move handler, ~line 1129-1146)

- [ ] **Step 1: Import the config**

`Recruit.tsx` already imports from `./pixiFx` (`pixiFx`, `tauntFx`…). Add to the existing import block near the top:

```ts
import { getTrailConfig } from './trailConfig';
```

- [ ] **Step 2: Emit from the rAF-throttled move flush**

In the drag effect (`useEffect` keyed `[drag?.uid]`, ~line 1129), the handler already coalesces pointermoves into one `flushMove` per frame. Add a last-emit tracker just above `let moveRaf = 0;`:

```ts
    // Motion-trail bookkeeping: the viewport point of the last wisp emit (null until the drag goes active).
    let trailLast: { x: number; y: number } | null = null;
```

Then inside `flushMove`, after the `setOverZone(...)` line, add:

```ts
      // Wind-whoosh trail: distance-gated wisps behind the dragged card (gold when it has Divine Shield).
      const dNow = dragRef.current;
      if (dNow?.active) {
        const cx = e.clientX; // the card rides centred on the cursor (ox/oy are the centre)
        const cy = e.clientY;
        if (!trailLast) trailLast = { x: cx, y: cy };
        const tdx = cx - trailLast.x;
        const tdy = cy - trailLast.y;
        if (Math.hypot(tdx, tdy) >= getTrailConfig().emitSpacing) {
          pixiFx.trail(cx, cy, tdx, tdy, dNow.view.keywords.includes('DS'));
          trailLast = { x: cx, y: cy };
        }
      } else {
        trailLast = null;
      }
```

Note: `dragRef.current` is the up-to-date drag state (declared at ~line 798); `view.keywords.includes('DS')` is the same divine-shield test the aura tracker uses (`AURA_CFGS`' `dragKw: 'DS'`). No new layout reads — the cursor position is the card center by construction.

- [ ] **Step 3: Verify live**

Run: `npm run typecheck && npm run lint`, then `npm run dev`.
- Drag any plain card fast: subtle pale wisps trail it; stop moving → no wisps.
- Drag a Divine Shield card (e.g. a Mech with DS): gold additive wisps + occasional sparks, NO pale wind wisps.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/Recruit.tsx
git commit -m "feat(ui): wind/gold motion trail while dragging a card"
```

---

### Task 4: Combat lunge hookup in `useCombatReplay.ts`

**Files:**
- Modify: `packages/ui/src/useCombatReplay.ts` (`playAttackLunge`, ~line 207-234)

- [ ] **Step 1: Import the config**

The file already imports `pixiFx` and `getLungeConfig`. Add:

```ts
import { getTrailConfig } from './trailConfig';
```

- [ ] **Step 2: Emit from the lunge timeline**

In `playAttackLunge`, after `const c = getLungeConfig();` add the trail bookkeeping (one rect read at lunge start — NOT per frame), and give the timeline an `onUpdate`:

```ts
  // Motion trail: one up-front rect read gives the resting center; per-frame positions come from GSAP's
  // animated x/y (no per-frame getBoundingClientRect). Wisps fire during windup + strike only — the slow
  // elastic settle shouldn't smear. Gold when the attacker currently has Divine Shield (the `.dscard`
  // marker class the aura tracker also reads).
  const rest = attacker.getBoundingClientRect();
  const cx0 = rest.left + rest.width / 2;
  const cy0 = rest.top + rest.height / 2;
  const el = attacker as HTMLElement;
  const gold = el.classList.contains('dscard') || !!el.querySelector('.dscard');
  let trailLast = { x: cx0, y: cy0 };
  const trailCutoff = c.windupDur + c.strikeDur;
```

Then change the timeline construction from:

```ts
  const tl = gsap
    .timeline({ onComplete: () => gsap.set(attacker, { clearProps: 'transform,zIndex' }) })
```

to:

```ts
  const tl = gsap
    .timeline({
      onComplete: () => gsap.set(attacker, { clearProps: 'transform,zIndex' }),
      onUpdate: () => {
        if (tl.time() > trailCutoff) return; // no trail on the elastic settle
        const cx = cx0 + Number(gsap.getProperty(attacker, 'x'));
        const cy = cy0 + Number(gsap.getProperty(attacker, 'y'));
        const tdx = cx - trailLast.x;
        const tdy = cy - trailLast.y;
        if (Math.hypot(tdx, tdy) >= getTrailConfig().emitSpacing) {
          pixiFx.trail(cx, cy, tdx, tdy, gold);
          trailLast = { x: cx, y: cy };
        }
      },
    })
```

(`tl.time()` is the timeline's local time, so the cutoff holds under the user's `timeScale(speed)` too.)

- [ ] **Step 3: Verify live**

Run: `npm run typecheck && npm run lint`, then `npm run dev`; play into a combat.
- An unshielded attacker's strike leaves a brief pale whoosh along the lunge path; nothing during the settle.
- A Divine-Shield attacker (before its shield breaks) leaves the gold trail; after its shield breaks, later swings leave the wind trail (the `.dscard` class is gone).

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/useCombatReplay.ts
git commit -m "feat(ui): motion trail on combat attack lunges (gold for shielded attackers)"
```

---

### Task 5: `TrailTuner.tsx`

**Files:**
- Create: `packages/ui/src/TrailTuner.tsx`

Note: this component is written **panel-only** from the start (no floating toggle button) — the DevMenu (Task 6) mounts it. It will not be visible until Task 6 lands; that's fine, tasks 5+6 merge together.

- [ ] **Step 1: Write the tuner**

```tsx
import { useState } from 'react';
import { TRAIL_KEYS, TRAIL_RANGES, getTrailConfig, resetTrailConfig, setTrailValue, type TrailConfig } from './trailConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the card motion trail (`trailConfig.ts` → `pixiFx.trail`). Drag the sliders to dial
 * wisp density / life / size / alpha / stretch / drift and the gold divine-shield variant by eye — values
 * persist to localStorage and apply to the NEXT wisps emitted (drag a card to judge). "Copy" grabs the JSON
 * to paste back as the shipped defaults in `trailConfig.ts`. Panel-only: opened from the Dev Tuning Menu.
 */
const LABELS: Record<keyof TrailConfig, string> = {
  emitSpacing: 'emit spacing px',
  lifeMs: 'wisp life ms',
  size: 'wisp size',
  alpha: 'wind alpha',
  stretch: 'streak stretch',
  drift: 'lateral drift',
  goldAlpha: 'gold alpha',
  sparkChance: 'gold sparks',
};

export function TrailTuner() {
  const [cfg, setCfg] = useState<TrailConfig>(getTrailConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('trail');

  const set = (k: keyof TrailConfig, v: number): void => {
    setTrailValue(k, v);
    setCfg({ ...getTrailConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getTrailConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetTrailConfig(); setCfg({ ...getTrailConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Motion Trail <span>dev · drag a card · drag</span></div>
      {TRAIL_KEYS.map((k) => {
        const [min, max, step] = TRAIL_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm run lint` — clean (component is unused until Task 6; if the repo's lint flags unused exports, proceed — Task 6 wires it — otherwise commit now):

```bash
git add packages/ui/src/TrailTuner.tsx
git commit -m "feat(ui): TrailTuner — DEV panel for the motion-trail dials"
```

---

### Task 6: Panel-only tuners + `DevMenu` + `Game.tsx` + CSS

**Files:**
- Create: `packages/ui/src/DevMenu.tsx`
- Modify: `packages/ui/src/SfxMixer.tsx`, `LungeTuner.tsx`, `TauntTuner.tsx`, `DragTuner.tsx`, `FlipTuner.tsx`, `ShieldTuner.tsx` (drop own button/open state)
- Modify: `packages/ui/src/Game.tsx:16-20,116-131` (mount DevMenu instead of six tuners + Test FX)
- Modify: `packages/ui/src/styles.css:1713,1726,1728,1734,1739,1743,1745` (replace per-tuner button styles with menu styles)

- [ ] **Step 1: Refactor the six tuners to panel-only**

Same mechanical change in each of `SfxMixer.tsx`, `LungeTuner.tsx`, `TauntTuner.tsx`, `DragTuner.tsx`, `FlipTuner.tsx`, `ShieldTuner.tsx`:
1. Delete the `const [open, setOpen] = useState(false);` line.
2. Delete the `<button className="…-btn" …>…</button>` line and the surrounding `<> … {open && ( … )} </>` wrapper — the component returns the panel `<div className="sfxmix …">` directly.
3. Update the doc comment's "Mounted only in dev (see Game.tsx)" to "Panel-only: opened from the Dev Tuning Menu (DevMenu.tsx)."

Example — `LungeTuner.tsx` return becomes:

```tsx
  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Lunge Tuner <span>dev · next attack · drag</span></div>
      {LUNGE_KEYS.map((k) => {
        const [min, max, step] = LUNGE_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
```

Apply the identical pattern to the other five (their panel JSX is already written; only the wrapper changes). `TauntTuner` keeps its `held` demo state and buttons untouched.

- [ ] **Step 2: Write `DevMenu.tsx`**

```tsx
import { useState } from 'react';
import { SfxMixer } from './SfxMixer';
import { LungeTuner } from './LungeTuner';
import { TauntTuner } from './TauntTuner';
import { DragTuner } from './DragTuner';
import { FlipTuner } from './FlipTuner';
import { ShieldTuner } from './ShieldTuner';
import { TrailTuner } from './TrailTuner';
import { pixiFx } from './pixiFx';

/**
 * DEV-only Dev Tuning Menu — the single 🛠️ button that replaces the old row of floating tuner buttons.
 * Opens a compact list; each entry toggles one tuner panel (the panels themselves are unchanged: draggable,
 * localStorage-backed). "Test FX" stays a one-shot action. Mounted only in dev (see Game.tsx), so the whole
 * menu — and every tuner — is stripped from production.
 */
const TUNERS = [
  { key: 'sfx', label: '🔊 SFX Mixer', C: SfxMixer },
  { key: 'lunge', label: '🗡️ Lunge', C: LungeTuner },
  { key: 'taunt', label: '🛡️ Taunt', C: TauntTuner },
  { key: 'drag', label: '🎴 Drag Feel', C: DragTuner },
  { key: 'flip', label: '🔀 Reposition', C: FlipTuner },
  { key: 'shield', label: '🛡 Shield Place', C: ShieldTuner },
  { key: 'trail', label: '💨 Trail', C: TrailTuner },
] as const;

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());

  const toggle = (key: string): void =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <button className="devmenu-btn" onClick={() => setOpen((o) => !o)} title="Dev tuning menu">🛠️</button>
      {open && (
        <div className="devmenu">
          <div className="devmenu-h">Dev Tuning</div>
          {TUNERS.map(({ key, label }) => (
            <button key={key} className={`devmenu-item${shown.has(key) ? ' on' : ''}`} onClick={() => toggle(key)}>
              {label} <span>{shown.has(key) ? '✓' : ''}</span>
            </button>
          ))}
          <button className="devmenu-item" onClick={() => pixiFx.test()}>✨ Test FX <span>▸</span></button>
        </div>
      )}
      {TUNERS.map(({ key, C }) => (shown.has(key) ? <C key={key} /> : null))}
    </>
  );
}
```

- [ ] **Step 3: Swap the mounts in `Game.tsx`**

Replace the imports at lines 16-20 (`LungeTuner`, `TauntTuner`, `DragTuner`, `FlipTuner`, `ShieldTuner` — and the `SfxMixer` import wherever it is) with:

```ts
import { DevMenu } from './DevMenu';
```

Replace lines 115-131 (the six `{import.meta.env.DEV && <XTuner />}` lines AND the whole `fxtest-btn` button block) with:

```tsx
      {/* DEV-only tuning menu — one 🛠️ button opening every live tuner (stripped from production). */}
      {import.meta.env.DEV && <DevMenu />}
```

If `pixiFx` was imported in `Game.tsx` only for the Test FX button, remove that import too (check other uses first — `PixiFxLayer` is a separate import).

- [ ] **Step 4: CSS — remove the seven button rules, add the menu**

In `packages/ui/src/styles.css`, delete these rules (they are now dead): `.sfxmix-btn` (line 1713), `.lunge-btn` (1726), `.fxtest-btn` (1728), `.taunt-btn` (1734), `.dragfeel-btn` (1739), `.flip-btn` (1743), `.shield-btn` (1745). Keep everything else (`.sfxmix*`, `.lunge-btns`, panel variants).

Add in their place:

```css
/* ── Dev Tuning Menu (DEV only) — one 🛠️ button replacing the old row of floating tuner buttons ── */
.devmenu-btn { position: fixed; right: calc(var(--bar-x) + 64px); bottom: calc(var(--bar-y) + 16px); z-index: 200; width: 40px; height: 40px; border-radius: 50%; border: 2px solid var(--line); background: var(--card); font-size: 18px; cursor: pointer; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3); }
.devmenu { position: fixed; right: calc(var(--bar-x) + 64px); bottom: calc(var(--bar-y) + 64px); z-index: 201; width: 190px; background: var(--card); border: 2px solid var(--line); border-radius: 14px; padding: 8px; box-shadow: 0 16px 40px -8px rgba(0, 0, 0, 0.5); font-family: var(--font-ui); box-sizing: border-box; }
.devmenu-h { font-weight: 800; font-size: 12px; color: var(--ink3); text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 6px 6px; }
.devmenu-item { display: flex; justify-content: space-between; align-items: center; width: 100%; padding: 7px 8px; margin: 1px 0; border: 0; border-radius: 8px; background: transparent; font-family: var(--font-ui); font-weight: 700; font-size: 13px; color: var(--ink); cursor: pointer; text-align: left; }
.devmenu-item:hover { background: var(--bg2); }
.devmenu-item.on { background: color-mix(in srgb, var(--acc) 14%, var(--card)); color: var(--acc-dk); }
.devmenu-item span { font-size: 11px; color: var(--acc-dk); }
```

- [ ] **Step 5: Verify live**

Run: `npm run typecheck && npm run lint`, then `npm run dev`.
- Exactly one 🛠️ button bottom-right (old 🔊🗡️🛡️🎴🔀🛡 buttons + "Test FX" gone).
- Menu opens; each entry toggles its panel (✓ state); panels drag/slide/copy/reset as before; Taunt's Hold demo / Deploy work; Test FX fires the center burst; Trail panel edits change the drag trail live.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/DevMenu.tsx packages/ui/src/TrailTuner.tsx packages/ui/src/SfxMixer.tsx packages/ui/src/LungeTuner.tsx packages/ui/src/TauntTuner.tsx packages/ui/src/DragTuner.tsx packages/ui/src/FlipTuner.tsx packages/ui/src/ShieldTuner.tsx packages/ui/src/Game.tsx packages/ui/src/styles.css
git commit -m "feat(ui): Dev Tuning Menu — consolidate all DEV tuners under one 🛠️ button"
```

---

### Task 7: Full verification + docs + PR

**Files:**
- Modify: `docs/devlog.md` (prepend entry), `docs/roadmap.md` (move item out of queue), `README.md` (Recent changes)

- [ ] **Step 1: Full check suite**

Run: `npm run typecheck && npm run lint && npm test && npm run build:web`
Expected: all green. Report results.

- [ ] **Step 2: Live verification pass (prod-ish feel check)**

`npm run dev` (feel-verify against prod build if any hitch is suspected, per docs/performance.md):
1. Drag a plain card fast → subtle wind wisps; hold still → none.
2. Drag a Divine Shield card → gold trail only (no wind wisps), sparks occasional.
3. Combat: unshielded attacker → wind trail on windup+strike, none on settle; shielded attacker → gold; after its shield breaks, its next swing → wind.
4. Dev menu: every tuner opens/closes; Trail sliders change the trail live; Copy/Reset work.
5. No console errors; drag stays smooth (no added layout reads — verify no jank by eye).

- [ ] **Step 3: Update the living docs**

Per CLAUDE.md: prepend a dated `docs/devlog.md` entry (what changed: trail emitter, drag+combat hookups, TrailTuner, DevMenu consolidation; how verified), remove/adjust the relevant `docs/roadmap.md` line (combat juice / M1-polish bucket), refresh `README.md` "Recent changes".

- [ ] **Step 4: Commit docs + open the PR**

```bash
git add docs/devlog.md docs/roadmap.md README.md
git commit -m "docs: devlog/roadmap/README for card trail FX + dev tuning menu"
git push -u origin feat/card-trail-fx
# gh is not on PATH — use the full path (see memory: gh-cli-path)
```

Then create the PR with `gh pr create` (full path to gh.exe) titled `feat(ui): card motion trails (wind + divine-shield gold) + Dev Tuning Menu`, body summarizing the spec + verification results.

---

## Self-review

- **Spec coverage:** §1 emitter → Task 2; §2 config → Task 1; §3 drag → Task 3; §4 combat → Task 4; §5 tuner → Task 5; §6 menu → Task 6; perf+verification → Tasks 2-7. ✓
- **Type consistency:** `trail(x, y, dx, dy, gold)` used identically in Tasks 2/3/4; `stretchX` defined in Task 2 and used only there; `TrailConfig` keys match `LABELS`/`TRAIL_RANGES`/tuner. ✓
- **No placeholders:** all code complete; the six-tuner refactor shows the full pattern once (LungeTuner) and names the exact mechanical steps for the others, whose panel JSX already exists in-file. ✓
