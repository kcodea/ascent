/**
 * THE HOLY RUNNER: plays one Holy (Consecration) hero attack (the beats are in `heroHolyConfig.ts`) and lands the
 * consequence on its impact beat (the last smite, or Tier IV's eruption under the struck hero). Presentation only: the
 * total it shows and the blow it lands are handed in, already decided by the engine; this file only decides WHEN on
 * screen they happen.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as Arcana does: one clock (it never pauses), the
 * damage formation, the `#stage` camera (on the FX once: stageCamera.ts), the portraits (transform only, restored after),
 * the voices, the dim, reduced motion, finish / cancel and the safety timer. What is Holy's own: the invoke, the sigil,
 * the smites, the spear rain, the Tier IV sword and consecration, its camera and its sound.
 *
 * THE TICK CONTRACT: every smite before the last and every spear is a tick (FX and sound only). The consequence
 * (`onImpact`: the damage, Armor, Resolve) lands exactly ONCE, on the last smite (Tier IV: on the eruption).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; Pixi sprites are pooled per layer, textures painted once per session and pre-warmed during the
 * formation, and the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playBellStrike, playHolyChoir } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { koDipExtraMs, koTimeScale, playKoSting, scaledFrames } from '../heroAttack/knockout';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  HOLY_KO, barrageCount, getHeroHolyConfig, holyCameraAt, holyCameraFocus, holyCues, holyGeo, holyPlan,
  type HeroHolyConfig, type HolyCue, type HolyGeo, type HolyPlan,
} from './heroHolyConfig';
import { HeroHolyScene, type HeroHolyTextures } from './heroHolyScene';
import { heroHolyTextures } from './heroHolyTextures';

export interface HeroHolyOptions extends HeroAttackOptions {
  cfg?: HeroHolyConfig;
  textures?: HeroHolyTextures | null;
}

export interface HeroHolyHandle extends HeroAttackHandle {
  readonly plan: HolyPlan;
  /** Every position the attack uses (the spears, the sword, the consecration's path and runes). */
  readonly geo: HolyGeo;
  /** The Pixi scene (null under reduced motion or with no 2D canvas). Exposed for tests and the capture rig. */
  readonly scene: HeroHolyScene | null;
}

/** The seed a fight's motes are scattered from: the same fight (same blow, same geometry) throws the same light. */
export function holySeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 41 + (side === 'opp' ? 307 : 11)) >>> 0;
}

/** Play Holy. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroHoly(o: HeroHolyOptions): HeroHolyHandle {
  const c = o.cfg ?? getHeroHolyConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  // THE DAMAGE FORMATION plays first (shared by every style); this style's own attack starts where it ends.
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = holyPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, holyCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  // The sword always fits under the top of the screen (or the sandbox box).
  const geo = holyGeo(plan, o.attacker, o.defender, radius, c, s);
  const d = o.defender;

  // ── DOM: the numbers (shared) ──
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hholy',
  });

  // ── Pixi (the above-portrait slot, warmed now so it is up well before the first beat) ──
  const textures = o.textures !== undefined ? o.textures : heroHolyTextures({ gold: c.colorGold, deep: c.colorDeep, sky: c.colorSky, core: c.colorCore });
  const scene = textures && !reduced
    ? new HeroHolyScene(textures, {
      core: hexToNum(c.colorCore), gold: hexToNum(c.colorGold), deep: hexToNum(c.colorDeep), sky: hexToNum(c.colorSky),
      side: hexToNum(sideHex), dust: hexToNum(c.colorDust),
    }, {
      haloSize: c.haloSize, sunburst: c.sunburst, prayBeam: c.prayBeam, sigilSize: c.sigilSize, sigilSpin: c.sigilSpin,
      pillarGlow: c.pillarGlow, pillarHeight: c.pillarHeight, raysSize: c.raysSize, spearSize: c.spearSize, seedGlow: c.seedGlow,
      swordGlow: c.swordGlow, pathWidth: c.pathWidth, flameHeight: c.flameHeight,
    }, s, holySeed(o.total, dist, o.side))
    : null;
  // Tier V (owner 2026-10-02): the wave that comes out rolls pink + gold, not just gold.
  scene?.setKoWave(plan.ko);
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([
    c.sfxInvokeClip, c.sfxSigilClip, c.sfxDropClip, c.sfxHitClip, c.sfxImpactClip, c.sfxThumpClip, c.sfxSpearClip,
    c.sfxDescendClip, c.sfxSlamClip, c.sfxClangClip, c.sfxEruptClip, c.sfxImplodeClip, c.sfxBigClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const bell = (hz: number, gain: number, decayMs: number, delayMs = 0): void => {
    if (sound && gain > 0) voices.keep(playBellStrike('attack', { gain, hz, decayMs: real(decayMs), delayMs: real(delayMs) }));
  };
  let tick = 0;
  // The barrage's own swords (Tier V adds the knockout sword after them; it rings like the last, and louder).
  const nb = barrageCount(plan);
  const isKoSword = (i: number): boolean => plan.ko && i >= nb;

  const fire = (q: HolyCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge': {
        // The hero invokes: a shimmer of divine light, and a choir that swells to the prayer.
        cue(c.sfxInvokeClip, c.sfxInvokeGain, c.sfxInvokeRate, { lenMs: 900, fadeMs: 300 });
        if (sound) voices.keep(playHolyChoir('attack', { gain: c.sfxChoirGain, hz: c.sfxChoirHz, buildMs: real(plan.prayAt - plan.chargeAt), holdMs: real(plan.sword ? 200 : 120), tailMs: real(900), rise: 1 }));
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startInvoke(o.attacker.x, o.attacker.y, aRadius, plan.prayAt - plan.chargeAt, plan.k);
        cam.start();
        break;
      }
      case 'pray':
        bell(c.sfxBellHz * 1.5, c.sfxBellGain * 0.35, 900);
        scene?.pray(o.attacker.x, o.attacker.y, aRadius, plan.k);
        break;
      case 'sigil':
        // THE SIGIL: a divine chime as it flashes onto the struck hero, a soft bell as it lands.
        cue(c.sfxSigilClip, c.sfxSigilGain, c.sfxSigilRate, { lenMs: 800, fadeMs: 300 });
        bell(c.sfxBellHz * 2, c.sfxBellGain * 0.3, 700, plan.sigilMs * 0.85);
        scene?.startSigil(d.x, d.y, radius, plan.sigilMs, plan.tier);
        break;
      case 'spear': {
        const sp = geo.spears[q.i];
        cue(c.sfxSpearClip, c.sfxSpearGain, c.sfxSpearRate + 0.04 * q.i, { lenMs: 400, fadeMs: 160 });
        if (sp) scene?.spear(sp.from, sp.to, plan.spears[q.i]!.hitAt - plan.spears[q.i]!.launchAt, plan.spears[q.i]!.size);
        break;
      }
      case 'spearHit': {
        const sp = geo.spears[q.i];
        cue(c.sfxHitClip, c.sfxHitGain * 0.8, c.sfxHitRate + 0.05 * tick, { lenMs: 420, fadeMs: 180 });
        bell(c.sfxBellHz * (1.2 + 0.1 * (tick % 4)), c.sfxBellGain * 0.25, 500);
        if (sp) scene?.spearHit(sp.to, radius, q.i);
        tick++;
        break;
      }
      case 'drop': {
        const sm = plan.smites[q.i]!;
        cue(c.sfxDropClip, c.sfxDropGain * (q.i === plan.smites.length - 1 ? 1 : 0.75), c.sfxDropRate + 0.06 * q.i, { lenMs: 520, fadeMs: 200 });
        scene?.dropPillar(d.x, d.y, radius, sm.hitAt - sm.dropAt, plan.pillarWidth, sm.size, (local ? 6 : 24) * s);
        break;
      }
      case 'smite':
        // A smite before the last: a bright crack and a bell, FX only. The blow waits for the last.
        cue(c.sfxHitClip, c.sfxHitGain, c.sfxHitRate + 0.06 * tick, { lenMs: 500, fadeMs: 200 });
        bell(c.sfxBellHz, c.sfxBellGain * 0.6, 900);
        scene?.smiteTick(d.x, d.y, radius, tick);
        tick++;
        break;
      case 'sword': {
        // THE BARRAGE (owner 2026-09-29): a sword flies in from off screen along its own heading. Its whoosh climbs with
        // the ramp; the first carries the descending swoosh, placed so its hit lands on the bite.
        const w = geo.swords[q.i], pw = plan.swords[q.i]!;
        const k = isKoSword(q.i) ? 1.2 : nb > 1 ? q.i / (nb - 1) : 1;
        if (q.i === 0) voices.riser(c.sfxDescendClip, c.sfxDescendGain, c.sfxDescendRate, real(pw.arriveAt - pw.launchAt));
        cue(c.sfxSpearClip, c.sfxSpearGain * (1.2 + 0.6 * k), c.sfxSpearRate * (0.75 + 0.35 * k), { lenMs: 450, fadeMs: 160 });
        if (q.i === 1 && sound) {
          // The choir swells from the second sword to the implosion (the barrage charging the centre).
          voices.keep(playHolyChoir('attack', { gain: c.sfxChoirGain, hz: c.sfxChoirHz, buildMs: real(plan.implodeAt - pw.launchAt), holdMs: real(60), tailMs: real(300), rise: 1.3 }));
        }
        if (w) scene?.launchSword(w.from, w.tip, geo.centre, w.len, pw.arriveAt - pw.launchAt, isKoSword(q.i));
        break;
      }
      case 'swordHit': {
        // A sword BITES: punchy, not boomy, climbing in pitch and weight through the ramp (a hammer, a metal clang, a bell).
        const w = geo.swords[q.i];
        const ko = isKoSword(q.i);
        const n = nb, k = ko ? 1.2 : n > 1 ? q.i / (n - 1) : 1;
        cue(c.sfxSlamClip, c.sfxSlamGain * (0.6 + 0.5 * k), c.sfxSlamRate * (1 + 0.18 * k), { lenMs: 600, fadeMs: 250 });
        cue(c.sfxClangClip, c.sfxClangGain * (0.6 + 0.5 * k), c.sfxClangRate * (1 + 0.3 * k), { lenMs: 700, fadeMs: 300 });
        if (q.i === 0) cue(c.sfxThumpClip, c.sfxThumpGain * 1.2, c.sfxThumpRate - 0.1, { lenMs: 500, fadeMs: 180 });
        bell(c.sfxBellHz * (0.5 + 0.12 * q.i), c.sfxBellGain * (0.5 + 0.4 * k), 900);
        if (w) scene?.swordHit(w.tip, geo.centre, radius, Math.min(q.i, n - 1), n, { dust: c.slamDust, debris: c.slamDebris, shock: c.shockwave, flashAlpha: c.flashAlpha });
        if (ko) {
          // TIER V: the knockout sword bites dead centre: a low thump under it and a prismatic flare round the hub.
          cue(c.sfxThumpClip, c.sfxThumpGain * 1.3, c.sfxThumpRate - 0.15, { lenMs: 500, fadeMs: 180 });
          bell(c.sfxBellHz * 0.75, c.sfxBellGain, 1200);
          scene?.koSwordHit(geo.centre, radius);
        }
        break;
      }
      case 'implode':
        // THE IMPLOSION: a sharp inward suck (the collapse clip, reversed in feel by its pitch) under the peaking choir.
        cue(c.sfxImplodeClip, c.sfxImplodeGain, c.sfxImplodeRate, { lenMs: 600, fadeMs: 200 });
        scene?.implode(geo.centre, radius, plan.spreadAt - plan.implodeAt);
        break;
      case 'spread':
        // THE RELEASE: a punchy holy burst out of the centre (pitched up, a crack not a boom), then the flat consecrated
        // blast is fired along the board; a rising radiant swell peaks on the strike, and a whoosh carries the shot.
        cue(c.sfxEruptClip, c.sfxEruptGain * 0.8, c.sfxEruptRate * 1.12, { lenMs: 700, fadeMs: 300 });
        bell(c.sfxBellHz, c.sfxBellGain * 0.8, 1400);
        scene?.release(geo.centre, radius, geo.foot, { size: c.explodeSize, shards: c.shards, cracks: c.cracks, flashAlpha: c.flashAlpha });
        if (sound) voices.keep(playHolyChoir('attack', { gain: c.sfxSwellGain, hz: c.sfxChoirHz, buildMs: real(plan.impactAt - plan.spreadAt), holdMs: real(40), tailMs: real(1200), rise: 1.5 }));
        cue(c.sfxDropClip, c.sfxDropGain, c.sfxDropRate * 1.15, { lenMs: 600, fadeMs: 220 });
        cue(c.sfxHitClip, c.sfxHitGain * 0.7, c.sfxHitRate * 0.85, { lenMs: 500, fadeMs: 220 });
        scene?.spread(geo.path.a, geo.path.b, geo.cracks, geo.runes, plan.arriveAt - plan.spreadAt, radius * 0.62 * c.pathWidth * c.waveSize);
        break;
      case 'arrive':
        cue(c.sfxSigilClip, c.sfxSigilGain, c.sfxSigilRate * 0.9, { lenMs: 700, fadeMs: 260 });
        scene?.gather(geo.foot, radius, plan.impactAt - plan.arriveAt);
        break;
      case 'impact':
        if (plan.sword) {
          // THE ERUPTION: a bright burst (pitched up, a crack not a boom), the impact, a bell, the crystalline break.
          cue(c.sfxEruptClip, c.sfxEruptGain, c.sfxEruptRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 400 });
          cue(c.sfxImpactClip, c.sfxImpactGain, c.sfxImpactRate - 0.05, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxHitClip, c.sfxHitGain * 1.1, c.sfxHitRate - 0.1, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxBigClip, c.sfxBigGain * 1.1, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate, { lenMs: 500, fadeMs: 180 });
          bell(c.sfxBellHz, c.sfxBellGain, 1800);
          bell(c.sfxBellHz * 1.5, c.sfxBellGain * 0.5, 1400, 40);
          scene?.eruptFoe(geo.foot, d, radius, { flames: c.flamePillars, flameHeight: 1, burst: plan.burst, motes: plan.motes, flashAlpha: c.flashAlpha });
          // TIER V: the wider prismatic consecration ring and the KO sting.
          if (plan.ko) {
            scene?.koFlourish(geo.foot, d, radius, HOLY_KO.ringScale);
            playKoSting(voices, sound, real);
          }
        } else {
          // THE LAST SMITE: a bell strike, the impact, the crystalline break, a low punch (bigger per tier).
          cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.05 * plan.tier), c.sfxImpactRate, { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 450 });
          cue(c.sfxHitClip, c.sfxHitGain * 1.1, c.sfxHitRate + 0.06 * tick, { lenMs: 600, fadeMs: 220 });
          cue(c.sfxThumpClip, c.sfxThumpGain, c.sfxThumpRate - 0.03 * (plan.tier - 1), { lenMs: 500, fadeMs: 180 });
          if (plan.tier >= 3) cue(c.sfxBigClip, c.sfxBigGain, c.sfxBigRate, { lenMs: 700, fadeMs: 250 });
          bell(c.sfxBellHz * (1 - 0.08 * (plan.tier - 1)), c.sfxBellGain, 1500);
          scene?.smite(d.x, d.y, radius, { tier: plan.tier, k: plan.k, burst: plan.burst, motes: plan.motes, flashAlpha: c.flashAlpha });
        }
        seq.land();
        break;
      case 'fade':
        scene?.fadeGround(c.lingerMs);
        break;
      default:
        break;
    }
  };

  const px = local ? 0.45 : 1;
  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.prayAt, plan.impactAt + (plan.sword ? 420 : 200));
    const cm = holyCameraAt(plan, c, t);
    cam.apply(holyCameraFocus(plan, t, o.attacker, o.defender, plan.sword ? geo.centre : null), cm.zoom, cm.x, cm.y, local ? 1 : s);
    if (hero.el && t >= plan.chargeAt) {
      // Swell and rise a little through the invoke (lifted in prayer); a small dip as the prayer goes up; settle.
      let sc = 1, lift = 0;
      if (t < plan.prayAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.prayAt - plan.chargeAt));
        sc = 1 + c.heroSwell * u; lift = -5 * px * u;
      } else {
        const k = Math.max(0, spring(t - plan.prayAt, 3.5, 90));
        sc = 1 + c.heroSwell * k; lift = -5 * px * k + 4 * px * Math.max(0, spring(t - plan.prayAt, 4, 50)) * (t - plan.prayAt < 120 ? 1 : 0);
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(lift) < 0.05 ? null : `translate(0px, ${lift.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    if (foe.el) {
      let css: string | null = null;
      if (plan.sword && t >= plan.arriveAt && t < plan.impactAt) {
        // The ground gathers under it: it trembles (anticipation).
        const u = clamp01((t - plan.arriveAt) / Math.max(1, plan.impactAt - plan.arriveAt));
        const a = (0.8 + 2.4 * u) * px;
        css = `translate(${(a * Math.sin(t * 0.25)).toFixed(2)}px, ${(a * Math.sin(t * 0.33)).toFixed(2)}px)`;
      } else if (t >= plan.impactAt) {
        // Smitten from above (IV: heaved up by the eruption): knocked, squashed, springing home.
        const k = spring(t - plan.impactAt, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px * (plan.sword ? -0.8 : 1);
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        css = Math.abs(k) < 0.004 ? null
          : `translate(0px, ${knock.toFixed(2)}px) scale(${(1 + sq * 0.5).toFixed(4)}, ${(1 - sq).toFixed(4)})`;
      } else if (plan.hits.length && t >= plan.hits[0]!) {
        // Each tick presses the target down a little.
        let k = 0;
        for (const at of plan.hits) k += Math.max(0, spring(t - at, 6, 45)) * (at <= t ? 1 : 0);
        css = k < 0.004 ? null : `translate(0px, ${(k * 5 * px).toFixed(2)}px)`;
      }
      foe.set(css);
    }
  };

  const seq: Sequence<HolyCue | FormationCue> = new Sequence<HolyCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // Tier V's slow-mo dip on the eruption: the frame source hands the ONE clock a scaled step (never 0, never a freeze).
    frames: scaledFrames(o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)), () => (seq && !seq.done ? koTimeScale(plan.dip, seq.t) : 1)),
    safetyMs: o.safety !== false ? (plan.endAt + koDipExtraMs(plan.dip)) / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => { nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck(); },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    geo,
    scene,
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
