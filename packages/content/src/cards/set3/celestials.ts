import type { CardDef } from '@game/core';

/**
 * ── CELESTIAL TEST UNITS (owner ask 2026-08-03) ────────────────────────────────────────────────────────
 *
 * Three cards whose only job is to PROVE the two new mechanics end-to-end. They are deliberately plain
 * bodies with obvious numbers, so a Scene Builder board makes the rules legible at a glance.
 *
 *  • **ALIGNMENT** — the board splits around its centre: Dawn (left), Dusk (right), Eclipse (the exact
 *    middle body, which counts as BOTH). Derived from board SIZE, so it re-centres as minions come and go:
 *    a lone minion is Eclipsed, an EVEN board has no Eclipse. Alignment moves freely in the shop and LOCKS
 *    when combat starts. See `alignmentAt` (@game/sim).
 *
 *  • **ORBIT** — fires when a card is PLAYED FROM HAND into a slot adjacent to this minion. The watcher
 *    reads its OWN alignment, so one card behaves differently depending which half of the sky it sits in.
 *
 * The `align` field on an EFFECT is the whole mechanism: `align: 'dawn'` fires for a Dawn **or Eclipse**
 * body, `align: 'dusk'` for Dusk **or Eclipse**. Eclipse getting both halves falls out of that rule rather
 * than needing a third branch — which is why the gate lives on the effect and not on a pair of card fields.
 */
export const SET3_CELESTIALS: readonly CardDef[] = [
  {
    // ORBIT, both halves — the headline test. Sitting in Dawn it PAYS the arriver; sitting in Dusk it FEEDS
    // ITSELF; Eclipsed it does both, which is the clearest single demonstration of the eclipse rule.
    id: 'c3_orbiter',
    name: 'Twinlight Orbiter',
    tribe: 'neutral',
    tier: 2,
    attack: 2,
    health: 3,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffArriver', params: { attack: 2, health: 2 }, align: 'dawn' },
      { on: 'orbit', do: 'orbitBuffSelf', params: { attack: 2, health: 2 }, align: 'dusk' },
    ],
    text: '**Dawn Orbit:** give the minion **+2/+2**. **Dusk Orbit:** this minion gains **+2/+2**.',
    goldenText: '**Dawn Orbit:** give the minion **+4/+4**. **Dusk Orbit:** this minion gains **+4/+4**.',
  },
  {
    // ALIGNMENT on a SHOUT — proves the gate works on an ordinary trigger, not just the new one. The Shout
    // reads the alignment the card lands in (playing it re-centres the board, and the read happens after).
    id: 'c3_herald',
    name: 'Herald of the Divide',
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 2,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'onPlay', do: 'battlecryGainGoldNextTurn', params: { gold: 2 }, align: 'dawn' },
      { on: 'onPlay', do: 'onBattlecryBuffSelf', params: { attack: 2, health: 2 }, align: 'dusk' },
    ],
    text: '**Dawn Shout:** gain **2 Gold** next turn. **Dusk Shout:** this minion gains **+2/+2**.',
    goldenText: '**Dawn Shout:** gain **4 Gold** next turn. **Dusk Shout:** this minion gains **+4/+4**.',
  },
  {
    // ALIGNMENT in COMBAT — proves the LOCK. Its Start-of-Combat half is chosen by the alignment frozen at
    // combat setup, so re-centring caused by deaths mid-fight can never flip which half it runs.
    id: 'c3_sentinel',
    name: 'Horizon Sentinel',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 4,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'startOfCombat', do: 'scDamage', params: { amount: 3, target: 'leftmost', text: 'Dawnfire' }, align: 'dawn' },
      { on: 'startOfCombat', do: 'scDamage', params: { amount: 3, target: 'all', text: 'Duskfall' }, align: 'dusk' },
    ],
    text: '**Dawn:** Start of Combat — deal **3** to the left-most enemy. **Dusk:** deal **3** to ALL enemies.',
    goldenText: '**Dawn:** Start of Combat — deal **6** to the left-most enemy. **Dusk:** deal **6** to ALL enemies.',
  },

  {
    // Start of Combat with BOTH halves align-gated: the simplest "my text depends on where I stand" body.
    id: 'c3_acolyte',
    name: 'Daybreak Acolyte',
    tribe: 'neutral',
    tier: 1,
    attack: 1,
    health: 2,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'startOfCombat', do: 'scBuffSelf', params: { attack: 2 }, align: 'dawn' },
      { on: 'startOfCombat', do: 'scBuffSelf', params: { health: 2 }, align: 'dusk' },
    ],
    text: 'Start of Combat — **Dawn:** gain **+2 Attack**. **Dusk:** gain **+2 Health**.',
    goldenText: 'Start of Combat — **Dawn:** gain **+4 Attack**. **Dusk:** gain **+4 Health**.',
  },
  {
    // An UNGATED Orbit — fires whatever the Familiar's alignment. The contrast case to the Twinlight
    // Orbiter, whose halves are both gated.
    id: 'c3_starweft',
    name: 'Starweft Familiar',
    tribe: 'neutral',
    tier: 1,
    attack: 2,
    health: 2,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'orbit', do: 'orbitBuffArriver', params: { attack: 1, health: 1 } },
    ],
    text: '**Orbit:** give the played card **+1/+1**.',
    goldenText: '**Orbit:** give the played card **+2/+2**.',
  },
  {
    // Alignment across TWO different combat triggers on one card: a Dawn Rally and a Dusk Echo. Eclipsed it
    // carries both, which is the intended payoff for centring it.
    id: 'c3_equinox',
    name: 'Equinox Duelist',
    tribe: 'neutral',
    tier: 2,
    attack: 3,
    health: 3,
    keywords: ['RL'],
    celestial: true,
    effects: [
      { on: 'onAttack', do: 'rallyBuffCelestials', params: { attack: 2 }, align: 'dawn' },
      { on: 'onDeath', do: 'deathrattleBuffCelestials', params: { health: 2 }, align: 'dusk' },
    ],
    text: '**Dawn — Rally:** give your Celestials **+2 Attack**. **Dusk — Echo:** give them **+2 Health**.',
    goldenText: '**Dawn — Rally:** give your Celestials **+4 Attack**. **Dusk — Echo:** give them **+4 Health**.',
  },
  {
    // Alignment on END OF TURN — the recruit-phase economy shape (and the reason applyEndOfTurn + its
    // projection twin both gained the align gate in this PR).
    id: 'c3_nym',
    name: 'Starbroker Nym',
    tribe: 'neutral',
    tier: 3,
    attack: 3,
    health: 5,
    keywords: [],
    celestial: true,
    effects: [
      { on: 'endOfTurn', do: 'endOfTurnBonusGold', params: { amount: 2 }, align: 'dawn' },
      { on: 'endOfTurn', do: 'endOfTurnGetRandomSpells', params: { count: 1 }, align: 'dusk' },
    ],
    text: 'End of Turn — **Dawn:** gain **2 Gold** next turn. **Dusk:** get a **random spell**.',
    goldenText: 'End of Turn — **Dawn:** gain **4 Gold** next turn. **Dusk:** get **2 random spells**.',
  },
];

