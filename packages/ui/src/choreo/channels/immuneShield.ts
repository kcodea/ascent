import { playDef } from '../../fx/playDef';

/**
 * IMMUNE WHILE ATTACKING — the blue-and-gold shield (owner 2026-10-18):
 *
 *   *"make an immune while attacking effect. this would apply to iggy and bounty bot as an example. they should gain
 *   a blue/gold shield when they wind up to attack that dissipates when they settle"*
 *
 * The engine stamps `immune: true` on an `attack` event whose swing its immunity covers (Bounty Bot / Immune Iggy's
 * per-combat charges, Mauron's always-on, a Bloodlust swing) — read off the SAME charge count the clash spends, so a
 * spent "Twice per combat" swing carries no flag and therefore no shield. The lunge timeline (`channels/lunge.ts`)
 * fires the three hooks below at its own anchors: the shield FORMS at the start of the wind-up, DEFLECTS at contact
 * (the blocked counterblow sparks off it), and DISSIPATES as the attacker settles home.
 *
 * The shell is a DOM layer on the attacker's card (like the Ward's `.wardglass`), so it rides the lunge's transform
 * for free: no per-frame anchor re-read, no layout read per frame. Every layer's paint is STATIC; the form / hit /
 * fade animate transform + opacity only, all one-shot (CLAUDE.md perf rules). The Pixi defs add the formation
 * motes, the deflect sparks and the outward shimmer, each a one-shot play.
 *
 * Distinct from the Ward on purpose: the Ward is a pale-blue HEX shell with a white rim that breathes for as long as
 * the Ward lasts; this is a round dome, sized just OUTSIDE the Ward (so a Warded Immune attacker shows both), deep
 * blue energy inside a gold double rim, and it exists only for the swing.
 */

const SHELL = 'immshield';
/** A shell whose lunge was killed (a skip, a reset, a body that died mid-swing) never hears its settle — the
 *  watchdog retires it once its timeline is no longer running. */
const WATCHDOG_MS = 500;

type Timelineish = { isActive(): boolean; paused(): boolean } | null | undefined;

/** The attacker's card (`findEl` resolves the `.unit` wrapper; the shell sits on the `.card` for its size vars). */
function cardOf(el: Element): HTMLElement | null {
  if (typeof (el as HTMLElement).querySelector !== 'function') return null;
  if (el.classList?.contains('card')) return el as HTMLElement;
  return (el.querySelector('.card') as HTMLElement | null) ?? null;
}

function centreOf(el: Element): { cx: number; cy: number; w: number } | null {
  const r = el.getBoundingClientRect?.();
  return r && r.width > 0 ? { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width } : null;
}

function uidOf(el: Element): string | null {
  return el.getAttribute?.('data-uid') ?? el.closest?.('[data-uid]')?.getAttribute('data-uid') ?? null;
}

/** WIND-UP: the shield forms around the attacker. `speed` scales the CSS one-shots with the combat speed. */
export function raiseImmuneShield(attacker: Element, speed = 1, timeline?: () => Timelineish): void {
  const card = cardOf(attacker);
  if (!card || typeof document === 'undefined') return;
  card.querySelector(`:scope > .${SHELL}`)?.remove(); // a re-swing (Flurry) restarts clean
  const shell = document.createElement('div');
  shell.className = `${SHELL} up`;
  shell.setAttribute('aria-hidden', 'true');
  shell.style.setProperty('--ims-t', String(1 / Math.max(0.1, speed)));
  shell.innerHTML = '<div class="ims-body"><i class="ims-fill"></i><i class="ims-inner"></i><i class="ims-rim"></i><i class="ims-sheen"></i><i class="ims-hit"></i></div>';
  card.appendChild(shell);
  const at = centreOf(card);
  if (at) playDef('immune-shield-form', { target: { x: at.cx, y: at.cy } }, { uids: { source: null, target: uidOf(attacker) }, scale: at.w / 120 });
  if (timeline) {
    const iv = setInterval(() => {
      if (!shell.isConnected) { clearInterval(iv); return; }
      const tl = timeline();
      if (!tl || (!tl.isActive() && !tl.paused())) { clearInterval(iv); dropShell(shell, false); }
    }, WATCHDOG_MS);
  }
}

/** CONTACT: the counterblow the immunity blocks sparks off the shield. */
export function deflectImmuneShield(attacker: Element): void {
  const card = cardOf(attacker);
  const shell = card?.querySelector(`:scope > .${SHELL}`) as HTMLElement | null | undefined;
  if (!card || !shell) return;
  shell.classList.remove('hit');
  void shell.offsetWidth; // restart the one-shot flinch on a Flurry's second deflect
  shell.classList.add('hit');
  const at = centreOf(card);
  if (at) playDef('immune-shield-deflect', { target: { x: at.cx, y: at.cy } }, { uids: { source: null, target: uidOf(attacker) }, scale: at.w / 120 });
}

/** SETTLE: the shield fades and shimmers outward as the attacker returns to its slot. */
export function dropImmuneShield(attacker: Element): void {
  const card = cardOf(attacker);
  const shell = card?.querySelector(`:scope > .${SHELL}`) as HTMLElement | null | undefined;
  if (!card || !shell) return;
  dropShell(shell, true);
  const at = centreOf(card);
  if (at) playDef('immune-shield-dissipate', { target: { x: at.cx, y: at.cy } }, { uids: { source: null, target: uidOf(attacker) }, scale: at.w / 120 });
}

function dropShell(shell: HTMLElement, animate: boolean): void {
  if (shell.classList.contains('down')) return;
  if (!animate) { shell.remove(); return; }
  shell.classList.remove('up');
  shell.classList.add('down');
  const done = () => shell.remove();
  shell.addEventListener('animationend', (e) => { if (e.target === shell) done(); });
  setTimeout(done, 900); // belt-and-braces: a hidden tab / reduced motion never fires animationend
}

/** True while `attacker` wears the shell (tests + the DEV probe). */
export function hasImmuneShield(attacker: Element): boolean {
  const shell = cardOf(attacker)?.querySelector(`:scope > .${SHELL}`);
  return !!shell && !shell.classList.contains('down');
}
