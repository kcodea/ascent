import { describe, expect, it } from 'vitest';
import { makeRng, simulate, combatSide } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';

/**
 * BEAT-COUNT GOLDENS (2026-07-18 pacing audit): snapshot the compiled moment sequence (kind + event
 * count per beat) for curated fights. A PR that accidentally COLLAPSES beats (a missing `nextStep()` /
 * `withBeat` in the sim, or a grouping-rule change in the compiler) shows up here as a reviewable
 * snapshot diff instead of as "combat felt rushed" a week later. Deliberate pacing changes: review the
 * diff, then `vitest -u` to accept.
 */
const ALL_TRIBES = ['beast', 'dragon', 'undead', 'mech', 'demon'];
const mods = (m: object) => combatSide({ tier: 6, tribes: ALL_TRIBES, questMods: m });

const FIGHTS: [string, () => ReturnType<typeof simulate>][] = [
  ['plain exchange + deathrattle cascade', () => simulate(
    [{ cardId: 'stray', attack: 3, health: 10 }, { cardId: 'pack', attack: 2, health: 2 }],
    [{ cardId: 'sandbag', attack: 4, health: 8 }], makeRng(3), CARD_INDEX)],
  ['SoC rune stack (Warden + Warding + Mirror March)', () => simulate(
    [{ cardId: 'gnash', attack: 5, health: 8 }],
    [{ cardId: 'sandbag', attack: 0, health: 6 }], makeRng(1), CARD_INDEX,
    mods({ runeWarden: true, runeWarding: true, runeMirrorMarch: true }))],
  ['Umbral Energy + Rulebreaker Crown announce themselves', () => simulate(
    [{ cardId: 'cleric', attack: 3, health: 5 }, { cardId: 'stray', attack: 2, health: 4 }],
    [{ cardId: 'sandbag', attack: 1, health: 8 }], makeRng(2), CARD_INDEX,
    combatSide({ tier: 6, tribes: ALL_TRIBES, spellsCast: 2, questMods: { umbralEnergy: true, doubleLeftmostAttack: true } }))],
  ['avenge + last stand (Pit Without End)', () => simulate(
    [{ cardId: 'sandbag', attack: 1, health: 1 }, { cardId: 'sandbag', attack: 1, health: 1 }],
    [{ cardId: 'gnash', attack: 6, health: 30 }], makeRng(5), CARD_INDEX,
    mods({ pitWithoutEndImps: 2 }))],
];

describe('beat-count goldens — the compiled moment sequence is pinned', () => {
  for (const [name, run] of FIGHTS) {
    it(name, () => {
      const r = run();
      const moments = compileMoments(r.events);
      const shape = moments.map((m) => `${m.kind}×${m.end - m.start}[${m.stepGroups.length}]`);
      expect({ beats: moments.length, shape }).toMatchSnapshot();
    });
  }
});
