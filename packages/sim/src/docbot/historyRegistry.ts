/**
 * DOC BOT — registries for the HISTORY-MINED tripwires (5–8).
 *
 * Tripwires 1–4 came from one day's owner reports (2026-08-26). These came from mining the repo's ~480 fix
 * commits for structural bug classes that recur — each registry below cites the incidents that motivated it.
 * Same doctrine as `phaseRegistry.ts`: worklists re-derive from live content/source; asymmetries get a
 * registry entry with a verifiable reason; unknowns are 'needs-triage' (tolerated, counted, reported).
 */

/**
 * TRIPWIRE 7 — rune rewards that are legitimately a NO-OP under the differential fixtures.
 *
 * History: #900 "Rune of Duplication was a no-op on 41 of 72 Epic runes"; the reducer's own `combatFlag`
 * comment records 23 Epic runes silently swallowing a second copy. The differential applies every rune's
 * reward through the REAL `buyRune` action and demands the (bookkeeping-stripped) state change — once for a
 * first copy, again for a second. An entry here says why that demand is wrong for this rune.
 */
export const RUNE_DIFF_EXCUSED: Readonly<Record<string, { which: 'first' | 'second'; why: string }>> = {
  // seeded empty on 2026-08-26 — every current rune changes state on both applications under the fixtures.
  // If a new rune legitimately can't (e.g. a pure one-shot latch the owner rules non-stacking), excuse it HERE
  // with the ruling, never by weakening the test.
  rune_ornate_clock: {
    which: 'second',
    why: 'OWNER RULED 2026-08-27 (q-runedup-oneshot revise): "rune of the ornate clock should do nothing if duplicated, that one is unique" — the forge filter stops offering it once owned; a Duplication copy is a deliberate no-op.',
  },
};

/**
 * TRIPWIRE 8 — stat-spell factories that deliberately do NOT fold spell power.
 *
 * History: #817 "Ales fold spell power — the last two stat-spell factories that skipped it" (they weren't the
 * last), #731 "spell power on Hoardflame + Lantern Light". The scan slices every `spellBuff*` / stat-extra
 * factory body out of `RECRUIT_FACTORIES` and requires a `spellAttackBonus`/`spellHealthBonus`/
 * `spellStatBonus` reference — or an entry here.
 */
export const SPELL_POWER_EXCUSED: Readonly<Record<string, { kind: 'documented-flat' | 'other-channel' | 'derived-magnitude' | 'needs-triage'; why: string }>> = {
  spellBuffTavern: { kind: 'documented-flat', why: "Apples' current-shop option — its own docblock says flat, matching the next-shop option" },
  spellBuffNextShop: { kind: 'documented-flat', why: 'Apples\' banked option — docblock: "Flat (no spell-power scaling), like the current-shop option"' },
  spellAverageStats: { kind: 'derived-magnitude', why: 'Equalize: the grant IS the board average — there is no printed magnitude for spell power to scale' },
  rubyStatGain: { kind: 'other-channel', why: 'OWNER RULED 2026-08-26 (q-spellpower-rubyStatGain approved): flat is correct — Ruby strength is its own channel.' },
};

/**
 * TRIPWIRE 6 — turn-scoped RunState fields that deliberately survive the turn rollover.
 *
 * History: #1f6c "Layaway keep is shop-phase only (cleared at combat)", #517 "Funeral loan expires next
 * turn", this week's Merchant's Chorus (the reducer clears `tavernBuyBonusTurn` at rollover — the class
 * where turn-scoping is load-bearing). The scan: every `*ThisTurn` / `*Turn`-suffixed field declared in
 * `state.ts` must have a reset assignment somewhere in `reducer.ts`, or an entry here.
 */
export const TURN_RESET_EXCUSED: Readonly<Record<string, string>> = {
  // seeded empty on 2026-08-26 — all 39 turn-suffixed fields have a reducer reset today. A field that
  // legitimately persists (a misnomer, or a "since turn N" marker) gets excused here with the reason.
};

/**
 * TRIPWIRE 9 — cards the play differential cannot exercise under the CLEAN fixture, each with the condition
 * the fixture doesn't stage. An entry here is "conditional, not dead" — verified by reading the condition,
 * not by assuming. The sabotage story that shaped the lane (event bookkeeping + fixture watchers masking a
 * neutered Shout) lives in playScan.ts.
 */
export const PLAY_EXCUSED: Readonly<Record<string, string>> = {
  cleric: 'heals/buffs a DAMAGED or tribe-scoped target; the clean fixture stages none',
  dw_ironlung: 'buffs your OTHER DWARVES; the clean-token board has no Dwarf',
  d2_recaller: 'copies the last Shop Spell cast THIS TURN; the fixture casts none before it',
  c3_relay: 'wakes adjacent CELESTIAL Orbits; the clean-token board has no Celestial',
  b2_magepup: 'casts the spell it was TAUGHT; nothing teaches it in the fixture',
};

/** TRIPWIRE 9 — silent onSummon watchers, with the reading that keeps them silent legitimately. */
export const WATCHER_EXCUSED: Readonly<Record<string, string>> = {
  gravebody: 'OWNER RULED 2026-08-26, reaffirmed 2026-08-27 (q-watch-gravebody REVISE): PARKED FOR REWORK — "this card should get reworked, but it is also not currently active in the game. we\'ll revisit when we need to." Until then the silence stands: "Copy your leftmost Echo when summoned" — the onSummon is about ITSELF being summoned (and its shop half is the startOfCombat copy); watching others is correctly nothing',
};
