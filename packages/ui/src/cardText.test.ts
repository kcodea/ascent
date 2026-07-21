import { describe, it, expect } from 'vitest';
import { ALL_CARDS } from '@game/content';
import { abhorrentHorrorText, cadenceProgressText, cardTypeTallyText, escalatingCastText, guelProgressText, monkProgressText, packLeaderText, ritualistText, runescaleText, sergeantText, soulsmanText, stepProgress, summonBuffText, summonImproveText, summonScalingText, tallyBuffText, undeadBuyAtkText, watcherText } from './cardText';

describe('stepProgress — Avenge / gold-spent / Bleed counters', () => {
  it('Avenge units show 0/N on the board and tick with the death tally in combat, cyclic', () => {
    expect(stepProgress('soulsman', {})).toEqual({ current: 0, total: 4 });            // Avenge (4) — shop: 0/4
    expect(stepProgress('soulsman', { avengeSeen: 3 })).toEqual({ current: 3, total: 4 });
    expect(stepProgress('soulsman', { avengeSeen: 4 })).toEqual({ current: 4, total: 4 }); // procs here…
    expect(stepProgress('soulsman', { avengeSeen: 5 })).toEqual({ current: 1, total: 4 }); // …then wraps
    expect(stepProgress('solaris', { avengeSeen: 5 })).toEqual({ current: 5, total: 5 });  // Avenge (5)
  });
  it('Koron / Banksly count Gold spent (the goldTick meter), cyclic', () => {
    expect(stepProgress('acid', {})).toBeNull();                       // Koron — no meter passed
    expect(stepProgress('acid', { goldTick: 3 })).toEqual({ current: 3, total: 7 });   // every 7
    expect(stepProgress('banksly', { goldTick: 12 })).toEqual({ current: 2, total: 10 }); // every 10, wrapped
  });
  it('Bloodbinder counts GLOBAL combat attacks (bleedAttacks), cyclic; 0/N on the board', () => {
    expect(stepProgress('bloodbinder', {})).toEqual({ current: 0, total: 4 });
    expect(stepProgress('bloodbinder', { bleedAttacks: 4 })).toEqual({ current: 4, total: 4 });
    expect(stepProgress('bloodbinder', { bleedAttacks: 5 })).toEqual({ current: 1, total: 4 });
  });
});

describe('cardText helpers', () => {
  it('runescaleText shows Runescale Drake’s live Dragon grant (base + on-board spell tally, golden-aware)', () => {
    expect(runescaleText('runescale', false, 0)).toBeNull(); // no on-board spells → printed base is accurate
    // spellProgress 3 → base 1 + 3 = +4/+4 (first group only; the "+1/+1" improve rate is left alone).
    expect(runescaleText('runescale', false, 3)).toContain('{{+4/+4}}');
    expect(runescaleText('runescale', false, 3)).toContain('**+1/+1**');
    // Golden doubles the grant: (1 + 3) × 2 = +8/+8.
    expect(runescaleText('runescale', true, 3)).toContain('{{+8/+8}}');
    expect(runescaleText('sandbag', false, 3)).toBeNull();
  });
  it('packLeaderText shows the live total grant from the on-board Beast tally (summonBonus), golden-aware', () => {
    // Pack Leader accrues +3/+3 into summonBonus per Beast played WHILE on board; SoC spends the whole tally.
    // 2 Beasts → summonBonus 6 → +6/+6 grant. The enemy's tally rides its snapshot the same way.
    expect(packLeaderText('packleader', 6, false)).toContain('{{+6/+6}}'); // total grant = tally
    expect(packLeaderText('packleader', 6, false)).toContain('+3/+3'); // per-Beast rate shown
    expect(packLeaderText('packleader', 0, false)).toBeNull(); // none witnessed → printed rate is accurate
    expect(packLeaderText('packleader', 6, true)).toContain('{{+12/+12}}'); // golden doubles the grant
    expect(packLeaderText('packleader', 6, true)).toContain('+6/+6'); // golden per-Beast rate
  });
  it('escalatingCastText is DORMANT — no live card uses endOfTurnCastSpellEscalating', () => {
    // Vineweaver Drake was its only consumer and was retired 2026-07-20. The helper (and the factory it
    // reads) are kept as primitives for future content; until a card adopts one, this must return null for
    // every card rather than silently mis-render. Re-point this test at the new card when one adopts it.
    for (const c of ALL_CARDS) expect(escalatingCastText(c.id, false, 3, 0, 0)).toBeNull();
    expect(escalatingCastText('sandbag', false, 3, 0, 0)).toBeNull();
  });
  it("monkProgressText shows Flowing Monk's live grant + countdown to the next step (golden-aware)", () => {
    // 0 overflows: grant +2/+2, 5 to the next step — the current value shows from the very start.
    expect(monkProgressText('monk', false, 0)).toContain('{{+2/+2}}');
    expect(monkProgressText('monk', false, 0)).toContain('{{5 to go}}');
    // 7 overflows: floor(7/5)=1 → grant +4/+4; 7%5=2 → 3 to the next step.
    expect(monkProgressText('monk', false, 7)).toContain('{{+4/+4}}');
    expect(monkProgressText('monk', false, 7)).toContain('{{3 to go}}');
    // Golden, 5 overflows: 2 × (1 + 1) × 2 = +8/+8; per-step shows +4/+4.
    expect(monkProgressText('monk', true, 5)).toContain('{{+8/+8}}');
    expect(monkProgressText('monk', true, 5)).toContain('**+4/+4**');
    // A tripled golden carrying a flat combine bonus (+10) reads base 4 + 10 = +14/+14.
    expect(monkProgressText('monk', true, 0, 10)).toContain('{{+14/+14}}');
    expect(monkProgressText('monk', true, 0, 10)).toContain('{{5 to go}}');
    // Non-Monk card → null (falls back to printed text).
    expect(monkProgressText('sandbag', false, 3)).toBeNull();
  });
  it('guelProgressText shows Guel’s live grant + countdown to the next step (golden-aware)', () => {
    // 0 spells cast: grant +1/+1, 4 to the next step.
    expect(guelProgressText('guel', false, 0)).toContain('{{+1/+1}}');
    expect(guelProgressText('guel', false, 0)).toContain('{{4 to go}}');
    // 5 spells: floor(5/4)=1 → grant +2/+2; 5%4=1 → 3 to the next step.
    expect(guelProgressText('guel', false, 5)).toContain('{{+2/+2}}');
    expect(guelProgressText('guel', false, 5)).toContain('{{3 to go}}');
    // Golden, 4 spells: (1 + floor(4/4)) × 2 = +4/+4; per-step shows +2/+2.
    expect(guelProgressText('guel', true, 4)).toContain('{{+4/+4}}');
    expect(guelProgressText('guel', true, 4)).toContain('**+2/+2**');
    // Non-Guel card → null (falls back to printed text).
    expect(guelProgressText('sandbag', false, 8)).toBeNull();
  });


  it('tallyBuffText shows Grim’s live +N/+N from the run Deathrattle tally', () => {
    // Grim: "give your Beasts **+2/+2** for each Deathrattle triggered this game" — with 4 triggered,
    // the printed +2/+2 becomes a green {{+8/+8}}.
    expect(tallyBuffText('grim', 4)).toContain('{{+8/+8}}');
    expect(tallyBuffText('grim', 4)).not.toContain('**+2/+2**'); // the printed value was replaced
  });

  it('tallyBuffText doubles for a GILDED Grim and rewrites the golden text', () => {
    // The factory multiplies by mul(self), so a gilded Grim really grants double — the live number has to
    // follow, and it must rewrite the GOLDEN text, not the base one.
    expect(tallyBuffText('grim', 4, true)).toContain('{{+16/+16}}');
    expect(tallyBuffText('grim', 4, false)).toContain('{{+8/+8}}');
  });

  it('tallyBuffText falls back (null) at a zero tally or on a non-tally card', () => {
    expect(tallyBuffText('grim', 0)).toBeNull(); // nothing triggered yet → printed text
    expect(tallyBuffText('sandbag', 5)).toBeNull(); // not a tally-buff card
  });

  it('run-wide metric helpers surface live values (Soulsman gold, undeadBuyAtk contributors, Eternal Knight tally)', () => {
    // Soulsman: total max-Gold earned this run.
    expect(soulsmanText('soulsman', 5)).toContain('{{Gained 5 Gold this run.}}');
    expect(soulsmanText('soulsman', 0)).toBeNull();
    expect(soulsmanText('grim', 5)).toBeNull();
    // The undeadBuyAtk contributors show what a freshly-acquired Undead will inherit.
    for (const id of ['deathswarmer', 'forsakenweaver', 'karthus']) {
      expect(undeadBuyAtkText(id, 4)).toContain('{{New Undead arrive +4 Attack.}}');
    }
    expect(undeadBuyAtkText('deathswarmer', 0)).toBeNull();
    expect(undeadBuyAtkText('spore', 4)).toBeNull(); // not a contributor
    // Eternal Knight: run-wide card-type enchant accrued from deaths.
    expect(cardTypeTallyText('knit', { attack: 9, health: 6 })).toContain('{{Now +9/+6 this run.}}');
    expect(cardTypeTallyText('knit', { attack: 0, health: 0 })).toBeNull();
    expect(cardTypeTallyText('spore', { attack: 9, health: 6 })).toBeNull();
  });

  it('sergeantText shows the live Deathrattle HP grant (base + accrual, golden-aware)', () => {
    expect(sergeantText('sergeant', false, 4)).toContain('{{+6 Health}}'); // 2 base + 4 accrued
    expect(sergeantText('sergeant', true, 4)).toContain('{{+8 Health}}'); // 4 base (golden) + 4 accrued
    expect(sergeantText('sergeant', false, 0)).toBeNull(); // no accrual yet → printed text
    expect(sergeantText('grim', false, 4)).toBeNull(); // not Sergeant
  });

  it('summonImproveText (Den Mother) shows the live per-play grant = (2 base + accrued), golden-aware', () => {
    expect(summonImproveText('mamabear', 4, false)).toContain('{{+6/+6}}'); // 2 base + 4 accrued
    expect(summonImproveText('mamabear', 2, true)).toContain('{{+8/+8}}'); // (2 + 2) × 2 golden (from goldenText)
    expect(summonImproveText('mamabear', 0, false)).toBeNull(); // no accrual yet → printed +2/+2
    expect(summonImproveText('sandbag', 4, false)).toBeNull(); // not a per-summon-improve card
  });

  it('summonScalingText (Spirit Worgen) greens the per-play gain = base × (1 + spells cast this turn)', () => {
    expect(summonScalingText('spiritworgen', 3, false)).toContain('{{+12/+12}}'); // base 3 × (1 + 3 spells)
    expect(summonScalingText('spiritworgen', 2, true)).toContain('{{+18/+18}}'); // golden base 6 × (1 + 2 spells)
    expect(summonScalingText('spiritworgen', 0, false)).toBeNull(); // no spells this turn → printed +3/+3
    expect(summonScalingText('grim', 3, false)).toBeNull(); // not a spells-this-turn scaler
  });


  it('watcherText shows the live Lantern buff +x/+y (spell power in both stats); golden casts twice', () => {
    expect(watcherText('watcher', false, 2, 2)).toContain('{{+5/+2}}'); // base 3 + sp 2 attack, sp 2 health
    expect(watcherText('watcher', true, 2, 2)).toContain('{{+10/+4}}'); // ×2 casts
    expect(watcherText('watcher', false, 2, 0)).toContain('{{+5/+0}}'); // attack spell power only
    expect(watcherText('watcher', false, 0, 0)).toBeNull(); // no spell power → printed +3/+0 (golden +6/+0)
    expect(watcherText('spore', false, 2, 2)).toBeNull(); // not Watcher
  });

  it('abhorrentHorrorText shows the pending Start-of-Combat gain from Fodder consumed this turn (golden-aware)', () => {
    // 4/4 of Fodder consumed → it'll gain +4/+4 next combat (green); golden doubles to +8/+8.
    expect(abhorrentHorrorText('abhorrenthorror', { attack: 4, health: 4 }, false)).toContain('{{+4/+4 next combat}}');
    expect(abhorrentHorrorText('abhorrenthorror', { attack: 4, health: 4 }, true)).toContain('{{+8/+8 next combat}}');
    // Nothing consumed yet, or a non-Abhorrent card → null (falls back to printed text).
    expect(abhorrentHorrorText('abhorrenthorror', { attack: 0, health: 0 }, false)).toBeNull();
    expect(abhorrentHorrorText('abhorrenthorror', undefined, false)).toBeNull();
    expect(abhorrentHorrorText('sandbag', { attack: 4, health: 4 }, false)).toBeNull();
  });

  it('cadenceProgressText shows Frontdrake’s live countdown, reading “End of this turn.” on the proc turn', () => {
    // every:3 — eotTick 0 → 3 turns; 1 → 2; 2 → THIS turn's End of Turn lands it (one shy of a multiple);
    // 3 → just granted, 3 again.
    expect(cadenceProgressText('frontdrake', 0)).toContain('{{Next in 3 turns.}}');
    expect(cadenceProgressText('frontdrake', 1)).toContain('{{Next in 2 turns.}}');
    expect(cadenceProgressText('frontdrake', 2)).toContain('{{End of this turn.}}'); // procs at this turn's EOT
    expect(cadenceProgressText('frontdrake', 5)).toContain('{{End of this turn.}}'); // also one shy (5 % 3 === 2)
    expect(cadenceProgressText('frontdrake', 3)).toContain('{{Next in 3 turns.}}');
    expect(cadenceProgressText('sandbag', 1)).toBeNull(); // not a cadence card
  });

  it('cadenceProgressText also covers Money Maker’s every-2-turns cadence', () => {
    expect(cadenceProgressText('moneymaker', 0)).toContain('{{Next in 2 turns.}}');
    expect(cadenceProgressText('moneymaker', 1)).toContain('{{End of this turn.}}'); // one shy (1 % 2 === 1)
  });

  it('ritualistText shows the live per-tick Imp/Fodder grant = accrued eotBonus + next step (golden-aware)', () => {
    // eotBonus rides the run board (climbs by `step` each End of Turn, then grants the new total). The live text
    // shows the NEXT grant = current accrual + one more step. Only the FIRST magnitude (the grant) is greened;
    // the "improves by +1/+1" step stays printed.
    expect(ritualistText('ritualist', false, 0)).toBeNull(); // never triggered → printed base (+1/+1) is accurate
    expect(ritualistText('ritualist', false, 3)).toContain('{{+4/+4}}'); // accrued 3 + step 1 = next grant +4
    expect(ritualistText('ritualist', false, 3)).toContain('**+1/+1**'); // the step magnitude is left printed
    expect(ritualistText('ritualist', true, 6)).toContain('{{+8/+8}}'); // golden step 2: accrued 6 + 2 = +8
    expect(ritualistText('sandbag', false, 3)).toBeNull(); // not Ritualist
  });

  it('summonBuffText shows Kennelmaster’s live Start-of-Combat Beast aura (base + Avenge bonus)', () => {
    // Kennelmaster's aura is +(1 + summonBonus)/+(same); the printed +1/+1 becomes the live value.
    expect(summonBuffText('kennel', 0)).toBeNull(); // fresh → falls back to printed +1/+1
    expect(summonBuffText('kennel', 2)).toContain('{{+3/+3}}'); // base 1 + summonBonus 2
    expect(summonBuffText('sandbag', 3)).toBeNull(); // not a summon-buff / aura card
    // Trophy Stalker's growing Rally (base 5): golden doubles the live grant so the printed number matches the
    // real +10/+10 effect (owner-caught: it was under-showing +5/+5). Non-golden stays base+bonus.
    expect(summonBuffText('trophystalker', 5)).toContain('{{+10/+10}}'); // (5 + 5) × 1
    expect(summonBuffText('trophystalker', 5, true)).toContain('{{+20/+20}}'); // (5 + 5) × 2 golden
  });
});
