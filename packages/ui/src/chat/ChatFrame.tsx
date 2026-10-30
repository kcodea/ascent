/**
 * A CHAT WINDOW'S FRAME, shared by every chat window (the direct messages' window, R-DM-CHAT-02 / -03, and the lobby chat
 * panel, R-LOBBY-CHAT-02): MOVE it by its handles (the caller spreads `drag` on them; a press that moves less than a few
 * px is still a click on a tab or a button), RESIZE it from its four edges and four corners (the gold grips, dm.css), both
 * kept inside the screen, and put back inside when the screen shrinks. Where I leave it and its size are kept on this
 * device under the window's own key (`chatGeom.ts`). The pin itself is the caller's (`ChatPinButton` draws it).
 *
 * A PHONE (`phone`) gets no grips, no outline and no move: the caller's own phone layout stands.
 *
 * COST: a drag moves the frame by `transform` only, written straight to the element (no React render, no layout read);
 * a resize draws a ghost outline and commits the size once, on release. The view is read on mount and on a stage change
 * (a window resize, a rotation), never per frame. Nothing loops. Cursors: the gauntlet (CLAUDE.md, dm.css).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon } from '../Icon';
import { sfx } from '../sfx';
import { onStageChange, stageViewport, toStage } from '../stage';
import { swallowNextClick } from '../friends/dock/dockStore';
import { CHAT_EDGES, clampGeom, moveGeom, resizeGeom, type ChatEdge, type ChatGeom, type ChatLimits, type ChatPrefsStore } from './chatGeom';
import '../friends/dm/dm.css';

/** A phone: no move / resize / pin. Read from the stage's own flags (no layout read). */
export const phoneChat = (): boolean => typeof document !== 'undefined'
  && document.documentElement.hasAttribute('data-touch-ui') && document.documentElement.hasAttribute('data-touch-small');

/** A press that travels this far (stage px) on a handle is a move, not a click. */
export const MOVE_SLOP = 5;

/** What a move handle spreads (nothing on a phone). */
export interface ChatDrag { onPointerDown?: (e: ReactPointerEvent) => void }

export interface ChatFrameProps {
  prefs: ChatPrefsStore;
  limits: ChatLimits;
  /** Where the window opens before I ever move it, for a view of this size (stage px). */
  defaultGeom: (vw: number, vh: number) => ChatGeom;
  phone: boolean;
  pinned: boolean;
  /** The frame's classes (`dmchat-at` carries the shared frame rules). */
  className: string;
  /** More props for the frame element (a press or focus that says I am looking at it, ...). */
  frameProps?: HTMLAttributes<HTMLDivElement>;
  frameRef?: (el: HTMLDivElement | null) => void;
  children: (drag: ChatDrag) => ReactNode;
}

export function ChatFrame({ prefs, limits, defaultGeom, phone, pinned, className, frameProps, frameRef, children }: ChatFrameProps): JSX.Element {
  const saved = prefs.use((s) => s.geom);
  const [view, setView] = useState(stageViewport);
  useEffect(() => {
    setView(stageViewport());
    return onStageChange(() => setView(stageViewport()));
  }, []);
  const geom = useMemo(() => clampGeom(saved ?? defaultGeom(view.w, view.h), view.w, view.h, limits), [saved, view, limits, defaultGeom]);

  // MOVE / RESIZE: one gesture at a time, held in a ref (no state while the pointer moves).
  const frame = useRef<HTMLDivElement | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; edge: ChatEdge | null; sx: number; sy: number; start: ChatGeom; live: boolean; el: Element; last: ChatGeom | null } | null>(null);
  const begin = (e: ReactPointerEvent, edge: ChatEdge | null): void => {
    // A press that never became a drag (released outside the window) is simply replaced.
    if (phone || e.button !== 0 || gesture.current?.live) return;
    if (!edge && (e.target as Element).closest('input, textarea, .dmchat-rs, .dm-emotes')) return;
    gesture.current = { id: e.pointerId, edge, sx: e.clientX, sy: e.clientY, start: geom, live: false, el: e.currentTarget, last: null };
    if (edge) { e.preventDefault(); e.stopPropagation(); goLive(e.pointerId); }
  };
  const goLive = (pointerId: number): void => {
    const g = gesture.current!;
    g.live = true;
    try { g.el.setPointerCapture(pointerId); } catch { /* the pointer already went */ }
    frame.current?.classList.add(g.edge ? 'sizing' : 'moving');
    const gh = ghost.current;
    if (g.edge && gh) place(gh, g.start);
  };
  const onMove = (e: ReactPointerEvent): void => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = toStage(e.clientX - g.sx);
    const dy = toStage(e.clientY - g.sy);
    if (!g.live) {
      if (Math.abs(dx) < MOVE_SLOP && Math.abs(dy) < MOVE_SLOP) return;
      goLive(e.pointerId);
    }
    if (g.edge) {
      g.last = resizeGeom(g.start, g.edge, dx, dy, view.w, view.h, limits);
      if (ghost.current) place(ghost.current, g.last);
    } else {
      g.last = moveGeom(g.start, dx, dy, view.w, view.h, limits);
      if (frame.current) frame.current.style.transform = `translate(${g.last.x}px, ${g.last.y}px)`;
    }
  };
  const end = (e: ReactPointerEvent): void => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (!g.live) return;
    try { g.el.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    frame.current?.classList.remove('moving', 'sizing');
    if (ghost.current) ghost.current.classList.remove('on');
    // The release must not also press the tab or button the drag began on.
    swallowNextClick();
    if (g.last && e.type === 'pointerup') prefs.setGeom(g.last);
    if (frame.current) frame.current.style.transform = '';
  };

  const pos = { '--dmx': `${geom.x}px`, '--dmy': `${geom.y}px`, '--dmw': `${geom.w}px`, '--dmh': `${geom.h}px` } as CSSProperties;
  const drag: ChatDrag = phone ? {} : { onPointerDown: (e) => begin(e, null) };
  return (
    <>
      <div {...frameProps} ref={(el) => { frame.current = el; frameRef?.(el); }} className={`${className}${pinned ? ' pinned' : ''}${phone ? ' phone' : ''}`} style={pos}
        onPointerMove={onMove} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
        {children(drag)}
        {!phone && CHAT_EDGES.map((edge) => (
          <div key={edge} className={`dmchat-rs dmchat-rs-${edge}`} aria-hidden="true" onPointerDown={(e) => begin(e, edge)} />
        ))}
      </div>
      {!phone && <div ref={ghost} className="dmchat-ghost" aria-hidden="true" />}
    </>
  );
}

/** The resize outline at a geometry (transform + size on one empty box; nothing else lays out). */
function place(el: HTMLElement, g: ChatGeom): void {
  el.style.transform = `translate(${g.x}px, ${g.y}px)`;
  el.style.width = `${g.w}px`;
  el.style.height = `${g.h}px`;
  el.classList.add('on');
}

/** The pin: lit while pinned (the chat window's square button). `what` names the window in its label. */
export function ChatPinButton({ pinned, onToggle, what, className = '' }: { pinned: boolean; onToggle: (pinned: boolean) => void; what: string; className?: string }): JSX.Element {
  return (
    <button type="button" className={`fdock-x dmchat-pin pressable gtip gtip-down gtip-end${pinned ? ' on' : ''}${className ? ` ${className}` : ''}`} aria-pressed={pinned}
      data-tip={pinned ? 'Unpin' : 'Pin open while you play'}
      aria-label={pinned ? `Unpin ${what}` : `Pin ${what} open while you play`}
      onClick={() => { sfx.pulse(); onToggle(!pinned); }}>
      <Icon name="pin" />
    </button>
  );
}
