import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COSMETIC_RARITIES } from '@game/progression';
import { FLIP_DIP, FLIP_HALF_GUARANTEED_MS, FLIP_HALF_MS, flipHalfMs, flipPoseAt, type FlipPose } from './cardFlip';
import { AURA_BURST, FACE_AMBIENT, FLIP_CHARGE } from './bigPull';
import { AURA_COLORS } from './packAura';
import { teaseAuraLevel, teaseBeatFrames, teaseGlowPop, teaseTremble, teaseWobble } from './packTease';
import { CARD_CUES, FOIL, TEASE_RATES } from './packSounds';
import { summaryBest } from './PackOpener';
import { WEAR_MAX, newHandling, stepHandling } from './packFx';
import type { PackCard } from '@game/progression';

/** The feel pass (owner 2026-11-24: tactile cards, building excitement, the rush of a big pull). */
describe('the pack opening feel pass', () => {
  it('a better card turns slower and heavier; a guaranteed card never turns faster than the guaranteed flip', () => {
    const ms = COSMETIC_RARITIES.map((r) => flipHalfMs(r, false));
    for (let i = 1; i < ms.length; i++) expect(ms[i]!).toBeGreaterThanOrEqual(ms[i - 1]!);
    expect(ms[0]).toBe(FLIP_HALF_MS);
    expect(ms[4]!).toBeGreaterThan(ms[3]!);
    expect(flipHalfMs('common', true)).toBe(FLIP_HALF_GUARANTEED_MS);
    expect(flipHalfMs('ancient', true)).toBe(flipHalfMs('ancient', false));
    expect(flipHalfMs(undefined, false)).toBe(FLIP_HALF_MS);
  });

  it('the turn winds up: the card sinks first, then lifts, and ends exactly on its lift', () => {
    const out: FlipPose = { cx: 0, cy: 0, s: 0 };
    const path = { c0x: 0, c0y: 0, tx: 10, ty: 0, scale: 1, lift: 0.08 };
    expect(flipPoseAt(path, 0, out).s).toBe(1);
    expect(flipPoseAt(path, 0.12, out).s).toBeLessThan(1);
    expect(flipPoseAt(path, 0.16, out).s).toBeGreaterThan(1 - FLIP_DIP - 1e-9);
    expect(flipPoseAt(path, 1, out).s).toBeCloseTo(1.08);
  });

  it('the aura charges, bursts and lingers more with each rarity; a Common has no burst and nothing lingers', () => {
    for (let i = 1; i < COSMETIC_RARITIES.length; i++) {
      const a = COSMETIC_RARITIES[i - 1]!, b = COSMETIC_RARITIES[i]!;
      expect(FLIP_CHARGE[b]).toBeGreaterThanOrEqual(FLIP_CHARGE[a]);
      expect(AURA_BURST[b]).toBeGreaterThan(AURA_BURST[a]);
      expect(FACE_AMBIENT[b]).toBeGreaterThanOrEqual(FACE_AMBIENT[a]);
    }
    expect(AURA_BURST.common).toBe(0);
    expect(FACE_AMBIENT.common).toBe(0);
    expect(FACE_AMBIENT.legendary).toBeGreaterThan(0);
    for (const r of COSMETIC_RARITIES) {
      expect(AURA_COLORS[r]).toHaveLength(3);
      for (const c of AURA_COLORS[r]) { expect(c).toHaveLength(3); for (const x of c) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); } }
    }
  });

  it('the tease escalates: the aura burns hotter each step, only Legendary and Ancient tremble and beat (Ancient faster)', () => {
    for (let s = 1; s < 5; s++) expect(teaseAuraLevel(s, 1)).toBeGreaterThanOrEqual(teaseAuraLevel(s - 1, 1));
    expect(teaseAuraLevel(4, 1)).toBeLessThanOrEqual(1);
    expect(teaseGlowPop(0)).toBeGreaterThan(teaseGlowPop(1));
    expect(teaseGlowPop(1)).toBe(1);
    expect([0, 1, 2].map(teaseBeatFrames)).toEqual([0, 0, 0]);
    expect(teaseBeatFrames(3)).toBeGreaterThan(teaseBeatFrames(4));
    expect(teaseBeatFrames(4)).toBeGreaterThan(0);
    expect(teaseTremble(0, 12.3)).toBe(0); // a Common sits still
    // below Legendary the rotation is the slow wobble alone; from Legendary a faster tremble rides it
    let maxEpic = 0, maxLeg = 0;
    for (let t = 0; t < 400; t += 0.5) { maxEpic = Math.max(maxEpic, Math.abs(teaseTremble(2, t))); maxLeg = Math.max(maxLeg, Math.abs(teaseTremble(3, t))); }
    expect(maxEpic).toBeLessThanOrEqual(teaseWobble(2) + 1e-9);
    expect(maxLeg).toBeGreaterThan(teaseWobble(3));
  });

  it('the summary raises the best pull: Epic and up only, best first, the earlier card on a tie', () => {
    const c = (rarity: PackCard['rarity']): PackCard => ({ rarity } as PackCard);
    expect(summaryBest([c('common'), c('rare')])).toEqual([]);
    expect(summaryBest([c('epic'), c('common'), c('ancient'), c('legendary'), c('epic')])).toEqual([2, 3, 0, 4]);
    expect(summaryBest([c('legendary'), c('legendary')])).toEqual([0, 1]);
  });

  it('the wrapper only gets more crumpled as it is worked, up to a cap, and the foil recordings exist on disk', () => {
    const h = newHandling();
    expect(stepHandling(h, 0, 0.9, 0.9, 1)).toBe(0); // not held: moving the hand works nothing
    let worked = 0;
    for (let i = 0; i < 400; i++) worked += stepHandling(h, 1, i % 2 ? 0.1 : 0.9, 0.5, 1);
    expect(worked).toBeGreaterThan(0);
    expect(h.wear).toBeGreaterThan(0);
    expect(h.wear).toBeLessThanOrEqual(WEAR_MAX);
    const before = h.wear;
    for (let i = 0; i < 60; i++) stepHandling(h, 0, 0.5, 0.5, 1);
    expect(h.wear).toBe(before); // letting go never smooths it out
    expect(h.grip).toBe(0);
    const audio = fileURLToPath(new URL('../../audio/', import.meta.url));
    for (const v of Object.values(FOIL)) for (const f of Array.isArray(v) ? v : [v]) expect(() => readFileSync(audio + f.clip + '.mp3'), f.clip).not.toThrow();
  });

  it('the card beats are RECORDED clips that exist on disk, and the tease pitch climbs one step per rarity', () => {
    expect(TEASE_RATES).toHaveLength(COSMETIC_RARITIES.length);
    for (let i = 1; i < TEASE_RATES.length; i++) expect(TEASE_RATES[i]!).toBeGreaterThan(TEASE_RATES[i - 1]!);
    const audio = fileURLToPath(new URL('../../audio/', import.meta.url));
    for (const list of Object.values(CARD_CUES)) {
      for (const cue of list) {
        const found = ['.mp3', '.wav', '.ogg'].some((ext) => { try { readFileSync(audio + cue.clip + ext); return true; } catch { return false; } });
        expect(found, cue.clip).toBe(true);
        expect(cue.gain).toBeGreaterThan(0);
      }
    }
  });
});
