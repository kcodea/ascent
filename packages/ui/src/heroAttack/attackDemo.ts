/**
 * THE TUNERS' PLAY BUTTONS (shared by the Blast and Quake tuners since 2026-09-28): play a real hero attack runner
 * between the two real hero portraits (the foe's is mounted via `duelPreview`, so it works from the shop), with a
 * chosen damage split into a chosen number of parts, without ever touching the run: the impact only pops the attack's
 * own damage number. DEV tooling; production never calls it.
 */
import { useGame } from '../store';
import { portraitGeometry } from '../heroBlast/portraits';
import type { CombinePart } from './combineNumbers';
import type { HeroAttackHandle, HeroAttackOptions } from './options';

/** Split a blow into `n` numbers the way a fight does: the tier first, then the survivors (all at least 1). */
export function previewParts(damage: number, n: number): number[] {
  const d = Math.max(1, Math.round(damage));
  const k = Math.max(1, Math.min(8, Math.round(n), d));
  const base = Math.max(1, Math.round(d / k));
  const out = [Math.min(base, d - (k - 1))];
  let left = d - out[0]!;
  for (let i = 1; i < k; i++) { const v = i === k - 1 ? left : Math.max(1, Math.round(left / (k - i))); out.push(v); left -= v; }
  return out;
}

export interface DemoOpts {
  damage: number;
  parts: number;
  combineBias: number;
  speed: number;
  reduced?: boolean;
  frames?: HeroAttackOptions['frames'];
  sound?: boolean;
  safety?: boolean;
}

/** Play `play` between the portraits. Resolves with its handle (null when a portrait is missing). */
export function playAttackDemo<H extends HeroAttackHandle>(
  side: 'player' | 'opp',
  play: (o: HeroAttackOptions) => H,
  o: DemoOpts,
  onDone?: () => void,
): Promise<H | null> {
  const st = useGame.getState();
  st.setDuelPreview(true);
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
    const geo = portraitGeometry(side);
    if (!geo) { st.setDuelPreview(false); resolve(null); return; }
    const board = document.querySelector('.app')?.getBoundingClientRect();
    const cx = board ? board.left + board.width / 2 : window.innerWidth / 2;
    const cy = board ? board.top + board.height / 2 : window.innerHeight / 2;
    const values = previewParts(o.damage, o.parts);
    // Survivors fly from real cards when there are any on the board, else from a spread across the middle.
    const cards = [...document.querySelectorAll<HTMLElement>(side === 'player' ? "[data-zone='warband'] .card" : "[data-zone='tavern'] .card")];
    const bw = board?.width ?? window.innerWidth;
    const parts: CombinePart[] = values.map((value, i) => {
      if (i === 0) return { value, from: geo.a, base: true };
      const el = cards[i - 1];
      if (el) { const r = el.getBoundingClientRect(); return { value, from: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }; }
      return { value, from: { x: cx + (i - values.length / 2) * bw * 0.12, y: cy + (side === 'player' ? 1 : -1) * bw * 0.06 } };
    });
    const total = values.reduce((s, v) => s + v, 0);
    const h = play({
      parts, total, side, attacker: geo.a, defender: geo.d, defenderRadius: geo.radius, attackerRadius: geo.attackerRadius,
      combineAt: { x: cx + (geo.a.x - cx) * o.combineBias, y: cy + (geo.a.y - cy) * o.combineBias },
      speed: o.speed, reduced: o.reduced, attackerEl: geo.attackerEl, defenderEl: geo.defenderEl,
      frames: o.frames, sound: o.sound, safety: o.safety,
      onImpact: () => { /* a preview never touches the run; the attack shows its own hit number */ },
      onDone: () => {
        onDone?.();
        window.setTimeout(() => { useGame.getState().setDuelPreview(false); }, 500 / o.speed);
      },
    });
    resolve(h);
  })));
}
