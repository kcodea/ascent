import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { getHero } from '@game/sim';
import { useGame } from '../store';
import { sfx } from '../sfx';
import { LbHeroFrame } from '../LadderBits';
import { heroPortrait, opponentSkins, useRunSkins } from '../skins/skins';
import { frameIdOf } from '../portraitFrame/PortraitFrame';
import { artReady, requestArt, whenArtReady } from '../artPreload';
import { useSpectate } from '../versus/spectate';
import { goodLuckIntro } from '../goodLuck/goodLuckIntroStore';
import { getLobbyRevealConfig, LHR_REPLAY_EVENT } from './lobbyRevealConfig';
import {
  arcKeyframes, REVEAL_FACE_SELECTOR, REVEAL_HEAD_SELECTORS, revealHidesSlot, revealShowSelectorFor, revealTargetSelectors, revealTimeline, spectatorShouldReveal,
  type Rect, type RevealEntry,
} from './lobbyRevealModel';
import { lobbyReveal, lobbyRevealEnabled, useLobbyRevealActive, useLobbyRevealSeq, type RevealPlay } from './lobbyRevealStore';
import { beginLobbyRevealFor } from './beginLobbyReveal';
import './lobbyReveal.css';

/**
 * THE LOBBY REVEAL — the overlay (owner ask 2026-10-31: "after the player locks in a hero and hits start game ... all
 * the heroes in the lobby are shown and then all portraits fly over and build the rail").
 *
 * Mounted once in Game, beside the Good Luck intro and under the launch curtain. Renders nothing until
 * `lobbyReveal.begin()`, then plays ONE pass:
 *
 *   the live first shop dimmed, every hero of this game rising into a line-up centre stage (in its in-run portrait
 *   frame, the hero's name over the player's)  →  hold  →  each portrait flies on an arc to its own rail slot, shrinking
 *   into it, the slot appearing under it as it lands ("build the rail") while the dim lifts  →  the round slice settles
 *   →  end, and the Good Luck intro takes over (it has been waiting, with the shop clock held, the whole time).
 *
 * A REAL PHASE BEFORE ROUND 1 (owner 2026-10-31: "The hero reveal animation should happen before any timers obviously"):
 * the run is built under it but nothing runs. The shop takes no input (this layer covers it) and the turn clock is held
 * (the Good Luck intro waits behind the reveal, and Recruit's clock gate already reads that intro). A click, Esc or any
 * key skips to the Good Luck words. Reduced motion: a plain fade in, a short hold, a fade out as the rail fades in.
 *
 * PERF CONTRACT: every motion is a WAAPI transform / opacity animation scheduled up front (no per-frame JS at all).
 * Layout is read exactly twice per play: the rail slots are hidden once on mount, and at take-off ONE pass reads every
 * stage portrait and every slot (cached for the whole flight). Portraits are art the boot gate already decoded; the
 * line-up waits (at most 500 ms) for any that are not, so nothing pops in. The dim is a static gradient faded by opacity.
 */

/** What the reveal hid, so the end (natural or skipped) can always put it back. */
interface Hidden { el: HTMLElement; prev: string | null }

const ATTR = 'data-lhr';

function prefersReducedMotion(): boolean {
  try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** WAAPI when available; jsdom (tests) has none, and the reveal still ends on its timer there. */
function anim(el: Element | null | undefined, frames: Keyframe[], opts: KeyframeAnimationOptions): Animation | null {
  if (!el || typeof (el as HTMLElement).animate !== 'function') return null;
  return (el as HTMLElement).animate(frames, opts);
}

function firstMatch(selectors: readonly string[]): HTMLElement | null {
  for (const s of selectors) {
    const el = document.querySelector<HTMLElement>(s);
    if (el && el.isConnected) return el;
  }
  return null;
}

/** Each entry's landing slot, plus what to reveal there (a Duos team slot shows with its first member). */
function findTargets(play: RevealPlay): { slot: (HTMLElement | null)[]; show: (HTMLElement | null)[]; heads: HTMLElement[] } {
  const showSel = revealShowSelectorFor(play.layout);
  const slot = play.entries.map((e) => firstMatch(revealTargetSelectors(e, play.layout)));
  const show = slot.map((el, i) => (!el || !revealHidesSlot(play.entries[i]!, play.layout) ? null : showSel ? (el.closest<HTMLElement>(showSel) ?? el) : el));
  const heads = REVEAL_HEAD_SELECTORS.map((s) => document.querySelector<HTMLElement>(s)).filter((x): x is HTMLElement => !!x);
  return { slot, show, heads };
}

function hide(el: HTMLElement | null, into: Hidden[]): void {
  if (!el || into.some((h) => h.el === el)) return;
  into.push({ el, prev: el.getAttribute(ATTR) });
  el.setAttribute(ATTR, 'wait');
}

function unhide(el: HTMLElement | null, into: Hidden[]): void {
  if (!el) return;
  const i = into.findIndex((h) => h.el === el);
  if (i < 0) return;
  const h = into[i]!;
  into.splice(i, 1);
  if (h.prev == null) el.removeAttribute(ATTR); else el.setAttribute(ATTR, h.prev);
}

const rectIn = (r: DOMRect, o: { left: number; top: number; k: number }): Rect =>
  ({ left: (r.left - o.left) / o.k, top: (r.top - o.top) / o.k, width: r.width / o.k, height: r.height / o.k });

export function LobbyReveal(): JSX.Element | null {
  const active = useLobbyRevealActive();
  const seq = useLobbyRevealSeq();
  const showTitle = useGame((s) => s.showTitle);
  const runSkins = useRunSkins();
  const showOppSkins = useGame((s) => s.showOpponentSkins);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);
  const hiddenRef = useRef<Hidden[]>([]);

  // DEV ▶ Replay from the tuner: replay over whatever board is up. Never from the title (nothing to build).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onReplay = (): void => {
      const st = useGame.getState();
      if (st.run && !st.showTitle) beginLobbyRevealFor({ ...st.run, wave: 1 }, { force: true });
    };
    window.addEventListener(LHR_REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(LHR_REPLAY_EVENT, onReplay);
  }, []);

  // THE STANDS (owner brief: spectators see it when they joined at the start; late joiners skip it). Armed when this
  // screen showed the watched player's Hero Select; fired when that screen turns into their opening shop.
  useEffect(() => {
    let sawAt: number | null = null;
    const offSpec = useSpectate.subscribe((s, prev) => {
      if (s.active && !s.teammateHero && s.hero && !prev.hero) sawAt = Date.now();
      if (!s.active) sawAt = null;
    });
    const offGame = useGame.subscribe((s, prev) => {
      if (sawAt == null || s.run === prev.run) return;
      const sp = useSpectate.getState();
      if (!sp.active || sp.hero) return;
      if (spectatorShouldReveal(sawAt, Date.now(), s.run, lobbyRevealEnabled())) {
        sawAt = null;
        beginLobbyRevealFor(s.run, { spectator: true });
      }
    });
    return () => { offSpec(); offGame(); };
  }, []);

  // Leaving to the title mid-reveal (or Game unmounting) must never strand anything held or hidden.
  useEffect(() => { if (active && showTitle) finish(true); }, [active, showTitle]);
  useEffect(() => () => { restoreAll(hiddenRef.current); lobbyReveal.end(); }, []);

  // Click, Esc or any key skips. Capture phase, so the same press does not also open the Esc menu underneath.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      e.preventDefault();
      e.stopPropagation();
      finish(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // THE ONE PASS. A layout effect so the line-up is hidden and every animation scheduled before the first paint.
  useLayoutEffect(() => {
    if (!active) return;
    const play = lobbyReveal.play();
    const root = rootRef.current;
    if (!play || !root) return;
    const c = getLobbyRevealConfig();
    const reduced = prefersReducedMotion();
    const n = play.entries.length;
    const t = revealTimeline(c, n, reduced);
    const timers: number[] = [];
    const anims: Animation[] = [];
    const hidden = hiddenRef.current;
    let dead = false;
    const at = (ms: number, fn: () => void): void => { timers.push(window.setTimeout(() => { if (!dead) fn(); }, Math.max(0, ms))); };
    const push = (a: Animation | null): void => { if (a) anims.push(a); };

    // Hide the rail's slots (and the round slice) so it can be built. The rail may mount a frame after the run is built
    // (the curtain waits two frames before it lifts): one retry a frame until the line-up is complete.
    let targets = findTargets(play);
    const hideAll = (): boolean => {
      targets = findTargets(play);
      for (const el of targets.show) hide(el, hidden);
      for (const el of targets.heads) hide(el, hidden);
      return targets.slot.every(Boolean);
    };
    if (!hideAll()) {
      let tries = 0;
      const retry = (): void => {
        if (dead || hideAll() || ++tries > 40) return;
        requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    }

    const cards = Array.from(root.querySelectorAll<HTMLElement>('.lhr-card'));
    const faces = cards.map((el) => el.querySelector<HTMLElement>('.lhr-face'));
    const labels = cards.map((el) => el.querySelector<HTMLElement>('.lhr-labels'));

    // The line-up only starts once every portrait is decoded (the boot gate has normally done it already), so no frame
    // ever shows a blank disc. Waits at most 500 ms; the cards sit invisible meanwhile.
    const urls = play.entries.map((e) => portraitOf(e)).filter((u): u is string => !!u);
    const ready = urls.every((u) => artReady(u));
    const begin = (offset: number): void => {
      if (dead) return;
      const o = Math.max(0, t.enterAt[0]! - offset);
      if (c.revealSoundGain > 0) at(o, () => sfx.ceremony('ceremonyrevealsound', c.revealSoundGain));
      cards.forEach((el, i) => {
        const delay = Math.max(0, t.enterAt[i]! - offset);
        push(reduced
          ? anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay, easing: 'ease-out', fill: 'both' })
          : anim(el, [{ opacity: 0, transform: 'translateY(28px) scale(0.86)' }, { opacity: 1, transform: 'none' }],
            { duration: c.entranceMs, delay, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.08)', fill: 'both' }));
      });
      // The duel's VS leaves with the names, as the flights start.
      push(anim(root.querySelector('.lhr-vs'), [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: Math.max(0, t.dimOutAt - offset), easing: 'ease-in', fill: 'forwards' }));
      // The dim lifts with the flights, so the rail builds on the live board.
      const flightSpan = reduced ? 300 : Math.max(200, t.headAt - t.dimOutAt);
      push(anim(dimRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: flightSpan, delay: Math.max(0, t.dimOutAt - offset), easing: 'ease-in-out', fill: 'forwards' }));

      at(t.dimOutAt - offset, () => takeOff(offset));
      at(t.headAt - offset, () => {
        for (const el of targets.heads) {
          unhide(el, hidden);
          push(reduced
            ? anim(el, [{ opacity: 0 }], { duration: 300, easing: 'ease-out' })
            : anim(el, [{ opacity: 0, transform: 'translateY(-10px) scale(1.06)' }], { duration: c.headSettleMs || 1, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.15)' }));
        }
      });
      at(t.endAt - offset, () => finish(false));
    };

    // TAKE-OFF: one read pass (every portrait, every slot), then every flight scheduled at once from those numbers.
    const takeOff = (offset: number): void => {
      hideAll(); // a slot that mounted late is caught here, with the same single read pass below
      const rr = root.getBoundingClientRect();
      const o = { left: rr.left, top: rr.top, k: root.offsetWidth ? rr.width / root.offsetWidth : 1 };
      const from = faces.map((f) => (f ? rectIn(f.getBoundingClientRect(), o) : null));
      // Each portrait lands on the slot's FACE (the rail row's portrait), not the middle of the whole row.
      const to = targets.slot.map((s) => (s ? rectIn((s.querySelector<HTMLElement>(REVEAL_FACE_SELECTOR) ?? s).getBoundingClientRect(), o) : null));
      const now = t.dimOutAt - offset;
      if (c.whooshGain > 0) {
        sfx.ceremony('woosh1', c.whooshGain);
        if (n > 3 && !reduced) at(t.flyAt[Math.floor(n / 2)]! - offset - now, () => sfx.ceremony('woosh2', c.whooshGain * 0.8));
      }
      cards.forEach((card, i) => {
        const delay = Math.max(0, t.flyAt[i]! - offset - now);
        const land = Math.max(0, t.landAt[i]! - offset - now);
        const f = from[i], d = to[i], face = faces[i];
        const showEl = targets.show[i] ?? null;
        if (reduced || !f || !d || d.width <= 0) {
          // No slot on screen (or reduced motion): the portrait just fades where it stands, its slot fades in.
          push(anim(card, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 300 : c.landMs || 200, delay, easing: 'ease-in', fill: 'forwards' }));
          at(delay, () => { unhide(showEl, hidden); push(anim(showEl, [{ opacity: 0 }], { duration: 300, easing: 'ease-out' })); });
          return;
        }
        push(anim(labels[i], [{ opacity: 1 }, { opacity: 0 }], { duration: 160, delay, easing: 'ease-in', fill: 'forwards' }));
        push(anim(face, arcKeyframes(f, d, c.arcHeight), { duration: c.flyMs, delay, easing: 'linear', fill: 'forwards' }));
        // The crossfade: the flying portrait fades as the slot under it fades in.
        push(anim(face, [{ opacity: 1 }, { opacity: 0 }], { duration: c.landMs || 1, delay: land, easing: 'ease-out', fill: 'forwards' }));
        at(land, () => {
          // A Duos team slot appears with its FIRST member; the second lands into it already shown.
          if (showEl && hidden.some((h) => h.el === showEl)) {
            unhide(showEl, hidden);
            push(anim(showEl, [{ opacity: 0 }], { duration: Math.max(1, c.landMs), easing: 'ease-out' }));
          }
        });
      });
    };

    if (ready) begin(0);
    else {
      for (const u of urls) requestArt(u, 'now');
      const t0 = performance.now();
      let started = false;
      const go = (): void => { if (started) return; started = true; begin(Math.min(t.enterAt[0]!, performance.now() - t0)); };
      void whenArtReady(urls).then(go);
      at(500, go);
    }

    return () => {
      dead = true;
      for (const id of timers) window.clearTimeout(id);
      for (const a of anims) { try { a.cancel(); } catch { /* ignore */ } }
      restoreAll(hidden);
    };
  }, [active, seq]);

  if (!active) return null;
  const play = lobbyReveal.play();
  if (!play) return null;
  const c = getLobbyRevealConfig();
  const vars = { '--lhr-dim': String(c.dimOpacity), '--lhr-size': String(c.portraitSize) } as CSSProperties;
  const st = useGame.getState();
  const seats = st.run?.lobby?.seats ?? [];
  const skinsOf = (e: RevealEntry) => (e.you && !play.spectator ? runSkins : opponentSkins(showOppSkins, seats.find((s) => s.id === e.seatId)?.cosmetics));

  const card = (e: RevealEntry): JSX.Element => {
    const skins = skinsOf(e);
    return (
      <div className={`lhr-card${e.you ? ' you' : ''}`} key={e.seatId} data-seat={e.seatId}>
        <div className="lhr-face">
          <LbHeroFrame heroId={e.heroId} size="big" side={e.you ? 'self' : 'opp'} art={heroPortrait(e.heroId, skins)} frameId={e.you ? frameIdOf(runSkins) : frameIdOf(skins)} />
        </div>
        <div className="lhr-labels">
          <div className="lhr-hero">{getHero(e.heroId)?.name ?? ''}</div>
          <div className="lhr-name hudpill-name">{e.label}</div>
        </div>
      </div>
    );
  };

  let stage: JSX.Element;
  if (play.layout === 'teams') {
    const teams: RevealEntry[][] = [];
    for (const e of play.entries) {
      const last = teams[teams.length - 1];
      if (last && last[0]!.team === e.team) last.push(e); else teams.push([e]);
    }
    stage = <div className="lhr-stage teams">{teams.map((tm) => <div className="lhr-team" key={tm[0]!.seatId}>{tm.map(card)}</div>)}</div>;
  } else if (play.layout === 'duel') {
    stage = (
      <div className="lhr-stage duel">
        {card(play.entries[0]!)}
        <div className="lhr-vs" aria-hidden="true">VS</div>
        {play.entries[1] && card(play.entries[1])}
      </div>
    );
  } else {
    stage = <div className="lhr-stage">{play.entries.map(card)}</div>;
  }

  return (
    // A click anywhere skips. No cursor rule here: the game's gauntlet (body default) stays in charge.
    <div className={`lhr${play.entries.length > 6 ? ' many' : ''}`} style={vars} ref={rootRef} key={seq}
      onPointerDown={() => finish(true)} role="presentation" aria-label="The players in this game">
      <div className="lhr-dim" ref={dimRef} />
      {stage}
    </div>
  );

  function portraitOf(e: RevealEntry): string | undefined {
    return heroPortrait(e.heroId, skinsOf(e));
  }
}

function restoreAll(hidden: Hidden[]): void {
  for (const h of hidden.splice(0)) {
    if (h.prev == null) h.el.removeAttribute(ATTR); else h.el.setAttribute(ATTR, h.prev);
  }
}

/**
 * The reveal is over, played out or skipped. The Good Luck words play now (owner 2026-10-31: "the start game text should
 * happen after the animation is complete"; they have been waiting behind the reveal, and with them the shop clock), unless
 * the tuner's "Good Luck after" is off. Good Luck is told FIRST, so it never schedules a pass it would cancel a moment
 * later. In Versus the round-1 clock is the server's: it starts once EVERY player's intro is over (`ackIntro`), so a
 * skip here only ends this screen's visuals; the shared start still waits for the others.
 */
function finish(skip: boolean): void {
  if (!lobbyReveal.isActive()) return;
  const play = lobbyReveal.play();
  if (!play?.spectator && !getLobbyRevealConfig().goodLuckAfter) goodLuckIntro.end();
  lobbyReveal.end({ skip });
}
