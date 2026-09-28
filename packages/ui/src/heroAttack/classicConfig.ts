/**
 * CLASSIC, the free default hero attack, on the shared hero-attack core (owner review 2026-09-28: "remove the green/red
 * number pill from the hero windup for the normal animation ... clean up the normal animation so it's a bit more in line
 * with these"; then "try and match the same speed as how it was for the wind up and normal hit. it should be basic but
 * impactful. dont over do the zoom/shake.").
 *
 * After the shared damage formation, the blow dives into the striking hero, who then plays the ORIGINAL Classic swing:
 * the same wind-up and strike as a minion's attack (the ⚔️ Lunge tuner's `windupDur` / `windupDepth` / `windupScale`,
 * the distance-scaled strike and its ease from `contactGeometry`, the rebound and the elastic settle), at the same
 * tempo the old strike ran (`tempo`, the old Hero Duel `strikeSpeed`). On contact (never a freeze: owner 2026-09-28): the shared strike
 * burst and smack, a small squash and knockback on the struck portrait, a SUBTLE camera punch and shake, and the same
 * big `-N` every attack punches onto the target.
 *
 * `intensity` scales only the impact (shake, punch, knockback, squash, the burst's weight), never the swing's
 * speed, so a stronger variant (the planned Legendary "enraged" strike) can reuse the same motion.
 *
 * Tuner convention (the crate's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. Tuned from the Damage Formation tuner's "Classic" groups.
 */
export interface ClassicConfig {
  absorbMs: number;
  tempo: number;
  shakePx: number;
  shakeMs: number;
  punch: number;
  knockPx: number;
  squash: number;
  settleMs: number;
  impactPower: number;
}

export type ClassicNumKey = keyof ClassicConfig;

export const CLASSIC_DEFAULTS: ClassicConfig = {
  absorbMs: 220,
  // The old strike's speed (Hero Duel `strikeSpeed`, 1.15): the swing plays exactly as fast as it always did.
  tempo: 1.15,
  // SUBTLE (owner: "dont over do the zoom/shake"): a fraction of the Legendary attacks' camera.
  shakePx: 3.5,
  shakeMs: 260,
  punch: 0.01,
  knockPx: 12,
  squash: 0.07,
  settleMs: 180,
  // The old strike's weight (Hero Duel `impactPower`, 3.45) for the shared strike burst.
  impactPower: 3.45,
};

export const CLASSIC_RANGES: Record<ClassicNumKey, [number, number, number]> = {
  absorbMs: [60, 600, 10],
  tempo: [0.25, 3, 0.05],
  shakePx: [0, 30, 0.5],
  shakeMs: [0, 1200, 10],
  punch: [0, 0.1, 0.001],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  settleMs: [0, 1600, 10],
  impactPower: [0, 5, 0.05],
};

/** One value, made safe: numbers clamped into range (junk = the default). */
export function clampClassicValue<K extends keyof ClassicConfig>(key: K, value: unknown): ClassicConfig[K] | undefined {
  if (!(key in CLASSIC_DEFAULTS)) return undefined;
  const def = CLASSIC_DEFAULTS[key];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = CLASSIC_RANGES[key];
  return Math.min(max, Math.max(min, n)) as ClassicConfig[K];
}

export function sanitizeClassicConfig(saved: unknown): ClassicConfig {
  const out: ClassicConfig = { ...CLASSIC_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampClassicValue(k as keyof ClassicConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroclassic.v2';

let cfg: ClassicConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...CLASSIC_DEFAULTS };
  try { return sanitizeClassicConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...CLASSIC_DEFAULTS }; }
})();

export function getClassicConfig(): ClassicConfig { return cfg; }

export function setClassicValue(key: keyof ClassicConfig, value: number | string): void {
  const safe = clampClassicValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetClassicConfig(): void {
  cfg = { ...CLASSIC_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** The swing's own durations (seconds, as the ⚔️ Lunge tuner and `contactGeometry` give them, before `tempo`). */
export interface SwingTimes { windupS: number; strikeS: number; smackLeadS: number; reboundS: number; settleS: number }

export interface ClassicPlan {
  reduced: boolean;
  /** 0..1 across the damage tiers (a bigger blow lands a little harder). */
  k: number;
  /** The impact multiplier (1 = Classic). */
  intensity: number;
  /** The number starts diving into the hero (the formation's end). */
  chargeAt: number;
  absorbEnd: number;
  /** The wind-up starts. */
  windAt: number;
  /** The strike leaves. */
  strikeAt: number;
  /** The strike completes (the attacker is at its contact pose). */
  strikeEnd: number;
  /** THE consequence beat: contact (the smack lead before the strike completes, as a minion's swing). */
  impactAt: number;
  /** The rebound off the clack ends; the elastic settle starts. */
  reboundEnd: number;
  /** The settle ends (the hero is home). */
  homeAt: number;
  endAt: number;
  shakePx: number;
  punch: number;
  /** Classic never dims. */
  dim: number;
}

/**
 * Classic after a formation that ends at `leadIn`, for a blow of damage tier `tier` (1..4), with the swing's own
 * times. Pure. The swing runs at `tempo` (as the old strike did); `intensity` only scales the impact.
 */
export function classicPlan(
  input: { leadIn: number; tier: number; swing: SwingTimes; intensity?: number; reduced?: boolean },
  c: ClassicConfig = cfg,
): ClassicPlan {
  const chargeAt = Math.max(0, input.leadIn);
  const k = Math.min(1, Math.max(0, (input.tier - 1) / 3));
  const intensity = input.intensity ?? 1;
  const ms = (sec: number): number => (sec * 1000) / Math.max(0.05, c.tempo);
  if (input.reduced) {
    // No swing or shake: the number fades into the hero, the blow lands, the hit number fades.
    const impactAt = chargeAt + c.absorbMs;
    return {
      reduced: true, k, intensity, chargeAt, absorbEnd: impactAt, windAt: impactAt, strikeAt: impactAt, strikeEnd: impactAt, impactAt, reboundEnd: impactAt,
      homeAt: impactAt, endAt: impactAt + 900, shakePx: 0, punch: 0, dim: 0,
    };
  }
  const absorbEnd = chargeAt + c.absorbMs;
  // The wind-up starts as the number sinks in, so the hero coils WITH it (the handoff reads as one motion).
  const windAt = chargeAt + c.absorbMs * 0.5;
  const strikeAt = windAt + ms(input.swing.windupS);
  const strikeEnd = strikeAt + ms(input.swing.strikeS);
  const impactAt = strikeEnd - ms(input.swing.smackLeadS);
  const reboundEnd = strikeEnd + ms(input.swing.reboundS);
  const homeAt = reboundEnd + ms(input.swing.settleS);
  return {
    reduced: false, k, intensity, chargeAt, absorbEnd, windAt, strikeAt, strikeEnd, impactAt, reboundEnd, homeAt,
    // The settle is a long, lazy elastic tail: the sequence ends when it has visibly come to rest.
    endAt: Math.max(impactAt + 700 + c.settleMs, reboundEnd + (homeAt - reboundEnd) * 0.55 + c.settleMs),
    shakePx: c.shakePx * (1 + 0.6 * k) * intensity,
    punch: c.punch * (1 + 0.5 * k) * intensity,
    dim: 0,
  };
}

export type ClassicCueKind = 'charge' | 'wind' | 'impact' | 'end';
export interface ClassicCue { at: number; kind: ClassicCueKind; i: number }

export function classicCues(p: ClassicPlan): ClassicCue[] {
  if (p.reduced) return [{ at: p.chargeAt, kind: 'charge', i: 0 }, { at: p.impactAt, kind: 'impact', i: 0 }, { at: p.endAt, kind: 'end', i: 0 }];
  return [
    { at: p.chargeAt, kind: 'charge', i: 0 },
    { at: p.windAt, kind: 'wind', i: 0 },
    { at: p.impactAt, kind: 'impact', i: 0 },
    { at: p.endAt, kind: 'end', i: 0 },
  ];
}
