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
import { heroCardsPreviewSpeed } from '../heroCards/heroCardsConfig';
import { playHeroStorm } from '../heroStorm/heroStorm';
import { heroStormPreviewSpeed } from '../heroStorm/heroStormConfig';
import { playHeroCoin } from '../heroCoin/heroCoin';
import { heroCoinPreviewSpeed } from '../heroCoin/heroCoinConfig';
import { playHeroBoomerang } from '../heroBoomerang/heroBoomerang';
import { heroBoomerangPreviewSpeed } from '../heroBoomerang/heroBoomerangConfig';
import { playHeroBubble } from '../heroBubble/heroBubble';
import { heroBubblePreviewSpeed } from '../heroBubble/heroBubbleConfig';
import { playHeroBackstab } from '../heroBackstab/heroBackstab';
import { heroBackstabPreviewSpeed } from '../heroBackstab/heroBackstabConfig';
import { playHeroBlast } from './heroBlast';
import { heroBlastPreviewSpeed } from './heroBlastConfig';
import './heroAttackPreview.css';

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
  storm: { play: (o) => playHeroStorm(o), speed: heroStormPreviewSpeed },
  coin: { play: (o) => playHeroCoin(o), speed: heroCoinPreviewSpeed },
  boomerang: { play: (o) => playHeroBoomerang(o), speed: heroBoomerangPreviewSpeed },
  bubble: { play: (o) => playHeroBubble(o), speed: heroBubblePreviewSpeed },
  backstab: { play: (o) => playHeroBackstab(o), speed: heroBackstabPreviewSpeed },
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
    app.current?.destroy(true, { children: true, texture: false });
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
        const a = new Application();
        await a.init({ resizeTo: host, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2) * stageScale(), preference: 'webgl' });
        if (gone.current) { a.destroy(true, { children: true, texture: false }); return null; }
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
