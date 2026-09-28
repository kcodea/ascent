/**
 * THE TUNERS' PLAY BUTTONS (shared by every hero attack tuner and the Damage formation tuner): play a real hero attack
 * runner between the two real hero portraits (the foe's is mounted via `duelPreview`, so it works from the shop), on a
 * chosen board, without ever touching the run: the impact only pops the attack's own damage number. DEV tooling;
 * production never calls it.
 */
import { useGame } from '../store';
import { portraitGeometry } from '../heroBlast/portraits';
import { tierBadgeAnchor } from './badgeAnchors';
import type { FormationData } from './damageFormation';
import { formationPlan, getFormationConfig, type FormationConfig } from './formationConfig';
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

/** A preview board: the survivors' tiers left to right, the hero's tier, and the round cap (0 = uncapped). */
export interface PreviewBoard { minionTiers: readonly number[]; heroTier: number; cap: number }

/** The tiers across a row: `n` minions spread evenly from `lo` to `hi` (whole tiers). */
export function previewTiers(n: number, lo: number, hi: number): number[] {
  const k = Math.max(0, Math.min(7, Math.round(n)));
  return Array.from({ length: k }, (_, i) => Math.round(k === 1 ? lo : lo + ((hi - lo) * i) / (k - 1)));
}

/** A style tuner's preview (a blow split into numbers): the first is the hero, the rest the minions, never capped. */
export function boardOfDamage(damage: number, parts: number): PreviewBoard {
  const v = previewParts(damage, parts);
  return { heroTier: v[0]!, minionTiers: v.slice(1), cap: 0 };
}

/** The formation a preview board builds (a DEV preview: a real fight's numbers come from the engine). */
export function previewFormation(b: PreviewBoard): { data: Omit<FormationData, 'minions'> & { minions: number[] }; total: number } {
  const full = b.heroTier + b.minionTiers.reduce((s, v) => s + v, 0);
  const cap = b.cap > 0 ? b.cap : null;
  const total = cap !== null ? Math.min(full, cap) : full;
  return { data: { minions: [...b.minionTiers], hero: { value: b.heroTier }, full, total, cap }, total };
}

/** When a style tuner's preview attack starts (the formation's length for that preview), for its readout. */
export function previewLeadIn(damage: number, parts: number, reduced = false): number {
  const b = boardOfDamage(damage, parts);
  return formationPlan({ minions: b.minionTiers.length, hero: true, capped: false, reduced }, getFormationConfig()).endAt;
}

export interface DemoOpts {
  board: PreviewBoard;
  speed: number;
  reduced?: boolean;
  formationCfg?: FormationConfig;
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
    const { data, total } = previewFormation(o.board);
    // Each minion's number rises off a real card's tier badge when the striking side has cards up; else a made-up row.
    const cards = [...document.querySelectorAll<HTMLElement>(side === 'player' ? "[data-zone='warband'] .card" : "[data-zone='tavern'] .card")];
    const formation: FormationData = {
      ...data,
      minions: data.minions.map((value, i) => {
        const a = tierBadgeAnchor(cards[i]);
        return { value, at: a?.at ?? null, badges: a?.badges };
      }),
    };
    const h = play({
      formation, formationCfg: o.formationCfg, total, side, attacker: geo.a, defender: geo.d, defenderRadius: geo.radius, attackerRadius: geo.attackerRadius,
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
