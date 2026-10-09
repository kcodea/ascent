/**
 * LOBBY RAIL GUIDES (owner ask 2026-10-09): short build guides the player can flip the lobby rail to mid-game.
 *
 * DATA, not JSX. Each guide is ONE build line (owner 2026-10-09: "each line should have its own card"), grouped by tribe in data
 * order. Each names its set, its tribe(s) (empty = neutral, always shown), a title, a one-line
 * tagline for the collapsed card, the body paragraph, and two rows of card ids: the build's CORE units and its
 * common ENABLERS. `guides.test.ts` fails a guide whose card id does not resolve, or resolves to a card that is
 * not in the guide's set, so a rename or a set move can never leave a guide pointing at nothing.
 *
 * WHICH GUIDES SHOW (owner ruling 2026-10-09): only this game's set, and only guides whose tribe is in this lobby.
 * Neutral guides always show. `pairsWith` is display only: a second tribe chip the card wears when that tribe is
 * also in the lobby (the Kobold line's Dwarven Ale crossover); it never decides visibility.
 *
 * PLACEHOLDERS: the guides the owner has not written yet (all but Sunmane, Oona, Dragonflame, Shout Dragons and Ale,
 * as of 2026-10-09) are placeholders until the owner writes it. Its body starts
 * with PLACEHOLDER_BODY so it reads as unfinished, and its core / enabler picks are a best guess from the owner's
 * name hints, there so the layout can be judged.
 */
import type { Tribe } from '@game/core';
import type { SetId } from '@game/content';

export interface Guide {
  id: string;
  set: SetId;
  /** The tribes this guide is for. Empty = a neutral guide (always shown). */
  tribes: readonly Tribe[];
  /** A crossover tribe, shown as a second chip when it is also in the lobby. Never gates visibility. */
  pairsWith?: readonly Tribe[];
  /** The card whose ART stands for this guide on its row (owner ask 2026-10-09). Any card id with art, tokens and
   *  spells included (the Ale line wears Golden Ale), so the owner can repoint it. */
  iconCard: string;
  title: string;
  tagline: string;
  body: string;
  core: readonly string[];
  enablers: readonly string[];
  /** Other cards the body names (owner 2026-10-09: Eyes of Aresmar in the Shout Dragons write-up). Not shown as
   *  portraits; only their names in the body become hoverable highlights, like the core and enabler names. */
  mentions?: readonly string[];
  /** Body words that stand for a card under a shorter name than its printed one ("Oona" for King Oona), so they
   *  highlight too. Word → card id; the id must also be in core, enablers or mentions. */
  aliases?: Readonly<Record<string, string>>;
}

/** The Guides view's display mode: SIMPLE = the normal-width rail, portraits only; FULL = the wide rail + write-up. */
export type GuidesMode = 'simple' | 'full';

export const PLACEHOLDER_BODY = 'Guide coming soon.';

export const GUIDES: readonly Guide[] = [
  {
    id: 'set2-beast-sunmane',
    iconCard: 'b2_sunmane',
    set: 'set2',
    tribes: ['beast'],
    title: 'Sunmane',
    tagline: 'Rally Attack into the pack, in combat.',
    // The owner's text (2026-10-09), typo fixes only ("propegate", card-name capitals).
    body: "Sunmane comp relies on great positioning in order to propagate the Sunmane's rally attack effect to fresh bodies to multiplicatively stack its attack effect. The comp is simple in that it really only relies on 2 minions, but you need summons to protect your Solaris from dying early. Attack immediately related Rune support helps take this comp to the next level.",
    core: ['b2_sunmane', 'b2_solaris'],
    enablers: ['b2_sunmane'], // owner listed Sunmane as both Core and Enabler (2026-10-09), kept as given
  },
  {
    id: 'set2-beast-oona',
    iconCard: 'b2_oona',
    set: 'set2',
    tribes: ['beast'],
    title: 'Oona',
    tagline: 'Double every Beast summoned in combat.',
    // The owner's text, verbatim (2026-10-09). "Oona" is King Oona.
    body: 'Oona comp utilizes various Beast buffs to then multiply their stat gains using Oona. Look out for early enablers and commit once you find Grim and Oona, or Sylus.',
    core: ['b2_oona', 'grim', 'b2_florida'],
    enablers: ['b2_armadiyo', 'b2_bullseye', 'b2_beardsley'],
    mentions: ['sylus'],
    aliases: { oona: 'b2_oona' },
  },
  {
    id: 'set2-dragon-breath',
    iconCard: 'sp_dragonflame',
    set: 'set2',
    tribes: ['dragon'],
    title: 'Dragonflame',
    tagline: 'Cast Dragonflame again and again.',
    // The owner's text, verbatim (2026-10-09).
    body: 'Dragonflame comp uses in-combat Dragonflame casts that scale with spell power to buff your Dragons over and over. Transcendant allows these buffs to carry through combat. Spell power buffs are very important if you want to win with this comp, and a gilded Transcendant further multiplies its stat gain potential.',
    core: ['d2_warflame', 'd2_transcendence'],
    enablers: ['d2_felconjurer', 'd2_flamebeat', 'd2_chorus'],
    mentions: ['sp_dragonflame'],
  },
  {
    id: 'set2-dragon-shout',
    iconCard: 'karwind', // was Orivax, who is no longer in the guide (2026-10-09)
    set: 'set2',
    tribes: ['dragon'],
    title: 'Shout Dragons',
    tagline: 'Stack Shout triggers to grow your Dragons.',
    // The owner's text, verbatim (2026-10-09).
    body: 'Shout Dragons is an APM comp that has extremely high tempo, but a difficult time scaling into late game without Rune support or multiple Gilded Karwinds. Look for Eyes of Aresmar late game to Gild Karwinds, and cycle using Drakko and any token creation methods to go full APM.',
    core: ['karwind', 'drummer', 'd2_voicekeeper'],
    enablers: ['karwind', 'd2_roarcollector'], // owner's list ended in a trailing comma (2026-10-09): may be unfinished
    mentions: ['aresmar'],
  },
  {
    id: 'set2-kobold-combat',
    iconCard: 'k_deepdelve',
    set: 'set2',
    tribes: ['kobold'],
    title: 'In-combat',
    tagline: 'Rubies cast in combat hit twice as hard.',
    body: PLACEHOLDER_BODY,
    core: ['k_deepdelve'],
    enablers: ['k_blazer', 'k_tunnelcharger', 'k_kobabyboldies'],
  },
  {
    id: 'set2-kobold-mountainbond',
    iconCard: 'dw_mountainbond',
    set: 'set2',
    tribes: ['kobold'],
    pairsWith: ['dwarf'],
    title: 'APM Mountainbond',
    tagline: 'Spend Gold to rain Rubies.',
    body: PLACEHOLDER_BODY,
    core: ['dw_mountainbond'],
    enablers: ['k_mineralmaster', 'dw_pimm', 'k3_jeweler'],
  },
  {
    id: 'set2-dwarf-ale',
    iconCard: 'wo_mine',
    set: 'set2',
    tribes: ['dwarf'],
    title: 'Ale',
    tagline: 'Brew Ales, then cast them twice.',
    // The owner's text, verbatim (2026-10-09).
    body: 'The Ale line revolves around generating Dwarven Ales using Tapkeeper and using Edward Keg-Hands to multiply all Dwarven Ale casts. Core units: Edward Keg-Hands and Tapkeeper. Common Enablers: Drakko, Brunni, Blade Thrower.',
    core: ['dw_edward', 'dw_tapkeeper'],
    enablers: ['drummer', 'dw_brunni', 'dw_bladethrower'],
  },
  {
    id: 'set2-dwarf-spend',
    iconCard: 'dw_billings',
    set: 'set2',
    tribes: ['dwarf'],
    title: 'APM / Spend',
    tagline: 'Every Gold spent grows your Dwarves.',
    body: PLACEHOLDER_BODY,
    core: ['dw_billings', 'dw_coinfire'],
    enablers: ['dw_pimm', 'dw_dorrin', 'ropewrangler'],
  },
  {
    id: 'set2-demon-consume',
    iconCard: 'dm_glutton',
    set: 'set2',
    tribes: ['demon'],
    title: 'Consume',
    tagline: 'Feed the Shop to your Demons.',
    body: PLACEHOLDER_BODY,
    core: ['dm_glutton', 'dm_jumbo'],
    enablers: ['dm_agent', 'dm_gourmand', 'dm_grevlin'],
  },
  {
    id: 'set2-demon-imps',
    iconCard: 'impscrap',
    set: 'set2',
    tribes: ['demon'],
    title: 'Imps',
    tagline: 'Swarm the board with buffed Imps.',
    body: PLACEHOLDER_BODY,
    core: ['dm_todd', 'dm_shepherd'],
    enablers: ['impoverseer', 'dm_knocked', 'brood'],
  },
  {
    id: 'set2-neutral-paragon',
    iconCard: 'n2_paragon',
    set: 'set2',
    tribes: [],
    title: 'Paragon Rally comp',
    tagline: 'Rally into a minion of every type.',
    body: PLACEHOLDER_BODY,
    core: ['n2_paragon', 'n2_standardbearer'],
    enablers: ['uron', 'tauntbreaker'],
  },
];

/** A tribe's INK for text and accents: its `--t-<tribe>` token, except Dragon (white, so the rune cards' warm coral)
 *  and Neutral (the rune cards' soft gold). Owner ask 2026-10-09: "color the tribe names so they stand out". */
export function tribeInk(t: Tribe): string {
  if (t === 'dragon') return '#ff8a6a';
  if (t === 'neutral') return '#e8c27a';
  return `var(--t-${t})`;
}

/** The guides this game shows: its own set, and only tribes in this lobby (neutral always). Data order. */
export function guidesFor(setId: SetId | undefined, tribes: readonly Tribe[]): Guide[] {
  const set = setId ?? 'set1';
  return GUIDES.filter((g) => g.set === set && (g.tribes.length === 0 || g.tribes.some((t) => tribes.includes(t))));
}
