/**
 * THE WARHOST RUNNER ("Warhost", the Ancient of War; ANCIENT): plays one Warhost hero attack (the beats and the
 * staging are in `heroWarhostConfig.ts`) and lands the consequence on its impact beat. Presentation only: the total
 * and the blow are the engine's; this file only decides WHEN on screen they happen.
 *
 * A SILLY ARMY OF TINY SOLDIERS that gets more absurd and more powerful with every tier: Tier 1 one eager spearman who
 * trips on his face and throws anyway; Tier 2 a squad of archers and the one who ran the wrong way, whose late golden
 * arrow is the blow; Tier 3 two bickering mages (a fireball, a lightning bolt) and a cavalry charge; Tier 4 the whole
 * host with a drum line, five mages' barrage, three volleys darkening the sky, a flaming catapult boulder, a straggler,
 * and one tiny soldier planting a huge banner. The host always comes from the striker's side (every path is built from
 * the two portrait points), and its jitter is rolled from the blow's seed.
 *
 * EVERY BEAT HAS A SOUND: steps, the faceplant's clatter, tiny pitched-up voices ("Charge!", "Wait for me!"), the mages'
 * squeaky bickering, the rune circles igniting, each spell (a fireball's roar timed to peak as it lands, a frost
 * sparkle and shatter, lightning's crack and zap), the bowstrings and volleys, the horn, the drums and the march, the
 * ground RUMBLE (a synth) that builds as a charge crosses, the clash with a boom under it on the blow, the boulder's
 * whistle and crash, a thud per later row or rank, and the banner: a knock, a ground thud, the flag snapping open, and
 * the cheer of the ones who stayed.
 *
 * It runs on the SHARED hero-attack core (`../heroAttack/`): one clock (it never pauses; only the Knockout variant dips
 * it, through the frame source, never a freeze), the damage formation, the `#stage` camera (applied ONCE), the
 * portraits (transform only, restored after), the voices, the dim, reduced motion, finish / cancel and the safety timer.
 *
 * THE CONTRACT: every arrow before the last (II) is a tick (FX and sound only); every row or rank after the first (III,
 * IV) is a buffet (FX only). The consequence (`onImpact`) lands exactly ONCE: the spear, the last arrow, the point
 * rider, the front rank.
 *
 * Perf (docs/performance.md): DOM moves are `transform` / `opacity` from the clock; no layout reads after the opening
 * measure; every soldier's sprite is taken up front (during the formation), placed from the clock with no allocation;
 * one texture atlas, painted once per session and pre-warmed; the updater unhooks the moment the scene drains.
 */
import type { Container } from 'pixi.js';
import { pixiFx } from '../pixiFx';
import { playRumble } from '../sfx';
import { stageScale } from '../stage';
import { AttackVoices, type CueOpts } from '../heroAttack/attackSound';
import { playKoSting } from '../heroAttack/knockout';
import { DamageFormation, planFormation } from '../heroAttack/damageFormation';
import { withFormation, type FormationCue } from '../heroAttack/formationConfig';
import { easeInOutSine, hexToNum, prefersReducedMotion, spring } from '../heroAttack/easing';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { Sequence } from '../heroAttack/sequence';
import { heroFxCanvas, PortraitMover, StageCamera } from '../heroAttack/stageCamera';
import {
  WARHOST_SPEARMAN_SIZE, WARHOST_VOLLEY_LEAD_MS, WARHOST_VOLLEY_MS, getHeroWarhostConfig, warhostCameraAt, warhostCameraFocus, warhostCues, warhostPlan, warhostRumble, warhostScale,
  warhostSlowExtraMs, warhostStage,
  type HeroWarhostConfig, type WarhostCue, type WarhostPlan, type WarhostStage,
} from './heroWarhostConfig';
import { HeroWarhostScene, type HeroWarhostTextures } from './heroWarhostScene';
import { heroWarhostTextures } from './heroWarhostTextures';

export interface HeroWarhostOptions extends HeroAttackOptions {
  cfg?: HeroWarhostConfig;
  textures?: HeroWarhostTextures | null;
}

export interface HeroWarhostHandle extends HeroAttackHandle {
  readonly plan: WarhostPlan;
  readonly stage: WarhostStage;
  readonly scene: HeroWarhostScene | null;
  readonly mirrorsCamera: boolean;
}

/** The formation jitter's seed when the caller gives none: the same blow always fields the same host. */
export function warhostSeed(total: number, distance: number, side: 'player' | 'opp' | undefined): number {
  return (Math.round(total) * 7919 + Math.round(distance) * 31 + (side === 'opp' ? 613 : 17)) >>> 0;
}

/** A charge throws up its dust wall this often. */
const WALL_MS = 44;
/** The fireball clip's roar peaks this far in (measured): it is cued so the peak lands with the fireball. */
const FIRE_PEAK_MS = 397;

/** Play the Warhost. Returns a handle; the blow lands via `onImpact` on the impact beat. */
export function playHeroWarhost(o: HeroWarhostOptions): HeroWarhostHandle {
  const c = o.cfg ?? getHeroWarhostConfig();
  const reduced = o.reduced ?? prefersReducedMotion();
  const speed = o.speed && o.speed > 0 ? Math.min(4, Math.max(0.05, o.speed)) : 1;
  const sound = o.sound !== false;
  const local = o.space === 'local';
  const sideHex = o.side === 'opp' ? c.colorFoe : c.colorPlayer;
  const dist = Math.hypot(o.defender.x - o.attacker.x, o.defender.y - o.attacker.y);
  const { fcfg, fplan } = planFormation(o.formation, o.formationCfg, reduced);
  const plan = warhostPlan({ total: o.total, knockout: o.knockout, knockoutVariant: o.knockoutVariant, distance: dist, reduced, leadIn: fplan.endAt }, c);
  const cues = withFormation(fplan, warhostCues(plan));
  const s = o.pixiScale ?? (typeof window === 'undefined' ? 1 : stageScale());
  const doc = typeof document !== 'undefined' ? document : null;
  const radius = o.defenderRadius ?? 120 * s;
  const aRadius = o.attackerRadius ?? radius;
  const host = o.host !== undefined ? o.host : (doc ? doc.body : null);
  const voices = new AttackVoices(sound);
  const nums = new DamageFormation({
    data: o.formation, plan: fplan, beats: plan, cfg: fcfg, attacker: o.attacker, attackerRadius: o.attackerRadius,
    defender: o.defender, defenderRadius: o.defenderRadius, side: o.side, sideHex, local, host, scale: s, voices, className: 'hwarhost',
  });

  const vw = typeof window === 'undefined' ? 1920 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 1080 : window.innerHeight;
  const screen = local
    ? { x: Math.min(o.attacker.x, o.defender.x) - dist * 0.3, y: Math.min(o.attacker.y, o.defender.y) - dist * 0.3, w: Math.abs(o.attacker.x - o.defender.x) + dist * 0.6, h: Math.abs(o.attacker.y - o.defender.y) + dist * 0.6 }
    : { x: 0, y: 0, w: vw, h: vh };
  const seed = o.rollSeed ?? warhostSeed(o.total, dist, o.side);
  const stage = warhostStage(plan, o.attacker, o.defender, radius, aRadius, c, s, seed, screen);
  const u = stage.u, n = stage.n;
  const feet = { x: o.attacker.x, y: o.attacker.y + aRadius * 0.2 };
  /** IV: the banner planted on the struck portrait (its foot is where the plant's FX go). */
  const planted = stage.banners.find((b) => b.follow) ?? null;

  const textures = o.textures !== undefined ? o.textures : heroWarhostTextures();
  const scene = textures && !reduced
    ? new HeroWarhostScene(textures, { red: hexToNum(c.colorRed), brass: hexToNum(c.colorBrass), dust: hexToNum(c.colorDust), side: hexToNum(sideHex) }, {
      soldierPx: c.soldierPx, cavalryPx: c.cavalryPx, dust: c.dust, impactSize: c.impactSize, spellSize: c.spellSize,
    }, s, seed)
    : null;
  // Every soldier's sprite is taken now, while the damage formation still plays: nothing is made on a hot beat.
  scene?.deploy(stage);
  if (scene && !o.mount) void pixiFx.ensureAboveSlot();
  const unmount = scene ? (o.mount ?? ((ct: Container) => pixiFx.mountLayer(ct, 'above')))(scene.root) : null;

  const cameraEl = reduced ? null : (o.camera !== undefined ? o.camera : (doc?.getElementById('stage') ?? null));
  const cam = new StageCamera(cameraEl, scene, heroFxCanvas(o)); // the FX get the camera ONCE (stageCamera.ts)
  const hero = new PortraitMover(reduced ? null : (o.attackerEl ?? null));
  const foe = new PortraitMover(reduced ? null : (o.defenderEl ?? null));
  const cue = (clip: string, gain: number, rate: number, opts?: CueOpts): void =>
    voices.cue(clip, gain, rate * (0.85 + 0.15 * warhostScale(plan, seq ? seq.t : 0)), opts);
  voices.warm([
    c.sfxHornClip, c.sfxDrumClip, c.sfxChargeClip, c.sfxGallopClip, c.sfxLooseClip, c.sfxThunkClip, c.sfxWhooshClip, c.sfxThudClip, c.sfxBoomClip,
    c.sfxCheerClip, c.sfxVolleyClip, c.sfxClashClip, c.sfxFlapClip, c.sfxTripClip, c.sfxBickerClip, c.sfxRuneClip, c.sfxFireClip, c.sfxBurnClip,
    c.sfxFrostClip, c.sfxShatterClip, c.sfxZapClip, c.sfxCrackClip, c.sfxWhistleClip, c.sfxBoulderClip, c.sfxCryClip, c.sfxWaitClip,
  ]);
  /** A spell's sound plays once per school per landing moment (Tier 4's second round all lands at once: one roar). */
  const sounded: Record<string, number> = {};
  const once = (key: string, at: number): boolean => { if (sounded[key] === at) return false; sounded[key] = at; return true; };
  /** A few quick soft steps (the spearman running out, the archers jogging out or home). */
  const steps = (n: number, gapMs: number, gain = 0.16): void => { for (let i = 0; i < n; i++) cue(c.sfxThunkClip, c.sfxThunkGain * gain * (0.8 + 0.2 * (i % 2)), c.sfxThunkRate * (1.8 + 0.12 * (i % 3)), { startMs: 55, lenMs: 110, fadeMs: 60, delayMs: (i * gapMs) / speed }); };
  /**
   * THE GROUND RUMBLE under a charge (a synth, no clip): it builds as the charge crosses, holds while the rows or ranks
   * pass over the struck portrait, and dies after the last. Kept with the voices so a cancel stops it.
   */
  const rumble = (gain: number): void => {
    if (!sound || !(gain > 0)) return;
    try {
      voices.keep(playRumble('attack', { gain, buildMs: (plan.impactAt - plan.marchAt) / speed, holdMs: (plan.passAt - plan.impactAt) / speed, tailMs: 520 / speed, lowHz: 28, highHz: 240 }));
    } catch { /* no audio here */ }
  };
  /** The thunk's knock sits 87 ms into its clip: skip most of the lead so it lands on the beat. */
  const thunk = (gain: number, rate: number, lenMs = 360): void => cue(c.sfxThunkClip, c.sfxThunkGain * gain, c.sfxThunkRate * rate, { startMs: 55, lenMs, fadeMs: 120 });

  const fire = (q: WarhostCue | FormationCue): void => {
    if (q.kind === 'form') { nums.fire(fplan.beats[q.i]!); return; }
    switch (q.kind) {
      case 'charge':
        if (c.sfxDuck < 1) voices.duck(c.sfxDuck);
        cam.start();
        break;
      case 'trip': {
        // FLAT ON HIS FACE: a stumble and a clatter of tin, a low knock as he hits the ground, the view thumps.
        cue(c.sfxTripClip, c.sfxTripGain, c.sfxTripRate, { startMs: 80, fadeMs: 160 });
        thunk(0.45, 0.6, 200);
        const who = stage.troops[0];
        if (who?.via) scene?.trip(who.via, who.via.x >= who.p0.x ? 1 : -1, WARHOST_SPEARMAN_SIZE * 0.5);
        break;
      }
      case 'up':
        // He scrambles up and carries on (a quick whoosh, two hurried steps).
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.35, c.sfxWhooshRate * 1.5, { lenMs: 200, fadeMs: 120 });
        steps(3, 60, 0.45);
        break;
      case 'lost':
        // The one who ran the wrong way stops and looks about.
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.25, c.sfxWhooshRate * 1.7, { lenMs: 160, fadeMs: 100 });
        break;
      case 'turn':
        // "Wait for me!" (a tiny voice), and he sprints back.
        cue(c.sfxWaitClip, c.sfxWaitGain * (plan.kind === 'host' ? 0.6 : 1), c.sfxWaitRate * (plan.kind === 'host' ? 1.08 : 1));
        if (plan.kind === 'archers') steps(5, 55, 0.4);
        break;
      case 'late':
        // The straggler's golden arrow: one bowstring, a whistle in the air.
        cue(c.sfxLooseClip, c.sfxLooseGain, c.sfxLooseRate * 0.92);
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.7, c.sfxWhooshRate * 1.1, { lenMs: 360, fadeMs: 160, delayMs: 40 / speed });
        break;
      case 'mages':
        // The mages pop out (a bright little shimmer).
        cue(c.sfxRuneClip, c.sfxRuneGain * 0.45, c.sfxRuneRate * 1.4, { lenMs: 500, fadeMs: 250 });
        break;
      case 'bicker':
        cue(c.sfxBickerClip, c.sfxBickerGain, c.sfxBickerRate, { lenMs: Math.max(300, (plan.bickerEnd - plan.bickerAt + 150) * c.sfxBickerRate), fadeMs: 200 });
        break;
      case 'rune':
        // Their circles light up together.
        cue(c.sfxRuneClip, c.sfxRuneGain, c.sfxRuneRate, { tail: c.sfxTailMix });
        scene?.runesFlare();
        break;
      case 'cry':
        // "CHARGE!" in a tiny voice (on Tier 4 two of them, a beat apart).
        cue(c.sfxCryClip, c.sfxCryGain, c.sfxCryRate);
        if (plan.kind === 'host') cue(c.sfxCryClip, c.sfxCryGain * 0.75, c.sfxCryRate * 1.12, { delayMs: 110 / speed });
        break;
      case 'cast': {
        const sp = plan.spells[q.i]!, st = stage.spells[q.i];
        const flightMs = sp.landAt - sp.castAt;
        if (sp.school === 'fire') {
          // The roar is cued so its peak lands with the fireball.
          if (once('fire-cast-' + sp.round, sp.landAt)) {
            const lead = FIRE_PEAK_MS / c.sfxFireRate;
            cue(c.sfxFireClip, c.sfxFireGain, c.sfxFireRate, flightMs >= lead ? { delayMs: (flightMs - lead) / speed } : { startMs: FIRE_PEAK_MS - flightMs * c.sfxFireRate });
          }
        } else if (sp.school === 'frost') {
          if (once('frost-cast-' + sp.round, sp.landAt)) cue(c.sfxFrostClip, c.sfxFrostGain, c.sfxFrostRate, { lenMs: 520, fadeMs: 260 });
        } else if (sp.school === 'bolt') {
          if (once('bolt-cast-' + sp.round, sp.landAt)) cue(c.sfxCrackClip, c.sfxCrackGain, c.sfxCrackRate);
        } else cue(c.sfxWhistleClip, c.sfxWhistleGain, c.sfxWhistleRate, { lenMs: Math.max(300, flightMs * c.sfxWhistleRate), fadeMs: 200 });
        if (st && st.caster >= 0) scene?.castFlash(st.from, sp.school);
        break;
      }
      case 'spell': {
        const sp = plan.spells[q.i]!, st = stage.spells[q.i];
        if (once(sp.school + '-land', sp.landAt)) {
          if (sp.school === 'fire') cue(c.sfxBurnClip, c.sfxBurnGain, c.sfxBurnRate);
          else if (sp.school === 'frost') cue(c.sfxShatterClip, c.sfxShatterGain, c.sfxShatterRate);
          else if (sp.school === 'bolt') cue(c.sfxZapClip, c.sfxZapGain, c.sfxZapRate);
          else {
            // THE BOULDER lands: the crash of rock and earth with a ground thud under it.
            cue(c.sfxBoulderClip, c.sfxBoulderGain, c.sfxBoulderRate, { tail: c.sfxTailMix, fadeMs: 400 });
            cue(c.sfxThudClip, c.sfxThudGain * 0.8, c.sfxThudRate * 0.7, { lenMs: 900, fadeMs: 400 });
          }
        }
        if (st) scene?.spellHit(sp.school, st.to, radius, sp.round === 2 ? 1.25 : 1);
        break;
      }
      case 'drum':
        // The war drums: each a little lower and louder than the last, and each sooner (the plan quickens them).
        cue(c.sfxDrumClip, c.sfxDrumGain * (0.7 + 0.1 * q.i), c.sfxDrumRate * (1 - 0.03 * q.i), { tail: c.sfxTailMix });
        if (q.i >= 2) cue(c.sfxThudClip, c.sfxThudGain * 0.3, c.sfxThudRate * 0.8, { lenMs: 420, fadeMs: 200 });
        scene?.drum(feet, aRadius, Math.min(2, q.i));
        break;
      case 'horn':
        // III: a quick call over the charge. IV: the long deep one after the drums.
        if (plan.kind === 'host') {
          cue(c.sfxHornClip, c.sfxHornGain, c.sfxHornRate * 0.94, { tail: c.sfxTailMix });
          // A drum roll under the horn, running into the charge.
          for (let i = 0; i < 3; i++) cue(c.sfxDrumClip, c.sfxDrumGain * 0.4, c.sfxDrumRate * 1.2, { lenMs: 240, fadeMs: 120, delayMs: (60 + i * 75) / speed });
        } else cue(c.sfxHornClip, c.sfxHornGain * 0.85, c.sfxHornRate * 1.1, { lenMs: 1150, fadeMs: 350 });
        scene?.horn(o.attacker, u, aRadius);
        break;
      case 'march':
        if (plan.kind === 'cavalry') {
          // Hooves (twice, overlapping, so they run the whole way across), a war cry, and the ground rumbling.
          cue(c.sfxGallopClip, c.sfxGallopGain, c.sfxGallopRate);
          cue(c.sfxGallopClip, c.sfxGallopGain * 0.8, c.sfxGallopRate * 0.92, { delayMs: 520 / speed });
          cue(c.sfxChargeClip, c.sfxChargeGain * 0.5, c.sfxChargeRate * 1.15, { lenMs: 1100, fadeMs: 400 });
          rumble(c.sfxRumbleGain * 0.75);
        } else if (plan.kind === 'host') {
          // THE HOST: the massed roar (twice, overlapping, so it lasts the crossing and the trample), hooves on the
          // flanks, the ground rumbling, and a marching drum under it all.
          cue(c.sfxChargeClip, c.sfxChargeGain, c.sfxChargeRate);
          cue(c.sfxChargeClip, c.sfxChargeGain * 0.9, c.sfxChargeRate * 0.93, { delayMs: 800 / speed, fadeMs: 400 });
          cue(c.sfxGallopClip, c.sfxGallopGain * 0.6, c.sfxGallopRate * 0.9);
          cue(c.sfxGallopClip, c.sfxGallopGain * 0.5, c.sfxGallopRate * 0.85, { delayMs: 700 / speed });
          rumble(c.sfxRumbleGain);
          // The drum line's marching beat under it all.
          for (let i = plan.drums.length, j = 0; i < plan.beats.length; i++, j++) {
            cue(c.sfxDrumClip, c.sfxDrumGain * 0.42, c.sfxDrumRate * (j % 2 ? 1.12 : 0.96), { lenMs: 300, fadeMs: 150, delayMs: Math.max(0, plan.beats[i]! - plan.marchAt) / speed });
          }
        } else steps(plan.kind === 'spear' ? 4 : 6, plan.kind === 'spear' ? 70 : 50, plan.kind === 'spear' ? 0.5 : 0.4);
        break;
      case 'arrive':
        if (plan.kind === 'spear') {
          // He plants his feet (a low knock) and winds up.
          thunk(0.35, 0.8, 160);
          const who = stage.troops[0]; if (who) for (let i = 0; i < 3; i++) scene?.puff(who.p1.x + (i - 1) * 8 * s, who.p1.y - 2 * s, 1.2);
        } else {
          // The line halts (a stamp) and the bows come up: a low creak of the draw through the held beat.
          thunk(0.3, 0.7, 160);
          cue(c.sfxLooseClip, c.sfxLooseGain * 0.35, c.sfxLooseRate * 0.5, { delayMs: 60 / speed });
          cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.4, c.sfxWhooshRate * 0.55, { lenMs: 300, fadeMs: 160, delayMs: 90 / speed });
        }
        break;
      case 'loose':
        if (plan.kind === 'spear') {
          cue(c.sfxWhooshClip, c.sfxWhooshGain, c.sfxWhooshRate, { lenMs: 320, fadeMs: 140 });
          cue(c.sfxLooseClip, c.sfxLooseGain * 0.5, c.sfxLooseRate * 0.7); // the snap of the throw
        } else {
          // The bowstrings (twice), then the VOLLEY: the hiss of the arrows in the air and their patter going in,
          // placed so the patter starts as the first arrow lands.
          cue(c.sfxLooseClip, c.sfxLooseGain, c.sfxLooseRate);
          cue(c.sfxLooseClip, c.sfxLooseGain * 0.7, c.sfxLooseRate * 1.12, { delayMs: 90 / speed });
          cue(c.sfxVolleyClip, c.sfxVolleyGain, c.sfxVolleyRate, { delayMs: Math.max(0, (plan.lands[0] ?? plan.impactAt) - plan.looseAt - WARHOST_VOLLEY_LEAD_MS) / speed });
        }
        break;
      case 'volley':
        // IV: a volley goes up over the host (the bowstrings), hisses overhead and patters down round the target.
        cue(c.sfxLooseClip, c.sfxLooseGain * 0.75, c.sfxLooseRate * (0.95 + 0.08 * q.i));
        cue(c.sfxVolleyClip, c.sfxVolleyGain * 0.85, c.sfxVolleyRate * (1 + 0.06 * q.i), { delayMs: Math.max(0, WARHOST_VOLLEY_MS - WARHOST_VOLLEY_LEAD_MS) / speed });
        break;
      case 'hit': {
        // One arrow of the rain: every other one knocks (a patter, not a wall of noise).
        if (q.i % 2 === 0) thunk(0.3, 1.35 + 0.06 * ((q.i / 2) % 4), 180);
        scene?.arrowTick(stage.shots[q.i]?.to ?? stage.strike);
        break;
      }
      case 'impact':
        // Every blow has a low body under its own sound.
        if (plan.tier === 1) { thunk(1, 1); cue(c.sfxThudClip, c.sfxThudGain * 0.4, c.sfxThudRate * 1.4, { lenMs: 420, fadeMs: 200 }); }
        else if (plan.tier === 2) { thunk(0.9, 1.1); cue(c.sfxThudClip, c.sfxThudGain * 0.6, c.sfxThudRate * 1.3, { lenMs: 500, fadeMs: 200 }); }
        else if (plan.tier === 3) {
          // The wedge striking: a heavy body hit, a boom under it, and the clatter of steel and shields.
          cue(c.sfxThudClip, c.sfxThudGain, c.sfxThudRate * 0.95, { tail: c.sfxTailMix, lenMs: 900, fadeMs: 350 });
          cue(c.sfxBoomClip, c.sfxBoomGain * 0.6, c.sfxBoomRate * 1.15, { lenMs: 900, fadeMs: 350 });
          cue(c.sfxClashClip, c.sfxClashGain * 0.75, c.sfxClashRate * 1.1, { lenMs: 1000, fadeMs: 400 });
          thunk(0.6, 0.8);
        } else {
          // The host striking: the boom, the body hit, and the full clash of the charge going in.
          cue(c.sfxBoomClip, c.sfxBoomGain, c.sfxBoomRate, { tail: c.sfxTailMix, lenMs: 1600, fadeMs: 600 });
          cue(c.sfxThudClip, c.sfxThudGain * 1.2, c.sfxThudRate * 0.8, { tail: c.sfxTailMix, lenMs: 1100, fadeMs: 400 });
          cue(c.sfxClashClip, c.sfxClashGain, c.sfxClashRate, { tail: c.sfxTailMix, fadeMs: 300 });
          thunk(0.5, 0.7);
        }
        scene?.impact(o.defender, stage.strike, u, radius, plan.tier);
        // THE KNOCKOUT: the prismatic shock and the sting.
        if (plan.ko) { scene?.koFlourish(o.defender, radius); playKoSting(voices, sound, (ms) => ms / speed); }
        seq.land();
        break;
      case 'buffet':
        cue(c.sfxThudClip, c.sfxThudGain * 0.55, c.sfxThudRate * (1.15 + 0.04 * q.i), { lenMs: 420, fadeMs: 180 });
        thunk(0.35, 0.62 + 0.05 * (q.i % 3), 200);
        scene?.buffet(o.defender, radius, plan.kind === 'host' ? 1 : 0.7);
        break;
      case 'cheer':
        // Tier 1, Tier 2: one man's tiny cheer (the crowd clip pitched up, quiet, short). Tier 4: the ones who stayed.
        if (plan.kind === 'spear' || plan.kind === 'archers') cue(c.sfxCheerClip, c.sfxCheerGain * 0.4, c.sfxCheerRate * 1.25, { startMs: 200, lenMs: 800, fadeMs: 360 });
        else cue(c.sfxCheerClip, c.sfxCheerGain * (plan.ko ? 1.2 : 1), c.sfxCheerRate, { lenMs: Math.max(700, (plan.endAt - plan.cheerAt - 60) * c.sfxCheerRate), fadeMs: 260 });
        break;
      case 'plant':
        // THE BANNER GOES IN: the pole biting (a knock and a ground thud with a boom under it), then the flag
        // snapping open.
        thunk(1, 0.7);
        cue(c.sfxThudClip, c.sfxThudGain, c.sfxThudRate * 0.85, { tail: c.sfxTailMix, lenMs: 800, fadeMs: 350 });
        cue(c.sfxDrumClip, c.sfxDrumGain * 0.9, c.sfxDrumRate * 0.8, { tail: c.sfxTailMix });
        cue(c.sfxFlapClip, c.sfxFlapGain, c.sfxFlapRate, { delayMs: 70 / speed });
        cue(c.sfxWhooshClip, c.sfxWhooshGain * 0.6, c.sfxWhooshRate * 0.7, { lenMs: 420, fadeMs: 200, delayMs: 40 / speed });
        scene?.plant(planted ? planted.at : { x: o.defender.x, y: o.defender.y + radius * 0.35 }, radius);
        break;
      case 'home':
        // I, II: running home.
        steps(plan.kind === 'spear' ? 4 : 6, plan.kind === 'spear' ? 70 : 50, 0.3);
        break;
      default:
        break;
    }
  };

  // ── the per-frame paint ──
  const flip = stage.face;
  const dimOut = plan.kind === 'host' ? plan.plantAt + c.bannerMs * 0.5 : plan.kind === 'cavalry' ? plan.passAt + 160 : plan.impactAt + 200;
  const knockK = c.knockPx * (0.7 + 0.4 * plan.k);
  // The rolling dust wall under a charge: thrown up every `WALL_MS` along the front as it crosses (never on a seek).
  const charge = plan.kind === 'host' || plan.kind === 'cavalry';
  const chargeV = dist / Math.max(1, plan.impactAt - plan.marchAt);
  const wallHalf = (plan.kind === 'host' ? c.hostWidthPx * 0.5 : c.cavalryPx * 2.4) * s;
  let nextWall = plan.marchAt;
  let lastT = -1;
  const wallPt = { x: 0, y: 0 };
  const dustWall = (t: number): void => {
    if (!scene || !charge || t < nextWall || t > plan.passAt) return;
    nextWall = t + WALL_MS;
    if (lastT < 0 || t - lastT > 120) return; // a jump (finish / a hitch): do not dump a wall of dust in one frame
    const reach = chargeV * (t - plan.marchAt);
    const k = Math.min(1, reach / Math.max(1, dist));
    // The host funnels as it nears the target; behind the target the wall stays over it (the trample's dust).
    const half = wallHalf * (plan.kind === 'host' ? 1 - (1 - c.funnel) * k : 1);
    const along = Math.min(reach, dist);
    wallPt.x = o.attacker.x + u.x * along; wallPt.y = o.attacker.y + u.y * along;
    scene.dustWall(wallPt, u, n, half, plan.kind === 'host' ? 5 : 4, plan.kind === 'host' ? 1 : 1.1);
    // The body of the host kicks up its own, further back.
    if (plan.kind === 'host' && reach > dist * 0.25) {
      wallPt.x = o.attacker.x + u.x * along * 0.55; wallPt.y = o.attacker.y + u.y * along * 0.55;
      scene.dustWall(wallPt, u, n, wallHalf * 0.9, 2, 0.8);
    }
  };

  const paintStage = (t: number): void => {
    if (plan.reduced) return;
    nums.paintDim(t, plan.chargeAt, plan.marchAt, dimOut);
    const cm = warhostCameraAt(plan, c, t, u);
    const unit = local ? 1 : s;
    cam.apply(warhostCameraFocus(plan, t, o.attacker, o.defender), cm.zoom, cm.x, cm.y, unit);
    const px = local ? 0.45 : 1;
    if (hero.el && t >= plan.chargeAt) {
      // The send-off: a lean back through the ready, a thrust as the troops go; each war drum thumps it.
      let bx = 0, by = 0, sc = 1;
      const lean = t < plan.marchAt ? easeInOutSine((t - plan.chargeAt) / Math.max(1, plan.marchAt - plan.chargeAt)) : Math.max(0, spring(t - plan.marchAt, 3, 90));
      bx -= u.x * c.heroWindPx * px * lean; by -= u.y * c.heroWindPx * px * lean;
      const rot = -2.5 * flip * lean;
      if (t >= plan.marchAt) { const f = c.heroThrowPx * px * Math.max(0, spring(t - plan.marchAt, 5, 60)); bx += u.x * f; by += u.y * f; }
      for (let i = 0; i < plan.drums.length; i++) { const at = plan.drums[i]!; if (t >= at) sc += (0.06 + 0.012 * i) * Math.max(0, spring(t - at, 4, 80)); }
      // Tier 1: the hero CRINGES as his recruit hits the ground (a squash and a wince).
      let wince = 0;
      if (plan.tripAt >= 0 && t >= plan.tripAt + 80) { wince = Math.max(0, spring(t - plan.tripAt - 80, 2.2, 160)); sc -= 0.05 * wince; }
      const hrot = rot + 4 * flip * wince;
      const still = Math.abs(bx) + Math.abs(by) < 0.05 && Math.abs(hrot) < 0.01 && Math.abs(sc - 1) < 1e-4;
      hero.set(still ? null : `translate(${bx.toFixed(2)}px, ${by.toFixed(2)}px) rotate(${hrot.toFixed(3)}deg) scale(${sc.toFixed(4)})`);
    }
    // The struck portrait: ticked by each arrow, knocked by the blow, knocked ABOUT by every row and rank after it, and
    // shuddering under the trample.
    let fx = 0, fy = 0, rot = 0, sq = 0;
    for (const at of plan.hits) if (t >= at) { const k = Math.max(0, spring(t - at, 6, 40)) * 3 * px; fx += u.x * k; fy += u.y * k; }
    // Each spell that lands before the blow knocks it (frost makes it shiver).
    for (let i = 0; i < plan.spells.length; i++) {
      const sp = plan.spells[i]!;
      if (sp.landAt >= plan.impactAt || t < sp.landAt) continue;
      const since = t - sp.landAt;
      const k = Math.max(0, spring(since, 5, 60)) * 8 * px;
      fx += u.x * k; fy += u.y * k;
      if (sp.school === 'frost') fx += Math.sin(since * 0.3) * 3.5 * px * Math.exp(-since / 220);
    }
    if (t >= plan.impactAt) {
      // A charge hits like a wall (a slower, longer spring) and BATTERS the portrait: every later row or rank throws
      // it to one side and back, tips it and squashes it again, and it shudders under the feet the whole time.
      const k = charge ? spring(t - plan.impactAt, 3.4, 130) : spring(t - plan.impactAt, 4.5, 90);
      fx += u.x * knockK * k * px; fy += u.y * knockK * k * px;
      sq = c.squash * (0.8 + 0.4 * plan.k) * k;
      rot += 3 * flip * k * (0.5 + plan.k);
      for (let i = 0; i < plan.buffets.length; i++) {
        const at = plan.buffets[i]!;
        if (t < at) break;
        const bs = spring(t - at, 5, 80);
        const b = bs * knockK * 0.7 * px;
        const side = i % 2 ? 1 : -1;
        fx += (u.x * 0.5 + n.x * side * 0.8) * b; fy += (u.y * 0.5 + n.y * side * 0.8) * b;
        rot += side * 4.2 * bs;
        sq += c.squash * 0.5 * Math.max(0, bs);
      }
      const r = charge ? warhostRumble(plan, t) : 0;
      if (r > 0) { const amp = (plan.kind === 'host' ? 6 : 3.5) * r * px; fx += Math.sin(t * 0.11) * amp; fy += Math.sin(t * 0.17 + 1) * amp * 0.8; }
      // The banner going in drives the portrait down, and it rocks as the flag snaps open.
      if (plan.plantAt >= 0 && t >= plan.plantAt) { const ps = spring(t - plan.plantAt, 4, 90); fy += 13 * px * ps; rot += -2.2 * flip * ps; sq += c.squash * 0.7 * Math.max(0, ps); }
    }
    const still = Math.abs(fx) + Math.abs(fy) < 0.05 && Math.abs(rot) < 0.02 && Math.abs(sq) < 4e-4;
    foe.set(still ? null : `translate(${fx.toFixed(2)}px, ${fy.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${(1 - sq).toFixed(4)}, ${(1 + sq * 0.6).toFixed(4)})`);
    if (scene) { scene.setFoeOffset(fx * unit, fy * unit); dustWall(t); scene.paint(t); }
    lastT = t;
  };

  const seq: Sequence<WarhostCue | FormationCue> = new Sequence<WarhostCue | FormationCue>({
    cues, speed, fire,
    paint: (t) => { nums.paint(t); paintStage(t); },
    scene, unmount,
    // The Knockout's slow-mo dip: the frame source hands the ONE clock a scaled step (a smooth ramp, never 0).
    frames: (fn: (dt: number) => void) => (o.frames ?? ((f: (dt: number) => void) => pixiFx.addUpdater(f)))((dt) => fn(dt * (seq && !seq.done ? warhostScale(plan, seq.t) : 1))),
    safetyMs: o.safety !== false ? (plan.endAt + warhostSlowExtraMs(plan)) / speed + 2500 : null,
    onImpact: o.onImpact, onDone: o.onDone,
    teardownDom: () => {
      nums.remove(); cam.reset(); hero.reset(); foe.reset(); voices.unduck();
      scene?.retire();
    },
    stopVoices: () => voices.stopAll(),
  });

  return {
    plan,
    stage,
    scene,
    get mirrorsCamera() { return cam.mirrorsCamera; },
    elapsed: () => seq.t,
    get impacted() { return seq.impacted; },
    get done() { return seq.done; },
    finish: () => seq.finish(),
    cancel: () => seq.cancel(),
  };
}
