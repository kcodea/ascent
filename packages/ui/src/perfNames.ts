import { CARD_INDEX } from '@game/content';
import type { Subject } from './perfDiagnose';

/**
 * IN-GAME NAMES FOR THE PERF HUD (owner ask 2026-08-30: *"id love the performance hud to use in-game names
 * and call outs for effects and jank frames etc if possible so it's easy for us to diagnose issues"*).
 *
 * The monitor's labels are addresses, not names — `reduce:play:dw_foreman`, `fx:weldBatch`, `view:board`.
 * They are the right thing to RECORD (stable, greppable, cheap to build in a hot path) and the wrong thing to
 * READ. "Playing **dw_foreman** took 41 ms" makes you go and look the id up; "Playing **Dwarf Foreman** took
 * 41 ms" tells you which card to suspect while you still remember the turn it happened on.
 *
 * This module is the translation layer, and it lives OUTSIDE `perfDiagnose` deliberately: the diagnosis engine
 * stays a pure function of buckets with no content dependency (that is what makes its 28 tests cheap and
 * hermetic), and naming is applied at the edge, where the content index is already loaded.
 *
 * Anything unrecognised falls through to the raw label rather than being hidden or guessed at. An unnamed
 * hotspot you can still grep for beats a prettified one that points nowhere.
 */

/**
 * Reducer actions in the words the game uses for them.
 *
 * Phrased as "-ing" fragments so they drop into the report's existing sentence frame ("Resolving X took…").
 * Only actions worth NAMING are here: the rest keep their action id, which is already close to English.
 */
const ACTION_NAMES: Record<string, string> = {
  roll: 'rolling the Shop',
  buy: 'buying a card',
  sell: 'selling a minion',
  play: 'playing a card',
  freeze: 'freezing the Shop',
  tavernUp: 'upgrading the Shop',
  endTurn: 'ending the turn',
  resolveCombat: 'resolving the combat',
  settleCombat: 'settling the combat',
  faceOmen: 'drawing the next opponent',
  heroPower: 'using the hero power',
  buyRune: 'taking a Rune',
  rerollRuneforge: 're-rolling the Runeforge',
  buyQuest: 'taking a Quest',
  skipRuneforge: 'skipping the Runeforge',
  reposition: 'reordering the warband',
  discover: 'a Discover pick',
};

/**
 * The engine's own measured blocks, in plain English. These are NOT gameplay — they are the renderer and the
 * run loop — and saying so is the useful part: it tells the reader immediately that no card is to blame.
 */
const CODE_NAMES: Record<string, string> = {
  'view:board': 'building the board view',
  'view:hand': 'building the hand view',
  'layout:flip': 'the board re-layout (FLIP)',
  'layout:handglide': 'the hand glide',
  'drag:flushMove': 'the drag move handler',
  'odds:deferred': 'the combat-odds probe',
  autosave: 'the autosave',
  'recruit:moment cues': 'the moment cues',
  'fx:weldBatch': 'the FX weld batch',
  'render:recruit': 'the recruit-screen render',
};

/**
 * The SHORT form, for the HUD's hotspot rows — plain text, no markdown, no parenthetical id.
 *
 * The HUD is a narrow panel read at a glance while playing; the report is prose read afterwards. The report
 * can afford "**Packstrider** (b2_packstrider, on playing a card)". A HUD row has about twenty characters
 * before it wraps, so it gets "Packstrider · play" and nothing else.
 */
export function shortName(label: string): string {
  if (label.startsWith('fx:')) {
    const id = label.slice(3);
    return CODE_NAMES[label] ? effectName(id) : `${effectName(id)} fx`;
  }
  if (label.startsWith('reduce:')) {
    const rest = label.slice(7);
    const i = rest.indexOf(':');
    if (i > 0) {
      const action = rest.slice(0, i);
      const name = cardName(rest.slice(i + 1));
      return name ? `${name} · ${action}` : rest;
    }
    return ACTION_NAMES[rest] ?? rest;
  }
  const named = CODE_NAMES[label];
  // Strip the namespace prefix as a last resort: `layout:flip` → `flip` still beats the full address.
  return named ?? (label.includes(':') ? label.slice(label.indexOf(':') + 1) : label);
}

/** `dw_foreman` → `Dwarf Foreman`, when the pool knows it. */
export function cardName(cardId: string): string | undefined {
  return CARD_INDEX[cardId]?.name;
}

/**
 * An FX definition id as something readable: `titan-hammer` / `titan_hammer` → `Titan Hammer`.
 *
 * FX ids have no display name anywhere to look up — they are authored strings — so this is a de-kebabbing
 * rather than a lookup, and it is honest about that: it never invents words, it only re-spaces and capitalises
 * the ones already in the id.
 */
export function effectName(id: string): string {
  const words = id.split(/[-_.:]+/).filter(Boolean);
  if (!words.length) return id;
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}

/**
 * The display label for one subject — the string the HUD and the report actually print.
 *
 * A CARD keeps its id alongside its name (`**Dwarf Foreman** (dw_foreman, on playing a card)`), because the
 * name is what you recognise and the id is what you grep for; dropping either one costs the reader a step.
 */
export function displaySubject(sub: Subject, rawLabel: string): string {
  if (sub.kind === 'card') {
    const name = cardName(sub.id);
    // The action rides in the raw label after `reduce:` — recover it rather than re-parsing the subject.
    const action = rawLabel.startsWith('reduce:') ? rawLabel.slice(7).split(':')[0] ?? '' : '';
    const doing = ACTION_NAMES[action] ?? (action ? `\`${action}\`` : '');
    if (!name) return sub.label;                       // unknown id — keep the raw form, still greppable
    return `**${name}**${doing ? ` (${sub.id}, on ${doing})` : ` (${sub.id})`}`;
  }
  if (sub.kind === 'mechanic') {
    const named = ACTION_NAMES[sub.id];
    return named ? `**${named}**` : sub.label;
  }
  if (sub.kind === 'effect') return `the **${effectName(sub.id)}** effect (\`fx:${sub.id}\`)`;
  // code: the engine's own blocks, named where we know them.
  const named = CODE_NAMES[sub.id];
  return named ? `**${named}** (\`${sub.id}\`)` : sub.label;
}

/** The phase names players use, for the by-phase table and the spike annotations. */
const PHASE_NAMES: Record<string, string> = {
  recruit: 'Shop', combat: 'Combat', gameover: 'Game over', victory: 'Victory',
};
export const phaseName = (p: string): string => PHASE_NAMES[p] ?? p;
