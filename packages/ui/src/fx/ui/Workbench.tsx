import { useEffect, useRef, useState } from 'react';
import { Container } from 'pixi.js';
import { defaultsOf } from '../params';
import type { FxDef } from '../def';
import { createPlayer, type FxPlayer } from '../player';
import { getPrimitive, listPrimitives } from '../registry';
import { resolveAnchor } from '../anchors';
import { SCENARIOS } from '../scenarios';
import { pixiFx } from '../../pixiFx';
import { Inspector } from './Inspector';
import { createBackdrop, type FxBackdrop } from './backdrop';

/** Swatches for the preview backdrop control (see `createBackdrop`). `hex: null` is "None" — transparent,
 *  matching the in-game overlay. Multiply against black is always black, so Mid/Light are what actually let
 *  you SEE multiply/overlay/screen doing their thing; that's the whole point of this control. Module-scope
 *  so the array identity is stable across renders. */
const BACKDROP_SWATCHES: readonly { label: string; hex: number | null }[] = [
  { label: 'None', hex: null },
  { label: 'Board', hex: 0x211d2c },
  { label: 'Mid', hex: 0x808080 },
  { label: 'Light', hex: 0xc8c8c8 },
];

// Registers every built-in primitive (see registry.ts's `registerPrimitive`). A DYNAMIC import,
// deliberately — the primitives self-register via a top-level function CALL (a real side effect Rollup
// can't prove away), so a plain `import '../primitives'` here would force the whole set — GLSL shader
// source strings included — into the production bundle even though nothing ever renders this component
// there (DevMenu, and everything under it, is only ever mounted behind `import.meta.env.DEV` in Game.tsx).
// Gating this import the same way lets prod's dead-code elimination drop the primitives entirely,
// matching how every other dev tuner already vanishes from the shipped bundle. `build()` below polls for
// a primitive to appear before using it, since this resolves asynchronously.
if (import.meta.env.DEV) void import('../primitives');

const DURATION_MS = 1200;

/**
 * Full-screen dev overlay for live-tuning FX primitives. Deliberately NOT a `.sfxmix` draggable panel —
 * the whole point of this tool is its own purpose-built transport + a generated inspector, not another
 * floating tuner. Mounted only from `DevMenu` (itself dev-gated), so this entire tree is stripped from the
 * production bundle (see the DEV-gated import above for the one subtlety that requires).
 */
export function FxWorkbench({ onClose }: { onClose: () => void }): React.ReactElement {
  const [primitiveId, setPrimitiveId] = useState<string>(() => listPrimitives()[0]?.id ?? 'ribbon');
  const [scenarioId, setScenarioId] = useState<string>(() => SCENARIOS[0]?.id ?? '');
  const [params, setParams] = useState<Record<string, unknown>>(() =>
    defaultsOf(getPrimitive(primitiveId)?.params ?? {}),
  );
  const [uiPlaying, setUiPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [timeMs, setTimeMs] = useState(0);
  const [fps, setFps] = useState(0);
  const [copied, setCopied] = useState(false);
  const [backdropColor, setBackdropColor] = useState<number | null>(null);

  const playerRef = useRef<FxPlayer | null>(null);
  const backdropRef = useRef<FxBackdrop | null>(null);
  // Mirrors of the latest state, read by the per-frame updater / build closures so those never go stale
  // without forcing a player rebuild on every keystroke (a rebuild happens ONLY on primitive/scenario change).
  const paramsRef = useRef(params);
  const speedRef = useRef(speed);
  const cursorRef = useRef({ x: 0, y: 0 });
  const clickRef = useRef<{ x: number; y: number } | null>(null);

  // Live pointer position (for cursor-driven scenarios) and last click point (for `clickPlace`) —
  // independent of build/rebuild, tracked once.
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      cursorRef.current = { x: e.clientX, y: e.clientY };
    };
    const onDown = (e: PointerEvent): void => {
      clickRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  // Mount the preview backdrop BEHIND the effect, once for the workbench's whole lifetime — deliberately its
  // own effect, declared ABOVE the build() effect below, so it always mounts (and thus lands at a lower child
  // index on the overlay's `layer`) before build() mounts the per-effect container. `pixiFx.mountLayer` just
  // appends, and a later append renders on top, so as long as this stays mounted for the workbench's whole
  // lifetime, every rebuild in build() (which tears down and re-mounts a fresh container per primitive/scenario
  // change) always lands above it — no z-index/sortableChildren needed, plain append order is sufficient.
  useEffect(() => {
    const backdrop = createBackdrop();
    backdropRef.current = backdrop;
    const unmountLayer = pixiFx.mountLayer(backdrop.container);
    const resize = (): void => backdrop.resize(window.innerWidth, window.innerHeight);
    resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      unmountLayer();
      backdrop.destroy();
      backdropRef.current = null;
    };
  }, []);

  // Push the selected color to the (persistent) backdrop whenever it changes. Split from the mount effect
  // above so picking a new color never tears down / remounts the backdrop container.
  useEffect(() => {
    backdropRef.current?.setColor(backdropColor);
  }, [backdropColor]);

  // (Re)build the player whenever the selected primitive or scenario changes. Param tweaks do NOT land
  // here — they go through player.setLayerParams (see `change` below) so a slider drag never respawns
  // the effect mid-gesture.
  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let container: Container | null = null;
    let unmountLayer: (() => void) | null = null;
    let removeUpdater: (() => void) | null = null;
    let player: FxPlayer | null = null;

    let fpsAccMs = 0;
    let fpsFrames = 0;
    let timeAccMs = 0;

    const build = (): void => {
      if (disposed) return;
      const renderer = pixiFx.renderer;
      if (!renderer) {
        // attach()/init() is async and may not have resolved yet (e.g. the workbench mounts before the
        // overlay canvas finishes initialising) — poll rather than building a player against a null
        // renderer, which `createPlayer`/the primitive's `spawn` cannot tolerate.
        retryTimer = setTimeout(build, 50);
        return;
      }
      const prim = getPrimitive(primitiveId);
      if (!prim) {
        // The primitive's self-registration import is a DEV-gated dynamic import (see the top of this
        // file — needed so prod's dead-code elimination can drop it entirely, see the file-level comment)
        // so on a very early mount it may not have resolved yet. Poll rather than silently building nothing.
        retryTimer = setTimeout(build, 50);
        return;
      }
      if (Object.keys(paramsRef.current).length === 0) {
        // Cold-boot recovery: the initial `useState` ran before the primitive above was registered, so
        // the params state constructed then is empty. Fill in real defaults now that the spec exists.
        const cold = defaultsOf(prim.params);
        paramsRef.current = cold;
        setParams(cold);
      }

      container = new Container();
      unmountLayer = pixiFx.mountLayer(container);

      const def: FxDef = {
        id: `workbench-${primitiveId}`,
        duration: DURATION_MS,
        layers: [{ primitive: primitiveId, anchor: 'travel', at: 0, params: paramsRef.current }],
      };
      player = createPlayer(def, { container, renderer }, { loop: true });
      player.setSpeed(speedRef.current);
      player.play();
      playerRef.current = player;
      setUiPlaying(true);
      setTimeMs(0);

      removeUpdater = pixiFx.addUpdater((dtMs) => {
        const p = player;
        if (!p) return;
        p.update(dtMs);

        const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
        if (scenario) {
          const vp = { w: window.innerWidth, h: window.innerHeight };
          const progress = (p.timeMs() % DURATION_MS) / DURATION_MS;
          // A scenario may drive the head along a custom path (e.g. `bounce` ping-ponging between units,
          // `pinnedCursor` tracking the live pointer, `clickPlace` anchoring to the last click); otherwise
          // the head follows the default source→target travel arc.
          const pt = scenario.headAt
            ? scenario.headAt({ viewport: vp, cursor: cursorRef.current, click: clickRef.current, progress })
            : resolveAnchor(scenario.anchorsAt(vp, cursorRef.current), 'travel', progress);
          // `pixiFx.mountLayer` parents `container` straight onto the overlay stage, which sits at the
          // canvas origin with no transform, and the overlay canvas itself is a full-viewport element at
          // (0,0) — so these page/screen coordinates map directly onto the container's local space with
          // no conversion needed, matching what a primitive's `setHead` assumes.
          // Layer 0 is the def's only layer (P1 stages a single-layer effect); revisit when the
          // workbench can stage multiple layers at once.
          p.setHead(0, pt.x, pt.y);
        }

        fpsAccMs += dtMs;
        fpsFrames += 1;
        if (fpsAccMs >= 500) {
          setFps(Math.round((fpsFrames * 1000) / fpsAccMs));
          fpsAccMs = 0;
          fpsFrames = 0;
        }

        timeAccMs += dtMs;
        if (timeAccMs >= 50) {
          setTimeMs(p.timeMs());
          timeAccMs = 0;
        }
      });
    };

    build();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      removeUpdater?.();
      player?.destroy();
      unmountLayer?.();
      container?.destroy({ children: true });
      playerRef.current = null;
    };
  }, [primitiveId, scenarioId]);

  // `number[]` covers the editable palette param (a 4-tuple of colour stops); every value flows unchanged
  // through setLayerParams' `Record<string, unknown>`, then coerceParams validates it per the primitive's spec.
  const change = (key: string, value: number | boolean | string | number[]): void => {
    setParams((prev) => {
      const next = { ...prev, [key]: value };
      paramsRef.current = next;
      return next;
    });
    playerRef.current?.setLayerParams(0, { [key]: value });
  };

  const selectPrimitive = (id: string): void => {
    if (id === primitiveId) return;
    const prim = getPrimitive(id);
    if (!prim) return;
    const next = defaultsOf(prim.params);
    paramsRef.current = next;
    setParams(next);
    setPrimitiveId(id);
  };

  const togglePlay = (): void => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) {
      p.pause();
      setUiPlaying(false);
    } else {
      p.play();
      setUiPlaying(true);
    }
  };

  // "Fire" is a discrete one-shot preview -- restart the effect from t=0 and let it run through once,
  // regardless of whether it's currently looping, paused, or already stopped. Deliberately does NOT touch
  // playerRef's identity or rebuild anything; it only retriggers the existing player (see FxPlayer.fireOnce).
  const fire = (): void => {
    const p = playerRef.current;
    if (!p) return;
    p.fireOnce();
    setUiPlaying(true);
    setTimeMs(0);
  };

  const scrub = (ms: number): void => {
    const p = playerRef.current;
    if (!p) return;
    p.pause();
    p.scrub(ms);
    setUiPlaying(false);
    setTimeMs(ms);
  };

  const changeSpeed = (n: number): void => {
    speedRef.current = n;
    setSpeed(n);
    playerRef.current?.setSpeed(n);
  };

  const copyParams = (): void => {
    void navigator.clipboard.writeText(JSON.stringify(params, null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const activePrimitive = getPrimitive(primitiveId);
  const activeScenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  return (
    <div className="fxwb">
      <div className="fxwb-top">
        <div className="fxwb-title">🎨 FX Workbench</div>
        <div className="fxwb-group">
          {listPrimitives().map((prim) => (
            <button
              key={prim.id}
              className={`fxwb-btn${prim.id === primitiveId ? ' on' : ''}`}
              onClick={() => selectPrimitive(prim.id)}
            >
              {prim.id}
            </button>
          ))}
        </div>
        <div className="fxwb-group">
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              className={`fxwb-btn${s.id === scenarioId ? ' on' : ''}`}
              onClick={() => setScenarioId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="fxwb-group fxwb-backdrop-group">
          <span className="fxwb-backdrop-label">Backdrop</span>
          {BACKDROP_SWATCHES.map((sw) => (
            <button
              key={sw.label}
              className={`fxwb-backdrop-swatch${sw.hex === null ? ' none' : ''}${backdropColor === sw.hex ? ' on' : ''}`}
              style={sw.hex !== null ? { background: `#${sw.hex.toString(16).padStart(6, '0')}` } : undefined}
              title={sw.label}
              onClick={() => setBackdropColor(sw.hex)}
            />
          ))}
          <input
            className={`fxwb-backdrop-custom${backdropColor !== null && !BACKDROP_SWATCHES.some((sw) => sw.hex === backdropColor) ? ' on' : ''}`}
            type="color"
            title="Custom backdrop color"
            value={`#${(backdropColor ?? 0x808080).toString(16).padStart(6, '0')}`}
            onChange={(e) => setBackdropColor(parseInt(e.target.value.slice(1), 16))}
          />
        </div>
        <div className="fxwb-fps">{fps} fps</div>
        <button className="fxwb-close" onClick={onClose} title="Close FX Workbench">✕</button>
      </div>

      <div className="fxwb-side">
        {activePrimitive && <Inspector specs={activePrimitive.params} values={params} onChange={change} />}
        <button className="fxwb-copy" onClick={copyParams}>{copied ? 'Copied!' : 'Copy params'}</button>
      </div>

      <div className="fxwb-transport">
        <button className="fxwb-play" onClick={togglePlay} title={uiPlaying ? 'Pause' : 'Play'}>
          {uiPlaying ? '⏸' : '▶'}
        </button>
        <button className="fxwb-fire" onClick={fire} title="Fire a single one-shot preview (no loop)">
          🔥 Fire
        </button>
        <input
          className="fxwb-scrub"
          type="range"
          min={0}
          max={DURATION_MS}
          value={timeMs}
          onChange={(e) => scrub(Number(e.target.value))}
        />
        <span className="fxwb-time">{Math.round(timeMs)} / {DURATION_MS} ms</span>
        <label className="fxwb-speedlabel" htmlFor="fxwb-speed">Speed</label>
        <input
          id="fxwb-speed"
          className="fxwb-speed"
          type="range"
          min={0.1}
          max={3}
          step={0.1}
          value={speed}
          onChange={(e) => changeSpeed(Number(e.target.value))}
        />
        <span className="fxwb-speedval">{speed.toFixed(1)}x</span>
        <div className="fxwb-hint">{activeScenario?.hint}</div>
      </div>
    </div>
  );
}
