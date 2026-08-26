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
  rubyStatGain: { kind: 'needs-triage', why: "Facetwright's Choice buffs Rubies; Ruby strength has its own channel (rubyBonus) — whether spell power should ALSO fold needs an owner ruling" },
  spellBuffShopByRuby: { kind: 'needs-triage', why: 'Veinstorm: sized by Ruby strength, not spell power — plausibly other-channel, unruled' },
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
