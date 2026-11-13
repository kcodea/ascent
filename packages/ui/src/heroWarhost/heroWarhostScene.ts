/**
 * THE WARHOST SCENE: everything the Warhost draws in Pixi, on the shared pooled scene (`../heroAttack/fxPool.ts`), so
 * it runs (and is tested) headless. `heroWarhost.ts` mounts `root` on the above-portrait overlay, hands it the staged
 * look once (`deploy`: every soldier, mage, drummer, shot, spell and banner gets its sprites up front, in draw order,
 * while the damage formation is still playing), then each frame calls `paint(t)` (every one of them placed from the
 * clock by the pure `troopAt` / `shotAt` / `quadAt`) and `update(dt)` (the fire-and-forget particles).
 *
 * THE SOLDIERS are small sprites cut from one atlas, with a two-frame run cycle, a bob, a lean into the run and a flip
 * for their heading; the poses (stand, wind-up, throw, cheer, draw, release, cast, drum) are frames of the same atlas,
 * picked from the clock. Tier 1's spearman trips flat on his face (the sprite tips over its feet, slides a step and
 * lies there with three dizzy stars circling his head, then pops up); a lost soldier looks one way and the other.
 *
 * EVERYTHING THEY DO IS LIVE PIXI (third pass, owner 2026-11-13: "mages etc casting pixi animations"):
 *  - a RUNE CIRCLE under every mage (the arcane sigil, laid on the ground in perspective, turning, breathing, flaring
 *    on every cast) and his staff's gem lit in his school's colour;
 *  - the mages' BICKERING throws little sparks at each other;
 *  - a FIREBALL: a flickering white-hot core in an orange halo, shedding flame and smoke every frame; it bursts in fire,
 *    rings and embers and SINGES the portrait (a scorch that lingers, smoke wisps, rising embers);
 *  - FROST: an icy core shedding glittering motes; it bursts in shards, snow and a cold glow;
 *  - LIGHTNING: a jagged bolt of stretched beam sprites from staff to target that RE-FORKS every 45 ms and flickers out;
 *  - the CATAPULT BOULDER: a spinning rock on fire, a comet tail of flame and smoke, and a crash of rock chunks and dust;
 *  - glowing TRAILS behind the spear, the arrows and the straggler's golden arrow; dust under every foot and hoof.
 *
 * Perf: one sprite per soldier (the host: under 400), all from one atlas (one batch per layer); `paint` does a lerp, a
 * sine and at most one texture swap per soldier and allocates nothing; trails emit at a fixed sequence-time rate (never
 * per frame), particles are pooled and capped (`MAX_WARHOST_SPRITES`); nothing is filtered or masked. The rune circles
 * are the only containers (one per mage, made in `deploy`).
 */
import { Container, Sprite, type Texture } from 'pixi.js';
import type { HeroArcanaTextures } from '../heroArcana/heroArcanaScene';
import { clamp01, easeOutCubic, mixColor, spring, whiten, type Pt } from '../heroAttack/easing';
import { FxPool } from '../heroAttack/fxPool';
import { KO_CYAN, KO_LILAC, KO_MAGENTA } from '../heroAttack/knockout';
import {
  WARHOST_BANNER_TALL, WARHOST_BOLT_HOLD_MS, WARHOST_LOOK_MS, WARHOST_MAGE_TIP, WARHOST_RELOAD_MS, quadAt, shotAt, troopAt,
  type Banner, type Shot, type ShotAt, type Spell, type Troop, type TroopAt, type WarhostSchool, type WarhostStage,
} from './heroWarhostConfig';
import {
  ARROW_W, BANNER_AX, BANNER_AY, BANNER_H, CAV_AX, CAV_AY, CAV_H, DUST_PX, FOOT_AX, FOOT_AY, FOOT_H, ROCK_PX, SPEAR_W,
} from './heroWarhostTextures';

export interface HeroWarhostTextures extends HeroArcanaTextures {
  /** The foot soldier: two run frames, a stand, the wind-up, the throw, the cheer, two empty-handed run frames. */
  infA: Texture; infB: Texture; infStand: Texture; spearWind: Texture; spearThrown: Texture; cheer: Texture; bareA: Texture; bareB: Texture;
  /** The archer: two run frames, a stand, the draw, the release, the cheer. */
  archA: Texture; archB: Texture; archStand: Texture; archDraw: Texture; archLoose: Texture; archCheer: Texture;
  /** The rider: the stretch and the gather of the gallop. */
  cavA: Texture; cavB: Texture;
  /** The mage (standing, casting) and the drummer (sticks up, sticks down). */
  mage: Texture; mageCast: Texture; drumA: Texture; drumB: Texture;
  bannerA: Texture; bannerB: Texture;
  spear: Texture; arrow: Texture; rock: Texture;
  dust: Texture;
}

export interface WarhostColors { red: number; brass: number; dust: number; side: number }

export interface WarhostLook { soldierPx: number; cavalryPx: number; dust: number; impactSize: number; spellSize: number }

/** Hard cap on sprites alive at once (the biggest host the caps allow, its arrows, spells, trails and dust sit under it). */
export const MAX_WARHOST_SPRITES = 1500;
const GLOW_PX = 128;
const RING_PX = 160;
const STAR_PX = 48;
const SIGIL_PX = 160;
const BEAM_PX = 64;
/** A run frame lasts this long (a pattering little stride); a gallop frame a touch longer. */
const FOOT_STRIDE = 92;
const CAV_STRIDE = 112;
/** The rear ranks shade toward this. */
const SHADE = 0x5a3c30;
const WOOD = 0x9b6a36;
const ROCK_GREY = 0x8a8580;
const SMOKE = 0x3a3330;
const SCORCH = 0x1c0e08;

/** Each school's colours: the halo, the white-hot core, and the rune circle under the caster. */
export const SCHOOL_COLORS: Record<WarhostSchool, { halo: number; hot: number; rune: number }> = {
  fire: { halo: 0xff6a1a, hot: 0xffd36b, rune: 0xff8a2a },
  frost: { halo: 0x5fd0ff, hot: 0xe8fbff, rune: 0x7fdcff },
  bolt: { halo: 0x8fb8ff, hot: 0xffffff, rune: 0xb69bff },
  rock: { halo: 0xff5a14, hot: 0xffc25a, rune: 0xff8a2a },
};

/** Lightning: segments from staff to target, re-forked every this many ms. */
const BOLT_SEGS = 9;
const BOLT_FORK_MS = 45;
/** Trails emit this often (sequence time): spells, the spear and the arrows. */
const TRAIL_MS = 18;
const ARROW_TRAIL_MS = 26;
/** The mages bicker in beats this long (one jabs, then the other). */
const BICKER_BEAT = 170;

interface TroopSprite {
  spec: Troop; s: Sprite; tex: Texture | null; on: boolean; x: number; y: number; a: number; nextDust: number; k: number;
  /** A mage's rune circle (a squashed holder with a soft glow and the sigil), his gem, and the last bicker jab he threw. */
  rune: Container | null; sigil: Sprite | null; pool: Sprite | null; gem: Sprite | null; jab: number;
  /** Tier 1's dizzy stars. */
  stars: (Sprite | null)[];
  /** A drummer's last beat; a lost soldier's surprise. */
  beat: number; startled: boolean;
}
interface ShotSprite { spec: Shot; s: Sprite; nextTrail: number }
interface SpellSprite { spec: Spell; halo: Sprite | null; core: Sprite | null; body: Sprite | null; glows: (Sprite | null)[]; cores: (Sprite | null)[]; nextTrail: number; nx: number; ny: number; lx: number; ly: number }
interface BannerSprite { spec: Banner; s: Sprite; i: number }

/** A small integer hash in [0, 1): lightning's forks from (seed, frame, point), allocation-free and replayable. */
function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class HeroWarhostScene extends FxPool {
  private troops: TroopSprite[] = [];
  private shots: ShotSprite[] = [];
  private spells: SpellSprite[] = [];
  private banners: BannerSprite[] = [];
  private runes: Container[] = [];
  private beats: readonly number[] = [];
  private face = 1;
  private ownLive = false;
  private lastT = -1;
  private readonly ta: TroopAt = { x: 0, y: 0, state: 'wait', alpha: 0, dir: 1 };
  private readonly sa: ShotAt = { x: 0, y: 0, rot: 0, state: 'wait', alpha: 0 };
  private readonly qp = { x: 0, y: 0 };

  constructor(private readonly tex: HeroWarhostTextures, private readonly colors: WarhostColors, private readonly look: WarhostLook, scale = 1, seed = 1) {
    super('heroWarhost', [tex.glow, tex.ring, tex.star, tex.spark, tex.streak, tex.beam, tex.sigil, tex.infA], scale, seed, MAX_WARHOST_SPRITES);
  }

  /** Soldiers on screen this frame. */
  get liveTroops(): number { let n = 0; for (const q of this.troops) if (q.on) n++; return n; }
  get deployedTroops(): number { return this.troops.length; }
  /** Soldiers on screen this frame drawn facing right (the rest face left). */
  get liveFacingRight(): number { let n = 0; for (const q of this.troops) if (q.on && q.s.scale.x > 0) n++; return n; }
  /** Spears and arrows in the air or stuck this frame. */
  get liveShots(): number { let n = 0; for (const q of this.shots) if (q.s.visible) n++; return n; }
  get liveBanners(): number { let n = 0; for (const q of this.banners) if (q.s.visible) n++; return n; }
  /** Spells in the air (or lightning lit) this frame, and rune circles showing. */
  get liveSpells(): number { let n = 0; for (const q of this.spells) if ((q.halo?.visible ?? false) || (q.body?.visible ?? false) || (q.cores[0]?.visible ?? false)) n++; return n; }
  get liveRunes(): number { let n = 0; for (const r of this.runes) if (r.visible) n++; return n; }
  /** Tier 1's dizzy stars showing this frame. */
  get liveStars(): number { let n = 0; for (const q of this.troops) for (const s of q.stars) if (s?.visible) n++; return n; }

  /**
   * Take a sprite for every soldier, shot, spell and banner of the staged look, in draw order (the striker's banners at
   * the back, then the rune circles, the soldiers far to near, then the shots and the spells, then the planted banner).
   * All hidden until their time.
   */
  deploy(stage: WarhostStage): void {
    this.face = stage.face;
    this.beats = stage.beats;
    const T = this.tex;
    const hold = (s: Sprite | null, ax: number, ay: number): Sprite | null => { if (s) { s.anchor.set(ax, ay); s.visible = false; } return s; };
    stage.banners.forEach((spec, i) => {
      if (spec.follow) return;
      const s = hold(this.take('body', T.bannerA, 0xffffff), BANNER_AX, BANNER_AY);
      if (s) this.banners.push({ spec, s, i });
    });
    // Each soldier's sprite is taken far to near, but kept at his index in the stage (a banner's carrier is an index).
    const order = stage.troops.map((_, i) => i).sort((p, q) => stage.troops[p]!.z - stage.troops[q]!.z);
    const made: (TroopSprite | null)[] = stage.troops.map(() => null);
    for (const i of order) {
      const spec = stage.troops[i]!;
      const cav = spec.unit === 'cav';
      const s = hold(this.take('body', cav ? T.cavA : T.infA, spec.shade > 0 ? mixColor(0xffffff, SHADE, spec.shade) : 0xffffff), cav ? CAV_AX : FOOT_AX, cav ? CAV_AY : FOOT_AY);
      if (!s) continue;
      let rune: Container | null = null, sigil: Sprite | null = null, pool: Sprite | null = null, gem: Sprite | null = null;
      if (spec.unit === 'mage' && spec.school) {
        // The rune circle: laid on the ground (a holder squashed in y), so the sigil can turn IN the ground's plane.
        const col = SCHOOL_COLORS[spec.school].rune;
        rune = new Container(); rune.label = 'warhost-rune'; rune.visible = false; rune.scale.set(1, 0.42);
        pool = new Sprite(T.glow); pool.anchor.set(0.5); pool.blendMode = 'add'; pool.tint = col; pool.alpha = 0.5;
        sigil = new Sprite(T.sigil); sigil.anchor.set(0.5); sigil.blendMode = 'add'; sigil.tint = whiten(col, 0.25);
        rune.addChild(pool, sigil);
        this.layers.glow.addChild(rune);
        this.runes.push(rune);
        gem = this.take('core', T.glow, SCHOOL_COLORS[spec.school].hot);
        if (gem) gem.visible = false;
      }
      const stars: (Sprite | null)[] = [];
      if (spec.viaKind === 'trip') for (let j = 0; j < 3; j++) { const st = this.take('core', T.star, j === 1 ? 0xffffff : this.colors.brass); if (st) st.visible = false; stars.push(st); }
      made[i] = { spec, s, tex: null, on: false, x: spec.p0.x, y: spec.p0.y, a: 0, nextDust: spec.t0, k: 1, rune, sigil, pool, gem, jab: -1, stars, beat: -1, startled: false };
    }
    this.troopAtIndex = made;
    for (const q of made) if (q) this.troops.push(q);
    for (const spec of stage.shots) {
      const s = hold(this.take('body', spec.kind === 'spear' ? T.spear : T.arrow, spec.gold ? 0xffe9a8 : 0xffffff), 1, 0.5);
      if (s) this.shots.push({ spec, s, nextTrail: spec.t0 });
    }
    for (const spec of stage.spells) {
      const col = SCHOOL_COLORS[spec.school];
      const hide = (s: Sprite | null): Sprite | null => { if (s) s.visible = false; return s; };
      const sp: SpellSprite = { spec, halo: null, core: null, body: null, glows: [], cores: [], nextTrail: spec.t0, nx: 0, ny: 0, lx: spec.from.x, ly: spec.from.y };
      if (spec.school === 'bolt') {
        const L = Math.hypot(spec.to.x - spec.from.x, spec.to.y - spec.from.y) || 1;
        sp.nx = -(spec.to.y - spec.from.y) / L; sp.ny = (spec.to.x - spec.from.x) / L;
        for (let k = 0; k < BOLT_SEGS; k++) { sp.glows.push(hide(this.take('glow', T.beam, col.halo))); sp.cores.push(hide(this.take('core', T.beam, 0xffffff))); }
      } else {
        sp.halo = hide(this.take('glow', T.glow, col.halo));
        if (spec.school === 'rock') sp.body = hide(this.take('body', T.rock, 0xffffff));
        sp.core = hide(this.take('core', spec.school === 'frost' ? T.star : T.glow, col.hot));
      }
      this.spells.push(sp);
    }
    stage.banners.forEach((spec, i) => {
      if (!spec.follow) return;
      const s = hold(this.take('body', T.bannerA, 0xffffff), BANNER_AX, BANNER_AY);
      if (s) this.banners.push({ spec, s, i });
    });
  }

  private troopAtIndex: (TroopSprite | null)[] = [];

  /** Place every soldier, shot, spell and banner for sequence time `t`. Allocation-free. */
  paint(t: number): void {
    if (this.destroyed) return;
    const S = this.scale, T = this.tex;
    // A jump (finish, a hitch): place everything but emit nothing (no wall of trail particles in one frame).
    const smooth = this.lastT >= 0 && t - this.lastT < 120;
    this.lastT = t;
    let live = false;
    const o = this.ta;
    for (const q of this.troops) {
      const tr = q.spec;
      troopAt(tr, t, o);
      q.x = o.x; q.y = o.y; q.a = o.alpha;
      if (o.state === 'wait' || o.state === 'gone') { q.on = false; if (q.s.visible) q.s.visible = false; this.hideExtras(q); continue; }
      live = true; q.on = true;
      const cav = tr.unit === 'cav';
      const moving = o.state === 'out' || o.state === 'back';
      const cyc = (t + tr.phase) / (cav ? CAV_STRIDE : FOOT_STRIDE);
      const second = moving && (Math.floor(cyc) & 1) === 1;
      const step = moving ? Math.abs(Math.sin(cyc * Math.PI)) : 0;
      let dir = o.dir;
      let tex: Texture;
      let lift = 0, rot = 0, slide = 0;
      if (cav) {
        tex = second ? T.cavB : T.cavA;
        lift = step * 4; rot = dir * Math.sin(cyc * Math.PI) * 0.055;
      } else {
        lift = step * 2.6; rot = moving ? dir * 0.07 : 0;
        if (o.state === 'trip') {
          // FLAT ON HIS FACE: he tips over his feet (110 ms), slides a step, lies there kicking, then pops back up.
          const since = t - tr.tv0, dur = Math.max(1, tr.tv1 - tr.tv0);
          const fall = easeOutCubic(since / 110);
          const rise = clamp01((since - (dur - 130)) / 130);
          rot = dir * (1.48 * fall * (1 - rise) + 0.05 * Math.sin(since * 0.045) * (1 - rise) * fall);
          slide = dir * 18 * fall * (1 - rise);
          lift = rise > 0 ? 9 * Math.sin(rise * Math.PI) : 0;
          tex = rise > 0 ? T.infB : T.infA;
        } else if (o.state === 'lost') {
          // Lost: standing, looking one way and then the other with a little start each time.
          const look = (t - tr.tv0) % WARHOST_LOOK_MS;
          lift = look < 70 ? 4 * Math.sin((look / 70) * Math.PI) : 0;
          tex = tr.unit === 'archer' ? T.archStand : T.infStand;
          if (!q.startled) { q.startled = true; this.startle(o.x, o.y - this.look.soldierPx * tr.size * S * 1.25); }
        } else switch (tr.unit) {
          case 'inf': tex = second ? T.infB : T.infA; break;
          case 'spear':
            if (o.state === 'out') tex = second ? T.infB : T.infA;
            else if (o.state === 'back') tex = second ? T.bareB : T.bareA;
            else if (t < tr.actAt) tex = T.infStand;
            else if (t < tr.looseAt) { tex = T.spearWind; rot = -dir * 0.16 * Math.min(1, (t - tr.actAt) / 90); }
            else if (tr.cheerAt < 0 || t < tr.cheerAt) { tex = T.spearThrown; rot = dir * 0.2 * Math.max(0, spring(t - tr.looseAt, 3, 90)); }
            else { tex = T.cheer; lift = hop(t - tr.cheerAt, 2); }
            break;
          case 'archer':
            if (moving) tex = second ? T.archB : T.archA;
            else if (tr.cheerAt >= 0 && t >= tr.cheerAt) { tex = T.archCheer; lift = hop(t - tr.cheerAt, 2); }
            else if (t < tr.actAt) tex = T.archStand;
            else if (t < tr.looseAt) tex = T.archDraw;
            else if (t <= tr.lastLooseAt) tex = (t - tr.looseAt) % WARHOST_RELOAD_MS < 40 ? T.archLoose : T.archDraw;
            else tex = t < tr.lastLooseAt + 220 ? T.archLoose : T.archStand;
            break;
          case 'mage': {
            let cast = -1;
            for (let i = 0; i < tr.casts.length; i++) if (tr.casts[i]! <= t) cast = tr.casts[i]!;
            const since = cast >= 0 ? t - cast : 1e9;
            if (moving) { tex = T.mage; lift = step * 3.4; }
            else if (tr.bickerAt >= 0 && t >= tr.bickerAt && t < tr.bickerEnd) {
              // BICKERING: they face each other and take turns jabbing their staffs, hopping, throwing sparks.
              const j = Math.floor((t - tr.bickerAt) / BICKER_BEAT);
              const mine = ((j + (tr.phase > 0 ? 1 : 0)) & 1) === 0;
              dir = tr.argueFace;
              tex = mine ? T.mageCast : T.mage;
              lift = mine ? 6 * Math.sin((((t - tr.bickerAt) % BICKER_BEAT) / BICKER_BEAT) * Math.PI) : 0;
              rot = mine ? dir * 0.12 : -dir * 0.06;
              if (mine && j !== q.jab && smooth) { q.jab = j; this.jab(q, dir); }
            } else if (since < 280) { tex = T.mageCast; rot = -dir * 0.14 * Math.exp(-since / 110); }
            else if (tr.cheerAt >= 0 && t >= tr.cheerAt) { tex = (Math.floor((t - tr.cheerAt) / 180) & 1) ? T.mage : T.mageCast; lift = hop(t - tr.cheerAt, 3); }
            else tex = T.mage;
            break;
          }
          case 'drummer': {
            // The drum line: sticks down on every beat (the war drums, then the march), a bounce and a ring off the skin.
            let hit = -1;
            for (let i = 0; i < this.beats.length; i++) { const b = this.beats[i]!; if (b <= t && t - b < 90) hit = i; }
            tex = hit >= 0 ? T.drumB : T.drumA;
            lift = hit >= 0 ? 0 : 2 * Math.abs(Math.sin((t + tr.phase) * 0.02));
            if (hit >= 0 && hit !== q.beat && smooth) { q.beat = hit; this.drumSkin(o.x + dir * 6 * q.k, o.y - 24 * q.k); }
            break;
          }
          default: // the banner bearer and the cheerers
            if (moving) tex = second ? T.bareB : T.bareA;
            else if (tr.cheerAt >= 0 && t >= tr.cheerAt) { tex = T.cheer; lift = hop(t - tr.cheerAt, 6); }
            else tex = tr.unit === 'bearer' ? T.spearThrown : T.infStand;
        }
      }
      if (q.tex !== tex) { q.tex = tex; q.s.texture = tex; }
      const k = ((cav ? this.look.cavalryPx / CAV_H : this.look.soldierPx / FOOT_H) * tr.size) * S;
      q.k = k;
      const s = q.s;
      if (!s.visible) s.visible = true;
      const x = o.x + slide * k, y = o.y - lift * S;
      s.position.set(x, y);
      s.scale.set(dir < 0 ? -k : k, k);
      s.rotation = rot;
      s.alpha = o.alpha;
      if (moving && tr.dustMs > 0 && t >= q.nextDust) {
        q.nextDust = t + tr.dustMs * (0.55 + this.rnd() * 0.9);
        if (smooth) this.puff(o.x - dir * (cav ? 22 : 7) * S * tr.size + (this.rnd() - 0.5) * 14 * S, o.y - (2 + this.rnd() * 6) * S, (cav ? 1.3 : 0.8) * tr.size * (0.7 + this.rnd() * 0.6));
      }
      if (tr.unit === 'mage') this.paintMage(q, t, x, y, dir, tex === T.mageCast, o.alpha);
      if (q.stars.length) this.paintStars(q, t, o.state === 'trip', x, y, dir, rot, k);
    }
    const so = this.sa;
    for (const q of this.shots) {
      const sh = q.spec;
      shotAt(sh, t, so);
      if (so.state === 'wait' || so.state === 'gone') { if (q.s.visible) q.s.visible = false; continue; }
      live = true;
      const s = q.s;
      if (!s.visible) s.visible = true;
      const ride = so.state === 'stuck' && sh.stick;
      s.position.set(so.x + (ride ? this.fox : 0), so.y + (ride ? this.foy : 0));
      s.rotation = so.rot;
      const k = (sh.kind === 'spear' ? (this.look.soldierPx * 1.55) / SPEAR_W : (this.look.soldierPx * 0.86) / ARROW_W) * sh.size * S;
      // Stuck, the point is buried: it sits a little shorter.
      s.scale.set(so.state === 'stuck' ? k * 0.84 : k, k);
      s.alpha = so.alpha;
      if (sh.trail && so.state === 'fly' && t >= q.nextTrail) {
        q.nextTrail = t + (sh.kind === 'arrow' && !sh.gold ? ARROW_TRAIL_MS : TRAIL_MS);
        if (smooth) this.shotTrail(so.x, so.y, so.rot, sh);
      }
    }
    for (const q of this.spells) if (this.paintSpell(q, t, smooth)) live = true;
    for (const q of this.banners) {
      const b = q.spec, s = q.s;
      const base = ((this.look.soldierPx * WARHOST_BANNER_TALL) / BANNER_H) * b.size * S;
      if (t >= b.t2) { if (s.visible) s.visible = false; continue; }
      if (t < b.t0) {
        // Not planted yet: carried (small, tilted back over the shoulder) or not there.
        const c = b.carrier >= 0 ? this.troopAtIndex[b.carrier] : null;
        if (!c || !c.on) { if (s.visible) s.visible = false; continue; }
        live = true;
        if (!s.visible) s.visible = true;
        if (s.texture !== this.tex.bannerA) s.texture = this.tex.bannerA;
        s.position.set(c.x - this.face * 5 * S, c.y - this.look.soldierPx * 0.3 * S);
        s.scale.set(-this.face * base * 0.62, base * 0.62);
        s.rotation = -this.face * 0.2; s.skew.set(0.05 * Math.sin(t * 0.03), 0);
        s.alpha = c.a;
        continue;
      }
      live = true;
      if (!s.visible) s.visible = true;
      const since = t - b.t0;
      const rise = Math.max(0, 1 - spring(since, 3.2, 110));
      const frame = (Math.floor(t / 140) + q.i) & 1 ? this.tex.bannerB : this.tex.bannerA;
      if (s.texture !== frame) s.texture = frame;
      s.position.set(b.at.x + (b.follow ? this.fox : 0), b.at.y + (b.follow ? this.foy : 0));
      s.scale.set(-this.face * base, base * rise);
      s.rotation = b.lean + 0.1 * spring(since, 2.4, 160);
      // The flag snaps as it goes up, then ripples.
      s.skew.set(0.05 * Math.sin(t * 0.011 + q.i * 1.7) + 0.24 * spring(since, 4, 170), 0);
      s.alpha = t < b.t1 ? 1 : 1 - (t - b.t1) / Math.max(1, b.t2 - b.t1);
    }
    this.ownLive = live;
  }

  private hideExtras(q: TroopSprite): void {
    if (q.rune?.visible) q.rune.visible = false;
    if (q.gem?.visible) q.gem.visible = false;
    for (const s of q.stars) if (s?.visible) s.visible = false;
  }

  /** A mage's rune circle (it pops up as he arrives, turns, breathes, and FLARES on each cast) and his lit gem. */
  private paintMage(q: TroopSprite, t: number, x: number, y: number, dir: number, casting: boolean, alpha: number): void {
    const tr = q.spec, S = this.scale;
    let flare = 0;
    for (let i = 0; i < tr.casts.length; i++) { const c = tr.casts[i]!; if (t >= c) flare = Math.max(flare, Math.exp(-(t - c) / 260)); }
    if (q.rune && q.sigil && q.pool) {
      const since = t - tr.t1 + 60;
      if (since < 0) { if (q.rune.visible) q.rune.visible = false; }
      else {
        if (!q.rune.visible) q.rune.visible = true;
        const grow = Math.max(0, 1 - spring(since, 2.6, 110)) * (1 + 0.25 * flare);
        const r = 36 * tr.size * S * grow * this.look.spellSize;
        q.rune.position.set(q.x, q.y + 2 * S);
        q.sigil.scale.set((r * 2) / SIGIL_PX);
        q.sigil.rotation = t * 0.0022 * (tr.phase % 2 ? -1 : 1);
        q.sigil.alpha = alpha * (0.5 + 0.12 * Math.sin(t * 0.009 + tr.phase) + 0.5 * flare);
        q.pool.scale.set((r * 2.6) / GLOW_PX);
        q.pool.alpha = alpha * (0.3 + 0.5 * flare);
      }
    }
    if (q.gem) {
      if (!q.gem.visible) q.gem.visible = true;
      const tip = casting ? WARHOST_MAGE_TIP.cast : WARHOST_MAGE_TIP.stand;
      q.gem.position.set(x + dir * tip.x * q.k, y + tip.y * q.k);
      q.gem.scale.set(((22 + 30 * flare) * S * this.look.spellSize) / GLOW_PX);
      q.gem.alpha = alpha * (0.55 + 0.15 * Math.sin(t * 0.02 + tr.phase) + 0.4 * flare);
    }
  }

  /** Tier 1's dizzy stars: three little stars circling the fallen man's head while he lies there. */
  private paintStars(q: TroopSprite, t: number, tripped: boolean, x: number, y: number, dir: number, rot: number, k: number): void {
    const tr = q.spec, S = this.scale;
    const since = t - tr.tv0, dur = tr.tv1 - tr.tv0;
    const on = tripped && since > 120 && since < dur - 110;
    // His head, where the tipped sprite puts it.
    const h = 54 * k;
    const hx = x + Math.sin(Math.abs(rot)) * h * dir, hy = y - Math.cos(rot) * h - 10 * S;
    for (let j = 0; j < q.stars.length; j++) {
      const st = q.stars[j];
      if (!st) continue;
      if (!on) { if (st.visible) st.visible = false; continue; }
      if (!st.visible) st.visible = true;
      const ang = t * 0.011 + (j * Math.PI * 2) / 3;
      st.position.set(hx + Math.cos(ang) * 36 * S, hy + Math.sin(ang) * 12 * S - 16 * S);
      const front = 0.75 + 0.25 * Math.sin(ang);
      st.scale.set(((46 + 12 * (j % 2)) * S * front) / STAR_PX);
      st.rotation = t * 0.01;
      st.alpha = Math.min(1, (since - 120) / 80) * front;
    }
  }

  /** Place one spell for `t` (and shed its trail). Returns whether it draws. */
  private paintSpell(q: SpellSprite, t: number, smooth: boolean): boolean {
    const sp = q.spec, S = this.scale, Z = sp.size * this.look.spellSize;
    const col = SCHOOL_COLORS[sp.school];
    if (sp.school === 'bolt') {
      const end = sp.t1 + WARHOST_BOLT_HOLD_MS;
      if (t < sp.t0 || t >= end) { for (let i = 0; i < BOLT_SEGS; i++) { const g = q.glows[i], c = q.cores[i]; if (g?.visible) g.visible = false; if (c?.visible) c.visible = false; } return false; }
      // LIGHTNING: jagged segments from the staff to the target, re-forked every few frames, flickering out.
      const reach = clamp01((t - sp.t0) / Math.max(1, sp.t1 - sp.t0));
      const frame = Math.floor(t / BOLT_FORK_MS);
      const fade = t < sp.t1 ? 1 : 1 - (t - sp.t1) / WARHOST_BOLT_HOLD_MS;
      const flick = (frame & 1 ? 0.7 : 1) * fade;
      const dx = sp.to.x - sp.from.x, dy = sp.to.y - sp.from.y;
      const amp = Math.min(70 * S, Math.hypot(dx, dy) * 0.08) * Z;
      let px = sp.from.x, py = sp.from.y;
      for (let i = 0; i < BOLT_SEGS; i++) {
        const f = (i + 1) / BOLT_SEGS;
        const off = i === BOLT_SEGS - 1 ? 0 : (hash01(sp.seed, frame, i) - 0.5) * 2 * amp * Math.sin(Math.PI * f);
        const nx = sp.from.x + dx * f + q.nx * off, ny = sp.from.y + dy * f + q.ny * off;
        const show = f <= reach + 1 / BOLT_SEGS;
        const len = Math.hypot(nx - px, ny - py), ang = Math.atan2(ny - py, nx - px);
        const g = q.glows[i], c = q.cores[i];
        boltSeg(g, show, px, py, nx, ny, len, ang, (46 * Z * S) / BEAM_PX, 0.85 * flick, S);
        boltSeg(c, show, px, py, nx, ny, len, ang, (10 * Z * S) / BEAM_PX, flick, S);
        px = nx; py = ny;
      }
      return true;
    }
    if (t < sp.t0 || t >= sp.t1) {
      if (q.halo?.visible) q.halo.visible = false;
      if (q.core?.visible) q.core.visible = false;
      if (q.body?.visible) q.body.visible = false;
      return false;
    }
    const e = (t - sp.t0) / Math.max(1, sp.t1 - sp.t0);
    quadAt(sp.from, sp.ctrl, sp.to, sp.school === 'rock' ? e * e * 0.35 + e * 0.65 : e, this.qp);
    const x = this.qp.x, y = this.qp.y;
    const grow = Math.min(1, (t - sp.t0) / 90);
    const rock = sp.school === 'rock';
    const R = (rock ? 62 : sp.school === 'fire' ? 44 : 38) * Z * S * grow; // the head's radius
    const flick = 1 + 0.14 * Math.sin(t * 0.06 + sp.seed) + 0.08 * Math.sin(t * 0.17);
    if (q.halo) { if (!q.halo.visible) q.halo.visible = true; q.halo.position.set(x, y); q.halo.scale.set((R * 3.2 * flick) / GLOW_PX); q.halo.alpha = 0.85; }
    if (q.body) { if (!q.body.visible) q.body.visible = true; q.body.position.set(x, y); q.body.scale.set((R * 1.15) / (ROCK_PX * 0.4)); q.body.rotation = t * 0.012; }
    if (q.core) {
      if (!q.core.visible) q.core.visible = true;
      q.core.position.set(x, y);
      q.core.scale.set(((sp.school === 'frost' ? R * 2.4 : R * 1.5) * (2 - flick)) / (sp.school === 'frost' ? STAR_PX : GLOW_PX));
      q.core.rotation = t * 0.015;
      q.core.alpha = rock ? 0.55 : 1;
    }
    if (t >= q.nextTrail) {
      q.nextTrail = t + TRAIL_MS;
      // Shed along the whole way travelled since the last shed, so a fast head leaves an unbroken tail, not beads.
      if (smooth) for (let k = 1; k <= 3; k++) this.spellTrail(sp.school, q.lx + (x - q.lx) * (k / 3), q.ly + (y - q.ly) * (k / 3), (R / S) * (0.75 + 0.08 * k), col.halo, col.hot);
      q.lx = x; q.ly = y;
    }
    return true;
  }

  /** The retreating sparks a spell sheds every few ms: flame and smoke, glittering frost, a comet of fire for the rock. */
  private spellTrail(school: WarhostSchool, x: number, y: number, r: number, halo: number, hot: number): void {
    const j = (): number => (this.rnd() - 0.5) * r * 0.8;
    if (school === 'frost') {
      this.spawn('glow', this.tex.spark, this.rnd() < 0.5 ? halo : hot, x + j(), y + j(), { dur: 380 + this.rnd() * 200, from: (r * 0.9) / 32, to: (r * 0.2) / 32, a0: 0.9, ease: 'linear', vx: (this.rnd() - 0.5) * 50, vy: 20 + this.rnd() * 30, drag: 0.6 });
      if (this.rnd() < 0.4) this.spawn('core', this.tex.star, 0xffffff, x + j(), y + j(), { dur: 300, from: (r * 0.5) / STAR_PX, to: 0.05, a0: 1, mode: 'punch', peakAt: 0.3, spin: 0.01 });
      return;
    }
    const n = school === 'rock' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const tint = i === 0 ? hot : this.rnd() < 0.5 ? halo : 0xff3a10;
      this.spawn('glow', this.tex.glow, tint, x + j(), y + j(), {
        dur: 260 + this.rnd() * 160, from: (r * (school === 'rock' ? 1.6 : 1.3)) / GLOW_PX * 2, to: (r * 0.3) / GLOW_PX * 2, a0: 0.85, ease: 'linear',
        vx: (this.rnd() - 0.5) * 70, vy: -30 - this.rnd() * 50, drag: 0.5,
      });
    }
    if (this.rnd() < (school === 'rock' ? 0.5 : 0.22)) {
      this.spawn('under', this.tex.dust, SMOKE, x + j(), y + j(), { dur: 600 + this.rnd() * 300, from: (r * 0.6) / DUST_PX, to: (r * 1.7) / DUST_PX, a0: 0.4, ease: 'cubic', vy: -26 - this.rnd() * 20, vx: (this.rnd() - 0.5) * 30, drag: 0.6, rot: this.rnd() * 6.28 });
    }
  }

  /** A glowing streak left behind a spear or an arrow in the air (gold and glinting for the straggler's arrow). */
  private shotTrail(x: number, y: number, rot: number, sh: Shot): void {
    const tint = sh.gold ? 0xffd86a : sh.kind === 'spear' ? whiten(this.colors.brass, 0.3) : 0xffe6b0;
    const big = sh.gold ? 2 : sh.kind === 'spear' ? 2.2 : 0.8;
    this.spawn('glow', this.tex.streak, tint, x, y, { dur: sh.gold || sh.kind === 'spear' ? 320 : 220, from: 0.9 * big, to: 0.35 * big, a0: sh.kind === 'arrow' && !sh.gold ? 0.6 : 0.95, ease: 'linear', rot, sy: 0.7 });
    if (sh.gold && this.rnd() < 0.6) this.spawn('core', this.tex.star, 0xfff2c0, x, y, { dur: 340, from: 0.45, to: 0.05, a0: 1, mode: 'punch', peakAt: 0.25, spin: 0.012, vx: (this.rnd() - 0.5) * 60, vy: (this.rnd() - 0.5) * 60 });
  }

  /** A mage jabs his staff at the other one: a little spit of sparks from his gem toward him. */
  private jab(q: TroopSprite, dir: number): void {
    const tr = q.spec;
    const col = tr.school ? SCHOOL_COLORS[tr.school] : SCHOOL_COLORS.bolt;
    const x = q.x + dir * WARHOST_MAGE_TIP.cast.x * q.k, y = q.y + WARHOST_MAGE_TIP.cast.y * q.k;
    this.burst('core', this.tex.spark, [col.hot, col.halo, 0xffffff], x, y, 5, { speed: 280, dir: dir > 0 ? -0.5 : Math.PI + 0.5, spread: 1, life: 260, size: 0.55, drag: 0.3, grav: 300 });
    this.spawn('core', this.tex.star, col.hot, x, y, { dur: 160, from: 14 / STAR_PX, to: 34 / STAR_PX, a0: 1, mode: 'punch', peakAt: 0.2, rot: 0.3 });
  }

  /** A lost soldier's start: a pop of three sparks over his head (where a cartoon would put a question mark). */
  private startle(x: number, y: number): void {
    this.burst('core', this.tex.spark, [0xffffff, this.colors.brass], x, y, 4, { speed: 160, dir: -Math.PI / 2, spread: 1.4, life: 300, size: 0.5, drag: 0.4 });
  }

  /** A drum skin struck: a small brass ring off it. */
  private drumSkin(x: number, y: number): void {
    this.spawn('glow', this.tex.ring, this.colors.brass, x, y, { dur: 220, from: 0.08, to: 0.36, a0: 0.6, ease: 'cubic', sy: 0.55 });
  }

  /** The sequence is over: hide every soldier, shot, spell, rune and banner (the particles drain by themselves). */
  retire(): void {
    for (const q of this.troops) { q.on = false; q.s.visible = false; this.hideExtras(q); }
    for (const q of this.shots) q.s.visible = false;
    for (const q of this.spells) { for (const s of [q.halo, q.core, q.body]) if (s) s.visible = false; for (const s of q.glows) if (s) s.visible = false; for (const s of q.cores) if (s) s.visible = false; }
    for (const q of this.banners) q.s.visible = false;
    this.ownLive = false;
  }

  // ── the dust and the bursts (fire and forget) ──

  /** A step puff under a foot or a hoof. */
  puff(x: number, y: number, k = 1): void {
    const D = this.look.dust;
    if (D <= 0) return;
    this.spawn('under', this.tex.dust, this.colors.dust, x, y, {
      dur: 300 + this.rnd() * 260, from: 0.18 * k * D, to: 0.6 * k * D, a0: 0.42, ease: 'cubic', vx: (this.rnd() - 0.5) * 40, vy: -22 - this.rnd() * 16, drag: 0.3,
      rot: this.rnd() * 6.28, spin: (this.rnd() - 0.5) * 0.003,
    });
  }

  /** A dust cloud rolling up over `at` (the trample burying the portrait): `n` big soft puffs within `r`. */
  cloud(at: Pt, r: number, n: number, k = 1, follow = false): void {
    const D = this.look.dust;
    if (D <= 0) return;
    const S = this.scale;
    for (let i = 0; i < n; i++) {
      const a = this.rnd() * Math.PI * 2, rr = Math.sqrt(this.rnd()) * r;
      const size = (r * (0.42 + this.rnd() * 0.4) * k) / DUST_PX / S;
      this.spawn('body', this.tex.dust, mixColor(this.colors.dust, 0xffffff, this.rnd() * 0.18), at.x + Math.cos(a) * rr, at.y + Math.sin(a) * rr * 0.7, {
        dur: 620 + this.rnd() * 520, from: size * 0.7, to: size * 1.8, a0: 0.5 * Math.min(1.4, D), mode: 'punch', peakAt: 0.22, ease: 'cubic',
        vx: (this.rnd() - 0.5) * 90, vy: -20 - this.rnd() * 40, drag: 0.4, rot: this.rnd() * 6.28, spin: (this.rnd() - 0.5) * 0.002, delay: this.rnd() * 90, follow,
      });
    }
  }

  /**
   * THE ROLLING DUST WALL: big soft clouds thrown up along a line across the charge's front (`at`, running along the
   * normal `n` for `half` px either side) and carried forward along `u` with it. Called every few frames while the
   * charge crosses, so the front of the host is always coming out of its own dust. `k` scales it (Tier 3 is smaller).
   */
  dustWall(at: Pt, u: Pt, n: Pt, half: number, count: number, k = 1): void {
    const D = this.look.dust;
    if (D <= 0) return;
    const S = this.scale;
    for (let i = 0; i < count; i++) {
      const lat = (this.rnd() - 0.5) * 2 * half;
      const along = (this.rnd() - 0.2) * 70 * S;
      const size = ((90 + this.rnd() * 90) * k) / DUST_PX;
      // Most of it rolls under the feet; some billows up in front of the ranks.
      this.spawn(i % 3 === 0 ? 'body' : 'under', this.tex.dust, mixColor(this.colors.dust, 0xffffff, this.rnd() * 0.22), at.x + n.x * lat + u.x * along, at.y + n.y * lat + u.y * along, {
        dur: 640 + this.rnd() * 520, from: size * 0.5, to: size * (1.7 + this.rnd() * 0.8), a0: (i % 3 === 0 ? 0.2 : 0.46) * Math.min(1.4, D), mode: 'punch', peakAt: 0.2, ease: 'cubic',
        vx: u.x * (170 + this.rnd() * 150) + (this.rnd() - 0.5) * 70, vy: u.y * (170 + this.rnd() * 150) - 24 - this.rnd() * 44, drag: 0.35, rot: this.rnd() * 6.28, spin: (this.rnd() - 0.5) * 0.002,
      });
    }
  }

  /** A spear or an arrow going into wood: a small bright knock, a ring, splinters thrown back the way it came. */
  thunk(at: Pt, dir: Pt, k = 1): void {
    const c = this.colors;
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 170, from: (26 * k) / STAR_PX, to: (78 * k) / STAR_PX, a0: 0.95, mode: 'punch', peakAt: 0.15, rot: 0.4, follow: true });
    this.spawn('glow', this.tex.ring, c.brass, at.x, at.y, { dur: 260, from: (14 * k) / RING_PX, to: (110 * k) / RING_PX, a0: 0.8, ease: 'cubic', follow: true });
    this.burst('body', this.tex.dust, [WOOD, mixColor(WOOD, 0xffffff, 0.35), c.dust], at.x, at.y, Math.round(5 + 3 * k), {
      speed: 300 * k, dir: Math.atan2(-dir.y, -dir.x), spread: 2.2, life: 360, size: 0.1 * k, grav: 700, drag: 0.4, to: 0.6,
    });
  }

  /** One arrow of the rain going in: a speck of a knock and a wisp of dust. */
  arrowTick(at: Pt): void {
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 130, from: 12 / STAR_PX, to: 40 / STAR_PX, a0: 0.85, mode: 'punch', peakAt: 0.2, follow: true });
    this.spawn('body', this.tex.dust, this.colors.dust, at.x, at.y, { dur: 300, from: 0.12, to: 0.4, a0: 0.5, ease: 'cubic', vy: -20, drag: 0.4, follow: true });
  }

  /** Tier 1: FLAT ON HIS FACE. A burst of dust where he lands, his tin helmet's clink (a spark), a little ring. */
  trip(at: Pt, dir: number, k: number): void {
    const c = this.colors, S = this.scale;
    const head = { x: at.x + dir * 50 * k * S, y: at.y - 4 * S };
    for (let i = 0; i < 6; i++) this.puff(head.x + (this.rnd() - 0.5) * 60 * k * S, head.y - this.rnd() * 6 * S, 1.3 * k);
    this.spawn('core', this.tex.star, 0xffffff, head.x, head.y - 8 * S, { dur: 200, from: 0.4, to: 1.1, a0: 1, mode: 'punch', peakAt: 0.15, rot: 0.3 });
    this.spawn('glow', this.tex.ring, c.brass, head.x, head.y, { dur: 300, from: 0.15, to: 0.8 * k, a0: 0.6, sy: 0.4, ease: 'cubic' });
    this.burst('core', this.tex.spark, [c.brass, 0xffffff], head.x, head.y - 6 * S, 6, { speed: 260, dir: -Math.PI / 2, spread: 2, life: 320, size: 0.5, grav: 900, drag: 0.4 });
  }

  /** A war drum: a low ring off the striking hero's feet and a kick of dust. */
  drum(at: Pt, r: number, i: number): void {
    const c = this.colors;
    this.spawn('glow', this.tex.ring, i === 2 ? whiten(c.brass, 0.3) : c.brass, at.x, at.y, { dur: 420, from: (r * 0.9) / RING_PX, to: (r * (2.6 + 0.5 * i)) / RING_PX, a0: 0.5 + 0.12 * i, ease: 'cubic' });
    this.spawn('glow', this.tex.glow, c.red, at.x, at.y, { dur: 260, from: (r * 1.6) / GLOW_PX, to: (r * 2.6) / GLOW_PX, a0: 0.3 + 0.08 * i, mode: 'punch', peakAt: 0.15 });
    for (let j = 0; j < 4 + i; j++) this.puff(at.x + (this.rnd() - 0.5) * r * 2.2, at.y + r * (0.8 + this.rnd() * 0.3), 1.3);
  }

  /** The horn: three sound rings rolling off the striker toward the target. */
  horn(at: Pt, dir: Pt, r: number): void {
    const c = this.colors;
    for (let i = 0; i < 3; i++) {
      this.spawn('glow', this.tex.ring, i % 2 ? c.red : c.brass, at.x + dir.x * r * (0.9 + i * 0.25), at.y + dir.y * r * (0.9 + i * 0.25), {
        dur: 520, from: (r * 0.5) / RING_PX, to: (r * (1.9 + 0.5 * i)) / RING_PX, a0: 0.55, ease: 'cubic', delay: i * 130, vx: dir.x * 220, vy: dir.y * 220, drag: 0.5,
      });
    }
  }

  /** The mages' circles light up together: a ring rolling out of each and a flash of its colour. */
  runesFlare(): void {
    for (const q of this.troops) {
      const tr = q.spec;
      if (tr.unit !== 'mage' || !tr.school) continue;
      const col = SCHOOL_COLORS[tr.school];
      this.spawn('glow', this.tex.ring, col.rune, q.x, q.y, { dur: 420, from: 0.2, to: 1.1 * this.look.spellSize, a0: 0.9, sy: 0.42, ease: 'cubic' });
      this.spawn('glow', this.tex.glow, col.halo, q.x, q.y - 30 * this.scale, { dur: 300, from: 0.5, to: 1.2, a0: 0.5, mode: 'punch', peakAt: 0.2 });
    }
  }

  /** A spell leaves the staff: a flash at the tip in its colour (and a spit of sparks). */
  castFlash(at: Pt, school: WarhostSchool): void {
    const col = SCHOOL_COLORS[school], Z = this.look.spellSize;
    this.spawn('core', this.tex.glow, col.hot, at.x, at.y, { dur: 200, from: 0.25 * Z, to: 0.75 * Z, a0: 0.95, mode: 'punch', peakAt: 0.15 });
    this.spawn('glow', this.tex.ring, col.halo, at.x, at.y, { dur: 260, from: 0.05, to: 0.4 * Z, a0: 0.8, ease: 'cubic' });
    this.burst('core', this.tex.spark, [col.hot, col.halo], at.x, at.y, 6, { speed: 320, life: 260, size: 0.5, drag: 0.3 });
  }

  /**
   * A spell lands: FIRE bursts in flame, rings and embers and singes the portrait; FROST in shards, snow and a cold
   * glow; LIGHTNING in a white flash and a spray of sparks; the BOULDER in a crash of rock chunks, fire and dust.
   * `k` scales it (the second round, all landing on the blow, is bigger).
   */
  spellHit(school: WarhostSchool, at: Pt, radius: number, k = 1): void {
    const col = SCHOOL_COLORS[school], S = this.scale, Z = k * this.look.spellSize;
    const R = radius / S;
    if (school === 'fire' || school === 'rock') {
      const rock = school === 'rock';
      const big = rock ? 1.7 : 1;
      this.spawn('core', this.tex.glow, col.hot, at.x, at.y, { dur: 220, from: (R * 0.8 * big * Z) / GLOW_PX, to: (R * 2.2 * big * Z) / GLOW_PX, a0: 0.9, mode: 'punch', peakAt: 0.12, follow: true });
      this.spawn('glow', this.tex.glow, col.halo, at.x, at.y, { dur: 520, from: (R * 1.2 * big * Z) / GLOW_PX, to: (R * 3 * big * Z) / GLOW_PX, a0: 0.75, mode: 'punch', peakAt: 0.15, ease: 'cubic', follow: true });
      this.spawn('glow', this.tex.ring, col.halo, at.x, at.y, { dur: 380, from: (R * 0.4) / RING_PX, to: (R * 2.6 * big * Z) / RING_PX, a0: 0.85, ease: 'cubic' });
      this.spawn('glow', this.tex.ring, col.hot, at.x, at.y, { dur: 300, from: (R * 0.3) / RING_PX, to: (R * 1.8 * big * Z) / RING_PX, a0: 0.7, ease: 'cubic', delay: 50 });
      this.burst('glow', this.tex.glow, [col.hot, col.halo, 0xff3a10], at.x, at.y, Math.round((rock ? 16 : 10) * k), { speed: 420 * big * Z, life: 520, size: 0.22 * Z, drag: 0.35, grav: -160, to: 0.2 });
      this.burst('core', this.tex.spark, [col.hot, 0xffffff, col.halo], at.x, at.y, Math.round((rock ? 22 : 14) * k), { speed: 700 * big * Z, life: 480, size: 0.6 * Z, drag: 0.3, grav: 500, to: 0.3 });
      for (let i = 0; i < (rock ? 7 : 4); i++) {
        this.spawn('under', this.tex.dust, SMOKE, at.x + (this.rnd() - 0.5) * R, at.y + (this.rnd() - 0.5) * R * 0.6, {
          dur: 800 + this.rnd() * 400, from: (R * 0.4) / DUST_PX, to: (R * 1.4 * big) / DUST_PX, a0: 0.45, ease: 'cubic', vy: -40 - this.rnd() * 30, vx: (this.rnd() - 0.5) * 60, drag: 0.5,
          rot: this.rnd() * 6.28, delay: this.rnd() * 120,
        });
      }
      if (rock) {
        // The boulder bursts: chunks of it flung out (spinning bits of the rock itself), and the dust goes up.
        this.burst('body', this.tex.rock, [ROCK_GREY, 0x6b6560, 0xa59f98], at.x, at.y, 12, { speed: 820, dir: -Math.PI / 2, spread: 3.4, life: 760, size: 0.26, grav: 1500, drag: 0.5, spin: 0.03, to: 0.8 });
        this.cloud(at, radius * 1.5, 12, 1.1);
        this.spawn('glow', this.tex.ring, this.colors.dust, at.x, at.y + R * 0.4, { dur: 620, from: (R * 0.5) / RING_PX, to: (R * 4.5) / RING_PX, a0: 0.7, sy: 0.4, ease: 'cubic' });
      }
      this.singe(at, radius, rock ? 1.4 : 1);
    } else if (school === 'frost') {
      this.spawn('core', this.tex.glow, col.hot, at.x, at.y, { dur: 200, from: (R * 0.7 * Z) / GLOW_PX, to: (R * 1.9 * Z) / GLOW_PX, a0: 0.85, mode: 'punch', peakAt: 0.12, follow: true });
      this.spawn('glow', this.tex.ring, col.halo, at.x, at.y, { dur: 420, from: (R * 0.3) / RING_PX, to: (R * 2.4 * Z) / RING_PX, a0: 0.9, ease: 'cubic' });
      this.burst('core', this.tex.streak, [col.hot, col.halo, 0xffffff], at.x, at.y, Math.round(14 * k), { speed: 760 * Z, life: 380, size: 0.9 * Z, drag: 0.25, align: true, to: 0.5 });
      this.burst('glow', this.tex.star, [0xffffff, col.hot], at.x, at.y, Math.round(10 * k), { speed: 240 * Z, life: 800, size: (16 * Z) / STAR_PX, grav: 140, drag: 0.5, spin: 0.012 });
      // The portrait frosts over for a moment (a cold glow riding it).
      this.spawn('glow', this.tex.glow, col.halo, at.x, at.y, { dur: 700, from: (R * 2) / GLOW_PX, to: (R * 2.3) / GLOW_PX, a0: 0.38, mode: 'hold', follow: true });
    } else {
      this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 160, from: (R * 0.9 * Z) / GLOW_PX, to: (R * 2.4 * Z) / GLOW_PX, a0: 0.95, mode: 'punch', peakAt: 0.1, follow: true });
      this.spawn('glow', this.tex.ring, col.halo, at.x, at.y, { dur: 300, from: (R * 0.3) / RING_PX, to: (R * 2.2 * Z) / RING_PX, a0: 0.9, ease: 'cubic' });
      this.burst('core', this.tex.streak, [0xffffff, col.halo], at.x, at.y, Math.round(16 * k), { speed: 1100 * Z, life: 220, size: 0.8 * Z, drag: 0.2, align: true, to: 0.4 });
      this.burst('core', this.tex.star, [0xffffff, col.hot], at.x, at.y, 5, { speed: 300, life: 260, size: (18 * Z) / STAR_PX, drag: 0.4, spin: 0.03 });
    }
  }

  /**
   * SINGED: a scorch mark darkening the struck portrait for a second (riding it), wisps of smoke curling up off it and
   * embers drifting up.
   */
  singe(at: Pt, radius: number, k = 1): void {
    const S = this.scale, R = radius / S;
    this.spawn('body', this.tex.glow, SCORCH, at.x, at.y, { dur: 1300, from: (R * 1.1 * k) / GLOW_PX, to: (R * 1.3 * k) / GLOW_PX, a0: 0.42, mode: 'hold', follow: true });
    for (let i = 0; i < Math.round(5 * k); i++) {
      this.spawn('body', this.tex.dust, mixColor(SMOKE, 0x6a625e, this.rnd()), at.x + (this.rnd() - 0.5) * R, at.y + (this.rnd() - 0.3) * R * 0.6, {
        dur: 900 + this.rnd() * 500, from: (R * 0.25) / DUST_PX, to: (R * 0.9) / DUST_PX, a0: 0.4, ease: 'cubic', vy: -50 - this.rnd() * 30, vx: (this.rnd() - 0.5) * 30, drag: 0.7,
        rot: this.rnd() * 6.28, spin: (this.rnd() - 0.5) * 0.003, delay: 150 + this.rnd() * 600,
      });
    }
    this.burst('glow', this.tex.spark, [0xffb040, 0xff6a1a], at.x, at.y, Math.round(8 * k), { speed: 120, dir: -Math.PI / 2, spread: 2, life: 1000, size: 0.4, drag: 0.6, grav: -90, to: 0.2 });
  }

  /**
   * THE blow. Tier 1, 2: the knock of the spear or the golden arrow (a thunk and a ring; the golden one glints). Tier 3:
   * the point rider's hit (a red and brass shock, speed lines, a first roll of dust). Tier 4: the front rank's (the
   * same, far bigger, and the dust goes up over the whole portrait).
   */
  impact(at: Pt, strike: Pt, dir: Pt, radius: number, tier: number): void {
    const c = this.colors;
    const X = this.look.impactSize;
    if (tier <= 2) {
      this.thunk(strike, dir, (tier === 1 ? 1.5 : 1.6) * X);
      this.spawn('glow', this.tex.ring, c.red, at.x, at.y, { dur: 340, from: (radius * 0.7) / RING_PX, to: (radius * (1.9 + 0.5 * tier) * X) / RING_PX, a0: 0.7, ease: 'cubic', follow: true });
      if (tier === 2) {
        // The golden arrow: a gold flash and a glint off it.
        this.spawn('core', this.tex.glow, 0xffd86a, strike.x, strike.y, { dur: 260, from: (radius * 0.5) / GLOW_PX, to: (radius * 1.8) / GLOW_PX, a0: 0.8, mode: 'punch', peakAt: 0.12, follow: true });
        this.spawn('core', this.tex.star, 0xfff2c0, strike.x, strike.y, { dur: 480, from: 0.4, to: 2.2, a0: 1, mode: 'punch', peakAt: 0.2, spin: 0.006, follow: true });
        this.cloud(at, radius * 0.7, 3, 0.7, true);
      }
      return;
    }
    const big = tier >= 4 ? 1.5 : 1;
    this.spawn('core', this.tex.glow, whiten(c.brass, 0.4), at.x, at.y, { dur: 180, from: (radius * 1.1) / GLOW_PX, to: (radius * 2.2 * X) / GLOW_PX, a0: 0.55, mode: 'punch', peakAt: 0.1 });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 220, from: (radius * 0.8) / STAR_PX, to: (radius * 2.6 * big * X) / STAR_PX, a0: 0.95, mode: 'punch', peakAt: 0.14, rot: 0.3 });
    [c.brass, c.red, whiten(c.brass, 0.3)].forEach((tint, i) => {
      if (i === 2 && tier < 4) return;
      this.spawn('glow', this.tex.ring, tint, at.x, at.y, { dur: 380 + i * 110, from: (radius * 0.6) / RING_PX, to: (radius * (2.6 + i * 0.9) * big * X) / RING_PX, a0: 0.7, ease: 'cubic', delay: i * 50 });
    });
    // Speed lines flung on past the target, the way the charge is going.
    this.burst('glow', this.tex.streak, [c.brass, c.red, whiten(c.brass, 0.5)], at.x, at.y, Math.round(8 * big), {
      speed: 1500 * big * X, dir: Math.atan2(dir.y, dir.x), spread: 1.3, life: 240, size: 1.4 * big * X, drag: 0.2, align: true, to: 0.5,
    });
    this.burst('core', this.tex.spark, [c.brass, 0xffffff, c.red], at.x, at.y, Math.round(20 * big), { speed: 720 * big * X, life: 460, size: 0.7 * X, drag: 0.3, grav: 500, to: 0.3 });
    // The hit lights the struck portrait for a moment, and the dust goes up over it.
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 240, from: (radius * 1.8) / GLOW_PX, to: (radius * 3.4 * big * X) / GLOW_PX, a0: 0.5, mode: 'punch', peakAt: 0.1, follow: true });
    this.spawn('glow', this.tex.glow, c.red, at.x, at.y, { dur: 620, from: (radius * 2.2) / GLOW_PX, to: (radius * 3.2 * big) / GLOW_PX, a0: 0.45, mode: 'punch', peakAt: 0.12, ease: 'cubic', follow: true });
    this.cloud(at, radius * (tier >= 4 ? 1.7 : 1.3), tier >= 4 ? 26 : 14, 1.1);
  }

  /** A later row or rank going over the target: more dust up over it, a few kicked sparks. */
  buffet(at: Pt, radius: number, k: number): void {
    this.cloud(at, radius * 1.4 * k, Math.round(9 * k + 4), 1);
    this.spawn('glow', this.tex.ring, this.colors.brass, at.x, at.y, { dur: 300, from: (radius * 0.8) / RING_PX, to: (radius * 2.6 * k) / RING_PX, a0: 0.5, ease: 'cubic', follow: true });
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 150, from: (radius * 1.4) / GLOW_PX, to: (radius * 2.2) / GLOW_PX, a0: 0.28, mode: 'punch', peakAt: 0.15, follow: true });
    this.burst('core', this.tex.spark, [this.colors.brass, 0xffffff, this.colors.red], at.x, at.y, 9, { speed: 520, life: 340, size: 0.5, drag: 0.3, grav: 500, to: 0.3 });
  }

  /**
   * THE BANNER GOES IN, a beat of its own: a hard knock where the pole bites, two rings rolling out along the ground, a
   * ring of dust kicked out round its foot, a shower of brass sparks, and a long glint off the finial.
   */
  plant(at: Pt, radius: number): void {
    const c = this.colors;
    const S = this.scale;
    this.spawn('core', this.tex.glow, 0xffffff, at.x, at.y, { dur: 200, from: (radius * 1.2) / GLOW_PX, to: (radius * 3) / GLOW_PX, a0: 0.6, mode: 'punch', peakAt: 0.12, follow: true });
    this.spawn('core', this.tex.star, 0xffffff, at.x, at.y, { dur: 220, from: (radius * 0.5) / STAR_PX, to: (radius * 1.8) / STAR_PX, a0: 0.95, mode: 'punch', peakAt: 0.15, rot: 0.4, follow: true });
    this.spawn('glow', this.tex.ring, c.brass, at.x, at.y, { dur: 460, from: (radius * 0.3) / RING_PX, to: (radius * 3.2) / RING_PX, a0: 0.85, sy: 0.45, ease: 'cubic', follow: true });
    this.spawn('glow', this.tex.ring, c.red, at.x, at.y, { dur: 620, from: (radius * 0.4) / RING_PX, to: (radius * 4.4) / RING_PX, a0: 0.55, sy: 0.45, ease: 'cubic', delay: 70, follow: true });
    this.spawn('glow', this.tex.glow, c.brass, at.x, at.y - radius * 0.9, { dur: 900, from: (radius * 2.2) / GLOW_PX, to: (radius * 3.2) / GLOW_PX, a0: 0.4, mode: 'punch', peakAt: 0.15, ease: 'cubic', follow: true });
    // The ring of dust: puffs thrown outward along the ground, all round the foot.
    const D = this.look.dust;
    for (let i = 0; i < 14 && D > 0; i++) {
      const a = (i / 14) * Math.PI * 2 + this.rnd() * 0.3;
      const sp = 240 + this.rnd() * 160;
      this.spawn('body', this.tex.dust, mixColor(c.dust, 0xffffff, this.rnd() * 0.2), at.x + Math.cos(a) * radius * 0.3, at.y + Math.sin(a) * radius * 0.14, {
        dur: 520 + this.rnd() * 300, from: (radius * 0.3) / DUST_PX / S, to: (radius * 0.9) / DUST_PX / S, a0: 0.5 * Math.min(1.4, D), mode: 'punch', peakAt: 0.2, ease: 'cubic',
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.45 - 20, drag: 0.2, rot: this.rnd() * 6.28, follow: true,
      });
    }
    this.burst('core', this.tex.spark, [c.brass, 0xffffff, c.red], at.x, at.y, 16, { speed: 560, dir: -Math.PI / 2, spread: 2.6, life: 520, size: 0.6, drag: 0.3, grav: 700, to: 0.3 });
    // The glint off the finial as the flag snaps open.
    this.spawn('core', this.tex.star, whiten(c.brass, 0.6), at.x, at.y - radius * 1.7, { dur: 520, from: 0.3, to: 1.8, a0: 0.95, mode: 'punch', peakAt: 0.25, spin: 0.004, delay: 90, follow: true });
  }

  /** THE KNOCKOUT's prismatic shock (on top of Tier 4's impact): cyan, lilac and magenta rings, prism streaks and stars. */
  koFlourish(at: Pt, radius: number): void {
    const X = this.look.impactSize * 1.3;
    [KO_CYAN, KO_LILAC, KO_MAGENTA].forEach((tint, i) => this.spawn('glow', this.tex.ring, tint, at.x, at.y, {
      dur: 640 + i * 120, from: (radius * 0.8) / RING_PX, to: (radius * (4.2 + i * 1.2) * X) / RING_PX, a0: 0.85, ease: 'cubic', delay: 40 + i * 70,
    }));
    this.spawn('glow', this.tex.glow, KO_CYAN, at.x, at.y, { dur: 700, from: (radius * 1.6) / GLOW_PX, to: (radius * 4.4 * X) / GLOW_PX, a0: 0.4, mode: 'punch', peakAt: 0.15 });
    this.burst('glow', this.tex.streak, [KO_CYAN, KO_LILAC, KO_MAGENTA], at.x, at.y, 18, { speed: 1900 * X, life: 400, size: 2 * X, drag: 0.2, align: true, to: 0.6 });
    this.burst('core', this.tex.star, [KO_CYAN, KO_MAGENTA, 0xffffff], at.x, at.y, 10, { speed: 620 * X, life: 680, size: (22 * X) / STAR_PX, drag: 0.3, spin: 0.02 });
  }

  protected override tick(dt: number): boolean { void dt; return this.ownLive; }

  protected override clearOwn(): void {
    for (const q of this.troops) {
      q.s.visible = true; q.s.skew.set(0, 0); this.give(q.s);
      if (q.gem) { q.gem.visible = true; this.give(q.gem); }
      for (const s of q.stars) if (s) { s.visible = true; this.give(s); }
    }
    for (const q of this.shots) { q.s.visible = true; this.give(q.s); }
    for (const q of this.spells) {
      for (const s of [q.halo, q.core, q.body]) if (s) { s.visible = true; this.give(s); }
      for (const s of q.glows) if (s) { s.visible = true; this.give(s); }
      for (const s of q.cores) if (s) { s.visible = true; this.give(s); }
    }
    for (const q of this.banners) { q.s.visible = true; q.s.skew.set(0, 0); this.give(q.s); }
    for (const r of this.runes) { r.parent?.removeChild(r); r.destroy({ children: true }); }
    this.troops = []; this.shots = []; this.spells = []; this.banners = []; this.runes = []; this.troopAtIndex = [];
    this.ownLive = false;
  }
}

/** One segment of a lightning bolt (a beam sprite stretched from one fork point to the next). Allocation-free. */
function boltSeg(s: Sprite | null, show: boolean, x0: number, y0: number, x1: number, y1: number, len: number, ang: number, sy: number, alpha: number, S: number): void {
  if (!s) return;
  if (!show) { if (s.visible) s.visible = false; return; }
  if (!s.visible) s.visible = true;
  s.position.set((x0 + x1) / 2, (y0 + y1) / 2);
  s.rotation = ang;
  s.scale.set((len + 4 * S) / BEAM_PX, sy);
  s.alpha = alpha;
}

/** A cheer: `n` little hops (px of lift at stage scale 1), then feet on the ground. */
function hop(ms: number, n: number): number {
  const each = 180;
  if (ms < 0 || ms >= each * n) return 0;
  return Math.abs(Math.sin((ms / each) * Math.PI)) * 12;
}
