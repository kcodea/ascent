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
];
