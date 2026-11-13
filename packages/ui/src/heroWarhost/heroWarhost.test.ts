// @vitest-environment jsdom
/**
 * THE WARHOST HERO ATTACK (the Ancient of War, ANCIENT): a silly army of tiny soldiers delivers the blow. The shared
 * four tiers; the tuner values; the pure plan (Tier 1 the eager recruit who trips; Tier 2 the squad and the straggler's
 * golden arrow; Tier 3 the bickering mages and the cavalry wedge; Tier 4 the drums, the mages' barrage, the boulder, the
 * host and the banner); the pure staging (every soldier, shot and banner from the two
 * portrait points: on screen, from the striker's side, in both directions, the same for the same seed); the runner on
 * the shared clock (the blow lands exactly ONCE; every exit puts the portraits and the camera back); the headless
 * scene. No Ancient art is used.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { HERO_ATTACK_TIER_THRESHOLDS, tierOf } from '../heroAttack/tiers';
import { DEV_HERO_ATTACK_CHOICES } from '../heroBlast/heroAttackStyle';
import {
  HERO_WARHOST_CLIP_KEYS, HERO_WARHOST_DEFAULTS, HERO_WARHOST_RANGES, WARHOST_BANNER_TALL, WARHOST_BEARER_SIZE, WARHOST_BOLT_MS, WARHOST_CAPS, WARHOST_CHEERERS,
  WARHOST_DRUM_QUICKEN, WARHOST_KO_CHEERERS, WARHOST_PLANT_SIZE,
  WARHOST_RUMBLE_AMP, WARHOST_STRIKE_IN, clampHeroWarhostValue, heroWarhostConfigJson, shotAt, troopAt, warhostCameraAt, warhostCameraFocus, warhostCues,
  warhostPlan, warhostRumble, warhostScale, warhostSlowExtraMs, warhostStage, wedgeRows, type HeroWarhostNumKey, type ShotAt, type TroopAt,
} from './heroWarhostConfig';
import { HeroWarhostScene, MAX_WARHOST_SPRITES, type HeroWarhostTextures } from './heroWarhostScene';
import { warhostAtlasLayout, WARHOST_ATLAS_W } from './heroWarhostTextures';
import { playHeroWarhost, warhostSeed, type HeroWarhostOptions } from './heroWarhost';
import { SPEC } from '../HeroWarhostTuner';
import { formationOf, leadInOf } from '../heroAttack/formationFixtures';
import { ATTACK_FX_CLIPS } from '../audio/codeClips';

const W = Texture.WHITE;
const TEX: HeroWarhostTextures = {
  glow: W, spark: W, streak: W, ring: W, beam: W, ribbonSoft: W, ribbonBody: W, sigil: W, star: W,
  infA: W, infB: W, infStand: W, spearWind: W, spearThrown: W, cheer: W, bareA: W, bareB: W, archA: W, archB: W, archStand: W, archDraw: W, archLoose: W,
  archCheer: W, cavA: W, cavB: W, mage: W, mageCast: W, drumA: W, drumB: W, bannerA: W, bannerB: W, spear: W, arrow: W, rock: W, dust: W,
};
const LOOK = { soldierPx: 46, cavalryPx: 70, dust: 1, impactSize: 1, spellSize: 1 };
const C = HERO_WARHOST_DEFAULTS;
const plan = (total: number, o: { knockout?: boolean; knockoutVariant?: boolean; reduced?: boolean } = {}) => warhostPlan({ total, distance: 1600, leadIn: leadInOf([total], o.reduced), ...o }, C);
const SCREEN = { x: 0, y: 0, w: 1920, h: 1080 };
/** The two portraits as the game lays them out: yours bottom left, the foe's top right. */
const ME = { x: 150, y: 850 }, FOE = { x: 1790, y: 130 };
const R = 130;
const TOTALS = [3, 8, 14, 40] as const;

describe('the tiers', () => {
  it('uses the shared thresholds; a knockout plays Tier 4 (the host)', () => {
    expect({ tier2At: C.tier2At, tier3At: C.tier3At, tier4At: C.tier4At }).toEqual(HERO_ATTACK_TIER_THRESHOLDS);
    for (let d = 0; d <= 60; d++) expect(plan(d).tier, `dmg ${d}`).toBe(tierOf(d));
    expect(plan(2, { knockout: true })).toMatchObject({ tier: 4, kind: 'host' });
    expect(TOTALS.map((d) => plan(d).kind)).toEqual(['spear', 'archers', 'cavalry', 'host']);
  });
});

describe('the tuner values', () => {
  it('defaults in range; clamping; every key has a control; Copy JSON; all four tier buttons on top', () => {
    for (const [k, [min, max]] of Object.entries(HERO_WARHOST_RANGES)) {
      const v = C[k as HeroWarhostNumKey];
      expect(v, k).toBeGreaterThanOrEqual(min);
      expect(v, k).toBeLessThanOrEqual(max);
    }
    expect(clampHeroWarhostValue('t4Troops', 999)).toBe(22);
    expect(clampHeroWarhostValue('colorRed', 'red')).toBe(C.colorRed);
    const keys = new Set(SPEC.controls.map((c) => c.key));
    for (const k of Object.keys(C)) expect(keys.has(k as never), k).toBe(true);
    expect(JSON.parse(heroWarhostConfigJson(C)).previewParts).toBeUndefined();
    expect(SPEC.buttonsOnTop).toBe(true);
    const labels = SPEC.actions!.map((a) => a.label);
    for (const n of ['(3)', '(8)', '(12)', '(40)']) expect(labels.some((l) => l.includes(n)), n).toBe(true);
    // Tier names (owner 2026-11-13): this attack's own groups, labels and hints say Tier 1 to Tier 4, never roman numerals.
    const own = SPEC.controls.filter((c) => c.key !== ('attackStyle' as never));
    for (const c of own) for (const text of [c.label, c.hint ?? '', c.group ?? '']) expect(text, String(c.key)).not.toMatch(/\b(I|II|III|IV)\b|Huge|Small|Medium/);
    expect(DEV_HERO_ATTACK_CHOICES).toContain('warhost');
  });

  it('the host wears the Ancient of War\'s red; no clip is the rune-select implosion or the clock; nothing of the source attack is left', () => {
    expect(C.colorRed).toBe('#ff5a4f');
    for (const [k, v] of Object.entries(C)) if (k.endsWith('Clip')) expect(String(v), k).not.toMatch(/runeselect|thymepiece|sparkle/i);
    expect(Object.keys(C).join(' ')).not.toMatch(/dart|clock|slowFx|dome|rift|ghost/i);
  });

  it('the biggest host the caps allow still fits the sprite pool', () => {
    // Foot, horse, arrows, the mages (body, gem) and their spells (lightning: 14 a bolt), drummers, the boulder, banners.
    const most = WARHOST_CAPS.ranks * WARHOST_CAPS.files + 2 * WARHOST_CAPS.flank + WARHOST_CAPS.volleys * WARHOST_CAPS.arrows + 2 * WARHOST_CAPS.mages
      + 2 * WARHOST_CAPS.mages * 14 + WARHOST_CAPS.drummers + 3 + 8 + 12;
    expect(most).toBeLessThan(MAX_WARHOST_SPRITES - 300); // room for the dust and the trails
  });
});

describe('the plan', () => {
  it('Tier 1, the eager recruit: out, TRIPS on his face, gets up, plants, throws, the spear lands (the blow), a cheer, home', () => {
    const p = plan(3);
    const order = [p.chargeAt, p.marchAt, p.tripAt, p.upAt, p.arriveAt, p.looseAt, p.impactAt, p.cheerAt, p.homeAt, p.endAt];
    for (let i = 1; i < order.length; i++) expect(order[i]!, `beat ${i}`).toBeGreaterThan(order[i - 1]!);
    expect(p.upAt - p.tripAt).toBe(C.tripMs); // he lies there long enough to read
    expect(C.tripMs).toBeGreaterThanOrEqual(400);
    expect(p.spells).toEqual([]);
    expect(p.mages).toBe(0);
    expect(p.hits).toEqual([]);
    expect(p.buffets).toEqual([]);
    expect(p.drums).toEqual([]);
    expect(p.hornAt).toBe(-1);
  });

  it('Tier 2, the squad: a held draw, an arrow rain (ticks); the one who ran the wrong way is lost, turns, gets back and looses the LAST arrow: the blow', () => {
    const p = plan(8);
    expect(p.troops).toBe(C.t2Troops);
    expect(p.troops).toBeGreaterThanOrEqual(5);
    expect(p.troops).toBeLessThanOrEqual(8);
    expect(p.looseAt - p.arriveAt).toBe(C.t2HoldMs); // the held beat
    expect(p.lands).toHaveLength(p.troops * C.arrowsPer + 1);
    for (let i = 1; i < p.lands.length; i++) expect(p.lands[i]!).toBeGreaterThan(p.lands[i - 1]!); // a patter, never all at once
    expect(p.impactAt).toBe(p.lands[p.lands.length - 1]);
    expect(p.hits).toEqual(p.lands.slice(0, -1));
    // The straggler: lost while the line draws, turns back, is in the line, then looses after the line is done.
    const order = [p.marchAt, p.lostAt, p.turnAt, p.backAt, p.lateAt, p.impactAt];
    for (let i = 1; i < order.length; i++) expect(order[i]!, `beat ${i}`).toBeGreaterThan(order[i - 1]!);
    expect(p.turnAt - p.lostAt).toBeGreaterThan(300); // long enough to look about
    expect(p.lateAt).toBeGreaterThan(p.hits[p.hits.length - 1]!); // everyone else is done: then his
    expect(p.impactAt - p.hits[p.hits.length - 1]!).toBeGreaterThan(250); // a beat of silence before the golden arrow
    expect(p.cheerAt).toBeGreaterThan(p.impactAt);
    expect(p.homeAt).toBeGreaterThan(p.cheerAt);
  });

  it('Tier 3, the cavalry and the mages: the horn at once; two mages bicker, flare and cast a fireball and lightning (ticks) before the point rider (the blow); every row after it buffets', () => {
    const p = plan(14);
    expect(p.hornAt).toBe(p.chargeAt);
    expect(p.mages).toBe(2);
    const order = [p.chargeAt, p.mageAt, p.bickerAt, p.bickerEnd, p.runeAt, p.marchAt, p.impactAt];
    for (let i = 1; i < order.length; i++) expect(order[i]!, `beat ${i}`).toBeGreaterThan(order[i - 1]!);
    expect(p.bickerEnd - p.bickerAt).toBeGreaterThanOrEqual(300);
    expect(p.spells.map((sp) => sp.school)).toEqual(['fire', 'bolt']);
    for (const sp of p.spells) { expect(sp.castAt).toBeGreaterThan(p.runeAt); expect(sp.landAt).toBeGreaterThan(sp.castAt); expect(sp.landAt).toBeLessThan(p.impactAt); }
    expect(p.spells[1]!.landAt - p.spells[1]!.castAt).toBe(WARHOST_BOLT_MS); // lightning strikes, it does not fly
    expect(p.cryAt).toBe(p.marchAt);
    expect(p.troops).toBeGreaterThanOrEqual(9);
    expect(p.troops).toBeLessThanOrEqual(12);
    const rows = wedgeRows(p.troops);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(p.troops);
    expect(rows[0]).toBe(1); // a wedge: one at the point
    expect(p.buffets).toHaveLength(rows.length - 1);
    for (const at of p.buffets) expect(at).toBeGreaterThan(p.impactAt);
    expect(p.passAt).toBe(p.buffets[p.buffets.length - 1]);
    expect(p.hits).toEqual([]);
  });

  it('Tier 4, the host: four drums QUICKEN, the horn answers the last, the charge sets out a beat after it; the front rank is the blow; the banner goes in after the last rank', () => {
    const p = plan(40);
    expect(p.drums).toHaveLength(C.drums);
    expect(C.drums).toBeGreaterThanOrEqual(4);
    expect(p.drums[1]! - p.drums[0]!).toBe(C.drumMs);
    // Each gap is shorter than the one before it: a build-up, not a metronome.
    for (let i = 2; i < p.drums.length; i++) expect(p.drums[i]! - p.drums[i - 1]!).toBeCloseTo(C.drumMs * (1 - WARHOST_DRUM_QUICKEN * (i - 1)), 6);
    for (let i = 2; i < p.drums.length; i++) expect(p.drums[i]! - p.drums[i - 1]!).toBeLessThan(p.drums[i - 1]! - p.drums[i - 2]!);
    expect(p.hornAt).toBeGreaterThan(p.drums[p.drums.length - 1]!);
    expect(p.marchAt - p.hornAt).toBeGreaterThanOrEqual(160); // the horn is heard before the host moves
    expect(p.marchAt - p.chargeAt).toBeGreaterThanOrEqual(1000); // a real build-up
    expect(p.impactAt).toBeGreaterThan(p.marchAt);
    expect(p.passAt - p.impactAt).toBe((p.troops - 1) * C.rankMs);
    expect(p.buffets.length).toBeGreaterThanOrEqual(3);
    for (const at of p.buffets) { expect(at).toBeGreaterThan(p.impactAt); expect(at).toBeLessThanOrEqual(p.passAt); }
    expect(p.volleys).toHaveLength(C.volleys);
    expect(C.volleys).toBeGreaterThanOrEqual(3); // the sky darkened
    expect(p.volleys.filter((at) => at < p.impactAt).length).toBeGreaterThanOrEqual(2);
    // The drum line beats the drums, then the march under the host.
    expect(p.drummers).toBe(C.drummers);
    expect(p.beats.slice(0, p.drums.length)).toEqual(p.drums);
    expect(p.beats.length).toBeGreaterThan(p.drums.length + 2);
    // THE MAGES: they pop out and two bicker during the drums, flare after the horn, then a first round lands over the end
    // of the charge and a second round ALL lands on the blow, with the catapult boulder.
    expect(p.mages).toBe(C.mages4);
    expect(p.bickerAt).toBeGreaterThan(p.mageAt);
    expect(p.bickerEnd).toBeLessThanOrEqual(p.hornAt);
    expect(p.runeAt).toBeGreaterThan(p.hornAt);
    const r1 = p.spells.filter((sp) => sp.round === 1), r2 = p.spells.filter((sp) => sp.round === 2);
    expect(r1).toHaveLength(p.mages);
    expect(new Set(r1.map((sp) => sp.school))).toEqual(new Set(['fire', 'frost', 'bolt']));
    for (const sp of r1) { expect(sp.landAt).toBeLessThan(p.impactAt); expect(sp.castAt).toBeGreaterThanOrEqual(p.runeAt); }
    for (const sp of r2) expect(sp.landAt).toBe(p.impactAt);
    expect(r2.filter((sp) => sp.school === 'rock')).toHaveLength(1);
    expect(warhostPlan({ total: 40, distance: 1600 }, { ...C, boulder: 0 }).spells.some((sp) => sp.school === 'rock')).toBe(false);
    // The straggler is lost while the host goes, and chases it.
    expect(p.lostAt).toBeGreaterThan(p.marchAt);
    expect(p.turnAt).toBeGreaterThan(p.lostAt);
    expect(p.turnAt).toBeLessThan(p.passAt);
    expect(p.plantAt).toBe(p.passAt + C.dustMs);
    expect(p.cheerAt).toBeGreaterThan(p.plantAt); // the thud first, then the cheer
    expect(p.endAt).toBe(p.plantAt + C.bannerMs + C.t4SettleMs); // the banner flies for its beat, then it all clears
    expect(C.bannerMs).toBeGreaterThanOrEqual(1000); // the aftermath lingers
    expect(p.hits).toEqual([]);
    // The dial changes the count; it is capped; a wild build-up never pushes the horn past the charge.
    expect(warhostPlan({ total: 40, distance: 1600 }, { ...C, drums: 2 }).drums).toHaveLength(2);
    const wild = warhostPlan({ total: 40, distance: 1600 }, { ...C, drums: 99, drumMs: 800 });
    expect(wild.drums).toHaveLength(WARHOST_CAPS.drums);
    expect(wild.marchAt).toBeGreaterThanOrEqual(wild.hornAt + 160);
    expect(wild.impactAt).toBeGreaterThan(wild.marchAt);
  });

  it('exactly one impact cue on every look, in time order, ending on `end`', () => {
    for (const d of TOTALS) {
      const cues = warhostCues(plan(d));
      expect(cues.filter((q) => q.kind === 'impact'), `dmg ${d}`).toHaveLength(1);
      for (let i = 1; i < cues.length; i++) expect(cues[i]!.at).toBeGreaterThanOrEqual(cues[i - 1]!.at);
      expect(cues[cues.length - 1]!.kind).toBe('end');
    }
    const four = warhostCues(plan(40));
    expect(four.filter((q) => q.kind === 'drum')).toHaveLength(C.drums);
    expect(four.filter((q) => q.kind === 'plant')).toHaveLength(1);
    const p4 = plan(40);
    expect(four.filter((q) => q.kind === 'cast')).toHaveLength(p4.spells.length);
    expect(four.filter((q) => q.kind === 'spell')).toHaveLength(p4.spells.length);
    // On the blow the impact cue fires before the spells that land with it (the consequence first, then their FX).
    const at = four.filter((q) => q.at === p4.impactAt).map((q) => q.kind);
    expect(at[0]).toBe('impact');
    for (const d of [3, 8, 14]) { const k = warhostCues(plan(d)).map((q) => q.kind); expect(k).toContain(d === 3 ? 'trip' : d === 8 ? 'turn' : 'bicker'); }
  });

  it('pace: each tier longer than the last, Tier 4 the long one', () => {
    const len = (d: number): number => { const p = plan(d); return p.endAt - p.chargeAt + warhostSlowExtraMs(p); };
    expect(len(3)).toBeLessThan(2400);
    expect(len(8)).toBeLessThan(2900);
    expect(len(14)).toBeLessThan(2900);
    // Tier 4: about a second longer than the shipped top looks (Soccer 3308, Frost 3083): an Ancient with an epilogue.
    expect(len(40)).toBeGreaterThanOrEqual(3900);
    expect(len(40)).toBeLessThanOrEqual(4700);
    expect(len(8)).toBeGreaterThan(len(3));
    expect(len(40)).toBeGreaterThan(len(14));
  });

  it('the clock never stops: only the Knockout variant dips it, and never to a freeze (R-PROG-ATTACK-10)', () => {
    for (const d of TOTALS) { const p = plan(d); expect(p.dip).toBeNull(); expect(warhostScale(p, p.impactAt + 10)).toBe(1); }
    const ko = plan(40, { knockout: true, knockoutVariant: true });
    expect(ko.ko).toBe(true);
    expect(ko.dip).not.toBeNull();
    for (let t = ko.impactAt - 50; t < ko.impactAt + 500; t += 5) expect(warhostScale(ko, t)).toBeGreaterThan(0.09);
    expect(warhostSlowExtraMs(ko)).toBeLessThan(500);
    expect(Object.keys(ko).join(' ')).not.toMatch(/hitStop|slamStop/i);
  });

  it('reduced motion: no soldiers; the blow lands at the end of the formation', () => {
    const p = plan(40, { reduced: true });
    expect(p.impactAt).toBe(leadInOf([40], true));
    expect(warhostStage(p, ME, FOE, R, R, C, 1, 1, SCREEN).troops).toEqual([]);
    expect(warhostCues(p).map((q) => q.kind)).toEqual(['impact', 'end']);
  });
});

describe('the staging (from the two portrait points)', () => {
  const dirs: [string, typeof ME, typeof FOE][] = [['you strike', ME, FOE], ['the foe strikes', FOE, ME]];
  const onScreen = (q: { x: number; y: number }): boolean => q.x >= 0 && q.x <= 1920 && q.y >= 0 && q.y <= 1080;
  /** The top of a shot's arc (the quadratic at its middle). */
  const apex = (sh: { from: { x: number; y: number }; ctrl: { x: number; y: number }; to: { x: number; y: number } }) => ({ x: 0.25 * sh.from.x + 0.5 * sh.ctrl.x + 0.25 * sh.to.x, y: 0.25 * sh.from.y + 0.5 * sh.ctrl.y + 0.25 * sh.to.y });
  const along = (q: { x: number; y: number }, a: typeof ME, d: typeof FOE): number => { const L = Math.hypot(d.x - a.x, d.y - a.y); return ((q.x - a.x) * (d.x - a.x) + (q.y - a.y) * (d.y - a.y)) / L; };

  it('Tier 1: one spearman runs out from the striker, trips on the way (on screen), stands on screen, and his spear lands on the struck portrait; he goes home', () => {
    for (const [name, a, d] of dirs) {
      const p = plan(3);
      const st = warhostStage(p, a, d, R, R, C, 1, 7, SCREEN);
      expect(st.troops, name).toHaveLength(1);
      const who = st.troops[0]!;
      expect(who.unit).toBe('spear');
      expect(Math.hypot(who.p0.x - a.x, who.p0.y - a.y)).toBeLessThan(R); // from the striking hero
      expect(onScreen(who.p1), name).toBe(true);
      expect(along(who.p1, a, d)).toBeGreaterThan(R); // out past his own portrait
      expect(along(who.p1, a, d)).toBeLessThan(Math.hypot(d.x - a.x, d.y - a.y) * 0.45); // and still the striker's man
      expect(who.p2).toEqual(who.p0); // home
      expect(who.face).toBe(a.x < d.x ? 1 : -1);
      expect(who.viaKind).toBe('trip');
      expect(onScreen(who.via!), name).toBe(true);
      expect(along(who.via!, a, d)).toBeGreaterThan(along(who.p0, a, d));
      expect(along(who.via!, a, d)).toBeLessThan(along(who.p1, a, d)); // on his way out
      expect([who.tv0, who.tv1]).toEqual([p.tripAt, p.upAt]);
      expect(st.shots).toHaveLength(1);
      const spear = st.shots[0]!;
      expect(spear).toMatchObject({ kind: 'spear', stick: true, t0: p.looseAt, t1: p.impactAt, trail: true });
      expect(Math.hypot(spear.to.x - d.x, spear.to.y - d.y)).toBeLessThan(R);
      expect(onScreen(apex(spear)), name).toBe(true); // the arc's apex stays on screen
      expect(apex(spear).y).toBeLessThan((spear.from.y + spear.to.y) / 2 - 40); // and it IS an arc
    }
  });

  it('Tier 2: the archers form a line across the way to the target, on screen; every arrow lands on the struck portrait at its plan time; the straggler runs the WRONG way first', () => {
    for (const [name, a, d] of dirs) {
      const p = plan(8);
      const all = warhostStage(p, a, d, R, R, C, 1, 7, SCREEN);
      expect(all.troops, name).toHaveLength(p.troops + 1);
      const late = all.troops[p.troops]!;
      expect(late).toMatchObject({ unit: 'archer', viaKind: 'lost', tv0: p.lostAt, tv1: p.turnAt, t1: p.backAt, looseAt: p.lateAt });
      // The WRONG way: off past the far end of the line from his own slot.
      const latOf = (q: { x: number; y: number }): number => (q.x - a.x) * all.n.x + (q.y - a.y) * all.n.y;
      const lineLat = all.troops.slice(0, p.troops).map((tr) => latOf(tr.p1));
      expect(Math.sign(latOf(late.via!)), name).toBe(-Math.sign(latOf(late.p1)));
      expect(Math.abs(latOf(late.via!)), name).toBeGreaterThan(Math.max(...lineLat.map(Math.abs)) * 0.9);
      expect(onScreen(late.via!), name).toBe(true);
      expect(onScreen(late.p1), name).toBe(true);
      const st = { ...all, troops: all.troops.slice(0, p.troops) };
      for (const tr of st.troops) { expect(tr.unit).toBe('archer'); expect(onScreen(tr.p1), name).toBe(true); expect(tr.t1).toBeLessThanOrEqual(p.arriveAt); }
      expect(st.troops.filter((tr) => tr.cheerAt > p.impactAt)).toHaveLength(1); // one of the squad cheers
      // A line: far wider across the way than it is deep along it.
      const al = st.troops.map((tr) => along(tr.p1, a, d));
      const lat = st.troops.map((tr) => (tr.p1.x - a.x) * st.n.x + (tr.p1.y - a.y) * st.n.y);
      expect(Math.max(...lat) - Math.min(...lat)).toBeGreaterThan(4 * (Math.max(...al) - Math.min(...al)));
      expect(st.shots).toHaveLength(p.lands.length);
      st.shots.forEach((sh, k) => {
        expect(sh.kind).toBe('arrow');
        expect(sh.t1).toBe(p.lands[k]);
        expect(sh.t0).toBeGreaterThanOrEqual(p.looseAt);
        expect(sh.trail).toBe(true);
        expect(Math.hypot(sh.to.x - d.x, sh.to.y - d.y), name).toBeLessThan(R);
        expect(onScreen(apex(sh)), name).toBe(true);
        expect(apex(sh).y, name).toBeLessThan((sh.from.y + sh.to.y) / 2 - 60); // arcing
      });
      const gold = st.shots[st.shots.length - 1]!;
      expect(gold).toMatchObject({ gold: true, t0: p.lateAt, t1: p.impactAt, to: st.strike });
      expect(st.shots.filter((sh) => sh.gold)).toHaveLength(1);
      // Sticking at slightly different angles.
      expect(new Set(st.shots.map((sh) => sh.lean.toFixed(3))).size).toBeGreaterThan(p.lands.length / 3);
    }
  });

  it('Tier 3: a wedge comes from the striker\'s side, rides THROUGH the struck portrait at a steady pace, then splits and wheels HOME round both sides of it, on screen', () => {
    for (const [name, a, d] of dirs) {
      const p = plan(14);
      const all = warhostStage(p, a, d, R, R, C, 1, 7, SCREEN);
      const st = { ...all, troops: all.troops.filter((tr) => tr.unit === 'cav') };
      expect(st.troops, name).toHaveLength(p.troops);
      // The point rider IS the blow: he is on the portrait's centre at the impact, and turns just beyond it.
      const point = st.troops[0]!;
      const o: TroopAt = { x: 0, y: 0, state: 'wait', alpha: 0, dir: 1 };
      troopAt(point, p.impactAt, o);
      expect(Math.hypot(o.x - d.x, o.y - d.y), name).toBeLessThan(R * 0.35);
      expect(point.t1).toBeGreaterThan(p.impactAt);
      expect(point.t1).toBeLessThan(p.impactAt + 120);
      const sides = new Set<number>();
      const L = Math.hypot(d.x - a.x, d.y - a.y);
      for (const tr of st.troops) {
        expect(tr.unit).toBe('cav');
        expect(tr.through).toBe(true);
        expect(along(tr.p0, a, d), name).toBeLessThan(0); // from behind the striker
        expect(Math.hypot(tr.p1.x - d.x, tr.p1.y - d.y), name).toBeLessThan(R * 1.6); // over the portrait
        // THE WHEEL: the turn and the whole ride home are ON SCREEN (the first pass left by the nearest edge).
        expect(onScreen(tr.p1), name).toBe(true);
        expect(onScreen(tr.p2), name).toBe(true);
        expect(along(tr.p2, a, d), name).toBeLessThan(L * 0.75); // well back toward the striker
        expect(Math.hypot(tr.p2.x - d.x, tr.p2.y - d.y), name).toBeGreaterThan(R * 2.5); // clear of the portrait
        expect(tr.t3 - tr.t2).toBeGreaterThan(200); // a real ride, not a pop
        expect(tr.t3).toBeLessThanOrEqual(p.endAt);
        expect(tr.t1).toBeGreaterThanOrEqual(p.impactAt - 10);
        expect(tr.face).toBe(a.x < d.x ? 1 : -1);
        sides.add(Math.sign((tr.p2.x - d.x) * st.n.x + (tr.p2.y - d.y) * st.n.y));
      }
      expect(sides.has(1) && sides.has(-1), name).toBe(true); // the wedge splits both ways
    }
  });

  it('Tier 3: two mages by the striker on screen, facing each other to bicker; their spells leave the staff tip and land on the struck portrait', () => {
    for (const [name, a, d] of dirs) {
      const p = plan(14);
      const st = warhostStage(p, a, d, R, R, C, 1, 7, SCREEN);
      const mages = st.troops.filter((tr) => tr.unit === 'mage');
      expect(mages, name).toHaveLength(2);
      for (const m of mages) { expect(onScreen(m.p1), name).toBe(true); expect(Math.hypot(m.p1.x - a.x, m.p1.y - a.y)).toBeLessThan(R * 2.6); expect(m.bickerAt).toBe(p.bickerAt); }
      expect(mages[0]!.argueFace).toBe(-mages[1]!.argueFace); // face to face
      expect(st.spells).toHaveLength(2);
      st.spells.forEach((sp, i) => {
        expect(sp.school).toBe(p.spells[i]!.school);
        expect([sp.t0, sp.t1]).toEqual([p.spells[i]!.castAt, p.spells[i]!.landAt]);
        expect(st.troops[sp.caster]!.unit).toBe('mage');
        expect(Math.hypot(sp.to.x - d.x, sp.to.y - d.y), name).toBeLessThan(R);
        expect(Math.hypot(sp.from.x - st.troops[sp.caster]!.p1.x, sp.from.y - st.troops[sp.caster]!.p1.y)).toBeLessThan(200);
        expect(st.troops[sp.caster]!.casts).toContain(sp.t0);
      });
    }
  });

  it('Tier 1: the spear sticks ON the struck face, well inside the rim (the rail\'s orbs sit on the rim and used to cover it)', () => {
    for (const [name, a, d] of dirs) {
      const st = warhostStage(plan(3), a, d, R, R, C, 1, 7, SCREEN);
      expect(Math.hypot(st.strike.x - d.x, st.strike.y - d.y), name).toBeCloseTo(R * WARHOST_STRIKE_IN, 6);
      expect(WARHOST_STRIKE_IN).toBeLessThanOrEqual(0.5);
      expect(st.shots[0]!.to).toEqual(st.strike);
    }
  });

  it('Tier 4: rank after rank of foot, cavalry on the flanks, volleys overhead, banners behind the striker, one bearer and his banner on the struck portrait', () => {
    for (const [name, a, d] of dirs) {
      const p = plan(40);
      const st = warhostStage(p, a, d, R, R, C, 1, 7, SCREEN);
      const foot = st.troops.filter((tr) => tr.unit === 'inf' && !tr.via), horse = st.troops.filter((tr) => tr.unit === 'cav'), bearers = st.troops.filter((tr) => tr.unit === 'bearer');
      expect(foot, name).toHaveLength(p.troops * C.hostFiles);
      expect(foot.length).toBeGreaterThanOrEqual(150);
      expect(horse).toHaveLength(2 * C.hostCavalry);
      expect(bearers).toHaveLength(1);
      expect(bearers[0]!.size).toBe(WARHOST_BEARER_SIZE); // tiny, next to the huge banner
      for (const tr of foot) { expect(along(tr.p0, a, d), name).toBeLessThan(0); expect(tr.t1).toBeGreaterThan(p.impactAt - C.rankMs); expect(tr.t1).toBeLessThan(p.passAt + C.rankMs); }
      // The front rank hits on the blow.
      expect(Math.min(...foot.map((tr) => tr.t1))).toBeLessThan(p.impactAt + C.rankMs * 0.5);
      // Funnelling: tighter across the target than where it set out.
      const wide = (key: 'p0' | 'p1'): number => { const l = foot.map((tr) => (tr[key].x - a.x) * st.n.x + (tr[key].y - a.y) * st.n.y); return Math.max(...l) - Math.min(...l); };
      expect(wide('p1')).toBeLessThan(wide('p0') * 0.7);
      // Cavalry outside the foot on both flanks.
      const latOf = (tr: (typeof foot)[number]): number => (tr.p0.x - a.x) * st.n.x + (tr.p0.y - a.y) * st.n.y;
      const half = Math.max(...foot.map((tr) => Math.abs(latOf(tr))));
      expect(horse.filter((tr) => latOf(tr) > half)).toHaveLength(C.hostCavalry);
      expect(horse.filter((tr) => latOf(tr) < -half)).toHaveLength(C.hostCavalry);
      expect(st.shots).toHaveLength(C.volleys * C.hostArrows);
      for (const sh of st.shots) expect(onScreen(sh.to), name).toBe(true);
      expect(st.shots.filter((sh) => sh.trail).length).toBeGreaterThan(st.shots.length / 4);
      // The drum line, the mages, the barrage, the boulder, the straggler.
      const drummers = st.troops.filter((tr) => tr.unit === 'drummer'), mages = st.troops.filter((tr) => tr.unit === 'mage');
      expect(drummers).toHaveLength(C.drummers);
      for (const tr of drummers) { expect(onScreen(tr.p1), name).toBe(true); expect(tr.t0).toBeLessThanOrEqual(p.drums[0]!); expect(Math.hypot(tr.p1.x - a.x, tr.p1.y - a.y)).toBeLessThan(R * 2.6); }
      expect(mages).toHaveLength(C.mages4);
      for (const tr of mages) expect(onScreen(tr.p1), name).toBe(true);
      expect(new Set(mages.map((tr) => tr.school))).toEqual(new Set(['fire', 'frost', 'bolt']));
      expect(st.spells).toHaveLength(p.spells.length);
      for (const sp of st.spells) expect(Math.hypot(sp.to.x - d.x, sp.to.y - d.y), name).toBeLessThan(R);
      const rock = st.spells.find((sp) => sp.school === 'rock')!;
      expect(rock.caster).toBe(-1);
      expect(rock.to).toEqual(d);
      expect(apex(rock).y, name).toBeLessThan(Math.min(a.y, d.y) + 1); // lobbed high over everything
      expect(onScreen(rock.from), name).toBe(false); // from a catapult off screen
      expect(onScreen(apex(rock)), name).toBe(true);
      const straggler = st.troops.filter((tr) => tr.unit === 'inf' && tr.viaKind === 'lost');
      expect(straggler).toHaveLength(1);
      expect(along(straggler[0]!.via!, a, d)).toBeLessThan(0);
      expect(straggler[0]!.t1).toBeGreaterThan(p.passAt); // he crosses after the whole host
      // A banner round the striker for every drum, on screen and all in different places; one BIG one on the struck
      // portrait, carried in by the bearer.
      const rally = st.banners.filter((b) => !b.follow), planted = st.banners.filter((b) => b.follow);
      expect(rally).toHaveLength(p.drums.length);
      expect(new Set(rally.map((b) => `${Math.round(b.at.x)},${Math.round(b.at.y)}`)).size).toBe(rally.length);
      rally.forEach((b, i) => { expect(onScreen(b.at), name).toBe(true); expect(Math.hypot(b.at.x - a.x, b.at.y - a.y)).toBeLessThan(R * 1.6); expect(b.t0).toBeGreaterThanOrEqual(p.drums[i]!); expect(b.t2).toBeLessThan(p.plantAt); });
      expect(planted).toHaveLength(1);
      expect(planted[0]).toMatchObject({ t0: p.plantAt, follow: true });
      expect(Math.hypot(planted[0]!.at.x - d.x, planted[0]!.at.y - d.y)).toBeLessThanOrEqual(R);
      expect(st.troops[planted[0]!.carrier]!.unit).toBe('bearer');
      expect(planted[0]!.t1 - planted[0]!.t0).toBeGreaterThan(800); // it snaps in the wind for a good beat
      // As big as fits: full size with room above the portrait, a little smaller under the top of the screen, and its
      // top never off the view.
      expect(planted[0]!.size).toBeLessThanOrEqual(WARHOST_PLANT_SIZE);
      expect(planted[0]!.size).toBeGreaterThanOrEqual(1.9);
      if (d.y > 500) expect(planted[0]!.size).toBe(WARHOST_PLANT_SIZE);
      expect(planted[0]!.at.y - C.soldierPx * WARHOST_BANNER_TALL * planted[0]!.size, name).toBeGreaterThanOrEqual(0);
      for (const b of rally) expect(planted[0]!.size).toBeGreaterThan(b.size * 1.2); // the biggest banner of the attack
      // The ones who stay and cheer round it: beside the portrait, on screen, cheering after the thud.
      const stay = st.troops.filter((tr) => tr.unit === 'cheerer');
      expect(stay, name).toHaveLength(WARHOST_CHEERERS);
      for (const tr of stay) { expect(onScreen(tr.p1), name).toBe(true); expect(tr.cheerAt).toBeGreaterThan(p.plantAt); expect(tr.t3).toBeLessThanOrEqual(p.endAt); }
      const bearer = bearers[0]!;
      expect(onScreen(bearer.p1), name).toBe(true);
      expect(bearer.t1).toBeLessThanOrEqual(p.plantAt);
      expect(bearer.t3).toBeLessThanOrEqual(p.endAt);
    }
  });

  it('the Knockout: more stay to cheer round the banner (the rest is Tier 4)', () => {
    const base = warhostStage(plan(40), ME, FOE, R, R, C, 1, 7, SCREEN);
    const p = plan(40, { knockout: true, knockoutVariant: true });
    const ko = warhostStage(p, ME, FOE, R, R, C, 1, 7, SCREEN);
    const cheerers = ko.troops.filter((tr) => tr.unit === 'cheerer');
    expect(cheerers).toHaveLength(WARHOST_KO_CHEERERS);
    expect(WARHOST_KO_CHEERERS).toBeGreaterThan(WARHOST_CHEERERS);
    expect(ko.troops.length).toBe(base.troops.length + WARHOST_KO_CHEERERS - WARHOST_CHEERERS);
    for (const tr of cheerers) { expect(tr.cheerAt).toBeGreaterThan(p.plantAt); expect(Math.hypot(tr.p1.x - FOE.x, tr.p1.y - FOE.y)).toBeLessThan(R * 2.6); }
  });

  it('deterministic: the same seed fields the same host; another seed jitters it; nothing reads Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    for (const d of TOTALS) {
      const p = plan(d);
      expect(warhostStage(p, ME, FOE, R, R, C, 1, 42, SCREEN)).toEqual(warhostStage(p, ME, FOE, R, R, C, 1, 42, SCREEN));
    }
    const p = plan(40);
    const one = warhostStage(p, ME, FOE, R, R, C, 1, 42, SCREEN), two = warhostStage(p, ME, FOE, R, R, C, 1, 43, SCREEN);
    expect(one.troops.length).toBe(two.troops.length);
    expect(one.troops.map((tr) => tr.p1)).not.toEqual(two.troops.map((tr) => tr.p1));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(warhostSeed(12, 1500, 'player')).toBe(warhostSeed(12, 1500, 'player'));
    expect(warhostSeed(12, 1500, 'player')).not.toBe(warhostSeed(12, 1500, 'opp'));
  });

  it('a soldier\'s life: waits, runs out, holds, runs home, gone; a rider never holds', () => {
    const o: TroopAt = { x: 0, y: 0, state: 'wait', alpha: 0, dir: 1 };
    const p = plan(3);
    const who = warhostStage(p, ME, FOE, R, R, C, 1, 7, SCREEN).troops[0]!;
    expect(troopAt(who, who.t0 - 1, o).state).toBe('wait');
    expect(troopAt(who, who.t0 + 40, o)).toMatchObject({ state: 'out', dir: 1 });
    // The faceplant: he lies where he fell, then carries on from there.
    expect(troopAt(who, p.tripAt + 100, o)).toMatchObject({ state: 'trip', x: who.via!.x, y: who.via!.y, dir: 1 });
    expect(troopAt(who, p.upAt + 30, o).state).toBe('out');
    // The straggler (Tier 2) looks one way and then the other while lost.
    const late = warhostStage(plan(8), ME, FOE, R, R, C, 1, 7, SCREEN).troops[plan(8).troops]!;
    const looks = new Set<number>();
    for (let t = late.tv0 + 5; t < late.tv1; t += 40) { const q = troopAt(late, t, o); expect(q.state).toBe('lost'); looks.add(q.dir); }
    expect(looks.size).toBe(2);
    expect(troopAt(who, p.looseAt, o)).toMatchObject({ state: 'hold', x: who.p1.x, y: who.p1.y, alpha: 1 });
    expect(troopAt(who, (who.t2 + who.t3) / 2 - 60, o)).toMatchObject({ state: 'back', dir: -1 }); // he turns for home
    expect(troopAt(who, who.t3, o)).toMatchObject({ state: 'gone', alpha: 0 });
    const rider = warhostStage(plan(14), ME, FOE, R, R, C, 1, 7, SCREEN).troops[0]!;
    const speed = (t: number): number => { const a = { ...troopAt(rider, t, o) }, b = troopAt(rider, t + 10, o); return Math.hypot(b.x - a.x, b.y - a.y); };
    expect(troopAt(rider, rider.t1, o).state).toBe('out');
    expect(speed(rider.t1 - 60)).toBeGreaterThan(5);
    expect(Math.abs(speed(rider.t1 - 60) - speed(rider.t0 + 60))).toBeLessThan(0.5); // one steady pace up to the target
  });

  it('a shot\'s life: flies its arc nose first, lands on the point, sticks and twangs, fades', () => {
    const o: ShotAt = { x: 0, y: 0, rot: 0, state: 'wait', alpha: 0 };
    const p = plan(3);
    const spear = warhostStage(p, ME, FOE, R, R, C, 1, 7, SCREEN).shots[0]!;
    expect(shotAt(spear, spear.t0 - 1, o).state).toBe('wait');
    const mid = { ...shotAt(spear, (spear.t0 + spear.t1) / 2, o) };
    expect(mid.state).toBe('fly');
    expect(mid.y).toBeLessThan((spear.from.y + spear.to.y) / 2); // an arc: above the chord
    expect(Math.cos(mid.rot)).toBeGreaterThan(0); // nose toward the target (to the right)
    const stuck = { ...shotAt(spear, spear.t1 + 30, o) };
    expect(stuck).toMatchObject({ state: 'stuck', x: spear.to.x, y: spear.to.y, alpha: 1 });
    expect(shotAt(spear, spear.t1 + 60, o).rot).not.toBeCloseTo(stuck.rot, 3); // the twang
    expect(shotAt(spear, spear.fadeAt + 1000, o).state).toBe('gone');
  });
});

describe('the camera (pure)', () => {
  it('the charge shakes the screen AS IT PASSES: the rumble starts when it sets out, grows all the way across, holds through the trample and dies after', () => {
    for (const d of [14, 40]) {
      const p = plan(d);
      expect(warhostRumble(p, p.marchAt - 1)).toBe(0);
      const q = [0.25, 0.5, 0.75, 1].map((k) => warhostRumble(p, p.marchAt + (p.impactAt - p.marchAt) * k));
      expect(q[0]!).toBeGreaterThan(0.03);
      for (let i = 1; i < q.length; i++) expect(q[i]!).toBeGreaterThan(q[i - 1]!);
      expect(q[3]!).toBeCloseTo(1, 6);
      expect(warhostRumble(p, (p.impactAt + p.passAt) / 2)).toBeCloseTo(1, 6);
      expect(warhostRumble(p, p.passAt + 400)).toBe(0);
      // On screen: several px of shake before the blow lands, more for the host than for ten horses.
      let peak = 0;
      for (let t = p.marchAt; t < p.impactAt - 4; t += 4) { const cm = warhostCameraAt(p, C, t); peak = Math.max(peak, Math.hypot(cm.x, cm.y)); }
      expect(peak, `dmg ${d}`).toBeGreaterThan(d === 40 ? 6 : 3);
    }
    expect(WARHOST_RUMBLE_AMP.host).toBeGreaterThan(WARHOST_RUMBLE_AMP.cavalry);
    expect(warhostRumble(plan(3), plan(3).impactAt)).toBe(0); // a spearman does not shake the ground
  });

  it('Tier 4: the banner going in kicks the view straight DOWN; the view PANS with the charge and pushes in on the barrage', () => {
    const p = plan(40);
    const bare = { ...p, plantAt: -1 };
    const a = warhostCameraAt(p, C, p.plantAt + 4), b = warhostCameraAt(bare, C, p.plantAt + 4);
    expect(a.y - b.y).toBeGreaterThan(p.shakePx * 0.3);
    expect(Math.abs(a.x - b.x)).toBeLessThan(0.01);
    // The pan: the point the view is held on travels with the front of the host, from striker to target.
    const mid = warhostCameraFocus(p, (p.marchAt + p.impactAt) / 2, ME, FOE);
    expect(mid.x).toBeGreaterThan(ME.x + 200);
    expect(mid.x).toBeLessThan(FOE.x - 200);
    // The push in on the barrage: deeper just before the blow than mid-charge.
    expect(warhostCameraAt(p, C, p.impactAt - 10).zoom).toBeGreaterThan(warhostCameraAt(p, C, (p.marchAt + p.impactAt) / 2).zoom + 0.04);
  });

  it('the sound: seventeen clips of its own, every one cued by a default, and every fx clip a default names is in the style\'s list', () => {
    const listed = [...(ATTACK_FX_CLIPS.warhost ?? [])];
    expect(listed.filter((c) => c.startsWith('fx/warhost-')).sort()).toEqual([
      'fx/warhost-bicker', 'fx/warhost-boulder', 'fx/warhost-charge', 'fx/warhost-charge-vo', 'fx/warhost-cheer', 'fx/warhost-clash', 'fx/warhost-drum', 'fx/warhost-fireball',
      'fx/warhost-flap', 'fx/warhost-gallop', 'fx/warhost-horn', 'fx/warhost-loose', 'fx/warhost-thunk', 'fx/warhost-trip', 'fx/warhost-volley', 'fx/warhost-wait-vo', 'fx/warhost-zap',
    ]);
    const used = new Set(HERO_WARHOST_CLIP_KEYS.map((k) => C[k]));
    for (const clip of listed) expect(used.has(clip), clip).toBe(true);
    for (const clip of used) if (clip.startsWith('fx/')) expect(listed, clip).toContain(clip);
    expect(C.sfxRumbleGain).toBeGreaterThan(0);
  });

  it('pushes in through the ready, punches on the blow, rumbles under the host, and is back at rest by the end', () => {
    for (const d of TOTALS) {
      const p = plan(d);
      expect(warhostCameraAt(p, C, p.chargeAt - 1)).toEqual({ zoom: 1, x: 0, y: 0 });
      expect(warhostCameraAt(p, C, p.marchAt).zoom).toBeGreaterThan(1.015);
      const hit = warhostCameraAt(p, C, p.impactAt + 8);
      expect(Math.hypot(hit.x, hit.y), `dmg ${d}`).toBeGreaterThan(p.shakePx * 0.4);
      for (let t = p.chargeAt; t < p.endAt; t += 7) { const cm = warhostCameraAt(p, C, t); expect(cm.zoom).toBeLessThanOrEqual(1.3); expect(Math.hypot(cm.x, cm.y)).toBeLessThanOrEqual(WARHOST_CAPS.shakePx * 1.8); }
      const end = warhostCameraAt(p, C, p.endAt);
      expect(end.zoom).toBeLessThan(1.01);
      expect(Math.hypot(end.x, end.y)).toBeLessThan(1);
    }
  });
});

function manualFrames(): { frames: HeroWarhostOptions['frames']; tick: (ms: number, step?: number) => void; hooked: () => number } {
  const fns: ((dt: number) => void)[] = [];
  return {
    frames: (fn) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; },
    tick: (ms, step = 16) => { for (let t = 0; t < ms; t += step) [...fns].forEach((f) => f(step)); },
    hooked: () => fns.length,
  };
}

function run(over: Partial<HeroWarhostOptions> = {}) {
  const f = manualFrames();
  const root = new Container();
  const onImpact = vi.fn();
  const onDone = vi.fn();
  const host = document.createElement('div');
  const camera = document.createElement('div');
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  // The portraits carry styles of their own: every exit must put exactly these back.
  attackerEl.style.transform = 'translateY(-2px)'; attackerEl.style.opacity = '0.9'; attackerEl.style.filter = 'saturate(1.1)'; attackerEl.className = 'hero mine';
  defenderEl.style.transform = 'scale(1.02)'; defenderEl.style.opacity = '0.8'; defenderEl.style.filter = 'brightness(1.1)'; defenderEl.className = 'hero theirs';
  document.body.append(host, camera);
  const h = playHeroWarhost({
    formation: formationOf([3, 2, 4], 9), total: 9, side: 'player', attacker: ME, defender: FOE, defenderRadius: R, attackerRadius: R,
    reduced: false, cfg: C, onImpact, onDone, frames: f.frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host, camera, attackerEl, defenderEl, ...over,
  });
  const restored = (): void => {
    expect(attackerEl.style.transform).toBe('translateY(-2px)');
    expect(defenderEl.style.transform).toBe('scale(1.02)');
    expect([attackerEl.style.opacity, attackerEl.style.filter, attackerEl.className]).toEqual(['0.9', 'saturate(1.1)', 'hero mine']);
    expect([defenderEl.style.opacity, defenderEl.style.filter, defenderEl.className]).toEqual(['0.8', 'brightness(1.1)', 'hero theirs']);
    expect(camera.style.transform).toBe('');
    expect(host.querySelector('.hblast')).toBeNull();
  };
  return { h, f, root, onImpact, onDone, host, camera, attackerEl, defenderEl, restored };
}
const of = (total: number): Partial<HeroWarhostOptions> => ({ total, formation: formationOf([total], total) });

describe('the runner (the shared clock)', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  it('Tier 1: the spearman is out, the spear flies, the blow lands once on its landing; then everything is put back and unhooked', () => {
    const { h, f, root, onImpact, onDone, host, defenderEl, restored } = run(of(3));
    expect(host.querySelector('.hblast.hwarhost')).not.toBeNull();
    expect(h.scene!.deployedTroops).toBe(1);
    f.tick(h.plan.arriveAt + 40, 4);
    expect(h.scene!.liveTroops).toBe(1);
    expect(h.scene!.liveShots).toBe(0);
    f.tick(h.plan.looseAt - h.elapsed() + 60, 4);
    expect(h.scene!.liveShots).toBe(1); // the spear is in the air
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.hblast-hit')!.textContent).toBe('-3');
    expect(defenderEl.style.transform).toMatch(/translate\(/); // knocked
    f.tick(h.plan.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveTroops).toBe(0);
    restored();
    f.tick(3000, 16);
    expect(f.hooked()).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('Tier 2: the line holds its draw, the arrows fly, and only the LAST (golden) arrow is the blow', () => {
    const { h, f, onImpact } = run(of(8));
    f.tick((h.plan.arriveAt + h.plan.looseAt) / 2, 4);
    expect(h.scene!.liveTroops).toBe(h.plan.troops + 1); // the line, and the one who ran the wrong way
    expect(h.scene!.liveShots).toBe(0); // the held beat
    f.tick(h.plan.hits[3]! - h.elapsed() + 4, 4);
    expect(h.scene!.liveShots).toBeGreaterThan(4);
    expect(onImpact).not.toHaveBeenCalled(); // arrows are in: still only ticks
    f.tick(h.plan.lateAt - h.elapsed() + 20, 4);
    expect(onImpact).not.toHaveBeenCalled(); // the golden arrow is in the air
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('Tier 1: he trips (dizzy stars over him while he lies there), gets up, and the blow is still the spear', () => {
    const { h, f, onImpact } = run(of(3));
    f.tick(h.plan.tripAt + 250, 4);
    expect(h.scene!.liveStars).toBe(3);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(h.plan.upAt - h.elapsed() + 40, 4);
    expect(h.scene!.liveStars).toBe(0);
    f.tick(h.plan.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    h.cancel();
  });

  it('Tier 3: the mages stand on lit rune circles; the fireball flies and the lightning strikes before the blow; one blow', () => {
    const { h, f, onImpact, restored } = run(of(14));
    const p = h.plan;
    f.tick(p.bickerAt + 60, 4);
    expect(h.scene!.liveRunes).toBe(2);
    f.tick(p.spells[0]!.castAt - h.elapsed() + 60, 4);
    expect(h.scene!.liveSpells).toBeGreaterThanOrEqual(1); // the fireball in the air
    f.tick(p.spells[1]!.castAt - h.elapsed() + 30, 4);
    expect(h.scene!.liveSpells).toBeGreaterThanOrEqual(1); // the lightning lit
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    f.tick(p.endAt - h.elapsed() + 40, 8);
    expect(h.scene!.liveRunes).toBe(0);
    expect(onImpact).toHaveBeenCalledTimes(1);
    restored();
  });

  it('Tier 4: banners rise on the drums, the host floods, the blow is the front rank, the struck portrait is knocked about, the banner flies, then all is put back', () => {
    const { h, f, onImpact, onDone, defenderEl, restored } = run(of(40));
    const p = h.plan;
    f.tick(p.drums[p.drums.length - 1]! + 120, 4);
    expect(h.scene!.liveBanners).toBe(p.drums.length);
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.impactAt - h.elapsed() - 30, 4);
    expect(h.scene!.liveTroops).toBeGreaterThan(100); // the flood
    expect(onImpact).not.toHaveBeenCalled();
    f.tick(p.impactAt - h.elapsed() + 8, 4);
    expect(onImpact).toHaveBeenCalledTimes(1);
    const seen = new Set<string>();
    let far = 0, tip = 0;
    while (h.elapsed() < p.passAt) {
      f.tick(16, 16); seen.add(defenderEl.style.transform);
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) rotate\((-?[\d.]+)deg\)/.exec(defenderEl.style.transform);
      if (m) { far = Math.max(far, Math.hypot(Number(m[1]), Number(m[2]))); tip = Math.max(tip, Math.abs(Number(m[3]))); }
    }
    expect(seen.size).toBeGreaterThan(20); // buffeted the whole trample
    expect(far).toBeGreaterThan(C.knockPx * 0.8); // BATTERED: thrown well off its spot
    expect(tip).toBeGreaterThan(4); // and tipped
    // The banner going in is a beat: the portrait is driven down and the view kicks.
    f.tick(p.plantAt - h.elapsed() + 24, 4);
    expect(defenderEl.style.transform).toMatch(/translate\(/);
    f.tick(400, 4);
    expect(h.scene!.liveBanners).toBe(1); // the one on the struck portrait
    expect(h.scene!.liveTroops).toBe(1 + WARHOST_CHEERERS); // the one who planted it, and the ones who stayed to cheer
    expect(h.scene!.liveRunes).toBe(0); // the mages have gone
    f.tick(p.endAt - h.elapsed() + 32, 8);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onImpact).toHaveBeenCalledTimes(1);
    expect(h.scene!.liveBanners).toBe(0);
    restored();
  });

  it('both directions at every tier (and the Knockout): one blow, within the sprite cap, everything restored', () => {
    for (const side of ['player', 'opp'] as const) {
      for (const total of [3, 8, 12, 40, 41]) {
        const ko = total === 41;
        const { h, f, onImpact, restored } = run({ side, attacker: side === 'player' ? ME : FOE, defender: side === 'player' ? FOE : ME, ...of(ko ? 40 : total), knockout: ko, knockoutVariant: ko });
        expect(h.stage.face, `${side} ${total}`).toBe(side === 'player' ? 1 : -1);
        let peak = 0;
        for (let t = 0; t < h.plan.endAt + 1200 && !h.done; t += 16) { f.tick(16, 16); peak = Math.max(peak, h.scene!.liveSprites); }
        expect(h.done, `${side} ${total}`).toBe(true);
        expect(onImpact, `${side} ${total}`).toHaveBeenCalledTimes(1);
        expect(peak, `${side} ${total}`).toBeLessThanOrEqual(MAX_WARHOST_SPRITES);
        restored();
        h.cancel();
      }
    }
  });

  it('the camera is applied once when the canvas rides it', () => {
    const camera = document.createElement('div');
    camera.appendChild(document.createElement('canvas'));
    const { h, f, root } = run({ camera, ...of(40) });
    f.tick(h.plan.impactAt + 20, 4);
    expect(h.mirrorsCamera).toBe(false);
    expect((root.children[0] as Container).scale.x).toBe(1);
    h.cancel();
  });

  it('every exit restores: finish() lands once; cancel() never lands; mid-trample too', () => {
    const a = run(of(40));
    a.f.tick(a.h.plan.impactAt - 100, 16);
    a.h.finish();
    a.h.finish();
    expect(a.onImpact).toHaveBeenCalledTimes(1);
    expect(a.onDone).toHaveBeenCalledTimes(1);
    a.restored();
    expect(a.f.hooked()).toBe(0);
    expect(a.root.children).toHaveLength(0);
    const b = run(of(40));
    b.f.tick(b.h.plan.impactAt + 200, 16); // mid-trample: the blow has landed, the portrait is moved
    expect(b.defenderEl.style.transform).not.toBe('scale(1.02)');
    b.h.cancel();
    expect(b.onImpact).toHaveBeenCalledTimes(1);
    b.restored();
    expect(b.f.hooked()).toBe(0);
    expect(b.root.children).toHaveLength(0);
    const c = run(of(8));
    c.f.tick(200, 16);
    c.h.cancel();
    expect(c.onImpact).not.toHaveBeenCalled();
    expect(c.onDone).not.toHaveBeenCalled();
    c.restored();
  });

  it('the safety timer finishes a stalled sequence: the blow lands once and everything is restored', () => {
    vi.useFakeTimers();
    try {
      const r = run({ ...of(40), safety: true });
      r.f.tick(300, 16); // then the tab is hidden: no more frames
      vi.advanceTimersByTime(r.h.plan.endAt + 4000);
      expect(r.onImpact).toHaveBeenCalledTimes(1);
      expect(r.h.done).toBe(true);
      r.restored();
      expect(r.root.children).toHaveLength(0);
    } finally { vi.useRealTimers(); }
  });

  it('a replay plays the same; the roll seed fields the host; reduced motion lands once with no scene', () => {
    const x = run(of(40)), y = run(of(40));
    expect(x.h.plan).toEqual(y.h.plan);
    expect(x.h.stage).toEqual(y.h.stage);
    x.h.cancel(); y.h.cancel();
    const s1 = run({ ...of(40), rollSeed: 5 }), s2 = run({ ...of(40), rollSeed: 5 }), s3 = run({ ...of(40), rollSeed: 6 });
    expect(s1.h.stage).toEqual(s2.h.stage);
    expect(s1.h.stage).not.toEqual(s3.h.stage);
    s1.h.cancel(); s2.h.cancel(); s3.h.cancel();
    const r = run({ reduced: true });
    expect(r.h.scene).toBeNull();
    r.f.tick(r.h.plan.endAt + 100, 16);
    expect(r.onImpact).toHaveBeenCalledTimes(1);
    r.restored();
  });
});

describe('the scene (headless Pixi)', () => {
  it('takes every sprite up front, in draw order; places them from the clock; retires, drains, and destroy leaves nothing', () => {
    const scene = new HeroWarhostScene(TEX, { red: 0xff5a4f, brass: 0xe2b34a, dust: 0xb9966a, side: 0xffe9b0 }, LOOK, 1, 3);
    const p = plan(40);
    const st = warhostStage(p, ME, FOE, R, R, C, 1, 3, SCREEN);
    scene.deploy(st);
    expect(scene.deployedTroops).toBe(st.troops.length);
    const made = scene.pooledSprites;
    let peakTroops = 0, peak = 0, peakSpells = 0;
    for (let t = p.chargeAt; t < p.endAt; t += 16) {
      st.spells.forEach((sp) => { if (Math.abs(t - sp.t1) < 8) scene.spellHit(sp.school, sp.to, R, sp.round === 2 ? 1.25 : 1); });
      if (Math.abs(t - p.impactAt) < 8) { scene.impact(FOE, st.strike, st.u, R, 4); scene.koFlourish(FOE, R); }
      for (const at of p.buffets) if (Math.abs(t - at) < 8) scene.buffet(FOE, R, 1);
      if (Math.abs(t - p.plantAt) < 8) scene.plant(FOE, R);
      scene.setFoeOffset(3, -2);
      scene.paint(t);
      scene.update(16);
      peakTroops = Math.max(peakTroops, scene.liveTroops);
      peak = Math.max(peak, scene.liveSprites);
      peakSpells = Math.max(peakSpells, scene.liveSpells);
    }
    expect(peakTroops).toBeGreaterThan(st.troops.length * 0.5); // most of the host on screen at once
    expect(peakSpells).toBeGreaterThanOrEqual(5); // the barrage in the air together
    expect(peak).toBeLessThanOrEqual(MAX_WARHOST_SPRITES);
    // Soldiers are never re-made mid-flight: only the particles (dust, trails, bursts) joined the pool.
    expect(scene.pooledSprites - made).toBeLessThan(MAX_WARHOST_SPRITES - made);
    scene.retire();
    expect(scene.liveTroops + scene.liveShots + scene.liveBanners + scene.liveSpells + scene.liveRunes + scene.liveStars).toBe(0);
    let alive = true;
    for (let i = 0; i < 600 && alive; i++) alive = scene.update(16);
    expect(alive).toBe(false);
    scene.destroy();
    expect(scene.root.destroyed).toBe(true);
  });

  it('every look draws something at its blow, and a soldier faces the way he runs', () => {
    for (const d of TOTALS) {
      const scene = new HeroWarhostScene(TEX, { red: 1, brass: 2, dust: 3, side: 4 }, LOOK, 1, 3);
      const p = plan(d);
      const st = warhostStage(p, FOE, ME, R, R, C, 1, 3, SCREEN); // the foe strikes: the host runs LEFT
      scene.deploy(st);
      scene.paint(p.impactAt - 1);
      expect(scene.liveTroops + scene.liveShots, `dmg ${d}`).toBeGreaterThan(0);
      scene.paint(p.kind === 'spear' || p.kind === 'archers' ? p.marchAt + 90 : p.impactAt - 100);
      expect(scene.liveTroops, `dmg ${d}`).toBeGreaterThan(0);
      // Flipped: every one faces left (on Tier 2 bar the one running the WRONG way).
      // (Tier 4's straggler, lost behind the host, may be looking the other way.)
      if (p.kind === 'archers' || p.kind === 'host') expect(scene.liveFacingRight, `dmg ${d}`).toBeLessThanOrEqual(1);
      else expect(scene.liveFacingRight, `dmg ${d}`).toBe(0);
      scene.destroy();
    }
  });
});

describe('the atlas', () => {
  it('every frame has its own cell inside the one canvas, none overlapping', () => {
    const { rects, height } = warhostAtlasLayout();
    const names = Object.keys(rects);
    expect(height).toBeGreaterThan(0);
    for (const k of Object.keys(TEX)) if (!['glow', 'spark', 'streak', 'ring', 'beam', 'ribbonSoft', 'ribbonBody', 'sigil', 'star'].includes(k)) expect(names, k).toContain(k);
    expect(height).toBeLessThanOrEqual(1024);
    const list = Object.values(rects);
    for (const r of list) { expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(WARHOST_ATLAS_W); expect(r.y + r.h).toBeLessThanOrEqual(height); }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${names[i]} / ${names[j]}`).toBe(true);
    }
  });
});
