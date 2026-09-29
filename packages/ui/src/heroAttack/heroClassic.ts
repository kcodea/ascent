/**
 * THE CLASSIC RUNNER: the free default hero attack, on the same one clock as the cosmetic styles (owner reviews
 * 2026-09-28; the beats and the rationale are in `classicConfig.ts`).
 *
 * The shared damage formation builds the blow; it sinks into the striking hero, who plays the ORIGINAL Classic swing
 * (a minion's attack: the wind-up, the distance-scaled strike leading with a corner, the rebound off the clack and the
 * elastic settle; same durations, same eases, same tempo) and connects (the clock never pauses): the shared strike burst and
 * smack (`playContactImpact`), a small squash and knockback, a SUBTLE camera punch and shake, and the same big `-N`
 * every attack punches onto the target. The consequence lands exactly once, on contact.
 *
 * REUSE (the planned Legendary "enraged" strike builds on this): `classicSwing` measures the swing once, `strikePose`
 * is its pure pose at any time, and `playHeroClassic` takes an `intensity` that scales only the impact.
 *
 * Perf: portraits and camera by `transform` only, written from the clock; the layout reads are once at the start (the
 * two portraits' rects, for the geometry) and the impact burst's own at contact.
 */
import { gsap } from 'gsap';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { getLungeConfig, strikeEaseFor } from '../lungeConfig';
import { contactGeometry } from '../choreo/contactGeometry';
import { hitPower, playContactImpact } from '../choreo/channels/impact';
import { AttackVoices } from './attackSound';
import { classicCues, classicPlan, getClassicConfig, type ClassicConfig, type ClassicCue, type ClassicPlan, type SwingTimes } from './classicConfig';
import { DamageFormation, planFormation } from './damageFormation';
import { clamp01, prefersReducedMotion, spring, type Pt } from './easing';
import { withFormation, type FormationCue } from './formationConfig';
import type { HeroAttackHandle, HeroAttackOptions } from './options';
import { Sequence } from './sequence';
import { PortraitMover, StageCamera } from './stageCamera';
import { attackTier } from './tiers';

export interface HeroClassicOptions extends HeroAttackOptions {
  cfg?: ClassicConfig;
  /** Scales the IMPACT only (shake, punch, knockback, squash, the burst): 1 = Classic. Never the swing. */
  intensity?: number;
  /** Fire the shared strike burst and smack on contact (default: yes; tests switch it off). */
  impactFx?: boolean;
}

export interface HeroClassicHandle extends HeroAttackHandle {
  readonly plan: ClassicPlan;
  readonly swing: ClassicSwing;
}

/** The swing, measured once: where it coils to, where it strikes, its tilt and swell, its eases, and its times. */
export interface ClassicSwing {
  /** The coiled-back offset and the strike offset, in the ATTACKER's own transform px. */
  back: Pt;
  strike: Pt;
  leadTilt: number;
  rebound: number;
  windupScale: number;
  strikeEase: (u: number) => number;
  times: SwingTimes;
}

const PLAYER_HEX = '#ffb627';
const FOE_HEX = '#ff4057';

const powerOut = gsap.parseEase('power1.out');
const power2Out = gsap.parseEase('power2.out');
const elasticOut = gsap.parseEase('elastic.out(1, 0.45)');

/**
 * The swing between two portraits, exactly as the old Classic strike solved it (`contactGeometry` in the attacker's
 * local frame, the ⚔️ Lunge tuner's wind-up), from screen-px centres and sizes. `inv` converts screen px into the
 * attacker's own transform px (it may sit inside a scaled wrapper). Pure.
 */
export function classicSwing(a: Pt, d: Pt, atkSize: { width: number; height: number }, defSize: { width: number; height: number }, inv = 1): ClassicSwing {
  const lc = getLungeConfig();
  const dx = (d.x - a.x) * inv, dy = (d.y - a.y) * inv;
  const geo = contactGeometry(dx, dy, { width: atkSize.width * inv, height: atkSize.height * inv }, { width: defSize.width * inv, height: defSize.height * inv }, lc);
  const travel = Math.max(0, Math.hypot(d.x - a.x, d.y - a.y) - (defSize.width + atkSize.width) / 2);
  return {
    back: { x: -dx * lc.windupDepth, y: -dy * lc.windupDepth },
    strike: geo.strike,
    leadTilt: geo.leadTilt,
    rebound: lc.attackerRebound,
    windupScale: lc.windupScale,
    strikeEase: gsap.parseEase(strikeEaseFor(travel)),
    times: { windupS: lc.windupDur, strikeS: geo.strikeDur, smackLeadS: lc.smackLead, reboundS: 0.06, settleS: lc.settleDur },
  };
}

/** The striking hero's pose at sequence time `t` (x / y in its own px, rotation in degrees, scale). Pure. */
export function strikePose(p: ClassicPlan, sw: ClassicSwing, t: number): { x: number; y: number; rot: number; scale: number } {
  if (p.reduced || t < p.windAt) return { x: 0, y: 0, rot: 0, scale: 1 };
  if (t < p.strikeAt) {
    const e = powerOut(clamp01((t - p.windAt) / Math.max(1, p.strikeAt - p.windAt)));
    return { x: sw.back.x * e, y: sw.back.y * e, rot: sw.leadTilt * e, scale: 1 + (sw.windupScale - 1) * e };
  }
  if (t < p.strikeEnd) {
    const e = sw.strikeEase(clamp01((t - p.strikeAt) / Math.max(1, p.strikeEnd - p.strikeAt)));
    return {
      x: sw.back.x + (sw.strike.x - sw.back.x) * e, y: sw.back.y + (sw.strike.y - sw.back.y) * e,
      rot: sw.leadTilt, scale: sw.windupScale + (1 - sw.windupScale) * e,
    };
  }
  const reb = -Math.sign(sw.leadTilt) * sw.rebound;
  if (t < p.reboundEnd) {
    const e = power2Out(clamp01((t - p.strikeEnd) / Math.max(1, p.reboundEnd - p.strikeEnd)));
    return { x: sw.strike.x, y: sw.strike.y, rot: sw.leadTilt + (reb - sw.leadTilt) * e, scale: 1 };
  }
  const e = elasticOut(clamp01((t - p.reboundEnd) / Math.max(1, p.homeAt - p.reboundEnd)));
  return { x: sw.strike.x * (1 - e), y: sw.strike.y * (1 - e), rot: reb * (1 - e), scale: 1 };
}

/** Play Classic. Returns a handle; the blow lands via `onImpact` on contact. */
export function playHeroClassic(o: HeroClassicOptions): HeroClassicHandle {
  const c = o.cfg ?? getClassicConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const local = o.space === 'local';
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const dir: Pt = { x: (o.defender.x - o.attacker.x) / (dist || 1), y: (o.defender.y - o.attacker.y) / (dist || 1) };
  // One measure of both portraits (the swing's geometry and each one's own transform scale).
  const rectOf = (el: HTMLElement | null | undefined, r: number): { width: number; height: number; inv: number } => {
    const b = el?.getBoundingClientRect();
    if (!el || !b || !(b.width > 0)) return { width: r * 2, height: r * 2, inv: 1 };
    return { width: b.width, height: b.height, inv: el.offsetWidth > 0 ? el.offsetWidth / b.width : 1 };
  };
  const aRect = rectOf(o.attackerEl, o.attackerRadius ?? o.defenderRadius ?? 100);
  const dRect = rectOf(o.defenderEl, o.defenderRadius ?? 100);
  const swing = classicSwing(o.attacker, o.defender, aRect, dRect, aRect.inv);

  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = classicPlan({ leadIn: fplan.endAt, tier: attackTier(o.total, o), swing: swing.times, intensity: o.intensity, reduced }, c);
  const cues = withFormation(fplan, classicCues(plan));
  const doc = typeof document !== 'undefined' ? document : null;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(o.sound !== false);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex: o.side === 'opp' ? FOE_HEX : PLAYER_HEX,
    local, host, scale: s, voices, className: 'hclassic',
  });
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, null);
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // The trail a minion's lunge leaves, while the hero is in the air (the original strike drew it too).
  let trailLast: Pt | null = null;

  const fire = (q: ClassicCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'wind':
        cam.start();
        break;
      case 'impact':
        if (!plan.reduced && o.impactFx !== false && o.defenderEl) {
          // The same strike burst and smack a minion's swing lands (the struck portrait's own recoil is ours).
          try {
            playContactImpact(o.defenderEl, dir.x, dir.y, hitPower(o.total * c.impactPower * plan.intensity), speed, o.defender, 0, false, false, false, false, false, true);
          } catch { /* no FX layer here */ }
        }
        seq.land();
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    const pose = strikePose(plan, swing, t);
    const still = Math.abs(pose.x) + Math.abs(pose.y) < 0.05 && Math.abs(pose.rot) < 0.01 && Math.abs(pose.scale - 1) < 1e-4;
    hero.set(still ? null : `translate(${pose.x.toFixed(2)}px, ${pose.y.toFixed(2)}px) rotate(${pose.rot.toFixed(3)}deg) scale(${pose.scale.toFixed(4)})`);
    if (o.impactFx !== false && t >= plan.windAt && t < plan.strikeEnd && !local) {
      const inv = aRect.inv || 1;
      const at = { x: o.attacker.x + pose.x / inv, y: o.attacker.y + pose.y / inv };
      if (trailLast && Math.hypot(at.x - trailLast.x, at.y - trailLast.y) >= 14) {
        try { pixiFx.trail(at.x, at.y, at.x - trailLast.x, at.y - trailLast.y, 'wind'); } catch { /* no FX layer here */ }
        trailLast = at;
      } else if (!trailLast) trailLast = at;
    }
    if (t >= plan.impactAt) {
      // The struck hero: a small knock along the blow and a squash, springing home.
      const since = t - plan.impactAt;
      const k = spring(since, 4.5, 80);
      const knock = c.knockPx * plan.intensity * k;
      const sq = c.squash * plan.intensity * k;
      foe.set(Math.abs(k) < 0.004 ? null
        : `translate(${(dir.x * knock * dRect.inv).toFixed(2)}px, ${(dir.y * knock * dRect.inv).toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`);
      // A SUBTLE punch in on the target and a shake along the blow (owner: "dont over do the zoom/shake").
      const tau = Math.max(1, c.shakeMs / 4);
      const decay = Math.exp(-since / tau);
      const sh = plan.shakePx * spring(since, 16, tau);
      const across = plan.shakePx * 0.2 * Math.sin(since * 0.09) * decay;
      cam.apply(o.defender, 1 + plan.punch * decay, dir.x * sh - dir.y * across, dir.y * sh + dir.x * across, local ? 1 : s);
    }
  };

  const seq: Sequence<ClassicCue | FormationCue> = new Sequence<ClassicCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene: null, unmount: null,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => { nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    swing,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
