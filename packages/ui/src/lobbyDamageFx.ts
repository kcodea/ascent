import { stageHost, toStage } from './stage';
/**
 * The round's damage, floated over each seat that took it (owner asks 2026-07-29 and 2026-10-03).
 *
 * The rail used to print every seat's last-round loss as a static "-N" that stayed all shop phase. The owner asked
 * for it gone from the rail: instead, as the rail comes back after a fight, each seat that lost Health this round
 * shows its number once, popping on the row, rising a little and fading out. The lasting record is the seat's hover
 * card (its last fights, with the damage of each).
 *
 * Built on the same one-shot WAAPI float the spell-power and ruby-power cues use, rather than a CSS class on the
 * row: the number has to outlive its element (rows re-sort by health the instant the round settles) and it must
 * never loop. Transform + opacity only; see `docs/performance.md` on animating paint properties.
 */
const HOLD_MS = 900;
const FADE_MS = 600;
const RISE_PX = 22;
/** The whole float, pop to gone (1.5s). */
export const LOBBY_DMG_FLOAT_MS = HOLD_MS + FADE_MS;

/**
 * Which seats announce a loss this round, and how much: every seat still standing whose last-round `taken` is above
 * 0 (the rule the old static number used, so a draw, a win, or a fight that hit only a fallen ghost shows nothing,
 * and a seat that was knocked out gets the knockout effect instead). In table order. Pure.
 */
export function roundDamageFloats(
  seats: readonly { id: string; alive: boolean }[],
  dmg: Readonly<Record<string, { taken: number } | undefined>>,
): { id: string; amount: number }[] {
  const out: { id: string; amount: number }[] = [];
  for (const s of seats) {
    const taken = dmg[s.id]?.taken ?? 0;
    if (s.alive && taken > 0) out.push({ id: s.id, amount: taken });
  }
  return out;
}

/** Float `-N` over a screen point. `amount <= 0` is a no-op, so an unhurt seat says nothing. */
export function floatLobbyDamage(x: number, y: number, amount: number): void {
  if (amount <= 0 || typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'lobbydmg-float';
  el.textContent = `−${amount}`;
  el.style.left = `${toStage(x)}px`; // a screen point -> stage px (stage.ts)
  el.style.top = `${toStage(y)}px`;
  stageHost().appendChild(el);
  const total = HOLD_MS + FADE_MS;
  try {
    // Easing is PER SEGMENT (a keyframe's `easing` shapes the hop to the next one), with a linear timeline: one
    // ease-out over the whole run front-loaded it so hard that the number was mostly faded by the middle.
    // Pop in (~180ms), settle, hold readable while drifting up, then fade over the last FADE_MS.
    const anim = el.animate([
      { transform: 'translate(-50%, -50%) scale(0.55)', opacity: 0, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)' },
      { transform: 'translate(-50%, -50%) scale(1.2)', opacity: 1, offset: 0.12, easing: 'ease-in-out' },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.22, easing: 'ease-in-out' },
      { transform: `translate(-50%, calc(-50% - ${RISE_PX * 0.6}px)) scale(1)`, opacity: 1, offset: HOLD_MS / total, easing: 'ease-in' },
      { transform: `translate(-50%, calc(-50% - ${RISE_PX}px)) scale(0.94)`, opacity: 0 },
    ], { duration: total, easing: 'linear', fill: 'backwards' });
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
  } catch {
    el.remove(); // WAAPI unavailable: never strand a permanent number on screen
  }
}

/** Longest we hold a float for the curtain before dropping it (a stuck class must never queue floats forever). */
const CURTAIN_WAIT_MAX_MS = 6000;

/**
 * Run `fn` once the combat <-> shop curtain is down (`body.wipe-up` cleared by Recruit when the reveal ends), or at
 * once when it is not up. The round settles UNDER the curtain (the run resolves at full cover), so without this
 * the float fired straight onto the blue hold, on top of it (owner 2026-09-24: "sometimes background elements come
 * through the wipe"). Now it plays over the revealed rail, where it was always meant to be seen.
 */
export function whenCurtainDown(fn: () => void): () => void {
  if (typeof document === 'undefined' || !document.body.classList.contains('wipe-up')) { fn(); return () => {}; }
  let done = false;
  const finish = (run: boolean): void => {
    if (done) return;
    done = true;
    obs.disconnect();
    window.clearTimeout(t);
    if (run) fn();
  };
  const obs = new MutationObserver(() => { if (!document.body.classList.contains('wipe-up')) finish(true); });
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const t = window.setTimeout(() => finish(false), CURTAIN_WAIT_MAX_MS);
  return () => finish(false);
}

/** Float the hit over a seat row, if that row is on screen. Returns whether it fired. */
export function floatLobbyDamageOnSeat(seatId: string, amount: number): boolean {
  if (amount <= 0 || typeof document === 'undefined') return false;
  const el = document.querySelector(`.lobbyrail [data-seat="${seatId.replace(/["\\]/g, '\\$&')}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false; // laid out but not visible — don't fire into nowhere
  floatLobbyDamage(r.left + r.width * 0.84, r.top + r.height * 0.5, amount); // the right end, where the old number sat
  return true;
}
