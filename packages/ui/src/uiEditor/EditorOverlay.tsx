import { useCallback, useEffect, useRef, useState } from 'react';
import { isUiEditMode, subscribeUiEditMode } from './config';
import { resolveAnchor, selectParent } from './resolver';
import { buildSelector, matchCount, type Scope } from './selector';
import { composeTransform, resizeToPx } from './transforms';
import {
  deserialize, removeEntry, serialize, setAsset, toSummary, upsertProp,
  type Scratchpad,
} from './scratchpad';
import { applyAll, applyEntry, clearAll, clearRule } from './overrideSheet';

/**
 * The in-run UI editor overlay — the integration layer over Tasks 1-7's pure cores (config/resolver/
 * selector/transforms/scratchpad/overrideSheet). DEV-only, mounted in `Game.tsx` beside `<DevMenu />`.
 *
 * Approach A: every edit becomes a CSS rule in a single injected `<style>` sheet (`overrideSheet.ts`),
 * addressed by a generated selector — NOT an inline style on the React element. That's what lets an edit
 * survive React re-renders and GSAP's own inline writes: the rule lives outside both.
 *
 * Persistence is synchronous on every DISCRETE edit (no debounce) — see `scratchpad.ts`'s header comment
 * for why (the FX-workbench Save-bug precedent). A drag gesture is NOT a discrete edit per pointermove:
 * per-frame `localStorage`/`JSON.stringify`/stylesheet-rebuild work is a hard performance-rule violation
 * (see root `CLAUDE.md`), so a move/resize drag writes only cheap, uncommitted inline styles on the live
 * target + the selection box while dragging, and commits ONE `upsertProp` → `applyEntry` → persist at
 * `pointerup`. Side effects (`applyEntry`/`persist`) are always run OUTSIDE any `setState` updater function
 * — calling them inside a functional `setSp(prev => ...)` update double-fires them under React StrictMode.
 */

const SCRATCH_KEY = 'ascent.uiEdit.scratchpad';
const RESTYLE_PROPS = ['font-size', 'color', 'background', 'border-radius', 'padding', 'opacity'] as const;

// Static picker list — every committed in-run image, resolved to a dev-server URL by Vite. `eager` + `?url`
// mirrors `art.ts`'s own glob so this stays in sync without a second manifest to maintain. Keys are raw
// module specifiers (not servable); values are the Vite-resolved URLs — always store the VALUE.
const PICKER_IMAGES = import.meta.glob('../art/**/*.{png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function persist(sp: Scratchpad): void {
  try { localStorage.setItem(SCRATCH_KEY, serialize(sp)); } catch { /* private mode / no storage */ }
}

function loadPersisted(): Scratchpad {
  try { return deserialize(localStorage.getItem(SCRATCH_KEY)); } catch { return {}; }
}

function defaultScope(el: Element): Scope {
  return el.getAttribute('data-uid') !== null ? 'this-element' : 'all-like-this';
}

/** Best-effort "this element is mid-animation" detector — a heuristic, not a guarantee (see brief §11). */
function isAnimated(el: Element): boolean {
  const w = window as unknown as { gsap?: { getTweensOf?: (t: unknown) => unknown[] } };
  if (typeof w.gsap?.getTweensOf === 'function') {
    try {
      let cur: Element | null = el;
      while (cur) {
        if ((w.gsap.getTweensOf(cur) ?? []).length > 0) return true;
        cur = cur.parentElement;
      }
      return false;
    } catch { /* fall through to the heuristic below */ }
  }
  return el.closest('.card') !== null && document.body.classList.contains('combat');
}

/**
 * Resolve a just-uploaded asset to a URL the browser can actually load. The upload endpoint returns a
 * repo-root-relative path (e.g. `packages/ui/src/assets/ui-editor/foo.png`) for display purposes, which is
 * NOT a servable URL on its own. Since this module itself lives at `packages/ui/src/uiEditor/`, a relative
 * `new URL(..., import.meta.url)` reaches the sibling `assets/ui-editor/` directory the exact same way the
 * dev server already resolves this module's own off-root imports (via Vite's `/@fs/` passthrough).
 */
function resolveUploadedAssetUrl(slug: string): string {
  return new URL(`../assets/ui-editor/${slug}.png`, import.meta.url).href;
}

type DragState =
  | { kind: 'move'; startX: number; startY: number; baseX: number; baseY: number; baseScale: number }
  | { kind: 'resize'; handle: string; startX: number; startY: number; baseW: number; baseH: number; baseX: number; baseY: number; baseScale: number };

type DragResult = { transform?: string; width?: string; height?: string; offset?: { x: number; y: number }; scale?: number };

/** Pure: turn a drag's accumulated pointer delta into the CSS it should produce. Shared by the cheap
 *  per-pointermove live preview and the one-time pointerup commit, so they can never disagree. */
function computeDrag(d: DragState, dx: number, dy: number, scaleAsUnit: boolean, keepAspect: boolean): DragResult {
  if (d.kind === 'move') {
    const offset = { x: d.baseX + dx, y: d.baseY + dy };
    return { transform: composeTransform(offset, d.baseScale), offset, scale: d.baseScale };
  }
  const sx = d.handle.includes('w') ? -1 : d.handle.includes('e') ? 1 : 0;
  const sy = d.handle.includes('n') ? -1 : d.handle.includes('s') ? 1 : 0;
  const dW = dx * sx;
  const dH = dy * sy;
  if (scaleAsUnit) {
    const ratioW = d.baseW > 0 ? (d.baseW + dW) / d.baseW : 1;
    const ratioH = d.baseH > 0 ? (d.baseH + dH) / d.baseH : 1;
    const scale = Math.max(0.05, sx !== 0 ? ratioW : sy !== 0 ? ratioH : Math.max(ratioW, ratioH));
    const offset = { x: d.baseX, y: d.baseY };
    return { transform: composeTransform(offset, scale), offset, scale };
  }
  const { width, height } = resizeToPx({ w: d.baseW, h: d.baseH }, dW, dH, keepAspect);
  return { width, height };
}

const HANDLES: { id: string; style: React.CSSProperties }[] = [
  { id: 'nw', style: { top: -5, left: -5, cursor: 'nwse-resize' } },
  { id: 'n', style: { top: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' } },
  { id: 'ne', style: { top: -5, right: -5, cursor: 'nesw-resize' } },
  { id: 'e', style: { top: '50%', right: -5, marginTop: -5, cursor: 'ew-resize' } },
  { id: 'se', style: { bottom: -5, right: -5, cursor: 'nwse-resize' } },
  { id: 's', style: { bottom: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' } },
  { id: 'sw', style: { bottom: -5, left: -5, cursor: 'nesw-resize' } },
  { id: 'w', style: { top: '50%', left: -5, marginTop: -5, cursor: 'ew-resize' } },
];

export function EditorOverlay(): JSX.Element | null {
  const [on, setOn] = useState(isUiEditMode());
  const [sp, setSp] = useState<Scratchpad>({});
  const [selected, setSelected] = useState<Element | null>(null);
  const [selRect, setSelRect] = useState<DOMRect | null>(null);
  const [selector, setSelector] = useState('');
  const [scope, setScope] = useState<Scope>('all-like-this');
  const [scaleAsUnit, setScaleAsUnit] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);

  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const offsetRef = useRef({ x: 0, y: 0 }); // committed translate for the current selection
  const scaleRef = useRef(1); // committed scale for the current selection
  const loadedRef = useRef(false); // has the scratchpad been loaded+applied for this "on" session

  // Mirrors of state read from the long-lived drag listeners (added once at pointerdown, removed at
  // pointerup) so they always see the LATEST selection/scratchpad rather than whatever was current when
  // the listener was attached.
  const selectedRef = useRef<Element | null>(null);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const selectorRef = useRef('');
  useEffect(() => { selectorRef.current = selector; }, [selector]);
  const scopeRef = useRef<Scope>('all-like-this');
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  const spRef = useRef<Scratchpad>({});
  useEffect(() => { spRef.current = sp; }, [sp]);

  // ---- 1. Mode subscription. OFF => render null, no listeners installed anywhere below. ----
  useEffect(() => subscribeUiEditMode(setOn), []);

  // First turn-ON: load the persisted scratchpad and re-apply every rule so prior edits are visible.
  useEffect(() => {
    if (!on || loadedRef.current) return;
    loadedRef.current = true;
    const loaded = loadPersisted();
    setSp(loaded);
    applyAll(loaded);
  }, [on]);

  // Discrete-edit commit: compute off the CURRENT `sp` (a plain value, not a functional updater — the
  // side effects below must never run twice, which a StrictMode-double-invoked updater would risk), apply
  // + persist once, then just store the result.
  const setProp = useCallback((prop: string, value: string) => {
    if (!selector) return;
    const next = upsertProp(sp, selector, scope, prop, value);
    applyEntry(next[selector]);
    persist(next);
    setSp(next);
  }, [selector, scope, sp]);

  const selectElement = useCallback((el: Element) => {
    setSelected(el);
    setSelRect(el.getBoundingClientRect());
    const nextScope = defaultScope(el);
    setScope(nextScope);
    setSelector(buildSelector(el, nextScope));
    offsetRef.current = { x: 0, y: 0 };
    scaleRef.current = 1;
    if (boxRef.current) boxRef.current.style.transform = '';
  }, []);

  // ---- 3. Selection: capture-phase pointerdown on document. ----
  useEffect(() => {
    if (!on) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target.closest('[data-ui-editor]')) return; // let the editor's own chrome handle its own clicks
      e.preventDefault();
      e.stopPropagation();
      selectElement(resolveAnchor(target));
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [on, selectElement]);

  // ---- 5/6. Move + resize drag. ----
  // Per pointermove: CHEAP live preview only — direct inline-style writes on the box + the live target
  // element. No React state, no upsertProp/applyEntry (stylesheet rebuild), no serialize, no localStorage.
  const onWindowPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const result = computeDrag(d, dx, dy, scaleAsUnit, e.shiftKey);
    const target = selectedRef.current as HTMLElement | null;

    if (result.transform !== undefined) {
      const boxTransform = d.kind === 'move' ? `translate(${dx}px, ${dy}px)` : `scale(${result.scale})`;
      if (boxRef.current) boxRef.current.style.transform = boxTransform;
      if (target) target.style.transform = result.transform;
    } else if (result.width !== undefined && result.height !== undefined) {
      if (boxRef.current) { boxRef.current.style.width = result.width; boxRef.current.style.height = result.height; }
      if (target) { target.style.width = result.width; target.style.height = result.height; }
    }
  }, [scaleAsUnit]);

  // pointerup: the ONE authoritative commit for the whole gesture — recomputes the same result from the
  // final pointer position, writes it through `upsertProp` → `applyEntry` → `persist` exactly once, then
  // clears the temporary inline styles so the injected stylesheet rule is the sole source of truth again.
  const endDrag = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('pointermove', onWindowPointerMove);

    const target = selectedRef.current as HTMLElement | null;
    if (target) { target.style.transform = ''; target.style.width = ''; target.style.height = ''; }
    if (!d) return;
    const sel = selectorRef.current;
    if (!sel) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const result = computeDrag(d, dx, dy, scaleAsUnit, e.shiftKey);
    if (result.offset) offsetRef.current = result.offset;
    if (result.scale !== undefined) scaleRef.current = result.scale;

    const sc = scopeRef.current;
    let next = spRef.current;
    if (result.transform !== undefined) next = upsertProp(next, sel, sc, 'transform', result.transform);
    if (result.width !== undefined && result.height !== undefined) {
      next = upsertProp(next, sel, sc, 'width', result.width);
      next = upsertProp(next, sel, sc, 'height', result.height);
    }
    applyEntry(next[sel]);
    persist(next);
    setSp(next);
  }, [onWindowPointerMove, scaleAsUnit]);

  useEffect(() => () => window.removeEventListener('pointermove', onWindowPointerMove), [onWindowPointerMove]);

  const startMove = (e: React.PointerEvent) => {
    if (!selected) return;
    e.stopPropagation();
    dragRef.current = {
      kind: 'move', startX: e.clientX, startY: e.clientY,
      baseX: offsetRef.current.x, baseY: offsetRef.current.y, baseScale: scaleRef.current,
    };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', endDrag, { once: true });
  };

  const startResize = (handle: string) => (e: React.PointerEvent) => {
    if (!selected || !selRect) return;
    e.stopPropagation();
    dragRef.current = {
      kind: 'resize', handle, startX: e.clientX, startY: e.clientY,
      baseW: selRect.width, baseH: selRect.height,
      baseX: offsetRef.current.x, baseY: offsetRef.current.y, baseScale: scaleRef.current,
    };
    window.addEventListener('pointermove', onWindowPointerMove);
    window.addEventListener('pointerup', endDrag, { once: true });
  };

  // ---- Selector text edit / scope toggle. ----
  const onSelectorChange = (value: string) => setSelector(value);
  const onScopeChange = (next: Scope) => {
    setScope(next);
    if (selected) setSelector(buildSelector(selected, next));
  };

  // ---- Image pick / upload. Both paths must store a URL the browser can actually load — `scratchpad.ts`
  // writes `entry.assetPath` straight into `background-image: url('<assetPath>')`, verbatim. ----
  const pickImage = (url: string) => {
    if (!selector) return;
    setAssetError(null);
    const next = setAsset(sp, selector, scope, url);
    applyEntry(next[selector]);
    persist(next);
    setSp(next);
  };

  const onUpload = async (file: File) => {
    setAssetError(null);
    if (file.type !== 'image/png') { setAssetError('Only PNG is supported.'); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    }).catch((e: unknown) => { setAssetError(e instanceof Error ? e.message : String(e)); return null; });
    if (!dataUrl) return;
    const slug = (selected?.getAttribute('data-uid')
      ?? selected?.getAttribute('data-ui')
      ?? file.name.replace(/\.png$/i, '')
      ?? 'asset').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 64) || 'asset';
    try {
      const res = await fetch('/__ui/asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, dataUrl }),
      });
      const json = await res.json() as { ok: boolean; path?: string; error?: string };
      if (!json.ok || !json.path) { setAssetError(json.error ?? 'Upload failed.'); return; }
      // `json.path` is a repo-root-relative path (for the summary / display) — not a servable URL. Resolve
      // it relative to THIS module so the browser gets a real, loadable URL for the swap.
      pickImage(resolveUploadedAssetUrl(slug));
    } catch (e) {
      setAssetError(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- Copy summary / reset. ----
  const copySummary = async () => {
    const counts: Record<string, number> = {};
    for (const key of Object.keys(sp)) counts[key] = matchCount(key);
    try {
      await navigator.clipboard.writeText(toSummary(sp, counts));
      setToast('Copied');
      setTimeout(() => setToast(null), 1500);
    } catch { setToast('Copy failed'); setTimeout(() => setToast(null), 1500); }
  };

  const resetElement = () => {
    if (!selector) return;
    const next = removeEntry(sp, selector);
    clearRule(selector);
    persist(next);
    setSp(next);
  };

  const resetAll = () => {
    clearAll();
    persist({});
    setSp({});
  };

  if (!on) return null;

  const count = selector ? matchCount(selector) : 0;
  const animated = selected ? isAnimated(selected) : false;

  return (
    <div data-ui-editor="root">
      <style>{CSS}</style>
      {selRect && (
        <div
          ref={boxRef}
          className="uied-box"
          data-ui-editor="box"
          style={{ left: selRect.left, top: selRect.top, width: selRect.width, height: selRect.height }}
          onPointerDown={startMove}
        >
          {animated && (
            <div className="uied-badge" data-ui-editor="badge" title="Transform edits may not stick during combat — edit at rest.">
              ⚠ animated
            </div>
          )}
          {HANDLES.map((h) => (
            <div
              key={h.id}
              className="uied-handle"
              data-ui-editor="handle"
              data-handle={h.id}
              style={h.style}
              onPointerDown={startResize(h.id)}
            />
          ))}
        </div>
      )}

      <div className="uied-toolbar" data-ui-editor="toolbar">
        <div className="uied-row uied-head">
          <span>🎛️ UI Edit Mode</span>
          {toast && <span className="uied-toast">{toast}</span>}
        </div>

        {!selected && <div className="uied-hint">Click an element to select it.</div>}

        {selected && (
          <>
            <label className="uied-row">
              <span>selector</span>
              <input
                value={selector}
                onChange={(e) => onSelectorChange(e.target.value)}
                spellCheck={false}
                className="uied-input"
              />
            </label>
            <div className="uied-row uied-meta">
              matches <b>{count}</b>
              <button
                className="uied-btn"
                onClick={() => { const p = selectParent(selected); if (p) selectElement(p); }}
                title="Select parent"
              >▲ parent</button>
            </div>

            <div className="uied-row">
              <span>scope</span>
              <div className="uied-seg">
                <button className={scope === 'this-element' ? 'on' : ''} onClick={() => onScopeChange('this-element')}>this element</button>
                <button className={scope === 'all-like-this' ? 'on' : ''} onClick={() => onScopeChange('all-like-this')}>all like this</button>
              </div>
            </div>

            <div className="uied-row">
              <span>scale as unit</span>
              <input type="checkbox" checked={scaleAsUnit} onChange={(e) => setScaleAsUnit(e.target.checked)} />
            </div>

            <div className="uied-grid">
              {RESTYLE_PROPS.map((prop) => (
                <label key={prop} className="uied-knob">
                  <span>{prop}</span>
                  <input
                    type="text"
                    placeholder={prop === 'color' || prop === 'background' ? '#rrggbb' : ''}
                    onBlur={(e) => { if (e.target.value.trim()) setProp(prop, e.target.value.trim()); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                  />
                </label>
              ))}
            </div>

            <div className="uied-row uied-imgs">
              <span>image</span>
              <div className="uied-imglist">
                {Object.entries(PICKER_IMAGES).slice(0, 24).map(([path, url]) => (
                  <button key={path} className="uied-imgbtn" title={path} onClick={() => pickImage(url)}>
                    <img src={url} alt="" />
                  </button>
                ))}
              </div>
              <label className="uied-btn uied-upload">
                upload PNG
                <input
                  type="file"
                  accept="image/png"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.target.value = ''; }}
                />
              </label>
              {assetError && <div className="uied-error">{assetError}</div>}
            </div>

            <div className="uied-row uied-actions">
              <button className="uied-btn" onClick={() => void copySummary()}>Copy Summary</button>
              <button className="uied-btn" onClick={resetElement}>Reset element</button>
              <button className="uied-btn danger" onClick={resetAll}>Reset all</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const CSS = `
[data-ui-editor] { box-sizing: border-box; }
.uied-box {
  position: fixed; z-index: 999998; pointer-events: auto; cursor: move;
  outline: 2px solid #4fa8ff; outline-offset: 2px; background: rgba(79,168,255,0.06);
}
.uied-handle {
  position: absolute; width: 10px; height: 10px; background: #4fa8ff; border: 1px solid #fff;
  border-radius: 2px; pointer-events: auto;
}
.uied-badge {
  position: absolute; top: -22px; left: 0; background: #e5446b; color: #fff; font: 600 11px/1.4 sans-serif;
  padding: 2px 6px; border-radius: 3px; white-space: nowrap;
}
.uied-toolbar {
  position: fixed; top: 12px; right: 12px; z-index: 999999; width: 280px; max-height: 90vh; overflow: auto;
  background: #1c1f26; color: #e8e8ec; border: 1px solid #3a3f4b; border-radius: 8px; padding: 10px;
  font: 12px/1.4 -apple-system, Segoe UI, sans-serif; pointer-events: auto; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
}
.uied-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; }
.uied-head { justify-content: space-between; font-weight: 600; }
.uied-hint { opacity: 0.7; padding: 8px 0; }
.uied-toast { color: #7fd88f; font-weight: 600; }
.uied-input { flex: 1; background: #12141a; border: 1px solid #3a3f4b; color: #e8e8ec; border-radius: 4px; padding: 3px 6px; font: inherit; }
.uied-meta { justify-content: space-between; opacity: 0.85; }
.uied-seg { display: flex; gap: 4px; }
.uied-seg button { flex: 1; background: #12141a; border: 1px solid #3a3f4b; color: #e8e8ec; border-radius: 4px; padding: 3px 6px; cursor: pointer; }
.uied-seg button.on { background: #4fa8ff; color: #10131a; border-color: #4fa8ff; }
.uied-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin: 6px 0; }
.uied-knob { display: flex; flex-direction: column; gap: 2px; font-size: 10px; opacity: 0.9; }
.uied-knob input { background: #12141a; border: 1px solid #3a3f4b; color: #e8e8ec; border-radius: 4px; padding: 3px 6px; font: inherit; }
.uied-imgs { flex-direction: column; align-items: stretch; }
.uied-imglist { display: flex; flex-wrap: wrap; gap: 4px; max-height: 96px; overflow: auto; }
.uied-imgbtn { width: 28px; height: 28px; padding: 0; border: 1px solid #3a3f4b; border-radius: 3px; overflow: hidden; cursor: pointer; background: #12141a; }
.uied-imgbtn img { width: 100%; height: 100%; object-fit: cover; }
.uied-btn { background: #2a2f3a; border: 1px solid #3a3f4b; color: #e8e8ec; border-radius: 4px; padding: 4px 8px; cursor: pointer; }
.uied-btn.danger { color: #ff8a9a; }
.uied-upload { display: inline-block; text-align: center; }
.uied-error { color: #ff8a9a; font-size: 11px; }
.uied-actions { flex-wrap: wrap; }
`;
