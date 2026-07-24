import { useEffect, useMemo, useRef, useState } from 'react';
import { Container } from 'pixi.js';
import { defaultsOf } from '../params';
import { createPlayer, type FxPlayer } from '../player';
import { getPrimitive, listPrimitives } from '../registry';
import { resolveAnchor } from '../anchors';
import { SCENARIOS } from '../scenarios';
import { pixiFx } from '../../pixiFx';
import { Inspector } from './Inspector';
import { createBackdrop, type FxBackdrop } from './backdrop';
import {
  addLayer,
  createEditorLayer,
  moveLayer,
  removeLayer,
  setLayerParam,
  setLayerPrimitive,
  setLayerTiming,
  structureKey,
  toDef,
  type EditorLayer,
} from './layerModel';

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

/** Duration dial bounds (ms) — replaces the old hardcoded `DURATION_MS` constant. Default matches the old
 *  constant's rough neighbourhood; the dial lets a tuner widen/narrow the def's duration (and thus the
 *  scenario's progress denominator) live. */
const DEFAULT_DURATION_MS = 1000;
const MIN_DURATION_MS = 200;
const MAX_DURATION_MS = 4000;
const DURATION_STEP_MS = 50;

/** Loop-gap dial bounds (ms) — only meaningful while Loop is on; see `FxPlayer.setLoopGap`. */
const MAX_LOOP_GAP_MS = 2000;
const LOOP_GAP_STEP_MS = 50;

/**
 * Full-screen dev overlay for live-tuning FX primitives. Deliberately NOT a `.sfxmix` draggable panel —
 * the whole point of this tool is its own purpose-built transport + a generated inspector, not another
 * floating tuner. Mounted only from `DevMenu` (itself dev-gated), so this entire tree is stripped from the
 * production bundle (see the DEV-gated import above for the one subtlety that requires).
 */
export function FxWorkbench({ onClose }: { onClose: () => void }): React.ReactElement {
  // The workbench now stages a LIST of layers (a composition), not a single primitive. `layers[selected]` is
  // the one the top primitive row / Inspector / timing controls edit; every layer is played together.
  const [layers, setLayers] = useState<EditorLayer[]>(() => {
    const first = listPrimitives()[0]?.id ?? 'ribbon';
    return [createEditorLayer(first, defaultsOf(getPrimitive(first)?.params ?? {}))];
  });
  const [selected, setSelected] = useState(0);
  // The "Add layer" picker's own selection (defaults to the first registered primitive). Independent of the
  // selected layer — it only feeds `addNewLayer`.
  const [addPrimitiveId, setAddPrimitiveId] = useState<string>(() => listPrimitives()[0]?.id ?? 'ribbon');
  const [scenarioId, setScenarioId] = useState<string>(() => SCENARIOS[0]?.id ?? '');
  // "Playing" now reflects the player's REAL state (polled each frame in the updater below), not just
  // "the user pressed play" — an auto-fire-once is playing until it completes, then goes idle on its own.
  const [uiPlaying, setUiPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [timeMs, setTimeMs] = useState(0);
  const [fps, setFps] = useState(0);
  const [copied, setCopied] = useState(false);
  const [backdropColor, setBackdropColor] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);
  // Loop is opt-in and OFF by default (see file-level rework note above `build()`): the workbench must
  // never auto-start a continuous loop just because an effect opened. Only `toggleLoop` turns this on.
  const [loopOn, setLoopOn] = useState(false);
  const [loopGapMs, setLoopGapMs] = useState(0);

  const playerRef = useRef<FxPlayer | null>(null);
  const backdropRef = useRef<FxBackdrop | null>(null);
  // Mirrors of the latest state, read by the per-frame updater / build closures so those never go stale
  // without forcing a player rebuild on every keystroke (a rebuild happens ONLY on primitive/scenario/duration
  // change). `loopGapRef` mirrors `loopGapMs` the same way `speedRef` mirrors `speed` -- a dial that should
  // survive a rebuild without itself triggering one.
  const layersRef = useRef(layers);
  const speedRef = useRef(speed);
  const loopGapRef = useRef(loopGapMs);
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

  // A signature of the layers' STRUCTURE only (primitive/anchor/at/life/order), NOT their params. This is
  // THE key that keeps a param drag from respawning the effect while still rebuilding on any structural
  // change — see the build effect's dependency array below.
  const structKey = useMemo(() => structureKey(layers), [layers]);

  // (Re)build the player whenever the layer STRUCTURE, scenario, OR duration changes. Param tweaks do NOT
  // land here — they go through player.setLayerParams (see `change` below) so a slider drag never respawns
  // the effect mid-gesture. Loop-on/off and the loop-gap dial ALSO don't land here (see `toggleLoop` /
  // `changeLoopGap`) -- they're live `setLoop`/`setLoopGap` calls on the existing player, not a rebuild, per
  // the same "don't respawn mid-gesture" reasoning.
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
    // Edge-detects `player.isPlaying()` transitions in the per-frame updater below so `uiPlaying` tracks the
    // player's REAL state without a `setState` call on every single frame.
    let lastPlaying = true;

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
      if (layersRef.current.some((l) => !getPrimitive(l.primitive))) {
        // Every layer's primitive must be registered before we can build. The self-registration import is a
        // DEV-gated dynamic import (see the top of this file — needed so prod's dead-code elimination can
        // drop it entirely) so on a very early mount it may not have resolved yet. Poll rather than silently
        // building nothing.
        retryTimer = setTimeout(build, 50);
        return;
      }
      // Cold-boot recovery: the initial `useState` may have run before the primitives registered, leaving a
      // layer's params empty. Fill in real defaults now that every spec exists. Params-only edit → structKey
      // unchanged → this setLayers does NOT respawn the effect (same as the old setParams recovery).
      let recovered: EditorLayer[] | null = null;
      layersRef.current.forEach((l, i) => {
        if (Object.keys(l.params).length === 0) {
          const prim = getPrimitive(l.primitive);
          if (prim) {
            recovered = recovered ?? layersRef.current.slice();
            recovered[i] = { ...l, params: defaultsOf(prim.params) };
          }
        }
      });
      if (recovered) {
        layersRef.current = recovered;
        setLayers(recovered);
      }
      const layersForDef = layersRef.current;

      container = new Container();
      unmountLayer = pixiFx.mountLayer(container);

      const def = toDef(`workbench-${layersForDef[0]?.primitive ?? 'fx'}`, durationMs, layersForDef);
      // NO auto-loop: every build (open, primitive/scenario switch, duration change) always constructs a
      // non-looping player and fires it exactly once, so the effect is visible immediately and then sits
      // idle -- never a continuous loop the user didn't ask for. `loopGapMs` is a dial value that DOES
      // survive the rebuild (see `loopGapRef`); the "is looping" flag deliberately does not (see `setLoopOn`
      // below) -- Loop is opt-in per build, matching the "no auto-loop on open" rule for every rebuild.
      player = createPlayer(def, { container, renderer }, { loop: false, loopGapMs: loopGapRef.current });
      player.setSpeed(speedRef.current);
      player.fireOnce();
      playerRef.current = player;
      setUiPlaying(true);
      setTimeMs(0);
      setLoopOn(false);
      lastPlaying = true;

      removeUpdater = pixiFx.addUpdater((dtMs) => {
        const p = player;
        if (!p) return;
        p.update(dtMs);

        const nowPlaying = p.isPlaying();
        if (nowPlaying !== lastPlaying) {
          lastPlaying = nowPlaying;
          setUiPlaying(nowPlaying);
        }

        const scenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
        if (scenario) {
          const vp = { w: window.innerWidth, h: window.innerHeight };
          const progress = (p.timeMs() % durationMs) / durationMs;
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
          // Every layer shares the SAME scenario head for now — per-layer anchors are a later refinement.
          for (let i = 0; i < layersRef.current.length; i++) p.setHead(i, pt.x, pt.y);
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
  }, [structKey, scenarioId, durationMs]);

  // `number[]` covers the editable palette param (a 4-tuple of colour stops); `number[][]` covers the curve
  // param (a list of [t, v] control points). Every value flows unchanged through setLayerParams'
  // `Record<string, unknown>`, then coerceParams validates it per the primitive's spec.
  const change = (key: string, value: number | boolean | string | number[] | number[][]): void => {
    setLayers((prev) => {
      const next = setLayerParam(prev, selected, key, value);
      layersRef.current = next;
      return next;
    });
    // Params-only edit: live-push to the selected layer's instance, no rebuild (structKey unchanged).
    playerRef.current?.setLayerParams(selected, { [key]: value });
  };

  // Commit a new layers array to both the state and the ref mirror the build/updater closures read.
  const commitLayers = (next: EditorLayer[]): void => {
    layersRef.current = next;
    setLayers(next);
  };

  const selectLayer = (i: number): void => setSelected(i);

  const addNewLayer = (id: string): void => {
    const prim = getPrimitive(id);
    const next = addLayer(layers, createEditorLayer(id, prim ? defaultsOf(prim.params) : {}));
    commitLayers(next);
    setSelected(next.length - 1);
  };

  const deleteLayer = (i: number): void => {
    const next = removeLayer(layers, i);
    commitLayers(next);
    setSelected((s) => Math.min(s, next.length - 1));
  };

  const reorderLayer = (i: number, dir: -1 | 1): void => {
    const next = moveLayer(layers, i, dir);
    commitLayers(next);
    const target = i + dir;
    if (target >= 0 && target < next.length) setSelected(target); // keep selection on the moved layer
  };

  // The TOP primitive-button row edits the SELECTED layer's primitive (resetting its params to the new
  // primitive's defaults). Structural change → structKey changes → the build effect respawns the player.
  const changeLayerPrimitive = (id: string): void => {
    if (layers[selected]?.primitive === id) return;
    const prim = getPrimitive(id);
    commitLayers(setLayerPrimitive(layers, selected, id, prim ? defaultsOf(prim.params) : {}));
  };

  const changeLayerTiming = (at: number, life: number | null): void => {
    commitLayers(setLayerTiming(layers, selected, at, life));
  };

  // Pause/resume. There's no standing continuous loop to "resume" unless Loop is on -- so when Loop is off,
  // resuming just re-fires a fresh one-shot pass (consistent with Fire, and with "no auto-loop" generally);
  // when Loop is on, resuming restarts continuous playback.
  const togglePlay = (): void => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying()) {
      p.pause();
      setUiPlaying(false);
    } else if (loopOn) {
      p.play();
      setUiPlaying(true);
    } else {
      p.fireOnce();
      setUiPlaying(true);
      setTimeMs(0);
    }
  };

  // Loop toggle -- the ONLY thing that starts continuous looping. OFF -> ON starts a fresh continuous cycle
  // from t=0; ON -> OFF stops and resets, matching "Loop off" meaning "nothing is looping", not "paused
  // mid-loop". Live setLoop()/play()/stop() calls on the existing player -- never a rebuild (see the build
  // effect's comment).
  const toggleLoop = (): void => {
    const p = playerRef.current;
    const next = !loopOn;
    setLoopOn(next);
    if (!p) return;
    if (next) {
      p.setLoop(true);
      p.play();
      setUiPlaying(true);
    } else {
      p.setLoop(false);
      p.stop();
      setUiPlaying(false);
      setTimeMs(0);
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

  // Loop-gap dial: live `setLoopGap`, no rebuild -- only meaningful once Loop is on, but it's harmless to
  // set while not looping. `loopGapRef` mirrors this into the next `build()` call the same way `speedRef`
  // mirrors `speed`, so the dial's value survives a primitive/scenario/duration rebuild.
  const changeLoopGap = (ms: number): void => {
    loopGapRef.current = ms;
    setLoopGapMs(ms);
    playerRef.current?.setLoopGap(ms);
  };

  // Duration dial: deliberately just a `setState` -- the actual rebuild is driven by `durationMs` sitting
  // in the build effect's dependency array (see above), same as primitive/scenario changes.
  const changeDuration = (ms: number): void => {
    setDurationMs(ms);
  };

  // Copy the whole composed DEF as JSON — with multiple layers, the def is the useful artifact, not one
  // layer's params.
  const copyDef = (): void => {
    void navigator.clipboard.writeText(JSON.stringify(toDef('workbench', durationMs, layers), null, 2)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  // The selected layer drives the top primitive row, the Inspector, and the timing controls. Fallback to the
  // last layer guards the brief window after a delete before `selected` re-clamps.
  const selLayer = layers[selected] ?? layers[layers.length - 1];
  const activePrimitive = getPrimitive(selLayer.primitive);
  const activeScenario = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];

  return (
    <div className="fxwb">
      <div className="fxwb-top">
        <div className="fxwb-title">🎨 FX Workbench</div>
        <div className="fxwb-group">
          {listPrimitives().map((prim) => (
            <button
              key={prim.id}
              className={`fxwb-btn${prim.id === selLayer.primitive ? ' on' : ''}`}
              onClick={() => changeLayerPrimitive(prim.id)}
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
        <div className="fxwb-layers">
          {layers.map((l, i) => (
            <div
              key={i}
              className={`fxwb-layer-row${i === selected ? ' on' : ''}`}
              onClick={() => selectLayer(i)}
            >
              <span className="fxwb-layer-name">{l.primitive}</span>
              <span className="fxwb-layer-meta">@{l.at}ms · {l.life === null ? 'full' : `${l.life}ms`}</span>
              <span className="fxwb-layer-btns">
                <button
                  onClick={(e) => { e.stopPropagation(); reorderLayer(i, -1); }}
                  disabled={i === 0}
                  title="Move up"
                >↑</button>
                <button
                  onClick={(e) => { e.stopPropagation(); reorderLayer(i, 1); }}
                  disabled={i === layers.length - 1}
                  title="Move down"
                >↓</button>
                {layers.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteLayer(i); }}
                    title="Remove layer"
                  >✕</button>
                )}
              </span>
            </div>
          ))}
          <div className="fxwb-layer-add">
            <select value={addPrimitiveId} onChange={(e) => setAddPrimitiveId(e.target.value)}>
              {listPrimitives().map((prim) => <option key={prim.id} value={prim.id}>{prim.id}</option>)}
            </select>
            <button onClick={() => addNewLayer(addPrimitiveId)} title="Add layer">＋</button>
          </div>
        </div>

        <div className="fxwb-timing">
          <label htmlFor="fxwb-layer-at">At</label>
          <input
            id="fxwb-layer-at"
            type="range"
            min={0}
            max={durationMs}
            step={10}
            value={selLayer.at}
            onChange={(e) => changeLayerTiming(Number(e.target.value), selLayer.life)}
          />
          <span className="fxwb-val">{selLayer.at} ms</span>
          <label className="fxwb-timing-full">
            <input
              type="checkbox"
              checked={selLayer.life === null}
              onChange={(e) =>
                changeLayerTiming(
                  selLayer.at,
                  e.target.checked ? null : Math.min(durationMs, Math.max(10, selLayer.life ?? durationMs)),
                )
              }
            />
            Full
          </label>
          {selLayer.life !== null && (
            <>
              <input
                type="range"
                min={10}
                max={durationMs}
                step={10}
                value={selLayer.life}
                onChange={(e) => changeLayerTiming(selLayer.at, Number(e.target.value))}
              />
              <span className="fxwb-val">{selLayer.life} ms</span>
            </>
          )}
        </div>

        {activePrimitive && <Inspector specs={activePrimitive.params} values={selLayer.params} onChange={change} />}
        <button className="fxwb-copy" onClick={copyDef}>{copied ? 'Copied!' : 'Copy def'}</button>
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
          max={durationMs}
          value={timeMs}
          onChange={(e) => scrub(Number(e.target.value))}
        />
        <span className="fxwb-time">{Math.round(timeMs)} / {durationMs} ms</span>

        <div className="fxwb-loopgroup" title="Loop is opt-in -- Fire above always stays a single one-shot pass regardless of this toggle">
          <button
            className={`fxwb-loop-toggle${loopOn ? ' on' : ''}`}
            onClick={toggleLoop}
            title={loopOn ? 'Loop is ON -- click to stop' : 'Loop is OFF -- click to loop continuously'}
          >
            {loopOn ? '🔁 Loop: On' : '🔁 Loop: Off'}
          </button>
          <label className="fxwb-speedlabel" htmlFor="fxwb-duration">Duration</label>
          <input
            id="fxwb-duration"
            className="fxwb-speed"
            type="range"
            min={MIN_DURATION_MS}
            max={MAX_DURATION_MS}
            step={DURATION_STEP_MS}
            value={durationMs}
            onChange={(e) => changeDuration(Number(e.target.value))}
          />
          <span className="fxwb-speedval">{durationMs} ms</span>
          <label className="fxwb-speedlabel" htmlFor="fxwb-loopgap">Loop gap</label>
          <input
            id="fxwb-loopgap"
            className="fxwb-speed"
            type="range"
            min={0}
            max={MAX_LOOP_GAP_MS}
            step={LOOP_GAP_STEP_MS}
            value={loopGapMs}
            onChange={(e) => changeLoopGap(Number(e.target.value))}
          />
          <span className="fxwb-speedval">{loopGapMs} ms</span>
        </div>

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
