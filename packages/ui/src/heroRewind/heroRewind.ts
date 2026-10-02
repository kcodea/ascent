/**
 * THE REWIND RUNNER ("Rewind", the Ancient of Time; ANCIENT): plays one Rewind hero attack (the beats are in
 * `heroRewindConfig.ts`) and lands the consequence on its impact beat (the last landing, or Tier IV's shatter).
 * Presentation only: the total and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * GOD SCALE (owner review 2026-10-02: "the attack is an ancient power, literally a god's attack. make it cooler"): the
 * Ancient of Time MANIFESTS over the board (its own art, a feathered translucent bust: the mask, the gold and violet eyes,
 * the broken halo) and its raised hand POURS a torrent of golden sand onto the struck hero. Its halo rings fill the sky
 * round its head and, from II, sweep the stage like clock hands. Time bends the WHOLE board on every rewind: the eyes
 * flare, the screen washes gold, every card on both boards twitches backward (one transform per board row), the halo
 * snaps back. Tier IV raises a board-spanning clock face behind everything; at the end the god CLOSES its hand (its rings
 * clamp onto the target), every echo lands at once and the whole screen shatters like glass before time snaps back.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses; Tier IV's shatter gets a slow-mo
 * DIP through the frame source, never a freeze), the damage formation, the `#stage` camera (applied ONCE:
 * `stageCamera.ts`), the portraits and the board rows (transform only, restored after), the voices, the dim, reduced
 * motion, finish / cancel and the safety timer.
 *
 * THE REWIND IS STORY TIME RUN BACKWARD: every frame the plan says which strike is live and its story time `s`
 * (`rewindStateAt`). Forward `s` climbs; rewinding it falls. The torrent, its trail, the grains, the striker's snap and
 * the struck portrait's jolt are all drawn FROM `s`, so a rewind is literally the forward frames in reverse.
 *
 * THE CONTRACT: every landing before the last is a tick (FX and sound only). The consequence (`onImpact`) lands exactly
 * ONCE, on the last landing (Tier IV: the shatter, as every frozen echo lands with the last replay).
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` from the clock; the board rows are found ONCE at the
 * start (no per-frame queries or layout reads); pooled sprites under a hard cap plus a fixed set of own objects; textures
 * painted once per session (the god's art decoded once) and pre-warmed during the formation; the per-frame bolt state is
 * one reused object; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { stageScale } from '../stage';
import { ancientArt } from '../art';
import { AttackVoices, type CueOpts } from '../heroAttack/attackSound';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { clamp01, easeInOutSine, easeOutCubic, hexToNum, prefersReducedMotion, spring, type Pt } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  afterPathS, flyEase, getHeroRewindConfig, haloRateAt, pathAt, rewindCameraAt, rewindCameraFocus, rewindCues, rewindPath,
  rewindPlan, rewindSlowExtraMs, rewindStateAt, rewindTimeScale, strikePos, type HeroRewindConfig, type RewindCue, type RewindPath,
  type RewindPlan,
} from './heroRewindConfig';
import { HeroRewindScene, type BoltState, type HeroRewindTextures } from './heroRewindScene';
import { heroRewindTextures, rewindGodTexture } from './heroRewindTextures';

export interface HeroRewindOptions extends HeroAttackOptions {
  cfg?: HeroRewindConfig;
  textures?: HeroRewindTextures | null;
}

export interface HeroRewindHandle extends HeroAttackHandle {
  readonly plan: RewindPlan;
  readonly path: RewindPath;
  readonly scene: HeroRewindScene | null;
  readonly mirrorsCamera: boolean;
  /** Where the god looms (its bust's centre) and how tall it is, px (exposed for tests and the capture rig). */
  readonly god: { at: Pt; h: number; flip: boolean };
}

export function rewindSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 41 + (side === 'opp' ? 239 : 23)) >>> 0;
}

/** How bright the god's halo burns per tier (I present, IV the full clock). */
const HALO_ALPHA = [0.7, 0.8, 0.9, 1] as const;

/** Play the Rewind. Returns a handle; the blow lands via `onImpact` on the last landing. */
export function playHeroRewind(o: HeroRewindOptions): HeroRewindHandle {
  const c = o.cfg ?? getHeroRewindConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = rewindPlan({ total: o.total, knockout: o.knockout, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, rewindCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hrewind',
  });

  // ── the stage: the whole screen (a sandbox box: round both heroes) ──
  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight;
  const screen = local
    ? { x: Math.min(o.attacker.x, o.defender.x) - dist * 0.3, y: Math.min(o.attacker.y, o.defender.y) - dist * 0.3, w: Math.abs(o.attacker.x - o.defender.x) + dist * 0.6, h: Math.abs(o.attacker.y - o.defender.y) + dist * 0.6 }
    : { x: 0, y: 0, w: vw, h: vh };
  const centre = { x: screen.x + screen.w / 2, y: screen.y + screen.h / 2 };
  // THE GOD looms over the middle of the board, its raised pouring hand on the FAR side from the target, so the torrent
  // sweeps right across the board onto it.
  const godH = Math.max(1, screen.h * c.godSize);
  const godAt = { x: centre.x, y: screen.y + screen.h * 0.4 };
  const godFlip = o.defender.x < godAt.x;
  const godHand = HeroRewindScene.godHand(godAt, godH, godFlip);
  const godHead = HeroRewindScene.godHead(godAt, godH);
  const haloR = godH * 0.3;
  // The torrent pours from the god's hand (with no apparition, from the striker's rim as before).
  const source = c.godSize > 0 ? godHand : o.attacker;
  const path = rewindPath(source, o.defender, radius, c.godSize > 0 ? 0 : aRadius, c.arc, (local ? 8 : 36) * s);
  const toFoe = (() => { const L = dist || 1; return { x: (o.defender.x - o.attacker.x) / L, y: (o.defender.y - o.attacker.y) / L }; })();
  const hand = path.hand;
  const pourPx = Math.max(aRadius * 0.62, godH * 0.12);
  const flip = o.attacker.x > o.defender.x ? -1 : 1;
  // Each strike's torrent at story time ms (made once: a closure per strike, never per frame).
  const samplers = plan.strikes.map((st) => (ms: number): Pt => strikePos(path, st.flyMs, ms));
  const rainArea = { x: o.defender.x - radius * 3.2, y: o.defender.y - radius * 2.6, w: radius * 6.4, h: radius * 3.6 };

  const textures = o.textures !== undefined ? o.textures : heroRewindTextures();
  const scene = textures && !reduced
    ? new HeroRewindScene(textures, {
      sand: hexToNum(c.colorSand), sandLight: hexToNum(c.colorSandLight), gold: hexToNum(c.colorGold), violet: hexToNum(c.colorViolet),
      splitA: hexToNum(c.colorSplitA), splitB: hexToNum(c.colorSplitB), side: hexToNum(sideHex),
    }, {
      boltPx: c.boltPx, trailWidth: c.trailWidth, splitPx: c.splitPx, grainRate: c.grainRate, echoMs: c.echoMs, echoTremble: c.echoTremble,
      hourglassSize: c.hourglassSize, shatterSize: c.shatterSize,
    }, s, rewindSeed(o.total, dist, o.side))
    : null;
  scene?.setPath((v) => pathAt(path, v));
  // The god's art, decoded once per session (kicked off here, during the formation; until then it simply is not drawn).
  const godTex = (): void => { if (scene && c.godSize > 0 && o.textures === undefined) scene.setGodTexture(rewindGodTexture(ancientArt('time'))); };
  godTex();
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  // Every card on both boards: one mover per board ROW (found once; transform only; restored on every exit).
  const rows: PortraitMover[] = reduced || local || !doc || c.twitchPx <= 0 ? []
    : [...doc.querySelectorAll<HTMLElement>('[data-zone="warband"] .row, [data-zone="tavern"] .row')].map((el) => new PortraitMover(el));

  // Sounds follow the slow-mo dip a little (pitched down with the clock), as the Basketball's do.
  const cue = (clip: string, gain: number, rate: number, opts?: CueOpts): void =>
    voices.cue(clip, gain, rate * (0.85 + 0.15 * rewindTimeScale(plan, c, seq ? seq.t : 0)), opts);
  voices.warm([
    c.sfxTickClip, c.sfxThrowClip, c.sfxSnapClip, c.sfxHitClip, c.sfxThudClip, c.sfxChimeClip, c.sfxRewindClip, c.sfxZipClip, c.sfxBoomClip,
    c.sfxRiserClip, c.sfxShatterClip, c.sfxGlassClip, c.sfxBellClip, c.sfxRumbleClip,
  ]);
  const real = (ms: number): number => ms / speed;
  const launchDir = Math.atan2(path.ctrl.y - hand.y, path.ctrl.x - hand.x);
  const nAfter = plan.afterimages.length;
  const gold = hexToNum(c.colorGold);
  const violet = hexToNum(c.colorViolet);

  /** A landing's FX and sound; `i` grows it (every replay lands BIGGER: a bigger ring, a deeper thud). */
  const landing = (i: number): void => {
    const k = 1.05 + 0.18 * i;
    cue(c.sfxHitClip, c.sfxHitGain * Math.min(1.3, 0.8 + 0.1 * i), c.sfxHitRate - 0.04 * i, { lenMs: 420, fadeMs: 160 });
    cue(c.sfxThudClip, c.sfxThudGain * Math.min(1.3, 0.7 + 0.12 * i), c.sfxThudRate - 0.05 * i, { lenMs: 380, fadeMs: 150 });
    cue(c.sfxChimeClip, c.sfxChimeGain * 0.8, c.sfxChimeRate + 0.06 * i, { lenMs: 320, fadeMs: 140 });
    scene?.hit(path.hit, path.arrive, k, Math.round(plan.grains * 0.5) + 2 * i);
  };

  const fire = (q: RewindCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        // A clock ticks; the god rises over the board and sand gathers in its hand.
        godTex();
        cue(c.sfxTickClip, c.sfxTickGain, c.sfxTickRate, { lenMs: 500, fadeMs: 180 });
        cue(c.sfxRiserClip, c.sfxRiserGain * 0.6, c.sfxRiserRate * 0.9, { lenMs: Math.max(200, real(plan.throwAt - plan.chargeAt) + 80), fadeMs: 120 });
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        scene?.startCharge(hand, pourPx, plan.throwAt - plan.chargeAt);
        cam.start();
        break;
      case 'throw': {
        const last = q.i === plan.strikes.length - 1;
        cue(c.sfxThrowClip, c.sfxThrowGain * (last ? 1 : 0.85), c.sfxThrowRate + 0.06 * q.i, { lenMs: 420, fadeMs: 150 });
        // A replay SNAPS back out like a rubber band.
        if (q.i > 0) cue(c.sfxSnapClip, c.sfxSnapGain * Math.min(1.4, 0.8 + 0.12 * q.i), c.sfxSnapRate + 0.05 * q.i, { lenMs: 300, fadeMs: 120 });
        scene?.launch(hand, launchDir, 1.3 + 0.15 * q.i);
        // Tier III's last replay: the afterimages pour with it, a beat ahead (the stutter).
        if (last) for (let j = 0; j < nAfter; j++) scene?.flyEcho(j);
        // Tier IV's last replay: the god CLOSES its hand: its halo rings clamp down onto the target like a fist.
        if (last && plan.finaleAt >= 0) scene?.clamp(o.defender, haloR, plan.impactAt - plan.finaleAt);
        break;
      }
      case 'hit':
        landing(q.i);
        break;
      case 'stutter':
        // Tier III: an afterimage lands a beat ahead of the torrent (a tick): bam, bam, ...
        landing(q.i + plan.strikes.length - 1);
        scene?.consumeEcho(q.i);
        break;
      case 'rewind': {
        // TIME BENDS THE WHOLE BOARD: the god's eyes flare, the screen washes gold, every card twitches back (paint), the
        // halo snaps backward; a tape zip, a reversed whoosh and a stutter of reversed ticks; the splash is sucked back up
        // in a vortex and the torrent retracts into the god's hand.
        const st = plan.strikes[q.i]!;
        const win = real(st.rewindMs);
        voices.riser(c.sfxRewindClip, c.sfxRewindGain, c.sfxRewindRate + 0.08 * q.i, win, true);
        cue(c.sfxZipClip, c.sfxZipGain, c.sfxZipRate + 0.08 * q.i, { lenMs: Math.max(120, win + 40), fadeMs: 60, reverse: true });
        for (let k = 0; k < 3; k++) cue(c.sfxTickClip, c.sfxTickGain * (0.75 - 0.15 * k), c.sfxTickRate * (1.25 + 0.12 * k) + 0.05 * q.i, { lenMs: 140, fadeMs: 60, reverse: true, delayMs: k * Math.max(25, win / 4) });
        const unhold = (st.holdMs / Math.max(1, st.flyMs + st.holdMs)) * st.rewindMs;
        scene?.unsplash(path.hit, radius, Math.max(70, unhold + 50), Math.round(plan.grains * 0.6), 1 + 0.1 * q.i);
        scene?.scrub(screen, st.rewindMs, 4 + q.i);
        if (c.washAlpha > 0) scene?.wash(screen, gold, c.washAlpha, Math.max(160, st.rewindMs + 60));
        break;
      }
      case 'back':
        // Back in the god's hand: the clock ticks again, higher every loop (IV: ticks accelerating into the gong).
        cue(c.sfxTickClip, c.sfxTickGain * 0.85, c.sfxTickRate + 0.1 * (q.i + 1), { lenMs: 220, fadeMs: 100 });
        scene?.back(hand, pourPx, 6);
        break;
      case 'after':
        scene?.afterimage(q.i, afterPathS(q.i), plan.size * (1 + 0.1 * q.i));
        break;
      case 'echo': {
        const e = plan.echoes[q.i]!;
        cue(c.sfxChimeClip, c.sfxChimeGain * 0.8, c.sfxChimeRate + 0.12 * q.i, { lenMs: 260, fadeMs: 120 });
        scene?.freezeEcho(q.i, e.pathS, plan.size * 0.95);
        break;
      }
      case 'hourglass':
        voices.riser(c.sfxRiserClip, c.sfxRiserGain, c.sfxRiserRate, real(plan.impactAt - plan.hourglassAt));
        scene?.hourglass(o.defender, radius, plan.impactAt - plan.hourglassAt);
        break;
      case 'impact':
        if (plan.tier >= 4) {
          // THE MOMENT SHATTERS: glass across the whole screen, the gong, a deep boom, a rumble.
          cue(c.sfxShatterClip, c.sfxShatterGain, c.sfxShatterRate, { tail: c.sfxTailMix, lenMs: 1600, fadeMs: 500 });
          cue(c.sfxGlassClip, c.sfxGlassGain, c.sfxGlassRate, { lenMs: 900, fadeMs: 300 });
          cue(c.sfxBellClip, c.sfxBellGain, c.sfxBellRate, { tail: c.sfxTailMix * 1.5, lenMs: 2200, fadeMs: 900 });
          cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate - 0.08, { tail: c.sfxTailMix, lenMs: 1800, fadeMs: 600 });
          cue(c.sfxRumbleClip, c.sfxRumbleGain, c.sfxRumbleRate, { lenMs: 1400, fadeMs: 500 });
          cue(c.sfxThudClip, c.sfxThudGain * 1.2, c.sfxThudRate - 0.25, { lenMs: 700, fadeMs: 250 });
        } else {
          cue(c.sfxHitClip, c.sfxHitGain * 1.15, c.sfxHitRate - 0.08 * plan.tier, { tail: c.sfxTailMix, lenMs: 600, fadeMs: 220 });
          cue(c.sfxThudClip, c.sfxThudGain * (0.9 + 0.1 * plan.tier), c.sfxThudRate - 0.08 * plan.tier, { lenMs: 600, fadeMs: 220 });
          cue(c.sfxChimeClip, c.sfxChimeGain, c.sfxChimeRate - 0.1, { lenMs: 450, fadeMs: 180 });
          cue(c.sfxBoomClip, c.sfxBoomGain * (0.45 + 0.2 * plan.tier), c.sfxBoomRate + 0.25 - 0.08 * plan.tier, { tail: c.sfxTailMix, lenMs: 1200, fadeMs: 400 });
          if (plan.tier >= 3) cue(c.sfxBellClip, c.sfxBellGain * 0.55, c.sfxBellRate * 1.3, { tail: c.sfxTailMix, lenMs: 1200, fadeMs: 500 });
        }
        if (c.washAlpha > 0) scene?.wash(screen, plan.tier >= 4 ? violet : gold, c.washAlpha * 1.2, 300);
        scene?.impact(path.hit, path.arrive, radius, { tier: plan.tier, grains: plan.grains, area: rainArea, rain: Math.round(c.rain), screen: plan.tier >= 4 ? screen : undefined });
        seq.land();
        break;
      default:
        break;
    }
  };

  // ── the per-frame paint ──
  const bolt: BoltState = { sample: samplers[0] ?? ((): Pt => hand), s: 0, flyMs: 1, span: c.trailMs, rate: 1, size: plan.size, drain: c.drainMs };
  let haloAng = 0;
  let dialAng = 0;
  let lastT = -1;
  const lastStrike = plan.strikes[plan.strikes.length - 1];
  const refFly = plan.strikes[0]?.flyMs ?? 1;

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.throwAt, plan.impactAt + (plan.tier >= 4 ? 420 : 200));
    const cm = rewindCameraAt(plan, c, t, path.arrive);
    const unit = local ? 1 : s;
    cam.apply(rewindCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const st = rewindStateAt(plan, t);
    const dt = lastT < 0 ? 0 : Math.max(0, t - lastT);
    lastT = t;
    // How hard time is bending right now: a spike on every rewind (and the impact), decaying.
    let flare = 0;
    for (const r of plan.rewinds) if (t >= r) flare = Math.max(flare, Math.exp(-(t - r) / 160));
    if (t >= plan.impactAt) flare = Math.max(flare, Math.exp(-(t - plan.impactAt) / 220));
    if (scene) {
      // THE TORRENT, drawn from story time (a rewind is the same frames, backward); it drains into the hit after landing.
      if (st) {
        const sk = st.strike;
        bolt.sample = samplers[st.i]!;
        bolt.s = st.s;
        bolt.flyMs = sk.flyMs;
        bolt.span = c.trailMs * (sk.flyMs / refFly);
        bolt.rate = st.rewinding ? -(sk.flyMs + sk.holdMs) / Math.max(1, sk.rewindMs) : 1;
        bolt.size = plan.size * (1 + 0.06 * st.i);
        bolt.drain = Math.max(sk.holdMs, st.i === plan.strikes.length - 1 ? c.drainMs : Math.min(c.drainMs, sk.holdMs));
        scene.setBolt(bolt);
        if (nAfter && lastStrike && st.i === plan.strikes.length - 1) {
          for (let j = 0; j < nAfter; j++) {
            const lead = Math.min(sk.flyMs * 0.8, (nAfter - j) * c.stutterMs);
            scene.setEchoS(j, flyEase((st.s + lead) / Math.max(1, sk.flyMs)));
          }
        }
      } else scene.setBolt(null);
      if (plan.finaleAt >= 0 && t >= plan.finaleAt && t < plan.impactAt) {
        const u = (t - plan.finaleAt) / Math.max(1, plan.impactAt - plan.finaleAt);
        plan.echoes.forEach((e, i) => scene.setEchoS(i, e.pathS + (1 - e.pathS) * flyEase(u)));
      }
      // THE GOD rises over the ready, holds, and leaves after the impact (IV: snaps away with the shatter).
      const rise = easeOutCubic((t - plan.chargeAt) / Math.max(1, plan.throwAt - plan.chargeAt + 120));
      const outMs = plan.tier >= 4 ? 140 : 420;
      const godA = t < plan.chargeAt ? 0 : rise * (t > plan.impactAt ? 1 - clamp01((t - plan.impactAt) / outMs) : 1);
      if (c.godSize > 0) scene.setGod(godAt, godH, godFlip, godA, (1 - rise) * -godH * 0.1, flare, !!st?.rewinding);
      // ITS HALO round its head: integrated spin (snapping backward while time scrubs); from II the clock hands sweep the
      // stage. IV: the rings leave the god's head as it closes its hand (they clamp onto the target).
      const rate = haloRateAt(plan, c, t);
      haloAng += (rate * dt) / 1000;
      const clamped = plan.finaleAt >= 0 && t >= plan.finaleAt;
      const ha = t >= plan.chargeAt && !clamped ? HALO_ALPHA[plan.tier - 1] * godA * (c.godSize > 0 ? 0.45 : 1) : 0;
      const hr = (c.godSize > 0 ? haloR : aRadius * c.haloSize) * (1 + 0.04 * flare);
      scene.setHalo(c.godSize > 0 ? godHead : o.attacker, hr, haloAng, -haloAng * 1.4, haloAng * 3 - Math.PI / 2, ha, plan.tier >= 2);
      // IV: the board-spanning clock face behind everything, its hands spinning backward harder every loop.
      if (plan.tier >= 4 && c.dialSize > 0) {
        dialAng += (rate * 1.6 * dt) / 1000;
        const da = t < plan.impactAt ? easeInOutSine((t - plan.throwAt) / 300) : 1 - clamp01((t - plan.impactAt) / 120);
        scene.setDial(centre, Math.min(screen.w, screen.h) * 0.47 * (c.dialSize / 1.35), dialAng, t >= plan.throwAt ? da : 0);
      }
    }
    const px = local ? 0.45 : 1;
    // While time scrubs back, both portraits jitter sideways (a VHS tracking error): transform only.
    const jit = st?.rewinding ? c.jitterPx * px * (Math.sin(t * 0.9) > 0 ? 1 : -1) * (0.6 + 0.4 * Math.sin(t * 0.37)) : 0;
    // EVERY CARD on both boards twitches backward on each rewind (one transform per board row).
    if (rows.length) {
      let tw = 0;
      for (const r of plan.rewinds) if (t >= r) tw += Math.max(0, spring(t - r, 7, 70));
      const css = tw < 0.01 ? null : `translate(${(-c.twitchPx * tw * flip).toFixed(2)}px, 0px) skewX(${(2.5 * tw * flip).toFixed(2)}deg)`;
      for (const r of rows) r.set(css);
    }
    if (hero.el && t >= plan.chargeAt) {
      let bx = jit, by = 0, rot = 0;
      const lean = t < plan.throwAt
        ? easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.throwAt - plan.chargeAt))
        : Math.max(0, spring(t - plan.throwAt, 3, 90));
      bx -= toFoe.x * c.heroWindPx * px * lean; by -= toFoe.y * c.heroWindPx * px * lean;
      rot -= 3 * flip * lean;
      if (st) {
        const f = c.heroThrowPx * px * Math.max(0, spring(st.s, 5, 60));
        bx += toFoe.x * f; by += toFoe.y * f;
        rot += 2 * flip * Math.max(0, spring(st.s, 5, 60));
      }
      const still = Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(rot) < 0.01;
      hero.set(still ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${rot.toFixed(3)}deg)`);
    }
    let fx = 0, fy = 0;
    let css: string | null = null;
    if (t >= plan.impactAt && lastStrike) {
      const k = spring(t - plan.impactAt, 4.5, 90);
      const knock = c.knockPx * (0.7 + 0.4 * plan.k) * k * px;
      const sq = c.squash * (0.8 + 0.4 * plan.k) * k;
      fx = path.arrive.x * knock; fy = path.arrive.y * knock;
      css = Math.abs(k) < 0.004 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`;
    } else {
      let k = 0;
      if (st && st.s >= st.strike.flyMs) k += Math.max(0, spring(st.s - st.strike.flyMs, 6, 45)) * (9 + 3 * st.i) * px;
      for (const at of plan.stutters) if (t >= at) k += Math.max(0, spring(t - at, 6, 40)) * 10 * px;
      fx = path.arrive.x * k + jit; fy = path.arrive.y * k;
      css = Math.abs(fx) + Math.abs(fy) < 0.05 ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px)`;
    }
    foe.set(css);
    scene?.setFoeOffset(fx * unit, fy * unit);
  };

  const seq: Sequence<RewindCue | FormationCue> = new Sequence<RewindCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // IV's slow-mo dip on the shatter: the frame source hands the ONE clock a scaled step (a smooth ramp, never 0).
    frames: (fn: (dt: number) => void) => (o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)))((dt) => fn(dt * (seq && !seq.done ? rewindTimeScale(plan, c, seq.t) : 1))),
    safetyMs: o.safety !== false ? (plan.endAt + rewindSlowExtraMs(plan, c)) / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      for (const r of rows) r.reset();
      // The god, its halo, the clock face and the torrent leave with the sequence, so the scene drains.
      scene?.setGod(godAt, godH, godFlip, 0, 0, 0, false);
      scene?.setHalo(o.attacker, 0, 0, 0, 0, 0, false);
      scene?.setDial(centre, 0, 0, 0);
      scene?.setBolt(null);
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    path,
    scene,
    god: { at: godAt, h: godH, flip: godFlip },
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
