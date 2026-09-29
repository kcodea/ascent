/**
 * WHICH HERO ATTACK PLAYS at the end of a won combat.
 *
 * Owner 2026-09-28: first "branch off and make a new attack animation", then "the new blast attack is going to be a
 * cosmetic unlock, not a new default". EVERY style opens with the same damage formation (owner ask 2026-09-28,
 * `../heroAttack/damageFormation.ts`): minion tiers pulse left to right and merge, the hero tier joins, the full blow,
 * the cap. So:
 *  - `classic` is everyone's default: after the damage formation the hero wears the blow on its attack pill and
 *    lunges into the loser (`choreo/heroStrike.ts`).
 *  - `blast` is the first `hero_attack` COSMETIC (`attack_blast`, "Arcane Barrage" until the owner renames it): the hero
 *    charges, the view pushes in and shakes, and Pixi bolts
 *    carry the blow (`heroBlast.ts`).
 *  - `quake` is the second (`attack_quake`, "Tectonic Slam" until the owner renames it; owner ask 2026-09-28: "an
 *    earthquake attack essentially with varying degrees of strength/cracks/explosions"): the hero
 *    slams the ground, a quake cracks across the board and the ground erupts under the target (`../heroQuake/`).
 *  - `arcana` is the third (`attack_arcana`, "Arcana"; owner ask 2026-09-28: "one more attack animation, same setup as
 *    the last 2, but let's make like a magic one called arcana"): clean magic ribbons are
 *    lobbed from the hero (one, two, a barrage of five), and the top tier swirls them into a vortex over the target that
 *    explodes outward (`../heroArcana/`).
 *  - `blades` is the fourth (`attack_blades`, "Phantom Blades"; owner ask 2026-09-28: "make a new style animation and
 *    surprise me with it ... make it unique"): spectral swords are summoned round the hero, swing
 *    round to aim, lock, and are loosed in dead-straight thrusts that stick in the target and shatter; the top tier
 *    brings down a greatsword (`../heroBlades/`).
 *  - `enraged` is the fifth (`attack_enraged`, "Enraged Strike" until the owner renames it; owner ask 2026-09-28: "a
 *    legendary version of this strike ... just amplified or enraged"): Classic's own lunge, enraged. The hero burns with
 *    a rage aura, dashes in leaving afterimages and strikes with white-hot impacts and claw rips; II strikes twice, III a
 *    flurry of three, and IV rises and slams down like a meteor (`../heroEnraged/`).
 *  - `poison` is the sixth (`attack_poison`, "Venom Volley" until the owner renames it; owner ask 2026-09-28: "make a
 *    poison dart animation. the final one should throw multiple poison darts that implode with poison"): small, sleek
 *    poison darts flicked on a slight arc, thunking in and sticking at varied angles with venom splashes; II two, III a
 *    fan of five, and IV sticks six that swell, implode into one point and burst in a toxic cloud (`../heroPoison/`).
 *  - `frost` is the seventh (`attack_frost`, "Frost Nova" until the owner renames it; owner ask 2026-09-28: "icicles
 *    and then a frost nova blast that blasts across the screen from the attacker to the target"): icicles crystallise
 *    round the hero and fire (I one, II two, III a volley of five), shattering and leaving frost creeping over the
 *    portrait; IV adds a frost nova that rolls across the screen, encases the target in ice and shatters (`../heroFrost/`).
 *  - `holy` is the eighth (`attack_holy`, "Consecration" until the owner renames it; owner ask 2026-09-28: "a holy
 *    weapon + consecration attack"): a golden sigil and a pillar of light smite the target; II smites twice, III rains
 *    light spears that plant consecration seeds, and IV brings a huge holy sword down into the middle of the board and a
 *    consecration races from it to erupt under the target (`../heroHoly/`).
 *  - `fire` is the ninth (`attack_fire`, "Inferno" until the owner renames it; owner ask 2026-09-29: "we need a fire
 *    animation ... it should look like live flame/fires pixi sprites"): fireballs of live particle fire ignite round the
 *    hero and are hurled (I one, II two, III a volley of five that sets the struck hero ablaze), and IV calls down a
 *    meteor that detonates into a fire nova and engulfs the target, burning out to embers and smoke (`../heroFire/`).
 *  - `undead` is the tenth (`attack_undead`, "Grave Call" until the owner renames it; owner ask 2026-09-29: "some sort
 *    of an undead animation"): a spectral skull shrieks out of the hero and bites the target (I one, II two weaving in);
 *    III skeletal hands claw up round the target and drag at it while a swarm of ghost wisps strikes, then a skull
 *    finishes it; IV a grave rift tears open, a giant skull maw rises out of it, shrieks, lunges and chomps the target,
 *    and a wave of necrotic mist washes out (`../heroUndead/`).
 *  - `beast` is the eleventh (`attack_beast`, "Stampede" until the owner renames it; owner ask 2026-09-29: "a beast chomp
 *    rush animation"): spirit beasts leap from the hero and front jaws chomp shut on the target (I one wolf, II a
 *    staggered pair, III a pack of five kicking up dust), and IV raises a colossal beast whose jaws slam over the whole
 *    portrait before it roars (`../heroBeast/`).
 *
 * The style is the ATTACKER's: the equipped item recorded in the striking player's cosmetic snapshot (yours when you
 * win; the foe's seat snapshot when they win, and only while "Show opponent cosmetics" is on). The catalog item names
 * its animation in `assets.style`; an unknown, retired or unrecognised item plays Classic.
 *
 * Every style is PRESENTATION ONLY. The damage, the Armor absorb and the Resolve drop are the engine's; a style only
 * decides how that already-decided blow is drawn, and it lands the consequence on its impact beat.
 *
 * The DEV override (the Blast tuner's "Attack style" row) forces a style for both sides in dev builds only, for
 * previewing. Production ignores it; there is no player-facing style setting outside the Collection.
 */
import { heroAttackOf } from '@game/progression';

export const HERO_ATTACK_STYLES = ['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast'] as const;
export type HeroAttackStyle = (typeof HERO_ATTACK_STYLES)[number];

/** What a player without an equipped hero attack sees (owner 2026-09-28: Blast is a cosmetic, not a new default). */
export const DEFAULT_HERO_ATTACK_STYLE: HeroAttackStyle = 'classic';

const isStyle = (v: unknown): v is HeroAttackStyle => typeof v === 'string' && (HERO_ATTACK_STYLES as readonly string[]).includes(v);

/** The style a `hero_attack` cosmetic id plays, or null when it is not a live hero attack this client knows. */
export function styleOfCosmetic(id: string | null | undefined): HeroAttackStyle | null {
  if (!id) return null;
  const def = heroAttackOf({ heroAttack: id });
  const style = def?.assets.style;
  return isStyle(style) ? style : null;
}

/** The dev override: `auto` = what a player would see; the others force one style for BOTH sides. */
export const DEV_HERO_ATTACK_CHOICES = ['auto', 'classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast'] as const;
export type DevHeroAttackChoice = (typeof DEV_HERO_ATTACK_CHOICES)[number];

/** The dev "Attack style" row's labels, shared by every hero attack tuner. */
export const DEV_HERO_ATTACK_LABELS: Record<DevHeroAttackChoice, string> = {
  auto: 'Auto (equipped cosmetic)', classic: 'Classic (lunge)', blast: 'Blast', quake: 'Quake', arcana: 'Arcana', blades: 'Phantom Blades', enraged: 'Enraged Strike',
  poison: 'Venom Volley (poison darts)', frost: 'Frost Nova', holy: 'Consecration', fire: 'Inferno', undead: 'Grave Call', beast: 'Stampede (beast chomp rush)',
};

const KEY = 'ascent.heroattackstyle';
const isChoice = (v: unknown): v is DevHeroAttackChoice => typeof v === 'string' && (DEV_HERO_ATTACK_CHOICES as readonly string[]).includes(v);

let devChoice: DevHeroAttackChoice = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return 'auto';
  try {
    const v = localStorage.getItem(KEY);
    return isChoice(v) ? v : 'auto';
  } catch { return 'auto'; }
})();

/** The dev override in force. Always `auto` in production. */
export function devHeroAttackChoice(): DevHeroAttackChoice { return import.meta.env.DEV ? devChoice : 'auto'; }

export function setDevHeroAttackChoice(v: string): void {
  if (!isChoice(v)) return;
  devChoice = v;
  if (!import.meta.env.DEV) return;
  try {
    if (v === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch { /* ignore */ }
}

export interface HeroAttackStyleContext {
  /** Which side is striking (whose cosmetic applies). */
  attacker: 'player' | 'opp';
  /** The attacker's equipped `hero_attack` cosmetic id, from their recorded snapshot (already opponent-gated). */
  attackerCosmeticId?: string | null;
  /** Override the dev choice (tests). */
  devChoice?: DevHeroAttackChoice;
}

/** The style this blow plays: the dev override, else the attacker's cosmetic, else Classic. */
export function resolveHeroAttackStyle(ctx: HeroAttackStyleContext): HeroAttackStyle {
  const dev = ctx.devChoice ?? devHeroAttackChoice();
  if (dev !== 'auto') return dev;
  return styleOfCosmetic(ctx.attackerCosmeticId) ?? DEFAULT_HERO_ATTACK_STYLE;
}
