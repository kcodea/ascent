// @vitest-environment jsdom
/**
 * THE ATTACK TUNERS' BUTTON ROW (owner ask 2026-09-29: "for all the attack tuners, can you remove the speed options and
 * reduced motion, and put these buttons up top instead of at the bottom"). Every hero attack tuner, and the Damage
 * Formation tuner that plays them, puts Copy / Reset / Play above the dials and has no Speed or Reduced motion button.
 * The attacks themselves still honour reduced motion for real players (each attack's own test covers that).
 */
import { describe, expect, it } from 'vitest';
import { SPEC as BLAST } from '../HeroBlastTuner';
import { SPEC as QUAKE } from '../HeroQuakeTuner';
import { SPEC as ARCANA } from '../HeroArcanaTuner';
import { SPEC as BLADES } from '../HeroBladesTuner';
import { SPEC as ENRAGED } from '../HeroEnragedTuner';
import { SPEC as POISON } from '../HeroPoisonTuner';
import { SPEC as FROST } from '../HeroFrostTuner';
import { SPEC as HOLY } from '../HeroHolyTuner';
import { SPEC as FIRE } from '../HeroFireTuner';
import { SPEC as UNDEAD } from '../HeroUndeadTuner';
import { SPEC as BEAST } from '../HeroBeastTuner';
import { SPEC as BANANA } from '../HeroBananaTuner';
import { SPEC as BLEED } from '../HeroBleedTuner';
import { SPEC as COIN } from '../HeroCoinTuner';
import { SPEC as BOOMERANG } from '../HeroBoomerangTuner';
import { SPEC as BUBBLE } from '../HeroBubbleTuner';
import { SPEC as BACKSTAB } from '../HeroBackstabTuner';
import { SPEC as FORMATION } from '../DamageFormationTuner';

const SPECS = { BLAST, QUAKE, ARCANA, BLADES, ENRAGED, POISON, FROST, HOLY, FIRE, UNDEAD, BEAST, BANANA, BLEED, COIN, BOOMERANG, BUBBLE, BACKSTAB, FORMATION };

describe('the attack tuners', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    it(`${name}: buttons on top, Play buttons kept, no Speed or Reduced motion`, () => {
      expect(spec.buttonsOnTop).toBe(true);
      const labels = (spec.actions ?? []).map((a) => a.label);
      expect(labels.some((l) => l.startsWith('▶'))).toBe(true);
      expect(labels.filter((l) => /speed|reduced motion/i.test(l))).toEqual([]);
    });
  }
});
