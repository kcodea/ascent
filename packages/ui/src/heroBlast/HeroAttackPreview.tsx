import { useEffect, useRef, useState } from 'react';
import { Application, type Container, type Ticker } from 'pixi.js';
import { sfx } from '../sfx';
import { stageScale } from '../stage';
import type { HeroAttackHandle, HeroAttackOptions } from '../heroAttack/options';
import { playHeroQuake } from '../heroQuake/heroQuake';
import { heroQuakePreviewSpeed } from '../heroQuake/heroQuakeConfig';
import { playHeroArcana } from '../heroArcana/heroArcana';
import { heroArcanaPreviewSpeed } from '../heroArcana/heroArcanaConfig';
import { playHeroBlades } from '../heroBlades/heroBlades';
import { heroBladesPreviewSpeed } from '../heroBlades/heroBladesConfig';
import { playHeroEnraged } from '../heroEnraged/heroEnraged';
import { heroEnragedPreviewSpeed } from '../heroEnraged/heroEnragedConfig';
import { playHeroPoison } from '../heroPoison/heroPoison';
import { heroPoisonPreviewSpeed } from '../heroPoison/heroPoisonConfig';
import { playHeroFrost } from '../heroFrost/heroFrost';
import { heroFrostPreviewSpeed } from '../heroFrost/heroFrostConfig';
import { playHeroHoly } from '../heroHoly/heroHoly';
import { heroHolyPreviewSpeed } from '../heroHoly/heroHolyConfig';
import { playHeroFire } from '../heroFire/heroFire';
import { heroFirePreviewSpeed } from '../heroFire/heroFireConfig';
import { playHeroUndead } from '../heroUndead/heroUndead';
import { heroUndeadPreviewSpeed } from '../heroUndead/heroUndeadConfig';
import { playHeroBeast } from '../heroBeast/heroBeast';
import { heroBeastPreviewSpeed } from '../heroBeast/heroBeastConfig';
import { playHeroBanana } from '../heroBanana/heroBanana';
import { heroBananaPreviewSpeed } from '../heroBanana/heroBananaConfig';
import { playHeroBleed } from '../heroBleed/heroBleed';
import { heroBleedPreviewSpeed } from '../heroBleed/heroBleedConfig';
import { playHeroCards } from '../heroCards/heroCards';
import { playHeroClaw } from '../heroClaw/heroClaw';
import { playHeroChess } from '../heroChess/heroChess';
import { heroCardsPreviewSpeed } from '../heroCards/heroCardsConfig';
import { heroClawPreviewSpeed } from '../heroClaw/heroClawConfig';
import { heroChessPreviewSpeed } from '../heroChess/heroChessConfig';
import { playHeroStorm } from '../heroStorm/heroStorm';
import { playHeroChord } from '../heroChord/heroChord';
import { playHeroFireworks } from '../heroFireworks/heroFireworks';
import { heroStormPreviewSpeed } from '../heroStorm/heroStormConfig';
import { heroChordPreviewSpeed } from '../heroChord/heroChordConfig';
import { heroFireworksPreviewSpeed } from '../heroFireworks/heroFireworksConfig';
import { playHeroCoin } from '../heroCoin/heroCoin';
import { playHeroAnvil } from '../heroAnvil/heroAnvil';
import { playHeroStamp } from '../heroStamp/heroStamp';
import { heroCoinPreviewSpeed } from '../heroCoin/heroCoinConfig';
import { heroAnvilPreviewSpeed } from '../heroAnvil/heroAnvilConfig';
import { heroStampPreviewSpeed } from '../heroStamp/heroStampConfig';
import { playHeroBoomerang } from '../heroBoomerang/heroBoomerang';
import { playHeroGlove } from '../heroGlove/heroGlove';
import { heroBoomerangPreviewSpeed } from '../heroBoomerang/heroBoomerangConfig';
import { heroGlovePreviewSpeed } from '../heroGlove/heroGloveConfig';
import { playHeroBubble } from '../heroBubble/heroBubble';
import { heroBubblePreviewSpeed } from '../heroBubble/heroBubbleConfig';
import { playHeroBackstab } from '../heroBackstab/heroBackstab';
import { playHeroFlick } from '../heroFlick/heroFlick';
import { heroBackstabPreviewSpeed } from '../heroBackstab/heroBackstabConfig';
import { heroFlickPreviewSpeed } from '../heroFlick/heroFlickConfig';
import { playHeroBasketball } from '../heroBasketball/heroBasketball';
import { heroBasketballPreviewSpeed } from '../heroBasketball/heroBasketballConfig';
import { playHeroBaseball } from '../heroBaseball/heroBaseball';
import { playHeroCombo } from '../heroCombo/heroCombo';
import { playHeroWrestle } from '../heroWrestle/heroWrestle';
import { heroBaseballPreviewSpeed } from '../heroBaseball/heroBaseballConfig';
import { heroComboPreviewSpeed } from '../heroCombo/heroComboConfig';
import { heroWrestlePreviewSpeed } from '../heroWrestle/heroWrestleConfig';
import { playHeroSoccer } from '../heroSoccer/heroSoccer';
import { playHeroPinball } from '../heroPinball/heroPinball';
import { playHeroTrain } from '../heroTrain/heroTrain';
import { heroSoccerPreviewSpeed } from '../heroSoccer/heroSoccerConfig';
import { heroPinballPreviewSpeed } from '../heroPinball/heroPinballConfig';
import { heroTrainPreviewSpeed } from '../heroTrain/heroTrainConfig';
import { playHeroVoid } from '../heroVoid/heroVoid';
import { heroVoidPreviewSpeed } from '../heroVoid/heroVoidConfig';
import { playHeroStitch } from '../heroStitch/heroStitch';
import { playHeroReaping } from '../heroReaping/heroReaping';
import { heroStitchPreviewSpeed } from '../heroStitch/heroStitchConfig';
import { heroReapingPreviewSpeed } from '../heroReaping/heroReapingConfig';
import { playHeroBulletTime } from '../heroBulletTime/heroBulletTime';
import { playHeroStars } from '../heroStars/heroStars';
import { playHeroGlass } from '../heroGlass/heroGlass';
import { playHeroWarhost } from '../heroWarhost/heroWarhost';
import { heroBulletTimePreviewSpeed } from '../heroBulletTime/heroBulletTimeConfig';
import { heroStarsPreviewSpeed } from '../heroStars/heroStarsConfig';
import { heroGlassPreviewSpeed } from '../heroGlass/heroGlassConfig';
import { heroWarhostPreviewSpeed } from '../heroWarhost/heroWarhostConfig';
import { playHeroBlast } from './heroBlast';
import { heroBlastPreviewSpeed } from './heroBlastConfig';
import './heroAttackPreview.css';
import { detachPixiDomEvents } from '../pixiNoDomEvents';
import { destroyPixiApp, guardAppRender } from '../pixiAppSafety';
import { PIXI_ANTIALIAS } from '../phoneArt';
import { phonePixiOptions, pixiAllowed } from '../phoneDiag';
import { followStage } from '../pixiStageFollow';

/** The styles the sandbox can play, and the runner for each (every runner takes the same options). */
const RUNNERS: Record<string, { play: (o: HeroAttackOptions & { textures?: null }) => HeroAttackHandle; speed: () => number }> = {
  blast: { play: (o) => playHeroBlast(o), speed: heroBlastPreviewSpeed },
  quake: { play: (o) => playHeroQuake(o), speed: heroQuakePreviewSpeed },
  arcana: { play: (o) => playHeroArcana(o), speed: heroArcanaPreviewSpeed },
  blades: { play: (o) => playHeroBlades(o), speed: heroBladesPreviewSpeed },
  enraged: { play: (o) => playHeroEnraged(o), speed: heroEnragedPreviewSpeed },
  poison: { play: (o) => playHeroPoison(o), speed: heroPoisonPreviewSpeed },
  frost: { play: (o) => playHeroFrost(o), speed: heroFrostPreviewSpeed },
  holy: { play: (o) => playHeroHoly(o), speed: heroHolyPreviewSpeed },
  fire: { play: (o) => playHeroFire(o), speed: heroFirePreviewSpeed },
  undead: { play: (o) => playHeroUndead(o), speed: heroUndeadPreviewSpeed },
  beast: { play: (o) => playHeroBeast(o), speed: heroBeastPreviewSpeed },
  banana: { play: (o) => playHeroBanana(o), speed: heroBananaPreviewSpeed },
  bleed: { play: (o) => playHeroBleed(o), speed: heroBleedPreviewSpeed },
  cards: { play: (o) => playHeroCards(o), speed: heroCardsPreviewSpeed },
  claw: { play: (o) => playHeroClaw(o), speed: heroClawPreviewSpeed },
  chess: { play: (o) => playHeroChess(o), speed: heroChessPreviewSpeed },
  storm: { play: (o) => playHeroStorm(o), speed: heroStormPreviewSpeed },
  chord: { play: (o) => playHeroChord(o), speed: heroChordPreviewSpeed },
  fireworks: { play: (o) => playHeroFireworks(o), speed: heroFireworksPreviewSpeed },
  coin: { play: (o) => playHeroCoin(o), speed: heroCoinPreviewSpeed },
  anvil: { play: (o) => playHeroAnvil(o), speed: heroAnvilPreviewSpeed },
  stamp: { play: (o) => playHeroStamp(o), speed: heroStampPreviewSpeed },
  boomerang: { play: (o) => playHeroBoomerang(o), speed: heroBoomerangPreviewSpeed },
  glove: { play: (o) => playHeroGlove(o), speed: heroGlovePreviewSpeed },
  bubble: { play: (o) => playHeroBubble(o), speed: heroBubblePreviewSpeed },
  backstab: { play: (o) => playHeroBackstab(o), speed: heroBackstabPreviewSpeed },
  flick: { play: (o) => playHeroFlick(o), speed: heroFlickPreviewSpeed },
  basketball: { play: (o) => playHeroBasketball(o), speed: heroBasketballPreviewSpeed },
  baseball: { play: (o) => playHeroBaseball(o), speed: heroBaseballPreviewSpeed },
  combo: { play: (o) => playHeroCombo(o), speed: heroComboPreviewSpeed },
  wrestle: { play: (o) => playHeroWrestle(o), speed: heroWrestlePreviewSpeed },
  soccer: { play: (o) => playHeroSoccer(o), speed: heroSoccerPreviewSpeed },
  pinball: { play: (o) => playHeroPinball(o), speed: heroPinballPreviewSpeed },
  train: { play: (o) => playHeroTrain(o), speed: heroTrainPreviewSpeed },
  void: { play: (o) => playHeroVoid(o), speed: heroVoidPreviewSpeed },
  stitch: { play: (o) => playHeroStitch(o), speed: heroStitchPreviewSpeed },
  reaping: { play: (o) => playHeroReaping(o), speed: heroReapingPreviewSpeed },
  bullettime: { play: (o) => playHeroBulletTime(o), speed: heroBulletTimePreviewSpeed },
  stars: { play: (o) => playHeroStars(o), speed: heroStarsPreviewSpeed },
  glass: { play: (o) => playHeroGlass(o), speed: heroGlassPreviewSpeed },
  warhost: { play: (o) => playHeroWarhost(o), speed: heroWarhostPreviewSpeed },
};

/**
 * THE HERO ATTACK SANDBOX (owner 2026-09-28: the Collection's "Attack Animations" tab gets a preview that plays the
 * animation in place). A small stage with your hero, the foe and two survivors; ▶ runs the REAL runner on it in the
 * box's own coordinates: the damage formation builds the blow, your hero charges, the box pushes in and shakes, the bolts fly.
 *
 * It owns a tiny Pixi Application of its own (the gameplay overlay is not mounted on the menus), created on the first
 * play and destroyed on unmount. The shared Blast textures are NOT destroyed with it (the gameplay layer reuses them).
 */
export function HeroAttackPreview({ style, reducedMotion }: { style: string; reducedMotion?: boolean }): JSX.Element {
  const stageRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<HTMLDivElement>(null);
  const youRef = useRef<HTMLDivElement>(null);
  const foeRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const app = useRef<Application | null>(null);
  const booting = useRef<Promise<Application | null> | null>(null);
  const live = useRef<HeroAttackHandle | null>(null);
  const gone = useRef(false);
  const [playing, setPlaying] = useState(false);

  // Mount / unmount (StrictMode mounts twice in dev: the body re-arms what the first cleanup disarmed).
  useEffect(() => { gone.current = false; return () => {
    gone.current = true;
    live.current?.cancel();
    live.current = null;
    if (app.current) destroyPixiApp(app.current, { children: true, texture: false }); // never destroy(true): pixiAppSafety.ts
    app.current = null;
    booting.current = null;
  }; }, []);

  const boot = (): Promise<Application | null> => {
    if (app.current) return Promise.resolve(app.current);
    if (booting.current) return booting.current;
    booting.current = (async () => {
      const host = pixiRef.current;
      if (!host) return null;
      try {
        if (!pixiAllowed()) return null; // phone diagnostics `nofx`: no canvas
        const a = new Application();
        await a.init(phonePixiOptions({ resizeTo: host, backgroundAlpha: 0, antialias: PIXI_ANTIALIAS, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) * stageScale(), preference: 'webgl' }, stageScale()));
        detachPixiDomEvents(a); // no Pixi DOM events: see pixiNoDomEvents.ts
        followStage(a); // phones: the renderer follows the stage's box + page scale (pixiStageFollow.ts)
        guardAppRender(a, 'heroAttackPreview');
        if (gone.current) { destroyPixiApp(a, { children: true, texture: false }); return null; }
        a.canvas.setAttribute('aria-hidden', 'true');
        host.appendChild(a.canvas);
        app.current = a;
        return a;
      } catch { return null; } // no WebGL: the numbers and the camera still play, just without bolts
    })();
    return booting.current;
  };

  const play = async (): Promise<void> => {
    sfx.pulse();
    live.current?.cancel();
    const runner = RUNNERS[style];
    if (!runner) return;
    const a = reducedMotion ? null : await boot();
    const stage = stageRef.current, you = youRef.current, foe = foeRef.current;
    if (gone.current || !stage || !you || !foe) return;
    // Host-local centres, measured once per play (offset* never forces a style flush on a static layout).
    const centre = (el: HTMLElement): { x: number; y: number } => ({ x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 });
    const aPt = centre(you), dPt = centre(foe);
    // A made-up board (this is a preview, not a fight): your hero's tier 3, two survivors of tier 2 and 4. Each number
    // rises off the top of its card, and the card itself pulses.
    const tiers = [2, 4];
    const minions = tiers.map((value, i) => {
      const el = cardRefs.current[i];
      return { value, at: el ? { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + 4 } : null, badges: el ? [el] : [] };
    });
    const full = 3 + tiers.reduce((s, v) => s + v, 0);
    setPlaying(true);
    live.current = runner.play({
      formation: { minions, hero: { value: 3 }, full, total: full, cap: null }, total: full, attacker: aPt, defender: dPt,
      side: 'player', defenderRadius: foe.offsetWidth / 2, attackerRadius: you.offsetWidth / 2, space: 'local', pixiScale: 0.42, host: stage, camera: stage, attackerEl: you, defenderEl: foe,
      reduced: reducedMotion || undefined, speed: runner.speed(),
      textures: a ? undefined : null,
      mount: a ? (c: Container) => { a.stage.addChild(c); return () => { a.stage.removeChild(c); }; } : () => () => {},
      frames: a
        ? (fn) => { const cb = (t: Ticker): void => fn(t.deltaMS); a.ticker.add(cb); return () => { a.ticker.remove(cb); }; }
        : undefined,
      onImpact: () => { /* the sandbox has no run: the Blast shows its own hit number */ },
      onDone: () => { live.current = null; if (!gone.current) setPlaying(false); },
    });
  };

  const known = style in RUNNERS;
  return (
    <div className="hapv">
      <div className="hapv-box">
        <div className="hapv-stage" ref={stageRef}>
          <div className="hapv-floor" aria-hidden />
          <div className="hapv-cards" aria-hidden>
            {[0, 1].map((i) => <div key={i} className="hapv-card" ref={(el) => { cardRefs.current[i] = el; }} />)}
          </div>
          <div className="hapv-hero you" ref={youRef} aria-hidden><span>You</span></div>
          <div className="hapv-hero foe" ref={foeRef} aria-hidden>
            <span>Foe</span>
          </div>
          <div className="hapv-pixi" ref={pixiRef} aria-hidden />
        </div>
      </div>
      <button
        type="button" className="colls-quiet pressable quiet hapv-play" disabled={!known || playing}
        onClick={() => { void play(); }} aria-label="Preview this hero attack"
      >
        {known ? (playing ? 'Playing' : '▶ Preview') : 'No preview'}
      </button>
    </div>
  );
}
