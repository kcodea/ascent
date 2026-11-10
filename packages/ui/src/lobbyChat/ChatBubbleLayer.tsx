/**
 * CHAT BUBBLES (owner 2026-11-06: "how it shows an elipses when someone's typing, then their typed text in a speech bubble
 * next to their name"; R-CHAT-BUBBLE-01). Each speaker's bubble sits beside their face: a spectator's rail row, or a
 * player's hero portrait, wherever the emote bubble for that face would go (`emoteBubble.placementFor`).
 *
 * SPRINGY (owner 2026-11-09: "add some bounce and springiness to the bubbles"): it pops out of its tail with a squash
 * and a rock, the typing dots hop, the bubble boings from the dots' size to the words' size when they land, a move to a
 * new place slides on a spring, and it puffs and shrinks back into its tail when it goes. Every number is in
 * `chatBubbleConfig.ts` (the dev menu's "Chat Bubbles" panel).
 *
 * A bubble is placed ONCE when it opens or its speech changes (one rect read, never per frame). Only `transform` and
 * `opacity` move: the springs are one-shot Web Animations (compositor), and the dots loop on transform + opacity alone
 * (docs/performance.md). The outer box carries the slide, the inner bubble the pop / boing / leave, so the two never
 * fight over one transform. Bubbles never cover each other: a new one slides down its side until it clears the others.
 * The text is plain React text, never markup, with emotes as their pictures (bigger when a message is only emotes);
 * the reader's swear filter applies.
 *
 * ROOM ON THE SPECTATOR RAIL (owner 2026-11-09: "when someone sends a long message, any bubbles that pop up from another
 * spectator below are way off, is it possible to slide down the spectator cards while a long bubble or series of bubbles
 * are active?"): a spectator's bubbles that reach past the bottom of their row push the rows below down by that much
 * (a margin under the row), and the rows slide there on the bubble spring; the bubbles already beside those rows ride
 * along. So every spectator's bubble stays level with their own row. A rail bubble steps clear only of the bubbles of
 * the rows ABOVE it; the rows below make room instead. Measured once per bubble change (after the bubbles are placed,
 * before paint), never per frame; the slide is a one-shot `translate` animation (compositor).
 */
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatBody, isSoloEmotes } from '../chat/ChatMessage';
import { placementFor } from '../emotes/emoteBubble';
import { PLAYER_SEAT } from '../emotes/emoteRuntime';
import { useFriendsPrefs } from '../friends/friendsPrefs';
import { stageHost, stageViewport, toStage } from '../stage';
import { useGame } from '../store';
import { chatSeatOf, MAX_CHAT_BUBBLES, useChatSpeech, type Speech } from './chatSpeech';
import { getChatBubbleConfig, type ChatBubbleConfig } from './chatBubbleConfig';
import { bubbleShape, hashSeed } from './chatBubbleShape';
import { land, leave, popIn, reducedMotion, slide } from './chatBubbleSpring';
import { useLobbyChat } from './lobbyChatStore';
import './chatBubble.css';

const GAP = 6;
/** Moves smaller than this snap: a pixel of drift is not worth a spring. */
const SLIDE_MIN_PX = 2;

/**
 * Where each first bubble's tail tip sits on the stage, by bubble id: a long message's later bubbles aim their tail at
 * the same spot (owner 2026-11-09: "so it looks like it comes from the same spot"). Written when a bubble is drawn.
 */
const tailTips = new Map<string, { x: number; y: number }>();

/**
 * Ink the hand-drawn bubble into its SVG (written straight to the paths: no re-render). The SVG overhangs the box by a
 * margin so the tail and the sketch strokes can reach outside it (a reaching tail widens the margin to its tip).
 * Answers where the tail's tip landed, in the bubble's coordinates.
 */
function drawShape(el: SVGSVGElement | null, w: number, h: number, tail: 'left' | 'right', seed: number, c: ChatBubbleConfig,
  reach?: { x: number; y: number }): { x: number; y: number } | null {
  if (!el || !w || !h) return null;
  const pad = c.wobble + c.accentGap + c.inkWidth + 6;
  const far = reach ? Math.max(-reach.x, reach.x - w, -reach.y, reach.y - h) : 0;
  const m = Math.ceil(Math.max(c.tailLen, far) + pad);
  const shape = bubbleShape({ w, h, tail, seed, wobble: c.wobble, radius: c.radius, tailLen: c.tailLen, accents: c.accents, accentGap: c.accentGap, askew: c.askew, reach, reachWidth: c.reachWidth });
  el.setAttribute('viewBox', `${-m} ${-m} ${w + 2 * m} ${h + 2 * m}`);
  el.style.left = el.style.top = `${-m}px`;
  el.style.width = `${w + 2 * m}px`;
  el.style.height = `${h + 2 * m}px`;
  const [shadow, body, sketch] = [...el.children] as SVGPathElement[];
  shadow?.setAttribute('d', shape.body);
  shadow?.setAttribute('transform', `translate(${c.shadowX} ${c.shadowY})`);
  body?.setAttribute('d', shape.body);
  sketch?.setAttribute('d', shape.accents);
  el.style.setProperty('--cb-ink', c.ink);
  el.style.setProperty('--cb-ink-w', `${c.inkWidth}px`);
  el.style.setProperty('--cb-sketch-w', `${Math.max(1, c.inkWidth * 0.6)}px`);
  return shape.tip;
}

/** The rail's spectator rows, top to bottom (each carries its spectator's id). */
const RAIL_ROWS = '.vsspec-seats > [data-watcher]';
/** Room kept between a spectator's last bubble and the next row, px. */
export const RAIL_ROOM_GAP = 6;
/** How far a row pushes the rows below it: its speaker's bubbles reach `stackBottom` px below the row's top. */
export function railRoomFor(stackBottom: number | undefined, rowH: number): number {
  return stackBottom == null ? 0 : Math.max(0, Math.round(stackBottom + RAIL_ROOM_GAP - rowH));
}
const ROOM_ANIM = 'chat-rail-room';
const railOrder = (): string[] => [...document.querySelectorAll<HTMLElement>(RAIL_ROWS)].map((r) => r.dataset.watcher ?? '');

/** Make (or give back) room under each spectator row for its bubbles, sliding the rows and their bubbles. */
export function syncRailRoom(): void {
  const rows = [...document.querySelectorAll<HTMLElement>(RAIL_ROWS)];
  if (!rows.length) return;
  const host = stageHost().getBoundingClientRect();
  const yOf = (el: Element): number => toStage(el.getBoundingClientRect().top - host.top);
  const settle = (el: Element): void => { for (const a of el.getAnimations?.() ?? []) if (a.id === ROOM_ANIM) a.cancel(); };
  const bubs = [...document.querySelectorAll<HTMLElement>('.chatbub[data-speaker]')].filter((b) => b.style.visibility === 'visible');
  rows.forEach(settle);
  bubs.forEach(settle);
  const bySpeaker = new Map<string, HTMLElement[]>();
  for (const b of bubs) {
    const k = b.dataset.speaker ?? '';
    const list = bySpeaker.get(k);
    if (list) list.push(b); else bySpeaker.set(k, [b]);
  }
  const before = rows.map(yOf);
  const rooms = rows.map((r, i) => {
    const mine = bySpeaker.get(r.dataset.watcher ?? '');
    const bottom = mine?.length ? Math.max(...mine.map((b) => parseFloat(b.style.top) + b.offsetHeight)) - before[i]! : undefined;
    return railRoomFor(bottom, toStage(r.getBoundingClientRect().height));
  });
  let changed = false;
  rows.forEach((r, i) => {
    const v = rooms[i] ? `${rooms[i]}px` : '';
    if (r.style.marginBottom !== v) { r.style.marginBottom = v; changed = true; }
  });
  if (!changed) return;
  const after = rows.map(yOf);
  const motion = !reducedMotion();
  const c = getChatBubbleConfig();
  const glide = (el: HTMLElement, d: number): void => {
    if (!motion || typeof el.animate !== 'function') return;
    const a = slide({ speed: c.slideSpeed, bounce: c.slideBounce, dx: 0, dy: -d });
    // `translate`, so it never fights a row's own slide-out or a bubble's own spring (both `transform`).
    const frames = a.frames.map((f) => ({ offset: f.offset, translate: f.transform === 'none' ? '0px 0px' : String(f.transform).replace(/^translate\((.*), (.*)\)$/, '$1 $2') }));
    el.animate(frames, { duration: a.ms, id: ROOM_ANIM });
  };
  rows.forEach((r, i) => {
    const d = Math.round(after[i]! - before[i]!);
    if (!d) return;
    for (const b of bySpeaker.get(r.dataset.watcher ?? '') ?? []) {
      b.style.top = `${parseFloat(b.style.top) + d}px`;
      const tip = tailTips.get(b.dataset.bid ?? '');
      if (tip) tip.y += d;
      glide(b, d);
    }
    glide(r, d);
  });
}
/** The rail goes back to its plain spacing (the chat left the screen). */
function clearRailRoom(): void {
  for (const r of document.querySelectorAll<HTMLElement>(RAIL_ROWS)) r.style.marginBottom = '';
}

/** How far below the first bubble's tip a later bubble's tail lands, px (the two tips sit close, not stacked). */
const REACH_BELOW = 5;

interface Placed { left: number; top: number; w: number; h: number; kind: Speech['kind']; body: string | undefined }

const ChatBubble = memo(function ChatBubble({ id, speech, me, staged, filter, leaving, onGone }: {
  id: string; speech: Speech; me: string | null; staged: boolean; filter: boolean; leaving: boolean; onGone: (id: string) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const last = useRef<Placed | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const box = inner.current;
    if (!el || !box || leaving) return;
    // A long message's later bubbles sit by the same face as its first.
    const seat = chatSeatOf(speech.speaker ?? id, speech.role, me);
    const at = seat ? placementFor(seat) : null;
    if (!at) { el.style.visibility = 'hidden'; last.current = null; return; }
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    // A hero portrait's emote eclipses its edge; words must not, so this one stands clear of it.
    // The drawn tail reaches out toward the face, so the box stands that much further off (the old CSS tail was 6px).
    const cfgNow = getChatBubbleConfig();
    const clear = (seat === PLAYER_SEAT ? 56 : 0) + Math.max(0, cfgNow.tailLen - 6);
    const left = Math.round(at.side === 'right' ? at.x + clear : at.x - w - clear);
    let top = Math.max(GAP, at.y - h / 2);
    // Below every placed bubble this one would touch (a leaving one no longer counts). On the spectator rail, only the
    // bubbles of the rows ABOVE this speaker's (and their own earlier ones): the rows below slide down to make room.
    const speaker = speech.speaker ?? id;
    const rail = seat?.startsWith('w:') ? railOrder() : null;
    const myRow = rail ? rail.indexOf(speaker) : -1;
    const below = (o: HTMLElement): boolean => {
      if (!rail || myRow < 0 || o.dataset.speaker === speaker) return false;
      const row = rail.indexOf(o.dataset.speaker ?? '');
      return row > myRow;
    };
    const others = [...document.querySelectorAll<HTMLElement>('.chatbub:not(.leaving)')].filter((o) => o !== el && o.style.visibility === 'visible' && !below(o));
    for (let moved = true, pass = 0; moved && pass < MAX_CHAT_BUBBLES; pass++) {
      moved = false;
      for (const o of others) {
        const ol = o.offsetLeft, ot = o.offsetTop;
        if (ol < left + w && left < ol + o.offsetWidth && ot < top + h && top < ot + o.offsetHeight) { top = ot + o.offsetHeight + GAP; moved = true; }
      }
    }
    top = Math.round(Math.min(top, stageViewport().h - h - GAP));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.classList.toggle('right', at.side === 'right');
    el.classList.toggle('left', at.side === 'left');
    el.style.visibility = 'visible';
    // A long message's later bubble reaches its tail up to the first bubble's tip (only when it sits below it).
    const firstTip = speech.speaker && speech.speaker !== id ? tailTips.get(speech.speaker) : undefined;
    const reach = firstTip && firstTip.y + REACH_BELOW < top + h / 2 ? { x: firstTip.x - left, y: firstTip.y + REACH_BELOW - top } : undefined;
    const tip = drawShape(svg.current, w, h, at.side === 'right' ? 'left' : 'right', hashSeed(`${id}|${speech.body ?? ''}`), cfgNow, reach);
    if (tip && !reach) tailTips.set(id, { x: left + tip.x, y: top + tip.y });

    const prev = last.current;
    last.current = { left, top, w, h, kind: speech.kind, body: speech.body };
    if (reducedMotion() || typeof box.animate !== 'function') return;
    const c = getChatBubbleConfig();
    if (!prev) {
      const a = popIn({ speed: c.inSpeed, bounce: c.inBounce, from: c.inFrom, squash: c.inSquash, tilt: at.side === 'right' ? -c.inTilt : c.inTilt });
      box.getAnimations().forEach((x) => x.cancel());
      box.animate(a.frames, { duration: a.ms, fill: 'backwards' });
      return;
    }
    const dx = prev.left - left, dy = prev.top - top;
    if (Math.abs(dx) >= SLIDE_MIN_PX || Math.abs(dy) >= SLIDE_MIN_PX) {
      const a = slide({ speed: c.slideSpeed, bounce: c.slideBounce, dx, dy });
      el.getAnimations().forEach((x) => x.cancel());
      el.animate(a.frames, { duration: a.ms });
    }
    if (prev.kind !== speech.kind || prev.body !== speech.body) {
      const a = land({ speed: c.landSpeed, bounce: c.landBounce, kick: c.landKick, fromX: w ? prev.w / w : 1, fromY: h ? prev.h / h : 1 });
      box.getAnimations().forEach((x) => x.cancel());
      box.animate(a.frames, { duration: a.ms });
    }
  }, [id, speech, me, staged, leaving]);

  // Leaving: puff, shrink into the tail, then let the layer drop it.
  useLayoutEffect(() => {
    if (!leaving) return undefined;
    const box = inner.current;
    if (!box || reducedMotion() || typeof box.animate !== 'function' || ref.current?.style.visibility !== 'visible') { onGone(id); return undefined; }
    const c = getChatBubbleConfig();
    box.getAnimations().forEach((x) => x.cancel());
    const a = box.animate(leave({ puff: c.outPuff, to: c.outTo }), { duration: c.outMs, fill: 'forwards' });
    let done = false;
    a.onfinish = () => { done = true; tailTips.delete(id); onGone(id); };
    // Spoken again before it went: the main effect re-places it and the pop plays fresh.
    return () => { if (!done) { a.cancel(); last.current = null; } };
  }, [leaving]);

  return (
    <div ref={ref} className={`chatbub ${speech.kind}${leaving ? ' leaving' : ''}`} style={{ visibility: 'hidden' }} aria-hidden="true"
      data-speaker={speech.speaker ?? id} data-bid={id}>
      <div ref={inner} className="chatbub-in">
        <svg ref={svg} className="chatbub-ink" aria-hidden="true" focusable="false">
          <path className="chatbub-shadow" />
          <path className="chatbub-body" />
          <path className="chatbub-sketch" />
        </svg>
        {speech.kind === 'typing'
          ? <span className="chatbub-dots"><i /><i /><i /></span>
          : <span className={`chatbub-text${isSoloEmotes(speech.body ?? '') ? ' solo' : ''}`}><ChatBody body={speech.body ?? ''} filter={filter} /></span>}
      </div>
    </div>
  );
});

export const ChatBubbleLayer = memo(function ChatBubbleLayer(): JSX.Element | null {
  const by = useChatSpeech((s) => s.by);
  const me = useLobbyChat((s) => s.me);
  const staged = useGame((s) => !!s.combatStaged);
  const filter = useFriendsPrefs((s) => s.filterMessages);
  // A bubble whose speech ended stays on screen while it plays its leave, with the last thing it said.
  const kept = useRef(new Map<string, Speech>());
  const [, bump] = useState(0);
  const ids = Object.keys(by);
  // A said line outranks an ellipsis when the screen is full.
  const shown = [...ids.filter((i) => by[i]!.kind === 'text'), ...ids.filter((i) => by[i]!.kind === 'typing')].slice(0, MAX_CHAT_BUBBLES);
  const live = new Set(shown);
  const prevShown = useRef<Map<string, Speech>>(new Map());
  for (const [id, sp] of prevShown.current) if (!live.has(id) && !kept.current.has(id)) kept.current.set(id, sp);
  for (const id of shown) kept.current.delete(id);
  prevShown.current = new Map(shown.map((id) => [id, by[id]!]));
  const onGone = useRef((id: string): void => { if (kept.current.delete(id)) bump((n) => n + 1); }).current;
  // After the bubbles placed themselves (children's layout effects run first), before paint: the rail makes room.
  useLayoutEffect(() => { syncRailRoom(); });
  useLayoutEffect(() => clearRailRoom, []);
  if (shown.length === 0 && kept.current.size === 0) return null;
  // One list, so a bubble that starts leaving keeps its element (and its place) instead of being rebuilt.
  const all: [string, Speech, boolean][] = [...shown.map((id): [string, Speech, boolean] => [id, by[id]!, false]), ...[...kept.current].map(([id, sp]): [string, Speech, boolean] => [id, sp, true])];
  return createPortal(<>
    {all.map(([id, sp, out]) => <ChatBubble key={id} id={id} speech={sp} me={me} staged={staged} filter={filter} leaving={out} onGone={onGone} />)}
  </>, stageHost());
});
