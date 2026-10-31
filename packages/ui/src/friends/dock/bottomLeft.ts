/**
 * THE BOTTOM-LEFT CORNER CLUSTER (owner 2026-10-31, R-CORNER-SPLIT-01: "put the friends list back in the bottom left, have
 * the bottom right only show the compendium and settings. move the dev tool buttons to the bottom left, right of the
 * friends list"). The Friends button is square 0 of a bottom-left row; in a DEV build the dev tuner and the minimized
 * Scene Builder are squares 1 and 2 (`.cornerdev`, `--cd-slot`). The row moves per screen so it never covers what that
 * screen keeps bottom left:
 *  - a SIDE-MENU page (a ladder page, Collection, Settings, Patch Notes) and the in-game menu: inside the sidebar, just
 *    above its Settings plaque, left edges aligned (the column's own empty space);
 *  - the TITLE: just above the footer links (Report a problem, Balance report), left edges aligned;
 *  - a GAME: the corner left of your hero portrait and its Health plaque, on the corner row's baseline (the gear's
 *    bottom), at the gear's size; the dev squares stack UP the edge from it there (a full hand reaches from your hero to
 *    the Gold coin, so the bottom edge has no room to their right);
 *  - anywhere else (hero select, a Versus room): the corner itself (the CSS fallback in friendsDock.css).
 * Every framing (desktop, the phone zoom, the phone layout, a scaled stage) is covered by MEASURING the piece the row sits
 * by, once per screen change and on a resize (never per frame), and writing the row's place to three CSS variables on the
 * root (`--bl-l`, `--bl-b`, `--bl-cb`, stage px). The toast and the Friends panel hang off the same numbers.
 */
import { useEffect } from 'react';
import { anyPageOpen, useGame } from '../../store';
import { stageHost, toStage } from '../../stage';

type Box = { left: number; top: number; width: number; height: number };
/** Where the row sits, in stage px: its left edge, its bottom offset from the stage's bottom, the square's size. */
export interface BlAnchor { screen: 'page' | 'title' | 'game'; l: number; b: number; cb: number }

/** The gap kept between the row and the piece it sits by (stage px). */
export const BL_GAP = 12;
/** The least room kept from the stage's left edge in a game (stage px). */
export const BL_EDGE = 8;
/** A sidebar square is this share of the Settings plaque's height. */
export const BL_PAGE_SHARE = 0.85;

/**
 * Where the row goes (pure). Boxes in screen px; `stageLen` converts to stage px. The first piece on screen wins: the
 * sidebar's Settings plaque (a page or the in-game menu lies over everything else), then the title's footer, then your
 * hero portrait (with the gear for the baseline and size). Null = the corner (the CSS fallback).
 */
export function blAnchor(
  pieces: { settings: Box | null; titleFoot: Box | null; hero: Box | null; hp?: Box | null; gear: Box | null },
  stage: Box,
  stageLen: (px: number) => number,
): BlAnchor | null {
  const ok = (b: Box | null | undefined): b is Box => !!b && b.width > 0 && b.height > 0;
  const fromBottom = (y: number): number => stageLen(stage.top + stage.height - y);
  const { settings, titleFoot, hero, hp, gear } = pieces;
  if (ok(settings)) {
    return { screen: 'page', l: stageLen(settings.left - stage.left), b: fromBottom(settings.top) + BL_GAP, cb: stageLen(settings.height) * BL_PAGE_SHARE };
  }
  if (ok(titleFoot) && ok(gear)) {
    return { screen: 'title', l: stageLen(titleFoot.left - stage.left), b: fromBottom(titleFoot.top) + BL_GAP, cb: stageLen(gear.width) };
  }
  if (ok(hero) && ok(gear)) {
    const cb = stageLen(gear.width);
    const leftmost = Math.min(hero.left, ok(hp) ? hp.left : hero.left);
    return { screen: 'game', l: Math.max(BL_EDGE, stageLen(leftmost - stage.left) - BL_GAP - cb), b: fromBottom(gear.top + gear.height), cb };
  }
  return null;
}

/** The first VISIBLE match (a page keeps its sidebar in the DOM under another; the hidden one has no box). */
function visible(sel: string): Box | null {
  const all = document.querySelectorAll<HTMLElement>(sel);
  for (let i = all.length - 1; i >= 0; i--) {
    const r = all[i]!.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return r;
  }
  return null;
}

function measure(): BlAnchor | null {
  const host = stageHost().getBoundingClientRect();
  const stage = host.width > 0 && host.height > 0 ? host : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  return blAnchor({
    settings: visible('.msb-settings'),
    titleFoot: visible('.titlescreen .titlefoot'),
    hero: visible('.statusbar .hero .heroimg') ?? visible('.statusbar .hero .f'),
    hp: visible('.statusbar .hero .hpbox'),
    gear: visible('.gearbtn'),
  }, stage, toStage);
}

let written = '';
/** Writes the anchor to the root (only when it changed: one style write, no re-render anywhere). */
export function writeBlAnchor(a: BlAnchor | null): void {
  const key = a ? `${a.screen}|${a.l.toFixed(1)}|${a.b.toFixed(1)}|${a.cb.toFixed(1)}` : '';
  if (key === written) return;
  written = key;
  const de = document.documentElement;
  if (!a) {
    de.removeAttribute('data-bl');
    for (const p of ['--bl-l', '--bl-b', '--bl-cb']) de.style.removeProperty(p);
    return;
  }
  de.setAttribute('data-bl', a.screen);
  de.style.setProperty('--bl-l', `${a.l.toFixed(1)}px`);
  de.style.setProperty('--bl-b', `${a.b.toFixed(1)}px`);
  de.style.setProperty('--bl-cb', `${a.cb.toFixed(1)}px`);
}

/** Which screen is up: the key the row re-measures on (a primitive, so the hook re-runs only when it changes). */
const screenKey = (s: ReturnType<typeof useGame.getState>): string =>
  `${s.showTitle ? 't' : ''}${anyPageOpen(s) ? 'p' : ''}${s.gameMenuOpen ? 'm' : ''}${s.heroChoices !== null ? 'h' : ''}${s.titleView}|${s.run.runId ?? ''}|${s.replaying ? 'r' : ''}`;

/**
 * Keeps the row in place (mounted once, by the always-on FriendsDock): measures on a screen change (and again after the
 * sidebar's slide-in / the page hop settle), and on a resize. Layout reads only on those events.
 */
export function useBottomLeftAnchor(): void {
  const key = useGame(screenKey);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    let raf = 0;
    let tries = 0;
    const run = (): void => {
      const a = measure();
      writeBlAnchor(a);
      // A screen still mounting (the HUD, the sidebar): retry for a few frames before settling on the corner.
      if (!a && tries++ < 20) raf = requestAnimationFrame(run);
    };
    run();
    const late = window.setTimeout(() => { tries = 20; run(); }, 400);
    const onResize = (): void => { cancelAnimationFrame(raf); tries = 20; raf = requestAnimationFrame(run); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(late); window.removeEventListener('resize', onResize); };
  }, [key]);
}
