/**
 * HERO SELECT — difficulty rating + a one-line strategic tip (owner copy 2026-08-20).
 *
 * Shown under the portrait on the play-mode hero card, and swapped out for the hero-power text while the card
 * is hovered — so an unhovered row reads as "how hard is this, and what is the idea", and hovering answers
 * "what does the button actually do".
 *
 * Kept in its OWN module rather than as fields on `HeroDef`: `heroes.ts` is a chokepoint both devs edit, and
 * this is advisory copy with no engine meaning — nothing in the simulation reads it. Coverage is deliberately
 * OPTIONAL (`heroTip` returns undefined), so a hero with no entry renders no pill rather than an empty one;
 * `heroTips.test.ts` reports which heroes are uncovered so the gap stays visible instead of going unnoticed.
 */

/**
 * Whether the hero card shows the TIP line under the difficulty pill.
 *
 * OFF by owner call 2026-08-20: the pills ship, the tips stay written but hidden until we decide to turn them
 * on. Deliberately a flag rather than deleted copy — the 47 tips are authored, tested and covered, so hiding
 * them is a one-line flip in both directions instead of a re-write. The difficulty pill is unaffected.
 */
export const SHOW_HERO_TIPS = false;

/** How demanding the hero is to PILOT — not how strong it is. */
export type HeroDifficulty = 'Easy' | 'Medium' | 'Hard';

export interface HeroTip {
  difficulty: HeroDifficulty;
  /** One sentence of strategic guidance. Player-facing prose; no markdown. */
  tip: string;
}

export const HERO_TIPS: Readonly<Record<string, HeroTip>> = {
  warden: { difficulty: 'Easy', tip: 'Put Ward on a minion you expect to keep; every additional Ward makes Aegis’s board-wide scaling more valuable.' },
  indy: { difficulty: 'Easy', tip: 'Save Masterwork for a defining engine or generation effect.' },
  myra: { difficulty: 'Medium', tip: 'Pulse a Shout that generates resources or permanent scaling.' },
  soren: { difficulty: 'Hard', tip: 'Reclaim a valuable Echo or summon payoff.' },
  rohan: { difficulty: 'Medium', tip: 'Utilize Reflector to generate economy or tempo.' },
  nadja: { difficulty: 'Easy', tip: 'Nadja’s curve is unique. It is best to Goldspring for at least the first 4 turns to ramp up your economy.' },
  cassen: { difficulty: 'Hard', tip: 'Use commissions to gain economy early, and higher tier minion discovers past Tier 3.' },
  drakko: { difficulty: 'Easy', tip: 'Buy useful Shout minions early; temporary Shouts still advance Drumline before being sold.' },
  robin: { difficulty: 'Hard', tip: 'Cycle expendable minions before ending your turn to bank more Gold for the next Shop.' },
  darah: { difficulty: 'Hard', tip: 'Swapping Shouts is a common practice. Creative play can be extremely rewarding.' },
  risen: { difficulty: 'Easy', tip: 'Give Rise to an important Echo, Rally engine, or exposed utility minion.' },
  gildmaster: { difficulty: 'Easy', tip: 'Hold strong pairs when possible, then use Gildcrafter when the completed Gilded effect meaningfully advances your build.' },
  discodan: { difficulty: 'Medium', tip: 'If you can build towards your discovers, do so. Otherwise, use them as tempo for fast leveling.' },
  brackus: { difficulty: 'Medium', tip: 'Build with your Tier 7 in mind.' },
  baggerben: { difficulty: 'Easy', tip: 'Delay All In while stable, but cash out before waiting costs you a combat you could have won.' },
  hermithank: { difficulty: 'Hard', tip: 'Exploit cheap minions through cycling and economy; do not follow a normal leveling schedule with increased upgrade costs.' },
  fi: { difficulty: 'Medium', tip: 'Favor a Lesser Quest that complements your current board without forcing an early tribal commitment.' },
  runesmith: { difficulty: 'Medium', tip: 'Select a Rune that improves your current line or opens several directions, since the early board is still fluid.' },
  runeguard: { difficulty: 'Medium', tip: 'Use the early Epic Forge to establish an engine other heroes cannot access until later.' },
  coran: { difficulty: 'Hard', tip: 'Choose a late Quest that multiplies an existing engine rather than starting an entirely new build on turn 10.' },
  tiff: { difficulty: 'Easy', tip: 'Buy Dragons and spells before using Dragon Tamer so the Discover costs as little as possible.' },
  jenkins: { difficulty: 'Easy', tip: 'Use Dynamite Dig after tiering up to get cheap higher tier minions.' },
  repete: { difficulty: 'Hard', tip: 'Before every third End of Turn, move the card you most want copied into the left-most hand position.' },
  gorr: { difficulty: 'Medium', tip: 'Plan turns around buying at least three minions. Later you can prioritize the minion purchases to target doubles/triples.' },
  merrin: { difficulty: 'Easy', tip: 'Use Pocket Magic to round out curve and generate cheap high quality spells in late game.' },
  gambler: { difficulty: 'Easy', tip: 'Always roll on turn 1. If you roll a 1, do not roll on turn 2. Otherwise, roll whenever you can.' },
  xerox: { difficulty: 'Medium', tip: 'Holding out to copy a huge carry minion is great. Sometimes it’s worth it to copy just for a triple of a strong engine as well.' },
  frank: { difficulty: 'Easy', tip: 'Use clearance every turn.' },
  pete: { difficulty: 'Easy', tip: 'Track every third refresh and enter it with enough Gold to capitalize on the upgraded right-most offer.' },
  flint: { difficulty: 'Easy', tip: 'Cycle Dwarves aggressively. You can play any comp, but Dwarves generate early tempo and economy for you.' },
  vale: { difficulty: 'Hard', tip: 'Lean menagerie early for tempo. Commit if you find strong menagerie scaling.' },
  quillen: { difficulty: 'Hard', tip: 'Archive types deliberately to find pieces for your comp.' },
  hunch: { difficulty: 'Hard', tip: 'Spell casting order is important! Cast whatever spell you want to keep in your Rounded Spellbook, last.' },
  emeraldwarden: { difficulty: 'Easy', tip: 'Tier up on schedule to convert each upgrade into both long-term access and immediate board tempo.' },
  underdweller: { difficulty: 'Medium', tip: 'Hero power most turns, as it is at least a cheap body early on. Later it can uncover premium cards.' },
  albus: { difficulty: 'Medium', tip: 'Use Empowerment on Turn 1 and freeze the shop. Continue until you hit a core minion or a strong T6.' },
  devourer: { difficulty: 'Medium', tip: 'Reduce the number of possible recipients before using Devour if you need the consumed stats to land somewhere specific.' },
  flash: { difficulty: 'Easy', tip: 'Use First or Last every turn early to build a wide board for early tempo.' },
  midas: { difficulty: 'Hard', tip: 'Midas tends to make builds around specific engines much stronger. Look for Sylus or Drakko comps to find multiplicative scaling.' },
  juggler: { difficulty: 'Easy', tip: 'Carnival Coin will add some tempo and economy as you play normally.' },
  membrance: { difficulty: 'Hard', tip: 'Use Memory after facing a board with valuable engines or utility, not simply the opponent with the largest stats.' },
  bram: { difficulty: 'Easy', tip: 'Typically use Investment from Turn 1, timing it to use it after tiering up to 3.' },
  aevor: { difficulty: 'Medium', tip: 'Nothing happens for the first fifteen kills — build a board that trades often and the End-of-Turn gift compounds on your two flanks all run.' },
  gorun: { difficulty: 'Easy', tip: 'Every swing sharpens the swinger. Wide boards and Windfury bodies bank attacks fastest, and the grant keeps climbing all game.' },
  fibbsy: { difficulty: 'Easy', tip: 'Two coins a turn become four Rubies — pour them onto Kobolds and Ruby-hungry minions, or bank the stats board-wide.' },
  cindara: { difficulty: 'Hard', tip: 'Your own minions dying is the engine. Cheap bodies feed the Avenge, and every Whelp you have ever summoned grows together.' },
  rayse: { difficulty: 'Medium', tip: 'Every token, Echo body and Start-of-Combat fill lands bigger and Taunted. Summon-heavy warbands get the most out of her.' },
  mimic: { difficulty: 'Hard', tip: 'A new power every turn rewards knowing the whole roster. Pick for THIS turn, not the run.' },
  voidhero: { difficulty: 'Hard', tip: 'Turn 4 hands you two powers for the run — pick a pair that compounds, not two copies of the same idea.' },
  cia: { difficulty: 'Hard', tip: 'Lucky Seat passively adds economy and utility. Don’t over-prioritize the enchanted cards, though.' },
  odelle: { difficulty: 'Hard', tip: 'Reorder your board before playing each minion so Exhibition lands between three distinct types as often as possible.' },
  harlan: { difficulty: 'Medium', tip: 'Use Buyout for huge tempo swings in the early game, and for economy later.' },
  sable: { difficulty: 'Hard', tip: 'Put your two intended carries at the edges, activate Soulbind, then funnel repeated buffs into whichever is easier to target.' },
  keshi: { difficulty: 'Easy', tip: 'Higher-tier purchases advance Keshi’s Crown faster, so combine natural buying with timely Shop upgrades.' },
};

/** The tip for a hero, or undefined when none is authored (the card then shows no pill at all). */
export function heroTip(id: string | undefined): HeroTip | undefined {
  return id ? HERO_TIPS[id] : undefined;
}
