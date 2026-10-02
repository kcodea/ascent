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
 *  - `banana` is the twelfth (`attack_banana`, "Oona's Banana Cannon" until the owner renames it; owner ask
 *    2026-09-29: "i would love a king oona banana cannon animation", rebuilt the same day on King Oona's own painted card
 *    FX): her painted bananas spin out of the hero on high arcs and burst into her painted juice splats (I one, II a
 *    double, III a barrage of eight), and IV lands a giant golden banana stuck in the target that the striking hero
 *    slams in six times, juice flying, until it bursts (`../heroBanana/`).
 *  - `bleed` is the thirteenth (`attack_bleed`, "Hemorrhage" until the owner renames it; owner ask 2026-09-29: "a bleed/gash
 *    animation ... use the same 4 tier strategy"): crimson crescents fly in and cut gashes that open and bleed (I one
 *    diagonal, II a cross, III a flurry ending in a claw rake); IV throbs with a heartbeat, splits the screen with a
 *    mega-slash and erupts in a blood nova (`../heroBleed/`).
 *  - `cards` is the first EPIC (`attack_cards`, "Card Shark" until the owner renames it; owner ask 2026-09-29: "build 5
 *    animations that range from rare -> epic ... rare and epics should only have 2 or 3 tiers"): the hero deals playing
 *    cards with a snap. Three looks, not four: one Ace flicked spinning into the target; three Aces thrown thunk thunk
 *    thunk; and a royal flush dealt into a fanned hand, flipped, turned gold and fired together into a burst of card
 *    confetti (`../heroCards/`).
 *  - `storm` is the second EPIC (`attack_storm`, "Storm Call" until the owner renames it; same ask): a crackling bolt
 *    arcs from the hero with a zap; a forked bolt strikes twice and leaves the portrait jittering with static; and a
 *    small storm cloud gathers over the target and drops a thick lightning strike (`../heroStorm/`).
 *
 * THE RARES (owner ask 2026-09-29: "build 5 animations that range from rare -> epic ... rare and epics should only have
 * 2 or 3 tiers to them and generally be less exciting, but still extremely clean and fun"). A Rare has TWO visual tiers:
 * the shared I-II play Small, III-IV play Big (so a knockout, which forces IV, plays Big). Each maps that inside its own
 * config. Names are the builder's placeholders for the owner to rename (the ids stay):
 *  - `coin` (`attack_coin`, "Pocket Change"): a gleaming gold coin flicked spinning (a flat turn plus an edge-on flip)
 *    pings off the target with a bright ding; Big ricochets it off the face twice more and it bursts into a small shower
 *    of coins (`../heroCoin/`).
 *  - `boomerang` (`attack_boomerang`, "Come Back Around"): a carved wooden boomerang whirls out on a curve, thwacks the
 *    target and curves back to the hero, who catches it; Big throws two on crossing paths, a double thwack, both caught
 *    (`../heroBoomerang/`).
 *  - `bubble` (`attack_bubble`, "Bubble Trouble"): an iridescent soap bubble wobbles out, drifts to the target, engulfs
 *    its face and POPS into droplets and tiny bubbles; Big blows a stream of little ones first, then one big bubble that
 *    swells round the portrait and pops with a splash ring (`../heroBubble/`).
 *  - `backstab` (`attack_backstab`, "Shadow Step"; owner ask 2026-09-29: "portrait fades and attacks from behind the
 *    target back towards the player portrait and settles"): the striking PORTRAIT fades into smoke, steps out behind the
 *    target and stabs back toward home, then smokes back and settles; Big lunges first, vanishes, strikes from the side,
 *    vanishes again and strikes from behind (`../heroBackstab/`).
 *
 * `basketball` is the fourteenth Legendary (`attack_basketball`, "Nothing But Net" until the owner renames it; owner ask
 * 2026-09-29: "make a basketball attack animation"): the striking PORTRAIT plays ball. I a jump shot from where it
 * stands that swishes through a net on the target; II a fadeaway (a slide to mid court, a fade back to one side, a high
 * arc, swish); III a pull-up three (a scoot up court, a pass from off the right edge, a pump fake, a dribble back, a long
 * swish); IV a self alley-oop (fired off the backboard over the target, bounced high, caught at the top of a leap and
 * slammed down into an explosion; the backboard shatters). A whistle, dribbles, sneaker squeaks,
 * the swish, the rim and a crowd "ooh" (`../heroBasketball/`).
 *
 * `stitch` is the first attack BUILT at the Ancient rarity (`attack_soul_stitch`, "Soul Stitch"; owner ask 2026-10-02,
 * for the Ancient of Bonds: "this ancient binds things together and using soulbindings"): crystal needles on violet soul
 * thread stitch the struck hero to the striker. I a needle pierces, the thread hangs taut, a tug and the snap; II three
 * needles cross-stitch an X and the threads snap through; III five pins stab in at the points of a star and the target
 * is stretched toward the hero until they rip out; IV the heroes laced together, the target dragged into a gold heart-knot that
 * ties shut and bursts as it is flung home (`../heroStitch/`).
 * `bullettime` is the first ANCIENT attack built for its rarity (`attack_bullet_time`, "Bullet Time", the Ancient of Time;
 * owner 2026-10-02 picked "BULLET TIME" after three rewind builds): STOPPED TIME, the shots hang in the air. I a gold
 * clock-hand dart stops an inch from the target, then time resumes; II three stop in a ring round it; III a volley freezes
 * mid-flight in a spiral and the hero snaps; IV time stops for the whole board, dozens of blades hang in a dome while a
 * clock counts 3-2-1, then the dome collapses in one massive impact (`../heroBulletTime/`).
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

export const HERO_ATTACK_STYLES = ['classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast', 'banana', 'bleed', 'cards', 'storm', 'coin', 'boomerang', 'bubble', 'backstab', 'basketball', 'stitch', 'bullettime'] as const;
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
export const DEV_HERO_ATTACK_CHOICES = ['auto', 'classic', 'blast', 'quake', 'arcana', 'blades', 'enraged', 'poison', 'frost', 'holy', 'fire', 'undead', 'beast', 'banana', 'bleed', 'cards', 'storm', 'coin', 'boomerang', 'bubble', 'backstab', 'basketball', 'stitch', 'bullettime'] as const;
export type DevHeroAttackChoice = (typeof DEV_HERO_ATTACK_CHOICES)[number];

/** The dev "Attack style" row's labels, shared by every hero attack tuner. */
export const DEV_HERO_ATTACK_LABELS: Record<DevHeroAttackChoice, string> = {
  auto: 'Auto (equipped cosmetic)', classic: 'Classic (lunge)', blast: 'Blast', quake: 'Quake', arcana: 'Arcana', blades: 'Phantom Blades', enraged: 'Enraged Strike',
  poison: 'Venom Volley (poison darts)', frost: 'Frost Nova', holy: 'Consecration', fire: 'Inferno', undead: 'Grave Call', beast: 'Stampede (beast chomp rush)', banana: 'Banana Cannon', bleed: 'Hemorrhage (bleed)',
  cards: 'Card Shark (Epic)', storm: 'Storm Call (Epic)',
  coin: 'Pocket Change (coin, Rare)', boomerang: 'Come Back Around (boomerang, Rare)', bubble: 'Bubble Trouble (bubble, Rare)',
  backstab: 'Shadow Step (backstab, Rare)',
  basketball: 'Nothing But Net (basketball)',
  stitch: 'Soul Stitch (Ancient)',
  bullettime: 'Bullet Time (Ancient of Time)',
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
