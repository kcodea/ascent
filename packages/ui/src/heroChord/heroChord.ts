/**
 * THE POWER CHORD RUNNER: plays one Power Chord hero attack (the beats are in `heroChordConfig.ts`) and lands the
 * consequence on its impact beat (the note or the chord arriving, or the bass wave's front reaching the struck hero).
 * Presentation only: the total it shows and the blow it lands are handed in, already decided by the engine.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`), exactly as the other styles do: one clock (it never
 * pauses), the damage formation, the `#stage` camera, the portraits (transform only, restored after), the voices, the
 * dim, reduced motion, finish / cancel and the safety timer. What is Power Chord's own: the staff, the notes, the
 * striking portrait as the speaker, the bass wave, the way the struck portrait is blown back, its camera and its sound.
 *
 * THE STRIKING PORTRAIT IS THE SPEAKER (Big). It swells on every pump of the count-in (a little more each time), shrinks
 * a touch through the inhale, and kicks back on the drop. Transform only.
 *
 * THE STRUCK PORTRAIT IS BLOWN BACK BY TRANSFORM ONLY. On Big the wave shoves it hard downwind and skews it (the top of
 * the portrait leans the way the wave travels, like hair in a dryer); it is pinned there, fluttering, while the rest of
 * the wave train batters it again (`plan.echoes`), then it springs upright. That is one `transform` string on the
 * portrait's wrapper, written from the clock through `PortraitMover`, which saved the wrapper's own transform at the
 * start and puts it back on every exit (the end, `finish()`, `cancel()`, the safety timer).
 *
 * SOUND IS THE ATTACK. Every beat has a cue: the five strings (plucks walking up a scale), the note (a clear pluck with
 * a soft kick under it) or the chord (the full distorted power chord), and on Big the amp's feedback swelling through
 * the count-in, a kick drum on every pump (louder each time), a beat of near quiet for the inhale, then the power chord
 * with its sustain and the sub-bass drop together as the wave leaves, the air it pushes, and on the impact a heavy thud
 * with a kick under each later front.
 *
 * THE CAMERA IS APPLIED ONCE (as Card Shark, see `../heroCards/heroCards.ts`): the Pixi root mirrors the DOM camera only
 * when its canvas is NOT already inside the camera element.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` written from the clock; nothing reads layout after
 * the opening measure; sprites are pooled and capped, the staff's vertices are rewritten in place, there is no filter
 * anywhere, textures are painted once per session and pre-warmed during the formation, and the updater unhooks the
 * moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { AttackVoices } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  getHeroChordConfig, chordArrivalDir, chordCameraAt, chordCameraFocus, chordCues, chordGeometry, chordPlan, STAFF_LINES,
  type HeroChordConfig, type ChordCue, type ChordGeo, type ChordPlan,
} from './heroChordConfig';
import { HeroChordScene, type HeroChordTextures } from './heroChordScene';
import { heroChordTextures } from './heroChordTextures';

export interface HeroChordOptions extends HeroAttackOptions {
  cfg?: HeroChordConfig;
  textures?: HeroChordTextures | null;
}

export interface HeroChordHandle extends HeroAttackHandle {
  readonly plan: ChordPlan;
  /** The staff's ends, the speaker (the striking portrait) and where the blow lands. */
  readonly geo: ChordGeo;
  readonly scene: HeroChordScene | null;
}

/**
 * The seed a fight's scatter is drawn from (which line each waiting note sits on, how the ring of notes is thrown): the
 * fight's own `rollSeed` when the caller has one, folded with the blow so two blows in one fight differ; else the blow
 * and the geometry. The same fight scatters the same way.
 */
export function chordSeed(total: number, distance: number, side: 'player' | 'opp' | undefined, rollSeed = 0): number {
  return (Math.round(total) * 4969 + Math.round(distance) * 53 + (side === 'opp' ? 401 : 29) + Math.imul(rollSeed >>> 0, 2654435761)) >>> 0;
}

/** The five strings' pitches as the staff strings itself: a major pentatonic walking up (playback rates). */
export const STRING_RATES = [1, 1.122, 1.26, 1.498, 1.682] as const;

/** How long the wave holds the struck portrait pinned back (the rest of the wave train is still passing) before it springs upright. */
export const BLOW_HOLD_MS = 560;

/**
 * How hard the bass wave has the struck portrait at `ms` after the front arrives: 1 the instant it hits, held nearly
 * there while the rest of the wave passes, then swinging back through upright (a little past it) and settling. Pure.
 */
export function blowAt(ms: number): number {
  if (ms < 0) return 0;
  // Pinned, easing a little and FLUTTERING in the wind; then it swings back through upright and settles.
  if (ms < BLOW_HOLD_MS) return 1 - 0.2 * (ms / BLOW_HOLD_MS) + 0.05 * Math.sin(ms * 0.085) * (1 - ms / BLOW_HOLD_MS);
  return 0.8 * spring(ms - BLOW_HOLD_MS, 2.3, 170);
}

/** Play Power Chord. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroChord(o: HeroChordOptions): HeroChordHandle {
  const c = o.cfg ?? getHeroChordConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = chordPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, chordCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hchord',
  });

  // The view (measured once, at the start): Big's flash covers it.
  const view = local ? { w: o.host?.clientWidth || 400, h: o.host?.clientHeight || 300 } : { w: typeof window !== 'undefined' ? window.innerWidth : 1920, h: typeof window !== 'undefined' ? window.innerHeight : 1080 };
  const geo = chordGeometry(plan, o.attacker, o.defender, radius, aRadius, c, s);
  const dir = chordArrivalDir(geo, o.attacker, o.defender);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();

  // ── Pixi ──
  const textures = o.textures !== undefined ? o.textures : heroChordTextures();
  const scene = textures && !reduced
    ? new HeroChordScene(textures, {
      staff: hexToNum(c.colorStaff), noteA: hexToNum(c.colorNoteA), noteB: hexToNum(c.colorNoteB), noteC: hexToNum(c.colorNoteC),
      wave: hexToNum(c.colorWave), side: hexToNum(sideHex),
    }, {
      width: c.staffWidth, glow: c.staffGlow, sag: c.staffSag, stringMs: c.stringMs, staggerMs: c.stringStaggerMs, pluckPx: c.pluckPx,
      thrumPx: c.thrumPx, vibHz: c.vibHz, vibMs: c.vibMs, slackMs: c.slackMs, bendPx: c.bendPx, pumpScale: c.pumpScale,
      waveBands: c.waveBands, waveSize: c.waveSize,
    }, s, chordSeed(o.total, dist, o.side, o.rollSeed))
    : null;
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  // ── camera + the portraits ──
  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));

  const cue = voices.cue.bind(voices);
  voices.warm([c.sfxStringClip, c.sfxPluckClip, c.sfxStrumClip, c.sfxBassClip, c.sfxThudClip, c.sfxPumpClip, c.sfxRiserClip, c.sfxWhooshClip, c.sfxImpactClip]);

  const fire = (q: ChordCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    const t = seq.t;
    switch (q.kind) {
      case 'charge':
        // The staff strings itself, one line after another: five quiet plucks walking up a scale.
        for (let i = 0; i < STAFF_LINES; i++) {
          cue(c.sfxStringClip, c.sfxStringGain, c.sfxStringRate * STRING_RATES[i % STRING_RATES.length]!, { delayMs: (c.stringMs * 0.6 + i * c.stringStaggerMs) / speed, lenMs: 300, fadeMs: 140 });
        }
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        if (geo.from && geo.to) scene?.string(geo.from, geo.to, geo.across, geo.gap, t - q.at);
        cam.start();
        break;
      case 'amp':
        // The striking portrait powers up as the speaker: a low thump, and the amp's feedback starts to swell (it
        // peaks exactly on the drop).
        cue(c.sfxPumpClip, c.sfxPumpGain * 0.5, c.sfxPumpRate * 0.8, { fadeMs: 120 });
        voices.riser(c.sfxRiserClip, c.sfxRiserGain, c.sfxRiserRate, (plan.releaseAt - plan.ampAt) / speed);
        if (geo.speaker) scene?.speakerOn(geo.speaker, t - q.at);
        break;
      case 'pump': {
        // The count-in: a kick drum, the portrait swells, rings punch out, notes pop onto the staff. Harder each time.
        const up = 1 + 0.22 * q.i;
        cue(c.sfxPumpClip, c.sfxPumpGain * (0.8 + 0.2 * q.i), c.sfxPumpRate * (1 - 0.04 * q.i), { fadeMs: 120 });
        cue(c.sfxStringClip, c.sfxStringGain * 1.2, c.sfxStringRate * STRING_RATES[(q.i * 2) % STRING_RATES.length]! * 0.5, { lenMs: 260, fadeMs: 140 });
        scene?.pump(up, 2);
        scene?.rest(3, 0.16 + 0.05 * q.i, 0.7 + 0.06 * q.i);
        scene?.pluck(-1, c.pluckPx * (0.7 + 0.2 * q.i));
        break;
      }
      case 'inhale':
        // The breath before the drop: the rings pull in, nothing new sounds (only the feedback, climbing).
        scene?.inhale(plan.releaseAt - plan.inhaleAt);
        break;
      case 'release':
        if (plan.speaker) {
          // THE DROP: the power chord with its sustain, the sub-bass under it, and the air the wave pushes.
          cue(c.sfxStrumClip, c.sfxStrumGain * 0.8, c.sfxStrumRate * 0.94, { tail: c.sfxTailMix, fadeMs: 300 });
          cue(c.sfxBassClip, c.sfxBassGain, c.sfxBassRate, { tail: c.sfxTailMix });
          cue(c.sfxPumpClip, c.sfxPumpGain * 1.2, c.sfxPumpRate * 0.85, { fadeMs: 120 });
          cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate, { lenMs: (plan.flyMs + 260) * c.sfxWhooshRate, fadeMs: 220 });
          scene?.pump(2.1, 3);
          scene?.pluck(-1, c.thrumPx * 0.6);
          if (geo.waveFrom) scene?.bass(geo.waveFrom, o.defender, plan.flyMs, t - q.at, aRadius);
        } else {
          if (plan.level === 1) {
            cue(c.sfxPluckClip, c.sfxPluckGain, c.sfxPluckRate, { tail: c.sfxTailMix });
            cue(c.sfxPumpClip, c.sfxPumpGain * 0.35, c.sfxPumpRate * 1.3, { fadeMs: 100 });
          } else {
            cue(c.sfxStrumClip, c.sfxStrumGain * 1.15, c.sfxStrumRate, { tail: c.sfxTailMix, lenMs: 1100, fadeMs: 380 });
            cue(c.sfxPumpClip, c.sfxPumpGain * 0.6, c.sfxPumpRate, { fadeMs: 100 });
          }
          for (const r of plan.riders) {
            scene?.ride(r.line, { flyMs: r.flyMs, lag: r.lag, size: plan.noteSize, hue: r.hue, late: t - q.at });
            scene?.pluck(r.line, c.pluckPx * 1.2, 2);
          }
        }
        break;
      case 'echo':
        // A later front of the wave train leaves the speaker: another kick, another pump, another thick crescent.
        cue(c.sfxPumpClip, c.sfxPumpGain * (0.75 - 0.15 * q.i), c.sfxPumpRate * (0.8 - 0.06 * q.i), { fadeMs: 120 });
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.6, c.sfxWhooshRate * 0.9, { lenMs: (plan.flyMs + 200) * c.sfxWhooshRate, fadeMs: 200 });
        scene?.pump(1.4 - 0.25 * q.i, 0);
        if (geo.waveFrom) scene?.echo(geo.waveFrom, o.defender, plan.flyMs, 0.9 - 0.2 * q.i, aRadius);
        break;
      case 'impact':
        cue(c.sfxImpactClip, c.sfxImpactGain * (0.85 + 0.1 * plan.level), c.sfxImpactRate - 0.08 * (plan.level - 1), { tail: c.sfxTailMix, lenMs: c.sfxImpactLenMs, fadeMs: 300 });
        // Weight under every landing: a kick under the note and the chord, the heavy thud and a low kick under the wave.
        if (plan.speaker) {
          cue(c.sfxThudClip, c.sfxThudGain, c.sfxThudRate, { tail: c.sfxTailMix, lenMs: 700, fadeMs: 320 });
          cue(c.sfxPumpClip, c.sfxPumpGain * 1.3, c.sfxPumpRate * 0.7, { fadeMs: 140 });
        } else cue(c.sfxPumpClip, c.sfxPumpGain * (plan.level === 2 ? 0.9 : 0.6), c.sfxPumpRate * (plan.level === 2 ? 0.85 : 1.05), { fadeMs: 110 });
        // A chord (and the wave) makes the whole staff thrum; a single note just rings the line it rode.
        if (plan.level >= 2) scene?.thrum(); else scene?.pluck(2, c.thrumPx * 0.7);
        scene?.strike(geo.hit.x, geo.hit.y, radius, { level: plan.level, notes: plan.notes, sparks: plan.sparks, burst: plan.burst, flashAlpha: c.flashAlpha, dir: plan.speaker ? dir : undefined, view });
        seq.land();
        break;
      case 'slack':
        scene?.slacken();
        break;
      default:
        break;
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.speaker ? plan.inhaleAt : plan.releaseAt, plan.speaker ? plan.slackAt - 200 : plan.impactAt + 200);
    const cm = chordCameraAt(plan, c, t, dir);
    const unit = local ? 1 : s;
    cam.apply(chordCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The wind-up: a lean back and a little swell; playing throws the hero forward. On Big the portrait IS the
      // speaker: it swells on every pump (more each time), draws in through the inhale, and kicks BACK on the drop
      // and on every later front (the recoil of a cone).
      let sc = 1, bx = 0, by = 0;
      if (t < plan.releaseAt) {
        const u = easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.releaseAt - plan.chargeAt));
        sc = 1 + 0.035 * u;
        bx = -toFoe.x * c.heroCoilPx * px * u; by = -toFoe.y * c.heroCoilPx * px * u;
        if (plan.speaker) {
          for (let i = 0; i < plan.pumps.length; i++) { const at = plan.pumps[i]!; if (t >= at) sc += (0.05 + 0.02 * i) * Math.max(0, spring(t - at, 5, 60)); }
          if (t >= plan.inhaleAt) sc -= 0.05 * easeInOutSine((t - plan.inhaleAt) / Math.max(1, plan.releaseAt - plan.inhaleAt));
        }
      } else if (plan.speaker) {
        const age = t - plan.releaseAt;
        let kick = spring(age, 4.5, 80);
        sc = 1 + 0.035 * Math.max(0, spring(age, 3, 90)) + 0.11 * Math.max(0, kick);
        for (const at of plan.echoes) { const a2 = t - (at - plan.flyMs); if (a2 >= 0) { const k2 = spring(a2, 4.5, 70); kick += 0.5 * k2; sc += 0.05 * Math.max(0, k2); } }
        const f = c.heroThrustPx * px * kick;
        bx = -toFoe.x * f; by = -toFoe.y * f;
      } else {
        const back = Math.max(0, spring(t - plan.releaseAt, 3, 90));
        const f = c.heroThrustPx * px * spring(t - plan.releaseAt, 5, 60);
        sc = 1 + 0.035 * back;
        bx = -toFoe.x * c.heroCoilPx * px * back + toFoe.x * f; by = -toFoe.y * c.heroCoilPx * px * back + toFoe.y * f;
      }
      hero.set(Math.abs(sc - 1) < 1e-4 && Math.abs(bx) + Math.abs(by) < 0.05 ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) scale(${sc.toFixed(4)})`);
    }
    let fx = 0, fy = 0;
    if ((foe.el || scene) && t >= plan.impactAt) {
      let css: string | null = null;
      const age = t - plan.impactAt;
      if (plan.speaker) {
        // BLOWN BACK: shoved hard downwind and skewed (its top leans the way the wave travels), pinned and fluttering
        // while the later fronts batter it again, then it springs upright.
        let k = blowAt(age);
        for (const at of plan.echoes) if (t >= at) k += 0.3 * Math.max(-0.4, spring(t - at, 5, 70));
        fx = dir.x * c.blowPx * k * px; fy = dir.y * c.blowPx * k * px;
        const skew = -(dir.x >= 0 ? 1 : -1) * c.blowSkew * k;
        const sq = c.squash * k;
        if (Math.abs(k) >= 0.004) css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) skewX(${skew.toFixed(2)}deg) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.5).toFixed(4)})`;
        else { fx = 0; fy = 0; }
      } else {
        const k = spring(age, 4.5, 90);
        const knock = c.knockPx * (0.7 + 0.5 * plan.k) * k * px;
        const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
        fx = dir.x * knock; fy = dir.y * knock;
        if (Math.abs(k) >= 0.004) css = `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
        else { fx = 0; fy = 0; }
      }
      foe.set(css);
    }
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<ChordCue | FormationCue> = new Sequence<ChordCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    frames: o.frames ?? ((fn: (dt: number) => void) => pixiFx.addUpdater(fn)),
    safetyMs: o.safety !== false ? plan.endAt / speed + 2500 : null,
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
