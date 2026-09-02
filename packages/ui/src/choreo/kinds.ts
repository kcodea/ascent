import type { CombatEvent } from '@game/core';

/**
 * Presentation KIND of a moment (choreographer phase 2) — a coarser label than the raw event type, keyed to
 * how the moment is authored/scored (see docs/combat-events.md + the spec's Score section). Derived from the
 * moment's PRIMARY (first) event. Purely additive metadata in phase 2: the clock still keys hold TIMES by the
 * primary event type for exact-reproduction; kinds become the hold key + score key in phases 3-4.
 */
export type MomentKind =
  | 'attackExchange'
  | 'damage' | 'shieldPop' | 'shieldGain' | 'poisonTick' | 'venomSpent'
  | 'death'
  | 'riseDeath'
  | 'scCast' | 'scNarrate'
  | 'summon' | 'buffWave' | 'reborn' | 'ascend' | 'rally' | 'shout' | 'toHand' | 'maxGold' | 'improve'
  | 'keyword' | 'keywordLost' | 'hpGrant' | 'spellProgress' | 'reveal' | 'tribeAura'
  | 'questTrigger' | 'questComplete';

export function momentKind(primary: CombatEvent): MomentKind {
  switch (primary.type) {
    case 'attack': return 'attackExchange';
    case 'dmg': return 'damage';
    // Ward CONSUMED (`shield`) and Ward GAINED (`shieldUp`) are opposite beats that shared one kind. They are
    // split so the score can author them independently — a gain can carry its own FX without that FX also
    // firing on every shatter. Pacing is untouched: the clock keys holds by PRIMARY EVENT TYPE (clock.ts's
    // `beatDelay(next.primary.type)`), and the kind-facing `holdMsForKind` maps `shieldGain`→the `shieldUp`
    // pacing key, whose value equals `shield`'s — so both classifications hold for the same time.
    case 'shield': return 'shieldPop';
    case 'shieldUp': return 'shieldGain';
    // Same split, same reason, as `shield`/`shieldUp` above: an Execute PROC (`poison`, a kill) and a Venomous
    // charge being SPENT (`venomLost`) shared one kind, so a def authored for "Venom spent" would have fired on
    // every Execute kill too — and `poisonTick` already runs the `executeFx` cue (the crescent strike), which is
    // exactly the FX a shared kind would double up on. Pacing is untouched: the clock keys holds by PRIMARY EVENT
    // TYPE, and `holdMsForKind` maps `venomSpent`→the `venomLost` pacing key, whose value equals `poison`'s.
    case 'poison': return 'poisonTick';
    case 'venomLost': return 'venomSpent';
    case 'death': return primary.rise ? 'riseDeath' : 'death';
    // `sc` is TWO different beats behind one type: a genuine Start-of-Combat damage CAST (`cast: true` — the UI
    // plays the zap/bolt/flash) and mid-combat NARRATION (a spell-power gain: log line + trigger pulse only).
    // They shared `scCast`, so a caster muzzle-flash def would also have flashed on every narration line. The
    // narration keeps every cue it had, under its own name; `scCast` now means what it says. Both map to the
    // `sc` pacing key, so holds are unchanged either way.
    case 'sc': return primary.cast ? 'scCast' : 'scNarrate';
    case 'summon': return 'summon';
    case 'buff': return 'buffWave';
    case 'reborn': return 'reborn';
    case 'ascend': return 'ascend';
    case 'rally': return 'rally';
    // A Shout RE-FIRE — one moment per FIRE, carrying the consequences that fire produced (see the `shout`
    // branch in `compileMoments`). Paced like a narration beat; scored like a buff wave, since that is what
    // a re-fired Shout most often is.
    case 'shout': return 'shout';
    case 'toHand': return 'toHand';
    case 'maxGold': return 'maxGold';
    case 'improve': return 'improve';
    case 'keyword': return 'keyword';
    case 'keywordLost': return 'keywordLost'; // Tauntbreaker strips Taunt/Rise — was unhandled → "cues is not iterable" crash
    case 'hpGrant': return 'hpGrant';
    case 'spellProgress': return 'spellProgress'; // Archmagus Guel's on-board spell tally tick
    case 'reveal': return 'reveal';
    case 'tribeAura': return 'tribeAura'; // a run-wide combat aura → the board aura-wash
    // Quest/rune beats had NO case of their own, so they fell through to the `damage` default below and were
    // classified as damage moments — which own the `damageFx` cue (the crimson burst + impact ring). Harmless
    // while nothing was authored on `damage` (a quest moment is a single non-result event, so it contains no
    // `dmg` for that cue to burst at), but it made `damage` the ONLY place a quest def could be scored, and a
    // def scored there fires on every real hit in the fight. They get their own kinds instead; both map to the
    // `dmg` pacing key, so `holdMsForKind` is unchanged from the `damage` classification they had.
    case 'questTrigger': return 'questTrigger';
    case 'questComplete': return 'questComplete';
    // Defensive: any future event type falls back to a quiet damage-style moment instead of crashing the replay
    // (momentKind must NEVER return undefined — `getScore()[undefined]` is not iterable).
    default: return 'damage';
  }
}
