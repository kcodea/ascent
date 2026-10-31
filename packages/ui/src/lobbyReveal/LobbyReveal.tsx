import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { getHero } from '@game/sim';
import { useGame } from '../store';
import { playTailedClip, sfx } from '../sfx';
import { canPlayDefs, playDef } from '../fx/playDef';
import { LbHeroFrame } from '../LadderBits';
import { heroPortrait, opponentSkins, useRunSkins } from '../skins/skins';
import { frameIdOf } from '../portraitFrame/PortraitFrame';
import { artReady, requestArt, whenArtReady } from '../artPreload';
import { useSpectate } from '../versus/spectate';
import { goodLuckIntro } from '../goodLuck/goodLuckIntroStore';
import {
  getLobbyRevealConfig, LHR_REPLAY_EVENT, REVEAL_ALL_CLIPS, REVEAL_FLIGHT_WHOOSH, REVEAL_LINEUP_WHOOSH, REVEAL_LOCK_SHIMMER,
  REVEAL_LOCK_THUD_GAIN, REVEAL_LOCK_THUDS, REVEAL_SWEEP_SHIMMER, type RevealSoundLayer,
} from './lobbyRevealConfig';
import {
  arcKeyframes, flightOrder, REVEAL_FACE_SELECTORS, REVEAL_HEAD_SELECTORS, REVEAL_TOKEN_HEAD, REVEAL_TOKEN_RAIL, revealHidesSlot, revealShowSelectorFor,
  revealTargetSelectors, revealTimeline, revealTokensFor, spectatorShouldReveal, type Rect, type RevealEntry,
} from './lobbyRevealModel';
import { lobbyReveal, lobbyRevealEnabled, useLobbyRevealActive, useLobbyRevealSeq, type RevealPlay } from './lobbyRevealStore';
import { beginLobbyRevealFor } from './beginLobbyReveal';
import './lobbyReveal.css';

/**
 * THE LOBBY REVEAL — the overlay (owner ask 2026-10-31: "after the player locks in a hero and hits start game ... all
 * the heroes in the lobby are shown and then all portraits fly over and build the rail"; "The goal of the animation is
 * to show the player who they are facing. Hero art and player names").
 *
 * Mounted once in Game, beside the Good Luck intro and under the launch curtain. Renders nothing until
 * `lobbyReveal.begin()`, then plays ONE pass:
 *
 *   the live first shop dimmed and its rail COMPLETELY hidden; every hero of this game rising into a line-up centre stage
 *   (in-run portrait frame, the hero's name over the player's), lined up LEFT TO RIGHT in the rail's TOP-TO-BOTTOM order
 *   →  a long look  →  one at a time, top down, each portrait flies on an arc to its slice's art, HITS THE RAIL (a squash
 *   and a gold flash on the slice edge) and the slice EXPANDS out of that point to its full width while the portrait
 *   crossfades into the slice art; the dim lifts as they go (the ROUND slice opens first, before any portrait)  →  end, and the Good Luck
 *   words take over (they have been waiting, with the shop clock and every opening offer held).
 *
 * A REAL PHASE BEFORE ROUND 1 (owner 2026-10-31: "The hero reveal animation should happen before any timers
 * obviously"): the run is built under it but nothing runs. The shop takes no input (this layer covers it), the turn
 * clock and any turn-1 Discover wait (both read the Good Luck store, which stays active behind the reveal). UNSKIPPABLE
 * (owner 2026-10-31: "dont let the lobby hero reveal animation be skipped"): clicks land on this layer and do nothing,
 * and every key is swallowed while it plays, so neither the shop nor the Esc menu reacts. The store's 9 s safety timer
 * is the only early end (a failsafe), besides leaving to the title.
 *
 * PERF CONTRACT: every motion is a WAAPI transform / opacity animation scheduled up front (no per-frame JS at all).
 * Layout is read in two passes per play: once when the slots are on screen (to line the cards up in rail order), and
 * once at take-off (every stage portrait, every slot, every slot's art; cached for the whole flight). The hidden rail is
 * one attribute on <html> with class-subject rules, updated once per landing. Portraits are art the boot gate already
 * decoded; the line-up waits (at most 500 ms) for any that are not, so nothing pops in. The dim is a static gradient
 * faded by opacity, the flash a static gold edge faded by opacity.
 */

const ROOT_ATTR = 'data-lhr';

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

/** Each entry's landing slot, and what expands there (a Duos team slot expands with its first member). */
function findTargets(play: RevealPlay): { slot: (HTMLElement | null)[]; show: (HTMLElement | null)[] } {
  const showSel = revealShowSelectorFor(play.layout);
  const slot = play.entries.map((e) => firstMatch(revealTargetSelectors(e, play.layout)));
  const show = slot.map((el, i) => (!el || !revealHidesSlot(play.entries[i]!, play.layout) ? null : showSel ? (el.closest<HTMLElement>(showSel) ?? el) : el));
  return { slot, show };
}

const rectIn = (r: DOMRect, o: { left: number; top: number; k: number }): Rect =>
  ({ left: (r.left - o.left) / o.k, top: (r.top - o.top) / o.k, width: r.width / o.k, height: r.height / o.k });

/** The landed set on <html>. `null` clears it (the rail is fully shown). */
function setLanded(tokens: ReadonlySet<string> | null): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!tokens) { root.removeAttribute(ROOT_ATTR); return; }
  const v = ['on', ...tokens].join(' ');
  if (root.getAttribute(ROOT_ATTR) !== v) root.setAttribute(ROOT_ATTR, v);
}

export function LobbyReveal(): JSX.Element | null {
  const active = useLobbyRevealActive();
  const seq = useLobbyRevealSeq();
  const showTitle = useGame((s) => s.showTitle);
  const runSkins = useRunSkins();
  const showOppSkins = useGame((s) => s.showOpponentSkins);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const dimRef = useRef<HTMLDivElement | null>(null);

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
  useEffect(() => () => { setLanded(null); lobbyReveal.end(); }, []);

  // Unskippable: every key is swallowed while it plays (capture phase), so it neither skips nor reaches the shop's
  // hotkeys or the Esc menu underneath.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // THE ONE PASS. A layout effect so the rail is hidden and every animation scheduled before the first paint.
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
    let dead = false;
    const at = (ms: number, fn: () => void): void => { timers.push(window.setTimeout(() => { if (!dead) fn(); }, Math.max(0, ms))); };
    const push = (a: Animation | null): void => { if (a) anims.push(a); };

    // THE HIDDEN RAIL: everything waits for its own portrait (the 1v1's own board portrait is never hidden).
    const landed = new Set<string>();
    play.entries.forEach((e) => { if (!revealHidesSlot(e, play.layout)) for (const k of revealTokensFor(e, play.layout)) landed.add(k); });
    setLanded(landed);
    const land = (tokens: readonly string[]): void => { for (const k of tokens) landed.add(k); setLanded(landed); };

    let targets = findTargets(play);
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.lhr-card'));
    const faces = cards.map((el) => el.querySelector<HTMLElement>('.lhr-face'));
    const labels = cards.map((el) => el.querySelector<HTMLElement>('.lhr-labels'));
    const flashes = cards.map((el) => root.querySelector<HTMLElement>(`.lhr-flash[data-seat="${el.dataset.seat ?? ''}"]`));
    const frames = cards.map((el) => el.querySelector<HTMLElement>('.lb-heroframe'));
    const glints = cards.map((el) => el.querySelector<HTMLElement>('.lhr-glint > span'));
    // Decode every clip now, under the launch curtain, so the first lock's thud is never late (the audio caps keep it).
    if (!reduced) sfx.warmClips(REVEAL_ALL_CLIPS);
    const rootBox = (): { left: number; top: number; k: number } => {
      const rr = root.getBoundingClientRect();
      return { left: rr.left, top: rr.top, k: root.offsetWidth ? rr.width / root.offsetWidth : 1 };
    };
    // Each portrait lands on the slot's ART (the Docked slice's face crop, the Gem rail's round face), not the whole row.
    const faceIn = (s: HTMLElement): HTMLElement => {
      for (const sel of REVEAL_FACE_SELECTORS) { const el = s.querySelector<HTMLElement>(sel); if (el) return el; }
      return s;
    };
    const artRects = (o: { left: number; top: number; k: number }): (Rect | null)[] =>
      targets.slot.map((s) => (s ? rectIn(faceIn(s).getBoundingClientRect(), o) : null));

    // THE LINE-UP READS AS THE RAIL (owner 2026-10-31: "line it up so that left to right is top to bottom"): each card's
    // place in the line-up is its slot's place in the rail, so the leftmost portrait flies to the top slice and the rail
    // builds as one clean sequence. ONE layout read, once the slots are on screen (the rail may mount a frame or two
    // after the run is built, under the curtain). The cards are invisible until then.
    let rank = cards.map((_, i) => i);
    const lineUp = (): void => {
      if (play.layout === 'duel') return; // you on the left, your opponent on the right
      rank = flightOrder(artRects(rootBox()));
      cards.forEach((el, i) => { el.style.order = String(rank[i]); });
      // Duos: a pair stays together; the pairs follow their top member's place.
      root.querySelectorAll<HTMLElement>('.lhr-team').forEach((team) => {
        const mine = cards.map((cd, i) => (team.contains(cd) ? rank[i]! : Infinity));
        team.style.order = String(Math.min(...mine));
      });
    };

    // One soft sound from the bank, through the soft-tail voice on the hero-select fader.
    const sound = (l: RevealSoundLayer, gain: number, delayMs: number, rate?: number): void => {
      if (gain <= 0 || reduced) return;
      playTailedClip(l.clip, 'ceremony', {
        gain: l.gain * gain, delayMs: Math.max(0, delayMs), startMs: l.startMs, lenMs: l.lenMs, rate: rate ?? l.rate,
        tail: { fadeOutMs: l.fadeOutMs ?? 0, reverbMix: 0, reverbSec: 0.5 },
      });
    };
    const fxOk = !reduced && canPlayDefs();
    const centre = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

    // THE MAGIC SWEEP (owner 2026-10-31: "a magic trail that slides across the heroes after the reveal"): a band of light
    // crosses the whole row left to right; each portrait catches a shine (a glint band across its face) and a few
    // sparkles (the Discover entrance's `discover-glint`) as it passes, with the owner's shimmer. ONE layout read (the
    // card centres, for the sparkles' anchors and each glint's moment), then everything is scheduled.
    const sweep = (offset: number): void => {
      const now = t.sweepAt - offset;
      sound(REVEAL_SWEEP_SHIMMER, c.revealSoundGain, 0);
      const stage = root.querySelector<HTMLElement>('.lhr-stage');
      const band = root.querySelector<HTMLElement>('.lhr-sweep');
      push(anim(band, [
        { opacity: 0, transform: 'translateX(-110%)' },
        { opacity: 1, offset: 0.15 },
        { opacity: 1, offset: 0.85 },
        { opacity: 0, transform: 'translateX(330%)' },
      ], { duration: Math.max(1, c.sweepMs), easing: 'cubic-bezier(0.45, 0, 0.35, 1)' }));
      const sr = stage?.getBoundingClientRect();
      const rects = faces.map((f) => f?.getBoundingClientRect() ?? null);
      cards.forEach((_, i) => {
        const r = rects[i];
        if (!r || !sr || sr.width <= 0) return;
        const frac = Math.max(0, Math.min(1, (r.left + r.width / 2 - sr.left) / sr.width));
        const when = Math.round(c.sweepMs * (0.12 + 0.76 * frac)) - (t.sweepAt - offset - now);
        const glint = glints[i];
        push(anim(glint, [{ transform: 'translateX(-130%)', opacity: 0 }, { opacity: 1, offset: 0.3 }, { transform: 'translateX(130%)', opacity: 0 }],
          { duration: 420, delay: Math.max(0, when - 120), easing: 'ease-in-out' }));
        if (fxOk) {
          const p = centre(r);
          at(when, () => { playDef('discover-glint', { source: p, target: p, cursor: p }, { intensity: 0.7 }); });
        }
      });
    };

    // THE GROUP FLIGHT (owner 2026-10-31: "they fly over into place and then 'lock in'"): one read pass (every portrait,
    // every slot and its art), then every portrait flies AT ONCE, a breath apart, on the same gentle bow so a left-to-right
    // row fans into a top-to-bottom column with no crossings; each shrinks ahead of its path so neighbours never overlap
    // mid-air. They park, round, on their slices' art.
    let from: (Rect | null)[] = [];
    let to: (Rect | null)[] = [];
    let slice: (Rect | null)[] = [];
    let artScreen: ({ x: number; y: number } | null)[] = [];
    const takeOff = (offset: number): void => {
      targets = findTargets(play); // a slot that remounted is picked up here, with the same single read pass below
      const o = rootBox();
      from = faces.map((f) => (f ? rectIn(f.getBoundingClientRect(), o) : null));
      const art = targets.slot.map((s) => (s ? faceIn(s).getBoundingClientRect() : null));
      to = art.map((r) => (r ? rectIn(r, o) : null));
      artScreen = art.map((r) => (r ? centre(r) : null));
      slice = targets.show.map((s) => (s ? rectIn(s.getBoundingClientRect(), o) : null));
      const now = t.flyAt[0]! - offset;
      sound(REVEAL_FLIGHT_WHOOSH, c.whooshGain, 0);
      cards.forEach((card, i) => {
        const k = rank[i]!;
        const delay = Math.max(0, t.flyAt[k]! - offset - now);
        const f = from[i], d = to[i], face = faces[i];
        if (reduced || !f || !d || d.width <= 0) {
          // No slot on screen (or reduced motion): the portrait fades where it stands; its slot fades in at its lock.
          push(anim(card, [{ opacity: 1 }, { opacity: 0 }], { duration: reduced ? 300 : 200, delay, easing: 'ease-in', fill: 'forwards' }));
          return;
        }
        push(anim(labels[i], [{ opacity: 1 }, { opacity: 0 }], { duration: 140, delay, easing: 'ease-in', fill: 'forwards' }));
        push(anim(face, arcKeyframes(f, d, c.arcHeight, 16, 2.4), { duration: Math.max(1, c.flyMs), delay, easing: 'linear', fill: 'forwards' }));
      });
    };

    // THE LOCK-IN CASCADE, top to bottom, overlapping (owner 2026-10-31: "'lock in' and build their slices sequentially
    // from the top somewhat quickly and satisfying"): each portrait snaps (1.08, 0.97, 1 on its frame, inside the parked
    // flight transform), its slice edge flashes gold with a small sparkle pop, the owner's thud lands with a light shimmer,
    // and the slice EXPANDS out of the portrait (scaleX, the origin at the portrait) while the portrait crossfades into
    // the slice art. Same for every slice; a Duos team slot opens with its FIRST member.
    const lockIn = (i: number, offset: number): void => {
      const k = rank[i]!;
      const entry = play.entries[i]!;
      const tokens = revealTokensFor(entry, play.layout);
      const showEl = targets.show[i] ?? null;
      const d = to[i], sr = slice[i];
      const opening = !!showEl && !tokens.every((tk) => landed.has(tk));
      land(tokens);
      sound({ clip: REVEAL_LOCK_THUDS[k % REVEAL_LOCK_THUDS.length]!, gain: REVEAL_LOCK_THUD_GAIN, fadeOutMs: 250 }, c.lockSoundGain, 0);
      sound(REVEAL_LOCK_SHIMMER, c.lockSoundGain, 20, (REVEAL_LOCK_SHIMMER.rate ?? 1) + 0.03 * k);
      if (reduced || !d || d.width <= 0) {
        if (opening) push(anim(showEl, [{ opacity: 0 }], { duration: 300, easing: 'ease-out' }));
        return;
      }
      const imp = Math.max(1, c.impactMs);
      push(anim(frames[i], [{ transform: 'scale(1)' }, { transform: 'scale(1.08)', offset: 0.3 }, { transform: 'scale(0.97)', offset: 0.65 }, { transform: 'scale(1)' }],
        { duration: imp, easing: 'ease-out' }));
      const fl = flashes[i];
      if (fl && sr) {
        fl.style.transform = `translate(${sr.left.toFixed(1)}px, ${sr.top.toFixed(1)}px)`;
        fl.style.width = `${sr.width.toFixed(1)}px`;
        fl.style.height = `${sr.height.toFixed(1)}px`;
        push(anim(fl, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: imp + c.expandMs, delay: Math.round(imp * 0.3), easing: 'ease-out' }));
      }
      const p = artScreen[i];
      if (fxOk && p) playDef('hero-power-spark', { source: p, target: p, cursor: p }, { intensity: 0.6 });
      // The portrait crossfades into the slice art as the slice opens under it.
      push(anim(faces[i], [{ opacity: 1 }, { opacity: 0 }], { duration: Math.max(1, c.landMs), delay: Math.round(imp * 0.45), easing: 'ease-out', fill: 'forwards' }));
      if (!opening || !showEl) return;
      const w0 = sr && sr.width > 0 ? Math.min(1, d.height / sr.width) : 0.3;
      const ox = sr && sr.width > 0 ? `${(((d.left + d.width / 2 - sr.left) / sr.width) * 100).toFixed(1)}%` : '15%';
      push(anim(showEl, [
        { opacity: 0, transform: `scaleX(${w0.toFixed(3)})`, transformOrigin: `${ox} 50%` },
        { opacity: 1, transform: `scaleX(${(w0 + (1 - w0) * 0.45).toFixed(3)})`, transformOrigin: `${ox} 50%`, offset: 0.3 },
        { opacity: 1, transform: 'scaleX(1)', transformOrigin: `${ox} 50%` },
      ], { duration: Math.max(1, c.expandMs), delay: Math.round(imp * 0.3), easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)', fill: 'backwards' }));
      void offset;
    };

    const begin = (offset: number): void => {
      if (dead) return;
      const o = Math.max(0, t.enterAt[0]! - offset);
      sound(REVEAL_LINEUP_WHOOSH, c.revealSoundGain, o);
      cards.forEach((el, i) => {
        const delay = Math.max(0, t.enterAt[rank[i]!]! - offset);
        push(reduced
          ? anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay, easing: 'ease-out', fill: 'both' })
          : anim(el, [{ opacity: 0, transform: 'translateY(28px) scale(0.86)' }, { opacity: 1, transform: 'none' }],
            { duration: c.entranceMs, delay, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.08)', fill: 'both' }));
      });
      if (!reduced) at(t.sweepAt - offset, () => sweep(offset));
      // The duel's VS leaves as the round slice opens.
      push(anim(root.querySelector('.lhr-vs'), [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: Math.max(0, t.dimOutAt - offset), easing: 'ease-in', fill: 'forwards' }));
      // The dim lifts from the round slice to the last lock, so the rail builds on the live board.
      const lastLock = t.lockAt.length ? t.lockAt[t.lockAt.length - 1]! : t.endAt;
      const dimSpan = reduced ? 300 : Math.max(200, lastLock - t.dimOutAt);
      push(anim(dimRef.current, [{ opacity: 1 }, { opacity: 0 }], { duration: dimSpan, delay: Math.max(0, t.dimOutAt - offset), easing: 'ease-in-out', fill: 'forwards' }));

      // THE ROUND SLICE FIRST (owner 2026-10-31: "the round button should be the first piece to appear, then the heroes
      // slot in"): it opens out of the Refresh pill (scaleX from its left edge, where it ties into the pill) as the
      // line-up ends; the portraits leave as it settles.
      at(t.headAt - offset, () => {
        land([REVEAL_TOKEN_RAIL, REVEAL_TOKEN_HEAD]);
        for (const sel of REVEAL_HEAD_SELECTORS) {
          const el = document.querySelector(sel);
          push(reduced
            ? anim(el, [{ opacity: 0 }], { duration: 300, easing: 'ease-out' })
            : anim(el, [
              { opacity: 0, transform: 'scaleX(0.25)', transformOrigin: '0% 50%' },
              { opacity: 1, transform: 'scaleX(0.55)', transformOrigin: '0% 50%', offset: 0.3 },
              { opacity: 1, transform: 'scaleX(1)', transformOrigin: '0% 50%' },
            ], { duration: Math.max(1, c.headSettleMs), easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' }));
        }
      });
      at((t.flyAt[0] ?? t.headAt) - offset, () => takeOff(offset));
      cards.forEach((_, i) => { at(t.lockAt[rank[i]!]! - offset, () => lockIn(i, offset)); });
      at(t.endAt - offset, () => finish(false));
    };

    // The line-up starts once every portrait is decoded (the boot gate has normally done it already, so no frame ever
    // shows a blank disc) AND it stands in rail order. At most ~500 ms; the cards sit invisible meanwhile.
    const urls = play.entries.map((e) => portraitOf(e)).filter((u): u is string => !!u);
    const t0 = performance.now();
    let waits = 2;
    let started = false;
    const ready = (): void => {
      if (started || dead || --waits > 0) return;
      started = true;
      begin(Math.min(t.enterAt[0]!, performance.now() - t0));
    };
    const giveUp = (): void => { if (started || dead) return; waits = 1; ready(); };
    if (urls.every((u) => artReady(u))) ready();
    else {
      for (const u of urls) requestArt(u, 'now');
      void whenArtReady(urls).then(ready);
    }
    const found = (): boolean => { targets = findTargets(play); return targets.slot.every(Boolean); };
    if (found()) { lineUp(); ready(); }
    else {
      let tries = 0;
      const retry = (): void => {
        if (dead) return;
        if (found() || ++tries > 30) { lineUp(); ready(); return; }
        requestAnimationFrame(retry);
      };
      requestAnimationFrame(retry);
    }
    at(500, giveUp);

    return () => {
      dead = true;
      for (const id of timers) window.clearTimeout(id);
      for (const a of anims) { try { a.cancel(); } catch { /* ignore */ } }
      setLanded(null);
    };
  }, [active, seq]);

  if (!active) return null;
  const play = lobbyReveal.play();
  if (!play) return null;
  const c = getLobbyRevealConfig();
  const vars = { '--lhr-dim': String(c.dimOpacity), '--lhr-size': String(c.portraitSize), '--lhr-n': String(Math.max(2, play.entries.length)) } as CSSProperties;
  const st = useGame.getState();
  const seats = st.run?.lobby?.seats ?? [];
  const skinsOf = (e: RevealEntry) => (e.you && !play.spectator ? runSkins : opponentSkins(showOppSkins, seats.find((s) => s.id === e.seatId)?.cosmetics));

  const card = (e: RevealEntry): JSX.Element => {
    const skins = skinsOf(e);
    return (
      <div className={`lhr-card${e.you ? ' you' : ''}`} key={e.seatId} data-seat={e.seatId}>
        <div className="lhr-face">
          {/* The sweep's shine across this face: a soft light band moved by transform, clipped to the disc. */}
          <span className="lhr-glint" aria-hidden="true"><span /></span>
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
    stage = <div className="lhr-stage teams">{teams.map((tm) => <div className="lhr-team" key={tm[0]!.seatId}>{tm.map(card)}</div>)}<span className="lhr-sweep" aria-hidden="true" /></div>;
  } else if (play.layout === 'duel') {
    stage = (
      <div className="lhr-stage duel">
        {card(play.entries[0]!)}
        <div className="lhr-vs" aria-hidden="true">VS</div>
        {play.entries[1] && card(play.entries[1])}
        <span className="lhr-sweep" aria-hidden="true" />
      </div>
    );
  } else {
    stage = <div className="lhr-stage">{play.entries.map(card)}<span className="lhr-sweep" aria-hidden="true" /></div>;
  }

  return (
    // Clicks land on this layer and do nothing (the reveal is unskippable). No cursor rule here: the game's gauntlet
    // (body default) stays in charge.
    <div className={`lhr${play.entries.length > 6 ? ' many' : ''}${play.layout === 'duel' ? ' duel' : ''}`} style={vars} ref={rootRef} key={seq}
      role="presentation" aria-label="The players in this game">
      <div className="lhr-dim" ref={dimRef} />
      {stage}
      {/* The landing flashes: one static gold edge per seat, placed on its slice at take-off, faded by opacity. */}
      {play.entries.map((e) => <div className="lhr-flash" key={`f${e.seatId}`} data-seat={e.seatId} aria-hidden="true" />)}
    </div>
  );

  function portraitOf(e: RevealEntry): string | undefined {
    return heroPortrait(e.heroId, skinsOf(e));
  }
}

/**
 * The reveal is over (played out, or cut short only by leaving to the title). The Good Luck words play now (owner 2026-10-31: "the start game text should
 * happen after the animation is complete"; they have been waiting behind the reveal, and with them the shop clock and any
 * turn-1 offer), unless the tuner's "Good Luck after" is off. Good Luck is told FIRST, so it never schedules a pass it
 * would cancel a moment later. In Versus the round-1 clock is the server's: it starts once EVERY player's intro is over
 * (`ackIntro`), so the shared start waits for the slowest player's reveal and words.
 */
function finish(skip: boolean): void {
  if (!lobbyReveal.isActive()) return;
  const play = lobbyReveal.play();
  if (!play?.spectator && !getLobbyRevealConfig().goodLuckAfter) goodLuckIntro.end();
  setLanded(null);
  lobbyReveal.end({ skip });
}
