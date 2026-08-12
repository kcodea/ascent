import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE LIVE-TRACKING TRIPWIRE (owner ask 2026-08-07: "is there a way to make sure EVERYTHING has real-time
 * combat tracking?").
 *
 * The structural answer: anything the UI shows in real time must ride the EVENT LOG — carry-backs land at
 * settle, so a `CombatResult.player*` field with no in-fight event is, by construction, something the player
 * watches jump after the fight instead of move during it.
 *
 * This test enumerates every `player*` carry-back declared on CombatResult and demands each one is either
 * (a) LIVE — named in the registry below with the event/narration that carries it mid-fight — or
 * (b) EXEMPT — named with a reason why real-time display is genuinely meaningless for it.
 *
 * Adding a carry-back without classifying it here fails CI. That converts "remember to add a tracker" from
 * discipline into machinery, the same move as the snapshot-fidelity diff and the rune-count tripwire.
 */

/** Carry-backs with a LIVE in-fight signal, and what carries them. */
const LIVE: Record<string, string> = {
  playerSpellsCast: "the 'spellcast' event → combatSpellCastPreview (Yirin's Attunement ticks live)",
  playerSpellEscalationGain: "the '<spell> improves +A/+H' sc narration → combatEscalationPreview",
  playerSpellPower: "the '+A/+H Spell Power' sc narration → spellPower flourish + hand-spell pop",
  playerHandGrants: "the 'toHand' event — the card flies to hand on the trigger beat",
  playerRubyMints: "the 'toHand'-style mint beat in the replay (each Ruby flies to hand on its trigger)",
  playerPermaBuffs: "the 'buff' events themselves — the stats move on the body as they land",
  playerImpBuffGain: "the 'tribeAura' event — the board wash + Buffs-panel row tick",
  playerUndeadAuraGain: "the 'tribeAura' event (Lantern channel)",
  playerUndeadBuyAtkGain: "the 'tribeAura' event (Undead Attack aura)",
  playerTavernBuyGain: "the '+N/+N Shop' sc narration (gainTavernBuy telegraphs per proc)",
  playerQuestTally: 'quest deltas replay live via setCombatQuestDelta',
  playerDamage: "the 'dmg'/'death' events — the health bar IS the tracker",
  playerDeathrattles: "the death/summon beats — each Echo resolving is its own display; Grim-style tallies tick via improve events",
  playerDeaths: "the 'death' events — every death is watched as it happens",
  playerRallies: "the 'Rally' sc narrations + attack beats — each rally plays out visibly",
  playerImpsSummoned: "the 'summon' events — every Imp arrives on screen",
  playerSummonBonus: "the 'improve' events — accrual counters tick on the badge mid-fight (2026-08-05 rune batch)",
  playerSpellProgress: "the 'spellcast' event + logSpellProgress — the live countdown ticks per cast",
  playerHpGrantBonus: "the 'improve' events (the Health twin of summonBonus)",
  playerAscendCount: "the 'improve' events — Ascend's counter ticks per proc",
  playerBeastScaleProgress: "the 'improve' events — the scaler ticks on its badge",
  playerWildHuntGrown: "the 'buff' events — the growth lands on the body as it happens",
  playerBoardBuffGain: "the 'buff' events — visible stat changes on the board",
  playerCardBuffs: "the 'buff'/'tribeAura' beats — per-card-type gains bloom as they land",
  playerFodderBuffGain: "the 'tribeAura' event (Fodder channel)",
  playerMagneticBuffGain: "the 'tribeAura' event (Magnetic channel)",
  playerRubyBonusGain: "the '+A/+H Ruby Power' sc narration (same channel as playerRubyGain)",
  playerRubyGrants: "the mint beats — each granted Ruby flies to hand on its trigger",
  playerBeastBuyAtkGain: "the 'tribeAura' event (The Old Hunt's live aura pump)",
  playerBeastBuyHpGain: "the 'tribeAura' event (Pack Mentality's Health twin)",
};

/** Carry-backs where a real-time display is genuinely meaningless or already impossible to observe. */
const EXEMPT: Record<string, string> = {
  playerDiscoverCasts: 'the Discover MODAL cannot open mid-fight — queueing at settle is the whole design',
  playerNextShopBuff: 'its subject (the next shop) does not exist until the fight ends',
  playerRightmostSlotBuff: 'its subject (the next shop right-most slot) does not exist until the fight ends (Right Hand Hank)',
  playerBonusGold: 'ditto — next-shop Gold has no live surface mid-fight',
  playerFreeRolls: 'ditto — rerolls are a shop-phase affordance',
  playerMaxGoldGain: 'max-Gold has no combat surface; the maxGold event exists for the replay log only',
  playerFodderGrants: 'queued into the next tavern — no combat surface',
  playerFodderSchedule: 'queued across future shops — no combat surface',
  playerHandSummoned: 'the summon itself IS the live display; the field only records removal for settle',
  playerBeastExtraGain: 'Elderhorn modes read live in-fight already; the field is the settle stack',
  playerAttacksFirst: 'a coin-flip RESULT for the next fight — nothing to track during this one',
  playerRallyDouble: "next-combat mod already spent by the time it could display — the doubled rally IS the display",
  playerSurvivorCardIds: 'bookkeeping for the end screen — the survivors are literally on screen',
  playerQuestEvents: 'the quest DELTAS are the live channel (playerQuestTally); this is the settle record',
  playerDeferredBattlecries: 'tavern work queued for the shop — no combat surface by design (Effect Arena rule)',
  playerGuaranteedAttachments: 'a next-shop pity guarantee — no combat surface',
  playerNextTurnSpellCopies: 'next-turn hand grants — no combat surface',
  playerSlaughterCopy: "the kill itself is the display; the copy arrives at settle by design (Rune of the Trophy)",
};

describe('every CombatResult carry-back is classified: live-tracked or exempt', () => {
  const typesSrc = fs.readFileSync(path.join(__dirname, '..', 'types.ts'), 'utf-8');
  // Every `playerX?:` field declared on CombatResult. The interface is large; scanning declarations keeps
  // this in sync with reality rather than a hand-kept list of fields.
  const declared = [...typesSrc.matchAll(/^\s{2}(player[A-Za-z0-9]+)\??:/gm)].map((m) => m[1]!);

  it('the scan sees the interface (sanity)', () => {
    expect(declared.length).toBeGreaterThan(10);
    expect(declared).toContain('playerSpellsCast');
  });

  it('no carry-back is unclassified', () => {
    const unclassified = [...new Set(declared)].filter((f) => !(f in LIVE) && !(f in EXEMPT));
    expect(unclassified, [
      'New CombatResult carry-back(s) with NO live-tracking classification:',
      ...unclassified.map((f) => `  - ${f}`),
      'Either wire an in-fight event/narration + preview (see fxSpellsCastPreview for the pattern) and add it',
      'to LIVE, or add it to EXEMPT with the reason real-time display is meaningless for it.',
    ].join('\n')).toEqual([]);
  });

  it('nothing is classified twice, and nothing classified is imaginary', () => {
    const both = Object.keys(LIVE).filter((f) => f in EXEMPT);
    expect(both).toEqual([]);
    const ghosts = [...Object.keys(LIVE), ...Object.keys(EXEMPT)].filter((f) => !declared.includes(f));
    expect(ghosts, 'classified fields that no longer exist on CombatResult').toEqual([]);
  });
});
