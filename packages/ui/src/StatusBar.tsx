import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { renameTerms } from './terms';
import { Card, mdBold } from './Card';
import { instView } from './instView';
import { dragonTamerCostOf, INDY_GILD_RECHARGE_GOLD, KESHI_CROWN_THRESHOLD, roundedSpellbookCostOf, buyoutCostOf, allInPayoutOf, exhibitionGrantOf, tempestGrantOf, bladeMasteryGrantOf, hoardWhelpStatsOf, TEMPEST_KILLS_PER_STEP, BLADE_ATTACKS_PER_STEP, heroPowerText, commissionOffer, COMMISSION_NAME, COMMISSION_REWARD, COMMISSION_DELAY, getHero, spellAmplifyBonus, spellAttackBonus, spellHealthBonus, rubyStatBonus, heroPowerLockTurns, activePowers, type RunState, type HeroPower } from '@game/sim';
import { henchmanOffer } from '@game/sim';
import { equipmentCostOf, equipmentState, equipmentText, equipmentUsesLeft, selectedEquipment, selectedEquipmentDef } from '@game/sim';
import { CARD_INDEX, EQUIPMENT_INDEX } from '@game/content';
import { equipmentArtFor } from './art';
import { heroArt, heroPowerArt, questArt, runeArt } from './art';
import { Icon } from './Icon';
import { BuffsFrame } from './BuffsFrame';
import { QuestBadges } from './QuestBadges';
import { gatherRunBuffs } from './runBuffs';
import { questObjectiveText, questProgressText, questRewardText, questRewardLiveText, questRewardLiveOf } from './questText';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { getEquipFxConfig } from './equipFxConfig';
import { getEquipSlotConfig } from './equipSlotConfig';
import { sfx } from './sfx';
import { canPlayDefs, playDef } from './fx/playDef';
import { useGame } from './store';
import { getHeroPowerBtnConfig } from './heroPowerBtnConfig';
import { pixiFx } from './pixiFx';
import { getAimFxConfig } from './aimFxConfig'; // also reflects the --hpb-* vars at load (side-effect)
import './heroPanelConfig'; // side-effect: reflects the --hpn-* hero-panel transform vars at load

/** Shrink a pill's TEXT to fit its box (owner note 2026-07-16: no ellipsis — "Lord of the Risen" should
 *  fit): after layout, if the text overflows the pill's max-width, scale the font down by the overflow
 *  ratio (one measurement, no loops). Re-fits when the text changes and on window resize (--u shifts). */
function useFitText(text: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = (): void => {
      const el = ref.current;
      if (!el) return;
      el.style.fontSize = ''; // back to the stylesheet size before measuring
      if (el.scrollWidth > el.clientWidth) {
        // Ratio over the CONTENT box (padding doesn't scale with the font — a whole-box ratio under-shrinks),
        // with a hair of slack for subpixel rounding.
        const cs = getComputedStyle(el);
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const base = parseFloat(cs.fontSize);
        el.style.fontSize = `${Math.max(6, base * ((el.clientWidth - pad) / (el.scrollWidth - pad)) * 0.98)}px`;
      }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [text]);
  return ref;
}

/** "twice per game" reads better than "2 per game" at the counts we actually use (2 and 3); anything larger
 *  falls back to the numeral rather than inventing English for a case no hero has. */
function usesPerGame(n: number): string {
  return `${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`} per game`;
}

/**
 * SLOT-AWARE HERO-POWER READOUTS. Extracted so slot 0 (the hero's main power) AND slot 1 (Void's second power)
 * render the SAME cost coin, tracker pill and centre magnitude from one source of truth — the owner ask is a
 * 1:1 second power (2026-08-24). Everything a readout needs is run-global EXCEPT the firing slot's own
 * activation state, threaded in as `spent` / `uses` (Void keeps `heroPowerSpent2` / `heroPowerUses2`).
 */
function heroPowerCostOf(power: HeroPower, run: RunState, uses: number): number | undefined {
  if (power.kind === 'dynamiteDig') return uses; // Jenkins — escalates on the FIRING slot's use count
  if (power.kind === 'dragonTamer') return dragonTamerCostOf(run);
  if (power.kind === 'roundedSpellbook') return roundedSpellbookCostOf(run);
  if (power.kind === 'buyout') return buyoutCostOf(run);
  return power.cost;
}
function heroPowerCenterOf(power: HeroPower, run: RunState, combatEnemyDeaths: number): string | null {
  switch (power.kind) {
    case 'exhibition': return `+${exhibitionGrantOf(run)}/+${exhibitionGrantOf(run)}`; // Odelle
    // Aevor — the End-of-Turn grant right now (0 below the unlock → blank, so the centre isn't a hollow +0/+0).
    case 'tempest': { const g = tempestGrantOf({ ...run, tempestKills: (run.tempestKills ?? 0) + combatEnemyDeaths }); return g > 0 ? `+${g}/+${g}` : null; }
    // Gorun — the Attack a swing grants right now, folding the live combat preview.
    case 'bladeMastery': return `+${bladeMasteryGrantOf({ ...run, bladeAttacks: (run.bladeAttacks ?? 0) + (run.fxBladeAttacksPreview ?? 0) })}`;
    // Cindara — the stats her next Whelp arrives with (1/1 base + banked hoard).
    case 'hoard': { const w = hoardWhelpStatsOf(run); return `${w.attack}/${w.health}`; }
    // Vale — United Front's per-type grant, ticking live like Yirin's pill as combat casts resolve.
    case 'unitedFront': { const n = run.spellsCast + (run.fxSpellsCastPreview ?? 0); return `+${n}/+${n}`; }
    default: return null;
  }
}
function heroPowerTallyOf(
  power: HeroPower, run: RunState,
  o: { spent: boolean; uses: number; combatEnemyDeaths: number; diceLock: number },
): string | null {
  const { spent, uses, combatEnemyDeaths, diceLock } = o;
  const withinUses = power.maxUses ? uses < power.maxUses : true;
  const gildSpent = spent && run.indyGildRearmAt != null
    ? Math.max(0, Math.min(INDY_GILD_RECHARGE_GOLD, (run.goldSpent ?? 0) - (run.indyGildRearmAt - INDY_GILD_RECHARGE_GOLD)))
    : 0;
  switch (power.kind) {
    case 'gild': return spent ? `${gildSpent}/${INDY_GILD_RECHARGE_GOLD}g` : null; // Indy — recharging
    case 'spellAmplify': return `${(run.spellsCast + (run.fxSpellsCastPreview ?? 0)) % 10}/10`; // Yirin
    case 'collision': return `${Math.min(5, run.cassenKills + combatEnemyDeaths)}/5`; // Cassen
    case 'quest': return spent ? null : `${run.drakkoBuys}/5`; // Drakko
    case 'questChronos': return spent ? null : `${run.eotMinionBuys ?? 0}/4`; // Chronos
    case 'sellGold': return (run.bonusEmbersNextTurn ?? 0) > 0 ? `${run.bonusEmbersNextTurn}g` : null; // Robin
    case 'recurringGoldcrafter': return run.wave % 4 === 0 ? 'now' : `${4 - (run.wave % 4)}t`; // Gildmaster
    case 'scalingGold': return spent ? null : `${1 + run.wave}g`; // Bagger Ben
    case 'lesserQuest': return run.wave < 4 ? `${4 - run.wave}t` : null; // retired Fi
    case 'runeforge': return run.wave < 5 && !spent ? `${5 - run.wave}t` : null; // Runesmith
    case 'epicRuneforge': return run.epicForgeWave != null && run.wave < run.epicForgeWave ? `${run.epicForgeWave - run.wave}t` : null; // Runeguard
    case 'pathfinder': return run.wave < 10 ? `${10 - run.wave}t` : null; // Coran
    case 'dynamiteDig': return `Tier ${run.tier}`; // Jenkins
    case 'secondHand': return run.wave % 3 === 0 ? 'now' : `${3 - (run.wave % 3)}t`; // Re-Pete
    case 'fourPeat': return `${Math.min(3, run.gorrBuys?.length ?? 0)}/3`; // Gorr
    case 'dice': case 'preparation': return diceLock > 0 ? `${diceLock}t` : null; // Gambler / Aster
    case 'contraband': return `${(run.refreshCount ?? 0) % 3}/3`; // Pete
    case 'archive': return `${(run.archivedTribes?.length ?? 0)}/3`; // Quillen
    case 'investment': return `${run.bramInvested ?? 0}/5`; // Bram
    case 'luckySeat': return `${run.ciaEnchantedBought ?? 0}/3`; // Cia
    case 'exhibition': return `${(run.cardsPlayedTotal ?? 0) % 4}/4`; // Odelle
    case 'allIn': return withinUses ? `${allInPayoutOf(run)}g` : null; // Rascal
    case 'soulbind': return `${Math.max(0, 3 - uses)} left`; // Sable
    case 'baldgecoin': return `${run.jugglerBuys ?? 0}/3`; // Juggler
    case 'commission': return run.commission ? `${Math.max(0, run.commission.dueWave - run.wave)}t` : null; // Cassen
    case 'crownTally': return `${run.keshiTierPoints}/${KESHI_CROWN_THRESHOLD}`; // Keshi
    // Aevor — kills toward the next +4/+4 step, climbing live via `combatEnemyDeaths`; below 15 it counts to the UNLOCK.
    case 'tempest': {
      const kills = (run.tempestKills ?? 0) + combatEnemyDeaths;
      return kills < TEMPEST_KILLS_PER_STEP ? `${kills}/${TEMPEST_KILLS_PER_STEP}` : `${kills % TEMPEST_KILLS_PER_STEP}/${TEMPEST_KILLS_PER_STEP}`;
    }
    // Gorun — attacks toward the next +3, climbing live via the replay preview.
    case 'bladeMastery': return `${((run.bladeAttacks ?? 0) + (run.fxBladeAttacksPreview ?? 0)) % BLADE_ATTACKS_PER_STEP}/${BLADE_ATTACKS_PER_STEP}`;
    // Cindara — friendly deaths toward the next Avenge (4), off the live combat preview (0 between fights).
    case 'hoard': return `${(run.fxFriendlyDeathPreview ?? 0) % 4}/4`;
    // Fibbsy — activations left this turn (refreshes each turn); `usesPerTurn` is the cap.
    case 'rubyWealth': return `${Math.max(0, (power.usesPerTurn ?? 0) - (run.heroUsesThisTurn ?? 0))} left`;
    default: return null;
  }
}

/** Bottom bar, rooted across the whole round: Embers and Resolve flank the hero. */
export function StatusBar() {
  const run = useGame((s) => s.run);
  // GORUN'S COUNTER, LIVE (owner report 2026-08-31). `run.bladeAttacks` is banked at settle, so during a fight
  // the printed "improves in N attacks" was frozen for the whole combat — the one stretch anybody is watching
  // it. `combatQuestDelta.attack` is the friendly-attack tally the replay already keeps for quests; folding it
  // in makes the text count down with the swings, and it is null outside a fight so the shop is unchanged.
  const combatAttacks = useGame((s) => s.combatQuestDelta?.attack ?? 0);
  const heroPowerLive = useMemo(() => ({ attacks: combatAttacks }), [combatAttacks]);
  // While spectating a replay, the hero panel belongs to the RECORDED player, so show their name — not the
  // local account's. Falls back to your own name for normal play (replaySession is null outside playback).
  const playerName = useGame((s) => s.replaySession?.authorName ?? s.playerName);
  const heroArmed = useGame((s) => s.heroArmed);
  const heroArmedSlot = useGame((s) => s.heroArmedSlot);
  const armHero = useGame((s) => s.armHero);
  const dispatch = useGame((s) => s.dispatch);
  const eotAnimating = useGame((s) => s.endTurnAnimating);
  const combatEnemyDeaths = useGame((s) => s.combatEnemyDeaths);
  const heroAtkPill = useGame((s) => s.heroAtkPill);
  const heroDmgTaken = useGame((s) => s.heroDmgTaken);
  // The hero + its power are data (HEROES registry); the panel renders whatever the run is on.
  // `activePowers`, not `hero.power`: Mimic wields a different hero's power each turn and Void wields TWO —
  // the main button always shows slot 0, and a second button (below) appears for slot 1.
  const hero = getHero(run.heroId);
  const powers = activePowers(run);
  const power = powers[0]!;
  const secondPower = powers[1];

  // ── EQUIPMENT readouts (owner handoff 2026-08-28) ─────────────────────────────────────────────────────
  // Derived from `run.equipment`, never from slot-local state: the handoff requires that game-state and
  // effect code make no assumption about which visual component Equipment lives in.
  const equipArmed = useGame((s) => s.equipArmed);
  const armEquipment = useGame((s) => s.armEquipment);
  const equipOptions = equipmentState(run).available;
  const selectedEquip = selectedEquipment(run);
  const selectedEquipDef = selectedEquipmentDef(run);
  const equipUses = equipmentUsesLeft(run);
  const equipCost = selectedEquipDef ? equipmentCostOf(run, selectedEquipDef) : 0;
  // Visible but DISABLED when unaffordable or spent — the handoff is explicit that the slot keeps showing the
  // Equipment and explains why it cannot be used, rather than vanishing.
  const equipReady = !!selectedEquipDef && run.phase === 'recruit' && equipUses > 0 && run.embers >= equipCost;
  // The wording for the version this player actually holds — a Gilded source prints the Gilded rule.
  const equipRule = selectedEquipDef && selectedEquip
    ? equipmentText(selectedEquipDef, selectedEquip.version)
    : '';
  const equipArt = equipmentArtFor(selectedEquipDef?.id);

  /**
   * THE LEAVING FADE (owner ask 2026-08-28: "can you add a brief fade in/fade out for the equipment so it
   * doesn't simply disappear immediately?").
   *
   * Fading IN is free — a CSS animation on mount. Fading OUT is not: the slot renders off `run.equipment`, so
   * the frame the source minion dies or is sold, there is nothing left to paint. React has already unmounted
   * the thing we want to watch leave.
   *
   * So the panel LINGERS. The last frame that had an Equipment is kept, and when the run stops having one the
   * panel keeps rendering FROM THAT SNAPSHOT for the length of the fade, then drops. The lingering copy is
   * inert — no rail, no arming, button disabled — because it is a picture of something the player no longer
   * has, and letting them click it would be a lie about state.
   *
   * A ref, not state, for the snapshot itself: it is written on every render that has an Equipment and must
   * never cause one. Only the leaving FLAG is state, because that is the thing a re-render has to react to.
   */
  /**
   * THE ART SHEEN (owner ask 2026-08-29) — a band of light sweeps the Equipment ART when the slot's PICTURE
   * changes, with a clip alongside it.
   *
   * ── The trigger is the ART, not the equip ─────────────────────────────────────────────────────────────
   *
   * Owner: *"this sheen should not play if the player already has equipment shown and they play another equip
   * minion … the first equip / going from 0→1 equipment, or when equipment is swapped in the slot."*
   *
   * So it keys on the Equipment ID CURRENTLY SHOWN, and nothing else. A second Alchemist Frank leaves that id
   * unchanged and is silent — which lands in the same place as the equip cue's own gate (`holdsEquipment`),
   * but for a different reason and by a different route: that one asks "did you acquire something?", this one
   * asks "did the picture change?". They agree on a duplicate Frank and disagree elsewhere — swapping the rail
   * to an Equipment you already held acquires nothing, yet the art changes, so the sheen plays and the equip
   * burst does not. Keeping them separate is what makes both correct.
   *
   * The Start-of-Turn rebuild is silent for the same reason: same id, same picture.
   *
   * `key`-remounting the band is what restarts the CSS animation — re-adding a class to a live element does
   * not replay it, and a swap back and forth must sweep each time.
   */
  const shownEquipId = selectedEquipDef?.id;
  // The seq restarts the animation; `rev` carries the direction dial, which CSS cannot read from a number.
  const [sheen, setSheen] = useState<{ seq: number; rev: boolean }>({ seq: 0, rev: false });
  const lastShownRef = useRef<string | undefined>(shownEquipId);
  useEffect(() => {
    if (lastShownRef.current === shownEquipId) return;
    lastShownRef.current = shownEquipId;
    if (!shownEquipId) return; // losing the slot is a fade-out, not an arrival
    const cfg = getEquipSlotConfig();
    if (!cfg.sheenOn) return;
    // Both offsets are relative to the SLOT BURST — the moment the icon lands — so a negative dial reads as
    // "before the burst" rather than clamping against the cue.
    const burst = getEquipFxConfig().slotDelayMs;
    const at = Math.max(0, burst + cfg.sheenDelayMs);
    const rev = cfg.sheenDir === 1;
    const t = window.setTimeout(() => { setSheen((p) => ({ seq: p.seq + 1, rev })); }, at);
    if (cfg.sheenSfxOn) {
      sfx.equipmentSheen(cfg.sheenSfxVolume, Math.max(0, burst + cfg.sheenSfxDelayMs));
    }
    return () => { window.clearTimeout(t); };
  }, [shownEquipId]);

  const hasEquip = equipOptions.length > 0 && !!selectedEquip && !!selectedEquipDef;

  /**
   * "EMPTY" — the Equipment ran out of uses (owner ask 2026-08-29).
   *
   * *"there will be cases where players have more than 1 use available, this should only play when the player
   * has 0 equipment uses left. if a player then GAINS an equipment use somehow, and then again uses it and
   * hits 0, this would play as well. it's essentially an 'empty' effect."*
   *
   * So the trigger is the TRANSITION to zero, not the state of being at zero. Spending the first of two uses
   * leaves one and is silent; spending the second empties it and fires. A bonus use granted mid-turn takes it
   * off zero, and spending that one fires again — which falls out of watching the edge rather than the value,
   * with no special case for "how did it get back above zero".
   *
   * A fresh mount at zero is silent for the same reason the sheen is: the ref starts at the current value, so
   * only a change while mounted counts. Returning from combat would otherwise puff every time.
   */
  const equipEmptyRef = useRef(equipUses);
  useEffect(() => {
    const was = equipEmptyRef.current;
    equipEmptyRef.current = equipUses;
    if (!hasEquip || equipUses !== 0 || was === 0) return;
    if (!canPlayDefs()) return;
    const el = document.querySelector<HTMLElement>('.statusbar .equipslot .heropowerbtn');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    playDef('equipment-used-up', { source: at, target: at, cursor: at });
  }, [equipUses, hasEquip]);

  const equipSnapRef = useRef<{ name: string; rule: string; art?: string; cost: number; version: string } | null>(null);
  if (hasEquip) {
    equipSnapRef.current = {
      name: selectedEquipDef!.name, rule: equipRule, art: equipArt,
      cost: equipCost, version: selectedEquip!.version,
    };
  }
  const [equipLeaving, setEquipLeaving] = useState(false);
  const hadEquipRef = useRef(hasEquip);
  useEffect(() => {
    if (hadEquipRef.current === hasEquip) return;
    hadEquipRef.current = hasEquip;
    if (hasEquip) { setEquipLeaving(false); return; }
    setEquipLeaving(true);
    const t = window.setTimeout(() => { setEquipLeaving(false); }, getEquipSlotConfig().fadeOutMs);
    return () => { window.clearTimeout(t); };
  }, [hasEquip]);
  // What the leaving copy paints from. Null only if the slot has never held anything, in which case
  // `equipLeaving` is false too and none of this renders.
  const equipSnap = equipSnapRef.current;
  // HENCHMAN offer (owner spec 2026-08-03): the hero's bound recruit at its decayed price — null for the many
  // heroes with none authored yet, and after the once-per-run buy. PLACEHOLDER SURFACE: a plain chip under the
  // power pill so the mechanic is playable end-to-end; the real presentation is Mike's to design.
  const henchman = run.phase === 'recruit' ? henchmanOffer(run) : null;
  const henchmanDef = henchman ? CARD_INDEX[henchman.cardId] : undefined;
  // Some powers unlock on a later turn (Myra's Encore — turn 3); locked (and unusable) before then.
  const unlockWave = power.unlockWave ?? 1;
  const unlocked = run.wave >= unlockWave;
  // Passive powers (Spellbinder) are always-on — never armed, never "used".
  const isPassive = !!power.passive;
  // Once-per-game powers (Indy's Gild) gate on heroPowerSpent; the rest recharge each wave. Fortify can
  // target a warband minion OR a tavern offer, so it's usable whenever ready — no friend required.
  const withinUses = power.maxUses ? (run.heroPowerUses ?? 0) < power.maxUses : true;
  // Jenkins's Dynamite Dig has an ESCALATING cost (1 Gold + 1 per prior use), not a fixed `power.cost`.
  const digCost = power.kind === 'dynamiteDig' ? (run.heroPowerUses ?? 0) : undefined;
  // Tiff's Dragon Tamer has a SHRINKING cost (5 − a discount per Dragon/spell bought since the last use).
  const tamerCost = power.kind === 'dragonTamer' ? dragonTamerCostOf(run) : undefined;
  // Hunch's Rounded Spellbook also shrinks — 3, −1 per turn since the last use (shared helper, so the coin
  // shows exactly what the reducer charges).
  const bookCost = power.kind === 'roundedSpellbook' ? roundedSpellbookCostOf(run) : undefined;
  // Harlan's Buyout shrinks 1 a turn and re-bases on use — the coin reads the SAME helper the reducer charges,
  // so the price shown can never drift from the price paid (the dynamiteDig / dragonTamer / Hunch pattern).
  const buyCost = power.kind === 'buyout' ? buyoutCostOf(run) : undefined;
  // CROUPIER CIA: her power art is the SUIT that will pay next, not one fixed image — the button is how the
  // player sees which reward they are working toward. Falls back to her plain portrait art if a suit image is
  // ever missing, so a half-wired art folder degrades instead of rendering nothing.
  // Cassen while a commission is in flight: the button is LOCKED but its art must stay bright, because that
  // art is how the player sees which commission is running. Without this the shared "unusable active power"
  // rule dims the art to 10% and the button reads as empty (owner report 2026-08-17).
  const committed = power.kind === 'commission' && !!run.commission;
  // Once a quest/rune has been granted, the slot IS that grant: its own rule replaces the hero's ("get a quest
  // on turn 3" is no longer true or useful), and a quest also shows its objective progress.
  const grant = run.heroGrantArt;
  const grantQuest = grant?.kind === 'quest' ? run.activeQuests?.find((q) => q.questId === grant.id) : undefined;
  const grantQuestDef = grant?.kind === 'quest' ? QUEST_INDEX[grant.id] : undefined;
  const grantRuneDef = grant?.kind === 'rune' ? RUNE_INDEX[grant.id] : undefined;
  // Once the quest is DONE the objective is history — what matters is what it now gives you, so the tooltip
  // flips to the reward (owner report 2026-08-17: it still read "Cast 8 Rubies" after completing).
  const powerRule = grantQuestDef
    ? (grantQuest?.completed
      ? questRewardText(grantQuestDef.reward, { completed: true })
      : questObjectiveText(grantQuestDef.objective))
    : grantRuneDef ? grantRuneDef.text
    : heroPowerText(run, 0, heroPowerLive);
  // …and the REWARD, on its own line beneath. The objective alone says what to do but not what you get — the
  // half that decides whether the quest is worth steering the run toward (owner ask 2026-08-22). Only while
  // the quest is UNFINISHED: once complete, `powerRule` above has already flipped to the reward, and printing
  // it twice would read as a bug. Live-first so a scaling reward shows its current magnitude, not the base.
  const powerReward = grantQuestDef && !grantQuest?.completed
    ? (questRewardLiveText(grantQuestDef.reward, questRewardLiveOf(run, grantQuestDef.reward))
      ?? questRewardText(grantQuestDef.reward))
    : null;
  // …and CASSEN's button wears the art of the commission currently running, reverting to his plain art the
  // moment it matures. Both fall back to the hero's own art if a variant image is missing, so a half-wired
  // folder degrades instead of rendering nothing (there is no CassenHP3 yet).
  // Fi / Coran / Runesmith / Guardian: once their granted quest or rune is chosen, the button wears ITS art —
  // the grant is the power. Falls back to the hero's own art if that piece is unwired.
  const grantArt = run.heroGrantArt
    ? (run.heroGrantArt.kind === 'rune' ? runeArt(run.heroGrantArt.id) : questArt(run.heroGrantArt.id))
    : undefined;
  // The art follows the WIELDED power's hero (Mimic's disguise / Void's first pick) — the native id for
  // everyone else. Suit/commission variants resolve against the same id, so a mimicked Lucky Seat shows the
  // queued suit exactly as Ayse would.
  const artHeroId = run.voidPowerIds?.[0] ?? run.adoptedPowerId ?? run.mimicPowerId ?? hero.id;
  const powerArt = grantArt ?? (power.kind === 'luckySeat' && run.ciaSuit
    ? (heroPowerArt(`cia-${run.ciaSuit}`) ?? heroPowerArt(artHeroId))
    : power.kind === 'commission' && run.commission
      ? (heroPowerArt(`cassen-${run.commission.kind}`) ?? heroPowerArt(artHeroId))
      : heroPowerArt(artHeroId));
  // Gambler's Dice locks for as many turns as it rolled — how many turns remain.
  // Turns still owed on a recharge-locked power (Gambler's dice, Aster's Preparation). Shared with the
  // tutorial's readiness predicate via `heroPowerLockTurns` so the button, the coach and the reducer agree —
  // Preparation used to be missing here, so a locked power looked armed and clicking it silently no-opped.
  const diceLock = heroPowerLockTurns(run, power.kind);
  // GAMBLER'S DICE ROLL (owner ask 2026-08-14): the die visibly TUMBLES, then settles on what it rolled.
  // Presentation only — the value comes from gameplay (`heroDiceLockUntil - wave`, the seeded roll the reducer
  // already made). The tumble cycles 1→6 deterministically rather than randomly: it reads identically and
  // keeps the UI free of its own RNG.
  const [diceFace, setDiceFace] = useState<{ n: number; settled: boolean } | null>(null);
  const prevDiceLock = useRef(run.heroDiceLockUntil);
  useEffect(() => {
    const prev = prevDiceLock.current;
    prevDiceLock.current = run.heroDiceLockUntil;
    if (power.kind !== 'dice' || !run.heroDiceLockUntil || run.heroDiceLockUntil === prev) return;
    const rolled = run.heroDiceLockUntil - run.wave;
    if (rolled <= 0) return;
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      if (tick >= 11) {
        window.clearInterval(id);
        setDiceFace({ n: rolled, settled: true }); // land on the real roll — and STAY PUT
      } else {
        setDiceFace({ n: (tick % 6) + 1, settled: false });
      }
    }, 55);
    return () => window.clearInterval(id); }, [run.heroDiceLockUntil, run.wave, power.kind]);
  // The settled face STAYS UP for the rest of the turn (owner ruling 2026-08-16) — it used to hand the slot
  // back to the lock countdown after 1.1s, which read as the number being taken away. `heroDiceRollWave` is the
  // authority on "this turn", so a reload mid-turn still shows it and the next turn drops it with no explicit
  // clear. Only the tumble itself is local state.
  const diceHeld = power.kind === 'dice' && run.heroDiceRollWave === run.wave ? (run.heroDiceRoll ?? null) : null;
  useEffect(() => { if (diceHeld == null) setDiceFace(null); }, [diceHeld]);
  // HUNCH'S SPELL PREVIEW (owner ask 2026-08-14): hovering the power shows the spell it would hand you. Built
  // through the SHARED `instView`, so the preview prints the spell's LIVE value (spell power et al.) — the
  // card-text rule: never show a base number where the real one is knowable.
  // Cassen: the commission picker is local to this component, which owns the button — no cross-component
  // plumbing for a panel only one hero ever opens.
  const [pickingCommission, setPickingCommission] = useState(false);
  // WHICH slot opened the picker (Void can hold Commission/First-or-Last in slot 1) — threaded into the
  // picker's dispatch so the prize charges the slot that asked for it.
  const [pickerSlot, setPickerSlot] = useState(0);
  const [pickingFlash, setPickingFlash] = useState(false);
  const [hunchTip, setHunchTip] = useState<{ left: number; top: number; origin: 'left' | 'right' } | null>(null);
  const hunchHover = hunchTip !== null;
  /** Place the preview to the SIDE of the power (owner ask 2026-08-14) — the same floating side-popup a minion
   *  hover uses (`.cardref`), portalled to <body> so nothing in the status bar clips it, and flipped to the
   *  left when it would run off the right edge. */
  const showHunchTip = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement);
    const zoom = (parseFloat(cs.getPropertyValue('--inspect-zoom')) || 1) * (parseFloat(cs.getPropertyValue('--z-inspect-s')) || 1);
    const cardW = r.width * zoom * 1.5; // plate footprint, same estimate the card popup uses
    const gap = 10;
    const flip = r.right + gap + cardW > window.innerWidth - 6;
    const estH = cardW * 1.5550; // plate aspect (800x1244)
    setHunchTip({
      left: flip ? Math.max(6, r.left - gap - cardW) : r.right + gap,
      top: Math.max(6, Math.min(r.top - estH / 3, window.innerHeight - estH - 6)),
      origin: flip ? 'right' : 'left',
    });
  };
  // Powers whose HOVER shows the card they would hand you (owner asks 2026-08-14 Hunch, 2026-08-24 Fibbsy) —
  // you cannot judge the power without seeing what it produces. Hunch shows the spell it re-grants; Fibbsy
  // shows a Ruby at its LIVE value (base 1/1 + the run's accrued `rubyBonus`), so the player sees each Ruby is
  // currently, say, a 3/3. Both render from the same live `instView` the shop uses, so the printed value is real.
  const previewCardId = power.kind === 'roundedSpellbook' ? run.lastSpellCastId
    : power.kind === 'rubyWealth' ? 'ruby'
    : undefined;
  // A Ruby is a MINION token, so — unlike Hunch's spell — its preview needs real instance stats: the def's
  // base plus the run's LIVE ruby bonus (`rubyStatBonus`, the same value the shop's Ruby offer shows). A spell
  // carries no stats, so it stays 0/0. `instView` reads the stat footer AND the "+A/+H" grant text off these.
  const previewRuby = previewCardId === 'ruby';
  const previewRb = previewRuby ? rubyStatBonus(run) : { attack: 0, health: 0 };
  const previewBase = previewRuby ? CARD_INDEX['ruby'] : undefined;
  const hunchPreview = hunchHover && previewCardId
    ? instView(
      {
        uid: 'power-preview', cardId: previewCardId, tribe: 'neutral',
        attack: (previewBase?.attack ?? 0) + previewRb.attack,
        health: (previewBase?.health ?? 0) + previewRb.health,
        keywords: [], golden: false,
      },
      run.tier, undefined, spellAttackBonus(run), spellHealthBonus(run), run.spellsThisTurn, run.deathrattlesTriggered,
      run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, undefined, undefined,
      { rubyBonus: previewRuby ? previewRb : run.rubyBonus, impAura: run.impBuff, topTribe: null },
    )
    : null;
  // Indy's Gild recharges after INDY_GILD_RECHARGE_GOLD spent since the last use — how much is banked so far.
  // The literal 40 that used to sit here (three times) was the pre-2026-08-07 value and never followed the
  // rebalance, so the pill promised a recharge at 40 Gold that the reducer only granted at 75.
  const gildSpent = power.kind === 'gild' && run.heroPowerSpent && run.indyGildRearmAt != null
    ? Math.max(0, Math.min(INDY_GILD_RECHARGE_GOLD, (run.goldSpent ?? 0) - (run.indyGildRearmAt - INDY_GILD_RECHARGE_GOLD)))
    : 0;
  // The price this power ACTUALLY costs right now: a per-hero override when it has one, else the printed cost.
  // Rendered by the coin below and checked by `canHero` — the two must read the same value or they drift.
  const liveCost = digCost ?? tamerCost ?? bookCost ?? buyCost ?? power.cost;
  const canHero =
    !isPassive &&
    unlocked &&
    !eotAnimating &&
    withinUses &&
    (power.oncePerGame ? !run.heroPowerSpent : run.heroReady) &&
    // ONE price, checked once. A shrinking power (Dragon Tamer / Dynamite Dig / Hunch / Buyout) used to be
    // gated by its DISCOUNTED cost *and* its printed base cost, so between the two you could see the real,
    // payable price on the coin while the button read as unaffordable — and the art dimmed to 10% (the
    // `:not(.ready)` rule in styles.css), which looks exactly like the hero-power art vanishing (owner bug
    // 2026-08-17). `liveCost` is the same fallback chain the coin renders, so shown price == checked price.
    (!liveCost || run.embers >= liveCost) &&
    diceLock === 0 && // Gambler: the roll is unusable while its lock runs
    !(power.kind === 'commission' && run.commission); // Cassen: locked until the running commission pays out
  // Live power TALLY (owner ask 2026-07-16) — the Avenge-style numerals riding ABOVE the diamond for powers
  // that track a value: recharge/quest progress, cadence countdowns, scaling values, Jenkins's dig tier.
  // Null hides it (e.g. a completed quest fades away by unmounting; Robin with nothing banked shows nothing).
  const powerTally: string | null = (grantQuest && grantQuestDef)
    // A granted QUEST owns the slot while it runs: its objective tracker is the useful number.
    ? questProgressText(grantQuest.progress, grantQuestDef.objective, grantQuest.completed)
    : heroPowerTallyOf(power, run, { spent: !!run.heroPowerSpent, uses: run.heroPowerUses ?? 0, combatEnemyDeaths, diceLock });
  // A live MAGNITUDE printed on the power art itself (the pill above it carries progress). Odelle only, for
  // now — the slot exists because "how much is this giving me" and "how close is the next step" are two
  // different questions, and one pill cannot answer both (owner ask 2026-08-22).
  const powerCenter = heroPowerCenterOf(power, run, combatEnemyDeaths);
  // The big line under the hero name: what tapping the power does *right now*.
  const powerLine = isPassive
    ? power.kind === 'spellAmplify'
      ? `${power.name} · +${spellAmplifyBonus(run.spellsCast)}/+${spellAmplifyBonus(run.spellsCast)} · ${run.spellsCast % 10}/10`
      : power.kind === 'quest'
        ? `${power.name} · ${run.heroPowerSpent ? 'complete' : `${run.drakkoBuys}/5`}`
        : power.kind === 'questChronos'
          ? `${power.name} · ${run.heroPowerSpent ? 'complete' : `${run.eotMinionBuys ?? 0}/4`}`
          : power.kind === 'collision'
            ? `${power.name} · ${Math.min(5, run.cassenKills + combatEnemyDeaths)}/5`
            : power.kind === 'recurringGoldcrafter'
                ? `${power.name} · ${run.wave % 4 === 0 ? 'this turn' : `in ${4 - (run.wave % 4)}t`}`
                : power.kind === 'crownTally'
                  ? `${power.name} · ${run.keshiTierPoints}/${KESHI_CROWN_THRESHOLD}`
                  : `${power.name} · passive`
    : heroArmed
      ? 'Pick a minion…'
      : !unlocked
        ? `${power.name} · unlocks turn ${unlockWave}`
        : power.kind === 'fortify'
          ? `${power.name} · +${run.tier}/+${run.tier}`
          : power.kind === 'gainMaxMana'
            ? `${power.name} · ${!run.heroReady ? 'used' : run.embers >= (power.cost ?? 0) ? `${power.cost} Gold` : `need ${power.cost} Gold`}`
            : power.kind === 'rubyWealth'
              ? `${power.name} · ${!run.heroReady ? 'used' : run.embers >= (power.cost ?? 0) ? `${power.cost} Gold` : `need ${power.cost} Gold`}`
            : power.kind === 'gild'
              ? `${power.name} · ${run.heroPowerSpent ? `${gildSpent}/${INDY_GILD_RECHARGE_GOLD} Gold` : 'ready'}`
              : power.kind === 'scalingGold'
                  ? `${power.name} · ${run.heroPowerSpent ? 'spent' : `+${1 + run.wave} Gold`}`
                  : power.kind === 'dynamiteDig'
                    ? `${power.name} · ${!run.heroReady ? 'used' : digCost === 0 ? 'FREE' : run.embers >= digCost! ? `${digCost} Gold` : `need ${digCost} Gold`}`
                    : power.kind === 'dragonTamer'
                      ? `${power.name} · ${!run.heroReady ? 'used' : tamerCost === 0 ? 'FREE' : run.embers >= tamerCost! ? `${tamerCost} Gold` : `need ${tamerCost} Gold`}`
                      : power.kind === 'roundedSpellbook'
                        ? `${power.name} · ${!run.heroReady ? 'used' : bookCost === 0 ? 'FREE' : run.embers >= bookCost! ? `${bookCost} Gold` : `need ${bookCost} Gold`}`
                        : diceLock > 0
                          ? `${power.name} · locked ${diceLock}t`
                          // A once-per-GAME power must never read "once per turn" (owner report 2026-08-14 — Xerox).
                          : power.oncePerGame
                            ? `${power.name} · ${run.heroPowerSpent ? 'spent' : 'once per game'}`
                            // …and neither must a capped-USES power (Rascal: twice a game, not once a turn —
                            // owner report 2026-08-16). The cap is the headline; the once-per-turn gate is
                            // still enforced, it just isn't what the player needs told.
                            : power.maxUses
                              ? `${power.name} · ${(run.heroPowerUses ?? 0) >= power.maxUses ? 'spent' : usesPerGame(power.maxUses)}`
                              : `${power.name} · ${run.heroReady ? 'once per turn' : 'used'}`;
  // The live status line (current magnitude + countdown) shown ON HOVER, with the leading "Name · " stripped
  // (the name is the tip's header). Reuses the same live computations the old always-visible line did.
  const powerStatus = powerLine.startsWith(`${power.name} · `) ? powerLine.slice(power.name.length + 3) : powerLine;
  // REFRESH FLASH (owner note 2026-07-16, mirroring the End Turn diamond's relight): when the power comes
  // back up for usage the face blooms once. The signal is canHero AND the shop being on screen — a re-arm
  // that lands during combat (the reducer preps next-turn state early) defers its bloom to the moment the
  // shop returns, instead of firing invisibly mid-fight and reading "late"/missed (owner report). Covers
  // every re-arm path: start-of-shop recharge, Indy's Gild mid-shop, re-affording a costed power. One-shot
  // on mount (the layer unmounts after the tuner's `flash · refresh` ms + the 0.2s CSS delay); 0 disables.
  // ACTIVATION BURST (owner ask 2026-07-16): when the power actually FIRES — heroReady flipping
  // true→false mid-recruit (per-turn powers) or heroPowerSpent flipping false→true (once-per-game) —
  // spray sparks in all directions from the diamond. Covers targeted + untargeted paths alike.
  const prevReady = useRef(run.heroReady);
  const prevSpent = useRef(run.heroPowerSpent);
  useEffect(() => {
    const used = (prevReady.current && !run.heroReady) || (!prevSpent.current && run.heroPowerSpent);
    prevReady.current = run.heroReady;
    prevSpent.current = run.heroPowerSpent;
    if (!used || run.phase !== 'recruit') return;
    const el = document.querySelector('.heropowerbtn');
    if (!el) return;
    const r = el.getBoundingClientRect();
    pixiFx.heroPowerBurst(r.left + r.width / 2, r.top + r.height / 2, getAimFxConfig());
  }, [run.heroReady, run.heroPowerSpent, run.phase]);

  const [refreshFlash, setRefreshFlash] = useState(false);
  const flashSignal = canHero && run.phase === 'recruit';
  const prevFlashSignal = useRef(false);
  const flashTimerRef = useRef<number | undefined>(undefined);   // see below — must outlive the effect
  useEffect(() => {
    const was = prevFlashSignal.current;
    prevFlashSignal.current = flashSignal;
    if (!flashSignal || was) return;
    const ms = getHeroPowerBtnConfig().refreshFlash;
    if (ms <= 0) return;
    setRefreshFlash(true);
    /* Clear timer in a REF, not this effect's cleanup: `flashSignal` going true→false inside the hold made the
       cleanup cancel the clear, and the rising-edge guard above then early-returns — so the flash stayed lit
       for good. Same defect as the medallion pulses (#735, #736). */
    if (flashTimerRef.current !== undefined) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = undefined;
      setRefreshFlash(false);
    }, ms + 280);
  }, [flashSignal]);
  // Pill text auto-fits its box (no ellipsis / no tooltip needed — owner note 2026-07-16).
  const playerNameRef = useFitText(playerName);
  // When effective HP drops (Armor or Resolve — a wave broke through), shake the chip + float the −X.
  const prevHp = useRef(run.resolve + run.armor);
  const [hit, setHit] = useState<{ amt: number; key: number } | null>(null);
  const hitTimerRef = useRef<number | undefined>(undefined);   // see below — must outlive the effect
  useEffect(() => {
    const prev = prevHp.current;
    const now = run.resolve + run.armor;
    prevHp.current = now;
    if (now < prev) {
      setHit({ amt: prev - now, key: prev });
      /* Ref timer, same reason as the refresh flash: effective HP moving again inside the 1100ms hold — armor
         gained, Resolve healed — cancelled the clear via the cleanup and took the `now < prev` branch out of
         play, leaving the −X float parked on the chip permanently. */
      if (hitTimerRef.current !== undefined) window.clearTimeout(hitTimerRef.current);
      hitTimerRef.current = window.setTimeout(() => {
        hitTimerRef.current = undefined;
        setHit(null);
      }, 1100);
    }
  }, [run.resolve, run.armor]);

  // Hero-portrait buff FLASH — a blast/shard pop with a small eased ripple whenever ANY run buff grows (spell
  // power, a tribe aura, max Gold, …). Keyed off the SUMMED magnitude of the run-buff rows, so a buff of any
  // kind rising bumps the key and replays the one-shot. Recruit-phase only source (run state, not the combat
  // delta) — combat has its own per-unit FX, and flashing the portrait every beat would be noise. (owner ask
  // 2026-07-21.) One-shot transform/opacity animation, so it never repaints at rest.
  const buffMag = gatherRunBuffs(run).reduce((sum, r) => {
    for (const m of r.value.matchAll(/-?\d+/g)) sum += Math.abs(Number(m[0]));
    return sum;
  }, 0);
  const prevBuffMag = useRef(buffMag);
  const [buffFlash, setBuffFlash] = useState(0);
  // Run-buff rows for the pop-out (folds in live combat gains via `combatBuffs`), plus its open state. The
  // pop-out is toggled by clicking the hero portrait and expands UPWARD out of its top edge.
  const combatBuffs = useGame((s) => s.combatBuffs);
  const buffRows = gatherRunBuffs(run, combatBuffs);
  const [buffsOpen, setBuffsOpen] = useState(false);
  useEffect(() => {
    if (buffMag > prevBuffMag.current) setBuffFlash((n) => n + 1);
    prevBuffMag.current = buffMag;
  }, [buffMag]);

  return (
    <div className="statusbar">
      {/* Completed-quest trophies — a horizontal row of art circles sitting directly above the hero panel. */}
      <QuestBadges />
      <div className="statusrow">
        <div
          className={`hero${isPassive ? ' passive' : canHero ? '' : ' spent'}${heroArmed ? ' armed' : ''}${canHero && !heroArmed ? ' ready' : ''}`}
        >
          {/* Run buffs pop-out — expands UPWARD out of the portrait's top edge into the empty top-left board
              space when the portrait is clicked, anchored at the bottom so it grows up (owner rework 2026-08-14;
              it used to be a side drawer with a tab). */}
          <BuffsFrame open={buffsOpen} rows={buffRows} />
          {/* The portrait holds the hero art; the PLAYER name rides the bottom pill, and CLICKING it toggles the
              run-buffs pop-out (the up-arrow at its top + the dark hover overlay are the cues). */}
          <div
            className={`f${buffRows.length ? ' hasbuffs' : ''}${buffsOpen ? ' buffsopen' : ''}`}
            onClick={() => { if (buffRows.length) setBuffsOpen((o) => !o); }}
            role={buffRows.length ? 'button' : undefined}
            aria-expanded={buffRows.length ? buffsOpen : undefined}
            aria-label={buffRows.length ? (buffsOpen ? 'Hide run buffs' : 'Show run buffs') : undefined}
          >
            {/* THE LUNGE TARGET (owner ask 2026-08-25): a transform-clean wrapper GSAP owns for the post-combat
                hero strike. `.f` itself carries a base `transform: scale(1.2)`, and GSAP animating scale on it
                overwrote that — the portrait shrank to 1.0 mid-swing and the translate fought the base matrix.
                This wrapper has NO base transform, so the lunge is clean; the 1.2 lives on `.f` as its ancestor
                (heroStrike divides by the measured scale, so the geometry is unaffected). Everything visual —
                the art, name and attack pill — rides it together. */}
            <div className="herolunge">
            {/* Buff flash — remounts on `buffFlash` so the one-shot shard+ripple replays each time a run buff
                grows. `aria-hidden`, pointer-events none; sits over the art, under the name pill. */}
            {buffFlash > 0 && <span key={buffFlash} className="herobuff-blast" aria-hidden="true" />}
            {/* The post-combat ATTACK PILL — this hero's round damage, worn like a minion's Attack badge while
                the hero strike plays (owner ask 2026-08-25). A child of the portrait so it rides the lunge. */}
            {heroAtkPill?.side === 'player' && (
              <span key="hero-atk-player" className={`hero-atk hero-atk-player${heroAtkPill.buffed ? ' buffed' : ''}${heroAtkPill.leaving ? ' leaving' : ''}`} aria-hidden="true">{heroAtkPill.buffed && <span className="atk-sheen" aria-hidden="true"><span className="atk-sheen-bar" /></span>}{heroAtkPill.amount}</span>
            )}
            {/* The RED damage-taken number — pops in the centre of the portrait when the player is struck. */}
            {heroDmgTaken?.side === 'player' && (
              <span key={`dmg${heroDmgTaken.seq}`} className="hero-dmgtaken" aria-hidden="true">−{heroDmgTaken.amount}</span>
            )}
            {heroArt(hero.id) ? (
              <img decoding="sync" className="heroimg" src={heroArt(hero.id)} alt={hero.name} draggable={false} />
            ) : (
              <Icon name="anvil" />
            )}
            {/* Buffs affordance — the little arrow at the top of the portrait (only when there are buffs). */}
            {buffRows.length > 0 && <span className="herobuffs-arrow" aria-hidden="true">{buffsOpen ? '▾' : '▴'}</span>}
            {/* Hover affordance — the portrait darkens and spells out the click action (only when there are
                buffs to open; without any, the click is a no-op and there's nothing to explain). */}
            {buffRows.length > 0 && (
              <span className="herohover" aria-hidden="true">
                Click hero portrait to open / close the Buffs Panel
              </span>
            )}
            </div>
            {/* The player NAME sits OUTSIDE `.herolunge`, so it stays put while the portrait lunges — matching
                the anchored health and the foe's anchored name (owner ask 2026-08-25). */}
            {playerName && <div className="heroname" ref={playerNameRef}>{playerName}</div>}
          </div>
          {/* Health as a compact white box under the hero — the number is Resolve (+Armor). Keeps the hit-shake
              + −X float when a wave breaks through. */}
          <div
            className={`hpbox${hit ? ' hit' : ''}`}
            title={`Health: ${run.resolve} of ${run.maxResolve}${run.maxArmor ? ` · Armor ${run.armor} of ${run.maxArmor}` : ''}`}
          >
            <Icon name="heart" />
            <span className="hpval">{run.resolve}{run.armor > 0 && <b className="armval" title="Armor — extra effective HP">+{run.armor}</b>}</span>
            {hit && <span className="resfx" key={hit.key}>−{hit.amt}</span>}
          </div>
        </div>
        {/* Hero power — its OWN box to the right of the hero frame, sized up so an ACTIVE power reads as an
            obvious press-me button. The whole box glows (`.ready`) when the power is usable this turn, so it's a
            standing reminder to press it; it firms up (`.armed`) while aiming. A PASSIVE hero's box shows the art
            (dimmed, no glow, not clickable). The button keeps the `.heropowerbtn` class so Recruit's aim line
            still anchors to it. Clicking the frame does nothing — this button is the ONLY trigger. */}
        <div
          className={`heropanel${isPassive ? ' passive' : heroArmed ? ' armed' : canHero ? ' ready' : ''}`}
        >
          <div className="hpwrap">
            <button
              type="button"
              className={`heropowerbtn${isPassive ? ' passive' : heroArmed ? ' armed' : canHero ? ' ready' : ''}${committed ? ' committed' : ''}`}
              disabled={isPassive || (!canHero && !heroArmed)}
              aria-label={`${grantQuestDef?.name ?? grantRuneDef?.name ?? power.name} — ${renameTerms(powerRule).replace(/\*\*/g, '')}`}
              // Hunch only: reveal the spell this would grant. Cheap — the state is a boolean and the preview
              // is only built while hovering (and only for that hero).
              onPointerEnter={previewCardId ? (e) => showHunchTip(e.currentTarget) : undefined}
              onPointerLeave={previewCardId ? () => setHunchTip(null) : undefined}
              onPointerDown={(e) => {
                // B1: arm on PRESS, not click — so a press-drag-release onto a minion is one continuous
                // gesture (like dragging a card). A quick tap without dragging just arms it, preserving the
                // press-then-click-target flow (the aim line then follows the cursor; see Recruit).
                e.stopPropagation();
                if (isPassive || !canHero || heroArmed) return;
                sfx.pulse(); // the hero-power "pulse" cue, on pressing the button (fire or arm)
                sfx.heroPower(hero.id); // + this hero's own power SFX (heroes/<id>.power.mp3), layered; silent if absent
                // The authored 'hero-power-spark' FX (FX workbench) from the button's centre on press (owner
                // ask 2026-08-14). Fires when the power is actually used/armed, not on an inert press.
                {
                  const r = e.currentTarget.getBoundingClientRect();
                  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                  playDef('hero-power-spark', { source: { x: cx, y: cy }, target: { x: cx, y: cy } });
                }
                // CASSEN: the power is a CHOICE, so pressing it opens a picker rather than firing. It fires
                // when an option is chosen (below). Untargeted, but not immediate.
                // …and it is INERT while one is already running (owner ask 2026-08-16) — the reducer refuses
                // it too, so this just stops the panel opening on a click that could not do anything.
                if (power.kind === 'commission') { if (!run.commission) { setPickerSlot(0); setPickingCommission(true); } }
                else if (power.kind === 'firstOrLast') { setPickerSlot(0); setPickingFlash(true); }
                else if (power.untargeted) dispatch({ type: 'heroPower' });
                else armHero();
              }}
            >
              {/* CIRCLE treatment (owner ask 2026-08-14): the bronze frame png underneath is gone — the button
                  is JUST the hero-power art, clipped to a perfect circle. The ready/armed cue + refresh bloom
                  are now pure-CSS circular glows behind/over the art (no frame pngs), so nothing but the power
                  image shows. The 💠 tuner still moves/scales the art inside the circle via --hpb-art-*. */}
              <span className="hpb-glow" aria-hidden="true" />
              {/* Art sits in a CIRCULAR clipping wrapper so the 💠 tuner's art offset/scale dials move the art
                  INSIDE the circle without moving the clip. */}
              {powerArt
                ? <span className="hpb-artwrap" aria-hidden="true"><img decoding="sync" className="hpb-art" src={powerArt} alt="" draggable={false} /></span>
                : <Icon name="sc" />}
              {/* The REFRESH bloom — a one-shot circular flash as the power re-arms (never a loop). */}
              {refreshFlash && <span className="hpb-flash" aria-hidden="true" />}
            </button>
            {liveCost ? <span className="hpcost"><span className="costn">{liveCost}</span></span> : null}
            {/* Keyed on its text so every change replays the compositor-only bump (the Avenge-tally feel).
                While the Gambler's die tumbles it owns this slot, then hands it back to the countdown. */}
            {diceFace != null
              ? <span key={diceFace.settled ? 'die-final' : `die${diceFace.n}`} className={`hpb-tally hpb-dice${diceFace.settled ? ' settled' : ''}`}>{diceFace.n}</span>
              : diceHeld != null
                ? <span key="die-held" className="hpb-tally hpb-dice settled">{diceHeld}</span>
                : powerTally ? <span key={powerTally} className="hpb-tally">{powerTally}</span> : null}
            {/* CENTRE READOUT — a live magnitude printed ON the power art, distinct from the small pill above
                it (which carries the countdown). Odelle's Exhibition is the first: the grant she is giving
                RIGHT NOW. Suppressed while the Gambler's die owns the centre, so two heroes can never both
                claim the slot (only reachable at all through a Void holding both). */}
            {powerCenter && diceFace == null && diceHeld == null && (
              <span key={powerCenter} className="hpb-tally hpb-center">{powerCenter}</span>
            )}
            {/* CASSEN'S COMMISSION PICKER — reuses the Discover overlay's shell so it reads as the same kind of
          decision, but its options are plain text tiles rather than cards (a commission is not a card). Only
          the OFFERED commissions appear, so the one taken last is absent. */}
      {pickingCommission && createPortal(
        <div className="discover-ov commission-ov" role="dialog" aria-label="Choose a commission">
          <div className="disc-panel">
            <div className="disc-banner"><span className="disp">Choose a Commission</span></div>
            <div className="commission-opts">
              {commissionOffer(run).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="questcard has-art"
                  style={{ '--c': 'var(--t-neutral)' } as CSSProperties}
                  onClick={() => { setPickingCommission(false); dispatch({ type: 'heroPower', commission: kind, slot: pickerSlot }); }}
                >
                  {heroPowerArt(`cassen-${kind}`) && <img decoding="sync" className="questcard-art" src={heroPowerArt(`cassen-${kind}`)} alt="" aria-hidden />}
                  <span className="questcard-emblem" aria-hidden><Icon name="target" /></span>
                  <div className="questcard-head">
                    <div className="questcard-tier">Commission · {COMMISSION_DELAY[kind]} turns</div>
                    <div className="questcard-name">{COMMISSION_NAME[kind]}</div>
                  </div>
                  <div className="questcard-body">
                    <div className="questcard-sect reward">
                      <div className="questcard-lbl"><Icon name="gift" /> Reward</div>
                      <div className="questcard-txt">{COMMISSION_REWARD[kind]}</div>
                    </div>
                  </div>
                  <span className="questcard-gem" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        </div>, document.body)}
      {/* FLASH'S CHOOSE ONE — the SAME markup as Cassen's picker above, so the quest-style treatment in
          styles.css dresses both from one place rather than drifting into two lookalike panels. */}
      {pickingFlash && createPortal(
        <div className="discover-ov commission-ov" role="dialog" aria-label="First or Last">
          <div className="disc-panel">
            <div className="disc-banner"><span className="disp">First or Last</span></div>
            <div className="commission-opts">
              {(['first', 'last'] as const).map((end) => (
                <button
                  key={end}
                  type="button"
                  className="questcard has-art"
                  style={{ '--c': 'var(--t-neutral)' } as CSSProperties}
                  onClick={() => { setPickingFlash(false); dispatch({ type: 'heroPower', flashPick: end, slot: pickerSlot }); }}
                >
                  {heroPowerArt(`flash-${end}`) && <img decoding="sync" className="questcard-art" src={heroPowerArt(`flash-${end}`)} alt="" aria-hidden />}
                  <span className="questcard-emblem" aria-hidden><Icon name="target" /></span>
                  <div className="questcard-head">
                    <div className="questcard-tier">Claim · next combat</div>
                    <div className="questcard-name">{end === 'first' ? 'First Place' : 'Last Place'}</div>
                  </div>
                  <div className="questcard-body">
                    <div className="questcard-sect reward">
                      <div className="questcard-lbl"><Icon name="gift" /> Reward</div>
                      <div className="questcard-txt">
                        {end === 'first' ? 'A copy of the FIRST minion you kill' : 'A copy of the LAST minion you kill'}
                      </div>
                    </div>
                  </div>
                  <span className="questcard-gem" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        </div>, document.body)}
      {/* Hunch: hovering the power shows the SPELL it would hand you (owner ask 2026-08-14) — you can't
                judge the price without knowing what you're buying. Rendered from the same live view the shop
                uses, so its printed value is the real one. */}
            {hunchPreview && hunchTip && createPortal(
              <div className="cardref" style={{ left: hunchTip.left, top: hunchTip.top }}>
                <div className="cardref-inner" style={{ transformOrigin: `${hunchTip.origin} center` }}>
                  <Card card={hunchPreview} forceFull plated />
                </div>
              </div>,
              document.body,
            )}
          </div>
          {/* The power NAME now lives in the pill for passives too (mirrors the active-power pill, e.g. Soren's
              Reclaim); the "Passive"/status detail moves to the hover tip below. */}
          {/* Once a granted quest/rune owns the slot, its NAME owns the plate too — "Errand" under Opening
              Act's art reads as a mismatch (owner ask 2026-08-21). */}
          <div className="hplabel">{grantQuestDef?.name ?? grantRuneDef?.name ?? power.name}</div>
          {/* HENCHMAN recruit chip — placeholder presentation (see the `henchman` derivation above). */}
          {henchman && henchmanDef && (
            <button
              className="hmn-btn"
              disabled={run.embers < henchman.cost || eotAnimating}
              onClick={() => dispatch({ type: 'buyHenchman' })}
              title={`Recruit ${henchmanDef.name} — your hero's henchman. Costs ${henchman.cost} Gold (gets cheaper every round: win −3, loss −2).`}
            >
              {henchmanDef.name} · {henchman.cost === 0 ? 'FREE' : `${henchman.cost}g`}
            </button>
          )}
          <div className="herotip" role="tooltip">
            <b>{grantQuestDef?.name ?? grantRuneDef?.name ?? power.name}</b>{isPassive ? ' · passive' : ''}
            {/* `**word**` = a keyword reference → renders BOLD (mdBold), never raw asterisks. */}
            <span className="herotip-rule" dangerouslySetInnerHTML={{ __html: mdBold(powerRule) }} />
            {powerReward && (
              <span className="herotip-reward">
                <b>Reward</b>
                <span dangerouslySetInnerHTML={{ __html: mdBold(powerReward) }} />
              </span>
            )}
            {/* QUILLEN: the archived TYPES, each in its own tribe colour, with unused slots as "Empty". A
                plain rule string cannot carry per-word colour, so the live state is rendered here instead of
                being folded into the text (owner ask 2026-08-17). */}
            {power.kind === 'archive' && (
              <span className="herotip-types">
                {Array.from({ length: 3 }, (_, i) => {
                  const t = run.archivedTribes?.[i];
                  return (
                    <span
                      key={i}
                      className={`herotip-type${t ? '' : ' empty'}`}
                      style={t ? ({ '--tc': `var(--t-${t})` } as CSSProperties) : undefined}
                    >
                      {t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Empty'}
                    </span>
                  );
                })}
              </span>
            )}
            {/* Live status (current magnitude + countdown) on hover — the progress text was removed from the
                always-visible hero box, so it reads here instead. */}
            <span className="herotip-live">{powerStatus}</span>
          </div>
        </div>
        {/* VOID'S SECOND POWER (owner spec 2026-08-22): the slot-1 wielded power, seated to the right of the
            hero under the main power button. Position/scale are the owner's to place — the 👥 Second Power
            tuner drives `--hp2-x/--hp2-y/--hp2-scale` (secondPowerConfig.ts), with the CSS fallbacks as the
            shipped seat. A simplified button on purpose: the escalating-cost powers (Jensen/Tiff/Hunch/
            Harlan) key their coins off slot-0 state and are rare picks; the tooltip still shows the live rule
            via heroPowerText(run, 1, heroPowerLive). */}
        {secondPower && (() => {
          const p2 = secondPower;
          const passive2 = !!p2.passive;
          const uses2 = run.heroPowerUses2 ?? 0;
          const spent2 = p2.oncePerGame ? !!run.heroPowerSpent2 : p2.maxUses ? uses2 >= p2.maxUses : false;
          const diceLock2 = heroPowerLockTurns(run, p2.kind);
          // The SAME readouts the main power computes — from slot-1 state — so the second power's coin, tracker
          // and centre magnitude are 1:1 with a regular hero power (owner ask 2026-08-24).
          const liveCost2 = heroPowerCostOf(p2, run, uses2);
          const tally2 = heroPowerTallyOf(p2, run, { spent: !!run.heroPowerSpent2, uses: uses2, combatEnemyDeaths, diceLock: diceLock2 });
          const center2 = heroPowerCenterOf(p2, run, combatEnemyDeaths);
          const ready2 = !passive2 && !spent2 && (run.heroReady2 ?? true) && run.wave >= (p2.unlockWave ?? 1)
            && (!liveCost2 || run.embers >= liveCost2) && diceLock2 === 0
            && !(p2.kind === 'commission' && !!run.commission);
          const armed2 = heroArmed && heroArmedSlot === 1;
          const art2 = run.voidPowerIds?.[1] ? heroPowerArt(run.voidPowerIds[1]) : undefined;
          return (
            <div className={`heropanel heropanel2${passive2 ? ' passive' : armed2 ? ' armed' : ready2 ? ' ready' : ''}`}>
              {/* The SAME `.hpwrap` wrapper the main power uses — its absolutely-positioned pill / centre /
                  cost only pick up their styling under `.hpwrap`, so without it the second power's tracker
                  rendered as bare static text (owner bug 2026-08-25). Keeps the two powers 1:1. */}
              <div className="hpwrap">
              <button
                className={`heropowerbtn${passive2 ? ' passive' : armed2 ? ' armed' : ready2 ? ' ready' : ''}`}
                disabled={passive2 || (!ready2 && !armed2)}
                aria-label={`${p2.name} — ${renameTerms(heroPowerText(run, 1, heroPowerLive)).replace(/\*\*/g, '')}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (passive2 || !ready2 || armed2) return;
                  sfx.pulse();
                  // The choice-powers open their pickers exactly as the main button does — a slot-1 Commission
                  // fired bare would reach the reducer with no `commission` chosen and no-op.
                  if (p2.kind === 'commission') { if (!run.commission) { setPickerSlot(1); setPickingCommission(true); } }
                  else if (p2.kind === 'firstOrLast') { setPickerSlot(1); setPickingFlash(true); }
                  else if (p2.untargeted) dispatch({ type: 'heroPower', slot: 1 });
                  else armHero(1); // targeted: arm slot 1 — Recruit fires { slot: heroArmedSlot } on the pick
                }}
              >
                <span className="hpb-glow" aria-hidden="true" />
                {art2
                  ? <span className="hpb-artwrap" aria-hidden="true"><img decoding="sync" className="hpb-art" src={art2} alt="" draggable={false} /></span>
                  : <span className="hpb-glyph" aria-hidden="true">✦</span>}
              </button>
              {/* Cost coin, tracker pill and centre magnitude — the same three the main power shows, from
                  slot-1 state. `liveCost2` (not `p2.cost`) so an escalating/shrinking cost reads its live price. */}
              {liveCost2 ? <span className="hpcost"><span className="costn">{liveCost2}</span></span> : null}
              {tally2 ? <span key={tally2} className="hpb-tally">{tally2}</span> : null}
              {center2 && <span key={center2} className="hpb-tally hpb-center">{center2}</span>}
              </div>
              <div className="hplabel">{p2.name}</div>
              <div className="herotip" role="tooltip">
                <b>{p2.name}</b>{passive2 ? ' · passive' : ''}
                <span className="herotip-rule" dangerouslySetInnerHTML={{ __html: mdBold(heroPowerText(run, 1, heroPowerLive)) }} />
              </div>
            </div>
          );
        })()}
        {/* ── EQUIPMENT (owner handoff 2026-08-28) ────────────────────────────────────────────────────────
            A minion-granted, hero-power-shaped ability in the SECOND slot. It renders BESIDE a native second
            power rather than replacing it: the handoff's rule is that both stay reachable and their usage is
            independent, and this engine already tracks slot-1 usage separately, so covering one with the other
            would be hiding state that is still live.

            Deliberately built off `run.equipment` rather than any slot-local state — the handoff asks that
            "game-state and effect code must not assume Equipment permanently lives inside a particular visual
            component", and moving this to a dedicated button later should be a change to THIS block alone. */}
        {!hasEquip && equipLeaving && equipSnap && (
          /* THE LEAVING COPY — the last Equipment, on its way out. Inert by construction: no rail, no
             tooltip, a disabled button. See the `equipLeaving` block above for why it exists at all.
             `aria-hidden` because a screen reader should not be told about something already gone. */
          <div className="heropanel equipslot leaving" aria-hidden="true">
            <div className="hpwrap">
              <img decoding="sync" className="equipframe" src={`${import.meta.env.BASE_URL}frames/equipment-frame.webp`}
                   alt="" aria-hidden="true" draggable={false} />
              <button type="button" className="heropowerbtn" disabled tabIndex={-1}>
                <span className="hpb-glow" aria-hidden="true" />
                {equipSnap.art
                  ? <span className="hpb-artwrap" aria-hidden="true"><img decoding="sync" className="hpb-art" src={equipSnap.art} alt="" draggable={false} /></span>
                  : <span className="hpb-glyph" aria-hidden="true">⚒</span>}
              </button>
              {equipSnap.cost ? <span className="hpcost"><span className="costn">{equipSnap.cost}</span></span> : null}
            </div>
            <div className="hplabel">{equipSnap.name}</div>
          </div>
        )}
        {hasEquip && selectedEquip && selectedEquipDef && (
          <div className={`heropanel equipslot entering${equipArmed ? ' armed' : equipReady ? ' ready' : ''}`}>
            <div className="hpwrap">
              {/* THE FRAME (owner art 2026-08-28: "add the equipment frame around the equipment"). A sibling
                  of the button rather than a background ON it: the button is a square box whose art is
                  clipped to a circle, and a frame painted as its background would be clipped with it. As a
                  sibling it can also be sent BEHIND the icon or left in front of it, which is a dial.
                  `aria-hidden` + no pointer events — it is chrome, and must never eat the click that arms. */}
              <img decoding="sync" className="equipframe" src={`${import.meta.env.BASE_URL}frames/equipment-frame.webp`}
                   alt="" aria-hidden="true" draggable={false} />
              <button
                type="button"
                className={`heropowerbtn${equipArmed ? ' armed' : equipReady ? ' ready' : ''}`}
                disabled={!equipReady && !equipArmed}
                aria-label={`${selectedEquipDef.name} — ${renameTerms(equipRule).replace(/\*\*/g, '')}`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (!equipReady || equipArmed) return;
                  sfx.pulse();
                  const r = e.currentTarget.getBoundingClientRect();
                  const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                  playDef('hero-power-spark', { source: c, target: c });
                  // Untargeted Equipment fires immediately; a targeting one ARMS and waits for a pick — and
                  // because activation is atomic, nothing has been spent until that pick happens.
                  if (selectedEquipDef.targetMode === 'none') dispatch({ type: 'activateEquipment' });
                  else armEquipment();
                }}
              >
                <span className="hpb-glow" aria-hidden="true" />
                {/* The authored icon when one exists; the glyph is the fallback, exactly as before any art. */}
                {equipArt
                  ? (
                    <span className="hpb-artwrap" aria-hidden="true">
                      <img decoding="sync" className="hpb-art" src={equipArt} alt="" draggable={false} />
                      {/* The band lives INSIDE the art wrapper on purpose (owner: "it should play on the card
                          art itself and not the equipment slot png"). That wrapper is already the circular
                          clip, so the sweep is bounded by the art and cannot cross the frame. Remounted by
                          `key` to replay the animation. */}
                      {sheen.seq > 0 && <span key={sheen.seq} className={`equipsheen${sheen.rev ? ' rev' : ''}`} />}
                    </span>
                  )
                  : <span className="hpb-glyph" aria-hidden="true">⚒</span>}
              </button>
              {equipCost ? <span className="hpcost"><span className="costn">{equipCost}</span></span> : null}
              {/* The SHARED allowance, not a per-Equipment charge — labelled as uses left so a player with a
                  bonus activation can see there is a second one to spend. */}
              <span className="hpb-tally">{equipUses}</span>
            </div>
            <div className="hplabel">{selectedEquipDef.name}</div>
            <div className="herotip" role="tooltip">
              <b>{selectedEquipDef.name}</b>{selectedEquip.version === 'gilded' ? ' · gilded' : ''}
              <span className="herotip-rule" dangerouslySetInnerHTML={{ __html: mdBold(equipRule) }} />
              <span className="herotip-rule">
                {equipUses > 0 ? `${equipUses} Equipment use${equipUses === 1 ? '' : 's'} left this turn` : 'No Equipment uses left this turn'}
                {equipCost > 0 && run.embers < equipCost ? ' · not enough Gold' : ''}
              </span>
            </div>
            {/* THE SELECTOR — a rail that slides out to the RIGHT on hover (owner ask 2026-08-28: "when i
                mouse over the equipment, can it show the available equipment options slide out to the right?
                then i can click on an option to select it"). It replaced a permanent row of text buttons
                under the slot, which spent space every turn on a choice that is made rarely.

                Only when there is a choice to make — with one Equipment a picker is a control that can only
                do nothing. Swapping is free by contract: no Gold, no use, no exhaustion change.

                NOT rendered while ARMED. An armed Equipment means the player is aiming at the board, and a
                rail hanging off the slot would sit under the cursor on the way out and eat the pick.

                Reveal is CSS (`:hover`/`:focus-within` on the slot) rather than React state — no re-render on
                a mouse crossing a button, and the transition is transform + opacity only. The rail is a child
                of the slot so the pointer never leaves the hover target crossing into it. */}
            {equipOptions.length > 1 && !equipArmed && (
              <div className="equiprail">
                {/* The outer box carries the hoverable GAP as padding; this inner one is the visible panel.
                    Splitting them is what stops the rail closing while the pointer crosses to it. */}
                <div className="equiprail-in" role="group" aria-label="Choose Equipment">
                {equipOptions.map((g) => {
                  const def = EQUIPMENT_INDEX[g.equipmentId];
                  const art = equipmentArtFor(g.equipmentId);
                  const on = g.equipmentId === selectedEquip.equipmentId;
                  return (
                    <button
                      key={g.equipmentId}
                      type="button"
                      className={`equiprailbtn${on ? ' on' : ''}`}
                      aria-pressed={on}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        if (on) return;
                        sfx.equipmentSelect(getEquipSlotConfig().selectVolume);
                        dispatch({ type: 'selectEquipment', equipmentId: g.equipmentId });
                      }}
                    >
                      <span className="equiprail-icon" aria-hidden="true">
                        {art ? <img decoding="sync" src={art} alt="" draggable={false} /> : <span className="equiprail-glyph">⚒</span>}
                      </span>
                      <span className="equiprail-name">{def?.name ?? g.equipmentId}</span>
                      {def ? <span className="equiprail-cost">{equipmentCostOf(run, def)}</span> : null}
                    </button>
                  );
                })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
