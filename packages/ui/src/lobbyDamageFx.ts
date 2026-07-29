/**
 * The damage YOU dealt, floated over the seat that took it (owner ask 2026-07-29).
 *
 * The rail already prints what each seat lost last round, but that number is a static readout you have to go
 * looking for. Winning a fight is the moment the mode is about, and it deserves to be announced on the seat you
 * hurt — otherwise a win reads exactly like a draw until you scan the table.
 *
 * Built on the same one-shot WAAPI float the spell-power and ruby-power cues use, rather than a CSS class on the
 * row: the number has to outlive its element (rows re-sort by health the instant the round settles) and it must
 * never loop — see `docs/performance.md` on animating paint properties.
 */
const HOLD_MS = 620;
const FADE_MS = 420;
const RISE_PX = 26;

/** Float `-N` over a screen point. `amount <= 0` is a no-op, so a draw or a loss says nothing. */
export function floatLobbyDamage(x: number, y: number, amount: number): void {
  if (amount <= 0 || typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.className = 'lobbydmg-float';
  el.textContent = `−${amount}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  const total = HOLD_MS + FADE_MS;
  try {
    const anim = el.animate([
      { transform: 'translate(-50%, -50%) scale(0.55)', opacity: 0 },
      { transform: 'translate(-50%, -50%) scale(1.25)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.34 },
      { transform: `translate(-50%, calc(-50% - ${RISE_PX * 0.6}px)) scale(1)`, opacity: 1, offset: HOLD_MS / total },
      { transform: `translate(-50%, calc(-50% - ${RISE_PX}px)) scale(0.94)`, opacity: 0 },
    ], { duration: total, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)', fill: 'backwards' });
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
  } catch {
    el.remove(); // WAAPI unavailable: never strand a permanent number on screen
  }
}

/** Float the hit over a seat row, if that row is on screen. Returns whether it fired. */
export function floatLobbyDamageOnSeat(seatId: string, amount: number): boolean {
  if (amount <= 0 || typeof document === 'undefined') return false;
  const el = document.querySelector(`[data-seat="${seatId}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false; // laid out but not visible — don't fire into nowhere
  floatLobbyDamage(r.left + r.width * 0.72, r.top + r.height * 0.5, amount);
  return true;
}
