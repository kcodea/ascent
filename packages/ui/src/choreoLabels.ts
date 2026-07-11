import type { MomentKind } from './choreo/kinds';
import type { Anchor, Channel } from './choreo/score';

/**
 * Human-readable descriptions + colors for every term in the Choreography panel — surfaced as hover
 * tooltips (the `title` attribute) so a dev can learn what each channel / anchor / knob does without
 * leaving the panel. One source of truth shared by the panel + the timeline widget.
 */

/** Per-channel chip tint (a quick visual grouping). */
export const CH_COLOR: Record<Channel, string> = {
  sfx: '#7aa2ff', float: '#8affc0', lunge: '#ffb35c', impact: '#ff6a6a',
  auraBurst: '#c88bff', auraBreak: '#ffd24a', auraReform: '#6ab0ff',
};

/** What each effect CHANNEL is. */
export const CH_DESC: Record<Channel, string> = {
  sfx: 'Sound effects — the audio cues for this moment (attack whoosh, death thud, shield shimmer, etc.).',
  float: 'Floating combat text — damage numbers, +atk/+hp buff pops, and keyword pills that rise off the unit.',
  lunge: "The attacker's motion — wind-up, strike toward the defender, then an elastic settle. Attack moments only.",
  impact: "The melee smack — hit sound + WebGL spark burst + the defender's knock-back, fired at the moment of contact.",
  auraBurst: "A dying unit's aura explodes in place — the Divine Shield / Reborn spirit shatter on death.",
  auraBreak: 'A Divine Shield shatters when it soaks a hit — held briefly so the read is hit → settle → break.',
  auraReform: 'The Reborn re-form glow — the wispy blue shimmer as a returning unit knits back together.',
};

/** What each ANCHOR means + how offsets behave relative to it. */
export const AT_DESC: Record<Anchor, string> = {
  start: "Fires when the moment first appears on screen. 0 ms is the earliest point, so a positive offset delays it — start cues can't fire before the moment begins, so they don't go negative.",
  contact: 'Fires when the lunge connects with the defender. 0 = on contact; a NEGATIVE offset fires it before connection (the smack-lead), a positive offset after.',
  landed: "Fires when a Rise attacker's body is pulled back to its slot after dying mid-lunge (the spirit bursts there).",
  end: 'Fires at the end of the moment (reserved — not used by any default cue yet).',
};

/** The per-cue / global knobs. */
export const PROP_DESC = {
  offset: 'Milliseconds relative to the anchor: 0 = on the anchor, positive = later, negative = earlier (before the anchor, where the anchor allows it — see the anchor tooltip).',
  scaled: 'Scales with combat speed: ON = the delay compresses when the player speeds combat up (stays in sync with the fight). OFF = fixed wall-clock ms — use for effects welded to a fixed-length CSS animation (e.g. the Reborn re-form).',
  enabled: 'Turn this effect on or off for this moment — OFF silences just this one channel, handy to isolate or mute an effect while you tune the others.',
  hold: 'How long this moment lingers on screen before the next one shows (milliseconds), scaled by tempo + the combat-speed slider.',
  tempo: 'Global replay speed for the whole combat — higher = slower, more deliberate pacing (it multiplies every moment hold).',
  preview: "Fire the selected moment's FX cues on the two mock cards below — see the lunge / impact / aura effect on demand, without playing a real fight.",
  copy: 'Copy the current score as JSON — paste it into SCORE_DEFAULTS (choreo/score.ts) to ship your tuning as the new defaults.',
  reset: 'Reset every cue offset, per-moment hold, and the global tempo back to the shipped defaults.',
} as const;

/** What each moment KIND is (the rail). */
export const KIND_DESC: Record<MomentKind, string> = {
  attackExchange: 'An attack: the attacker winds up, strikes, and the impact lands on the defender.',
  damage: "A unit takes damage that isn't part of an attack's own lunge (Start-of-Combat / Deathrattle / poison damage).",
  shieldPop: 'A Divine Shield is gained or consumed — the ward shimmer on gain, the gold shatter on break.',
  poisonTick: 'A poison / venom tick destroys a unit.',
  death: 'A unit dies — its collapse plus any aura it was carrying bursting in place.',
  riseDeath: 'A Rise / Reborn unit dies — it will return, so its spirit bursts and the body later re-forms.',
  scCast: "A Start-of-Combat effect fires (Ember Whelp's scorch, Blaster, a spell-power gain, etc.).",
  summon: 'A token or minion is summoned onto the board.',
  buffWave: 'A buff lands on one or more units (+atk / +hp).',
  reborn: 'A unit returns via Reborn / Rise at its base stats (the re-form).',
  ascend: 'A unit ascends / upgrades into a stronger form mid-combat.',
  rally: "A Rally triggers an ally's Deathrattle / Echo.",
  toHand: 'A card is added to your hand mid-combat (Arcane Weaver, etc.).',
  maxGold: 'An Avenge effect raises your maximum Gold.',
  improve: "A summon-aura or per-N effect strengthens (Kennelmaster's aura, Tara's ascend tally…).",
  keyword: 'A unit is granted a keyword mid-combat (Rise, Ward, Toxin, Flurry…).',
  hpGrant: "A Deathrattle's accumulated HP grant (Sergeant) is applied.",
  reveal: 'A Stealthed unit is revealed (it loses Stealth when it attacks).',
};
