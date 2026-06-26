import { Application, Container, Graphics, Mesh, MeshGeometry, Shader, Sprite, Texture, type BLEND_MODES, type Ticker } from 'pixi.js';

/**
 * Vertex shader for the shield Mesh (WebGL2 / GLSL ES 3.0). Pixi's GlMeshAdaptor binds the global-uniform
 * group (uProjectionMatrix, uWorldTransformMatrix) + the mesh's local-uniform group (uTransformMatrix), so
 * we just declare them and transform the quad; `aUV` (a clean 0..1 from the geometry) feeds the fragment.
 */
const SHIELD_VERT = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

/**
 * The divine-shield bubble fragment shader (WebGL, GLSL ES 3.0 via Pixi's `Filter.from`). Procedural — it
 * ignores the input texture and draws a glassy energy sphere over the filtered quad: a faked-3D sphere
 * normal drives a moving specular glint; a fresnel term lights the rim like curved glass; a scrolling,
 * aspect-corrected HEX force-field grid + drifting value-noise caustics give the "energy" read; everything
 * breathes on `uTime`. Output is premultiplied gold so it tints the unit behind it (see-through center,
 * bright rim). `uColor` lets the same shader serve the future blue Reborn shield.
 */
const SHIELD_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform float uTime;
uniform float uAspect;   // card w/h, so the hex cells stay regular on a tall card
uniform vec3  uColor;    // shield tint (gold for Divine Shield)
uniform float uSeed;     // per-bubble phase offset so neighbours don't pulse in lockstep

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
// distance to the nearest edge of a hex cell (flat-top), 0 at centre → ~0.5 at edge
float hexEdge(vec2 p){ p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }

void main(){
  vec2 uv = vUV;               // clean 0..1 straight from the mesh geometry
  vec2 p = (uv - 0.5) * 2.0;   // -1..1 across the quad
  float d = length(p);
  if (d >= 1.0) { finalColor = vec4(0.0); return; }

  // faked sphere normal → moving specular glint (sells the glass)
  float z = sqrt(max(0.0, 1.0 - d * d));
  vec3 n = vec3(p, z);
  vec3 L = normalize(vec3(-0.45, -0.6, 0.65));
  float spec = pow(max(0.0, dot(reflect(-L, n), vec3(0.0, 0.0, 1.0))), 26.0);

  // fresnel rim — bright glassy edge
  float rim = pow(smoothstep(0.5, 1.0, d), 2.0);

  // hex force-field: two offset lattices → honeycomb, scrolling + pulsing
  vec2 hp = p * vec2(uAspect, 1.0) * 4.5;
  vec2 cell = vec2(1.0, 1.7320508);
  vec2 h1 = mod(hp, cell) - cell * 0.5;
  vec2 h2 = mod(hp + cell * 0.5, cell) - cell * 0.5;
  vec2 hh = dot(h1, h1) < dot(h2, h2) ? h1 : h2;
  float edge = smoothstep(0.36, 0.5, hexEdge(hh));
  float hexPulse = 0.55 + 0.45 * sin(uTime * 1.6 + (uv.x + uv.y) * 6.0 + uSeed);
  float hex = edge * (0.3 + 0.5 * hexPulse) * 0.7;   // −30% interior opacity

  // drifting energy caustics
  float e = vnoise(p * 3.0 + vec2(uTime * 0.30, -uTime * 0.22) + uSeed)
          + 0.5 * vnoise(p * 6.0 - vec2(uTime * 0.25, uTime * 0.30));
  float energy = 0.12 + 0.22 * e;

  float pulse = 0.85 + 0.15 * sin(uTime * 1.1 + uSeed);   // whole-bubble breathe

  float bodyA = (0.16 + energy * 0.5) * pulse * 0.7;      // translucent interior (−30% opacity)
  float alpha = clamp(bodyA + rim * 0.85 + hex * 0.5, 0.0, 0.92);
  alpha *= smoothstep(1.0, 0.94, d);                      // soft outer edge

  vec3 col = uColor * (bodyA + rim * 1.3 + hex) * pulse;
  col += vec3(1.0, 0.96, 0.85) * spec * 1.5;              // white-gold specular glint
  col += uColor * rim * 0.6;                              // rim bloom

  finalColor = vec4(col * alpha, alpha);                  // premultiplied
}
`;

/**
 * The WebGL effects layer — a single transparent PixiJS overlay stretched over the whole
 * viewport, drawing the *juice* that DOM/CSS does poorly (particle bursts, impact flashes)
 * on the GPU compositor. It does NOT render the board, cards, or layout — React/DOM still
 * owns all of that. The overlay reads the same viewport coordinates the combat replay
 * already measures via `getBoundingClientRect`, so effects land exactly on units.
 *
 * This is the foundation a future Pixi combat arena grows out of (the `Application`/`stage`
 * is reused, not re-bootstrapped): effects first → combat sprites → full arena, each step
 * shippable. For now it's purely additive — `main` stays playable.
 *
 * Math.random is used freely here for spread/jitter — the engine RNG ban is `core`/`content`/
 * `sim` only; this is presentation.
 */

/** One live particle, pooled. Position is in CSS/viewport pixels (1:1 with the stage). */
interface Particle {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number; // px/sec
  vy: number;
  drag: number; // velocity multiplier per second (<1 = decelerate)
  life: number; // ms remaining
  maxLife: number;
  fromScale: number;
  toScale: number;
  spin: number; // rad/sec
  peakAlpha: number; // opacity at birth; fades to 0 over life (smoke is semi-transparent)
  gravity: number;   // downward accel px/sec² (coins arc up then fall); 0 = none
}

/**
 * A persistent divine-shield bubble bound to one unit (by uid). Unlike particles (fire-and-forget),
 * it lives until the shield breaks or is cleared, breathing on the ticker and tracking the unit's
 * on-screen rect. The React layers measure the rect and push it via `setShield`; this stays DOM-agnostic.
 */
interface ShieldBubble {
  container: Container;
  mesh: Mesh;            // a quad mesh the shield shader draws the energy sphere onto (clean 0..1 UVs)
  shader: Shader;        // the per-bubble shield shader (its uTime/uAspect animate each frame)
  cx: number; cy: number; // target center (viewport px)
  w: number; h: number;   // target footprint (the card's size)
  age: number;            // ms lived — drives the breathe phase + vein drift
  formIn: number;         // ms elapsed of the grow-in (clamped at FORM_MS)
  fadeOut: number;        // ms elapsed of a graceful clear (−1 = not fading)
  mini: boolean;          // true while the card is being dragged → shrink to a small trailing sparkle
  pop: number;            // ms elapsed of the coalesce/pop-in on placement (−1 = not popping)
  scaleMul: number;       // current size multiplier (lerps toward 1 or MINI_SCALE; the pop drives it directly)
}

// Shield-bubble feel (tunable live via window.__pixiFx in DEV). The shield shader draws into a quad of
// half-size BUBBLE_TEX_R; the container is scaled per-unit to fit the card's footprint.
const BUBBLE_TEX_R = 40;       // shader quad half-size (px) before per-unit scaling
const BUBBLE_MARGIN = 0.84;    // bubble size vs the card footprint (−25% from 1.12 — sits inside the frame)
const BREATHE_MS = 2600;       // slow pulse period (the shader also breathes on its own clock)
const FORM_MS = 260;           // grow-in when a shield is gained
const FADE_MS = 200;           // graceful fade when a shield is cleared without breaking
const MINI_SCALE = 0.3;        // bubble size while dragging (a small trailing sparkle of the card)
const POP_MS = 320;            // coalesce/pop-in duration when a dragged card is placed
const SHIELD_GOLD_RGB = [1.0, 0.82, 0.29]; // Divine-Shield shader tint (0xffd24a in 0..1 rgb)

class FxController {
  private app: Application | null = null;
  private layer: Container | null = null;
  private ready = false;
  private initing: Promise<void> | null = null;
  private sparkTex: Texture | null = null;
  private glowTex: Texture | null = null;
  private shardRectTex: Texture | null = null; // jagged spark: elongated rectangle
  private shardTriTex: Texture | null = null;   // jagged spark: triangle
  private coinTex: Texture | null = null;       // gold coin (sell sprinkle)
  private bubbleTex: Texture | null = null;     // soft translucent disc — shield body
  private rimTex: Texture | null = null;        // bright ring — shield rim highlight
  private veinTex: Texture | null = null;       // thin streak — shield energy vein
  private shieldLayer: Container | null = null; // holds the persistent bubbles, beneath the particle layer
  private shieldGeo: MeshGeometry | null = null; // shared quad geometry (−R..R, uv 0..1) for every bubble mesh
  private readonly shields = new Map<string, ShieldBubble>();
  private readonly live: Particle[] = [];
  private readonly pool: Sprite[] = [];

  /** Mount the overlay canvas into `parent` (a fixed, full-viewport, pointer-events:none div).
   *  Lazily creates the PixiJS Application on first call and reuses it thereafter. */
  attach(parent: HTMLElement): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve(); // SSR guard
    if (this.app) {
      parent.appendChild(this.app.canvas); // re-mount the existing canvas (e.g. after a remount)
      return Promise.resolve();
    }
    if (this.initing) return this.initing;
    this.initing = this.init(parent).catch((e) => {
      // A failed init (e.g. no WebGL context) otherwise fails silently and every impact() no-ops.
      console.error('[pixiFx] overlay init failed — effects disabled:', e);
    });
    return this.initing;
  }

  private async init(parent: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      backgroundAlpha: 0, // transparent — it's an overlay
      antialias: true,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    // The replay may have remounted before init resolved; only attach if still wanted.
    const canvas = app.canvas;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.display = 'block';
    parent.appendChild(canvas);

    // Bubbles sit on their own layer BENEATH the particle layer, so break shards/flash draw over them.
    const shieldLayer = new Container();
    app.stage.addChild(shieldLayer);
    const layer = new Container();
    app.stage.addChild(layer);

    this.app = app;
    this.layer = layer;
    this.shieldLayer = shieldLayer;
    // shared centred quad (−R..R) with 0..1 UVs — every bubble mesh reuses it; the container scales it per-unit
    this.shieldGeo = new MeshGeometry({
      positions: new Float32Array([-BUBBLE_TEX_R, -BUBBLE_TEX_R, BUBBLE_TEX_R, -BUBBLE_TEX_R, BUBBLE_TEX_R, BUBBLE_TEX_R, -BUBBLE_TEX_R, BUBBLE_TEX_R]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.sparkTex = this.makeSparkTexture(app);
    this.glowTex = this.makeGlowTexture(app);
    this.shardRectTex = this.makeShardRectTexture(app);
    this.shardTriTex = this.makeShardTriTexture(app);
    this.coinTex = this.makeCoinTexture(app);
    this.bubbleTex = this.makeBubbleTexture(app);
    this.rimTex = this.makeRimTexture(app);
    this.veinTex = this.makeVeinTexture(app);
    app.ticker.add(this.update);
    this.ready = true;
  }

  /** Remove the canvas from the DOM and tear the app down. */
  detach(): void {
    if (!this.app) return;
    for (const p of this.live) p.sprite.destroy();
    this.live.length = 0;
    this.pool.length = 0;
    for (const b of this.shields.values()) { b.shader.destroy(); b.container.destroy({ children: true }); }
    this.shields.clear();
    this.shieldGeo?.destroy();
    this.shieldGeo = null;
    this.app.ticker.remove(this.update);
    this.app.destroy({ removeView: true, releaseGlobalResources: true }, { children: true });
    this.app = null;
    this.layer = null;
    this.shieldLayer = null;
    this.sparkTex = null;
    this.glowTex = null;
    this.shardRectTex = null;
    this.shardTriTex = null;
    this.coinTex = null;
    this.bubbleTex = null;
    this.rimTex = null;
    this.veinTex = null;
    this.ready = false;
    this.initing = null;
  }

  /**
   * A melee/projectile contact at viewport point (x, y): a white-hot flash plus a spray of
   * sparks fired outward, biased along the blow direction (dx, dy = attacker→defender vector,
   * any magnitude). No-op until the app has finished initialising.
   */
  impact(x: number, y: number, dx: number, dy: number): void {
    if (!this.ready) return;
    // Blow direction (unit vector); fall back to "up" if attacker/defender coincide.
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;

    // A burst of saturated colour, NORMAL blend, so the impact reads on the light "Sunward" cream
    // board (additive would just brighten cream toward white — near-invisible). A bright additive
    // core layers on top for the hot-glow pop.

    // Hot core flash — additive, brief, for the white-hot glint at the moment of contact.
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 220, fromScale: 0.5, toScale: 2.6, spin: 0,
      tint: 0xffe6b0, blend: 'add',
    });
    // Coloured shockwave — normal blend, a saturated orange flash that actually paints over cream.
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 300, fromScale: 0.3, toScale: 2.1, spin: 0,
      tint: 0xff6a1e, blend: 'normal',
    });

    // Sparks — jagged saturated shards (rectangles + triangles, not soft dots), fanning out within
    // ±63° of the blow direction and oriented ALONG their travel so they read as flung debris. Normal
    // blend + hot colours so they contrast the bright background. Size carries a +20% visibility boost.
    const VIS = 1.2; // +20% spark visibility (size)
    const count = 16;
    for (let i = 0; i < count; i++) {
      const spread = (Math.random() - 0.5) * (Math.PI * 0.7);
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const dirX = ux * cos - uy * sin;
      const dirY = ux * sin + uy * cos;
      const speed = 320 + Math.random() * 620; // px/sec
      const warm = Math.random();
      const tint = warm < 0.45 ? 0xff5a14 : warm < 0.8 ? 0xff9d20 : 0xffd24a;
      // alternate shard shapes; orient along velocity with a little jitter so the burst looks ragged
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.shardTriTex!;
      const angle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * 0.5;
      this.spawn(tex, {
        x, y,
        vx: dirX * speed,
        vy: dirY * speed,
        drag: 0.1, // strong decel — sparks burst then settle
        life: 360 + Math.random() * 340,
        fromScale: (0.9 + Math.random() * 0.7) * VIS,
        toScale: 0.05,
        spin: (Math.random() - 0.5) * 8,
        rotation: angle,
        tint, blend: 'normal',
      });
    }

    // Smoke — a few soft warm-grey puffs that rise, expand, and fade. Normal blend + low peak alpha
    // so they tint the cream board like a wisp rather than blasting it; slow + long-lived so they
    // linger after the sparks have burned out.
    const puffs = 4;
    for (let i = 0; i < puffs; i++) {
      const driftX = (Math.random() - 0.5) * 90; // gentle horizontal spread
      const rise = -40 - Math.random() * 70;      // drift upward
      const grey = Math.random() < 0.5 ? 0x9c9088 : 0x847a70; // warm smoke greys
      this.spawn(this.glowTex!, {
        x: x + (Math.random() - 0.5) * 22,
        y: y + (Math.random() - 0.5) * 22,
        vx: driftX,
        vy: rise,
        drag: 0.5,                 // slows as it billows
        life: 620 + Math.random() * 480,
        fromScale: 0.4 + Math.random() * 0.3,
        toScale: 1.7 + Math.random() * 0.8, // expands as it dissipates
        spin: (Math.random() - 0.5) * 1.5,
        tint: grey,
        blend: 'normal',
        peakAlpha: 0.28 + Math.random() * 0.12, // wispy, semi-transparent
      });
    }
  }

  /**
   * A sprinkle of gold coins bursting up out of point (x, y) and arcing back down under gravity —
   * the income flourish when a minion is sold (fired from the Gold counter's screen position).
   */
  coins(x: number, y: number): void {
    if (!this.ready) return;
    const count = 9;
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.15; // up, fanned ±33°
      const speed = 380 + Math.random() * 320;                 // punchier upward launch
      const fs = 0.7 + Math.random() * 0.45;
      this.spawn(this.coinTex!, {
        x: x + (Math.random() - 0.5) * 18,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed, // negative → pops upward
        drag: 0.85,                // light air damping; gravity dominates the vertical
        gravity: 1700,             // pull the higher launch back down within its life
        life: 700 + Math.random() * 400,
        fromScale: fs,
        toScale: fs * 0.85,        // hold roughly its size (coins don't shrink to nothing)
        spin: (Math.random() - 0.5) * 18,
        tint: 0xffffff,            // the texture is already gold
        blend: 'normal',
      });
    }
  }

  /**
   * A puff of dry-dirt dust ringing a card's footprint (cx/cy = card center, w/h = its size) —
   * like a flat stone dropped into dust. Fired when a minion is placed on / moved across the board.
   * Puffs spawn around the card's perimeter and billow **outward** (away from the card), hugging the
   * ground (vertical motion damped, gentle gravity) and fading fast — dusty tan on normal blend, low
   * alpha so it stays subtle. The caller raises the landed card above the FX layer for the duration,
   * so the dust reads as escaping out from *under* the card on every side.
   */
  dust(cx: number, cy: number, w: number, h: number): void {
    if (!this.ready) return;
    const halfW = w * 0.5;
    const halfH = h * 0.5;
    const puffs = 12;
    for (let i = 0; i < puffs; i++) {
      const ang = (i / puffs) * Math.PI * 2 + (Math.random() - 0.5) * 0.4; // around the ring
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      // project the direction onto the card's rectangular edge so puffs start at the card's border
      const edge = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
      const ex = cx + dx * edge;
      const ey = cy + dy * edge;
      const speed = 50 + Math.random() * 120;
      const tan = Math.random() < 0.5 ? 0xc9b48f : 0xb8a079; // dry-dirt tans
      this.spawn(this.glowTex!, {
        x: ex + (Math.random() - 0.5) * 8,
        y: ey + (Math.random() - 0.5) * 8,
        vx: dx * speed,
        vy: dy * speed * 0.45 - (4 + Math.random() * 14), // vertical damped + a slight lift → stays flat
        drag: 0.2,                                         // dust slows quickly
        gravity: 130,                                      // gentle settle — no rising column
        life: 380 + Math.random() * 260,
        fromScale: 0.3 + Math.random() * 0.2,
        toScale: 0.9 + Math.random() * 0.5,                // billow as it dissipates
        spin: (Math.random() - 0.5) * 1.2,
        tint: tan,
        blend: 'normal',
        peakAlpha: 0.2 + Math.random() * 0.12,             // subtle
      });
    }
  }

  /**
   * A tiny dust puff at a single point (x, y) — the dry-dirt motes kicked up where the mouse taps the
   * empty board. A much smaller sibling of `dust()`: a handful of tan puffs burst outward from the point,
   * hug the ground (vertical motion damped, gentle gravity), and fade fast. Purely tactile feedback.
   */
  clickPuff(x: number, y: number): void {
    if (!this.ready) return;
    const SIZE = 1.2; // puff size (1.0 = base); +20% per owner request
    const puffs = 7;
    for (let i = 0; i < puffs; i++) {
      const ang = (i / puffs) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const speed = 26 + Math.random() * 46; // gentle — a small kick, not a billow
      const tan = Math.random() < 0.5 ? 0xc9b48f : 0xb8a079; // dry-dirt tans (match the card-landing dust)
      this.spawn(this.glowTex!, {
        x: x + (Math.random() - 0.5) * 4,
        y: y + (Math.random() - 0.5) * 4,
        vx: dx * speed,
        vy: dy * speed * 0.5 - (3 + Math.random() * 7), // vertical damped + a slight lift → stays flat
        drag: 0.18,                                      // settles quickly
        gravity: 120,
        life: 260 + Math.random() * 180,
        fromScale: (0.14 + Math.random() * 0.1) * SIZE,
        toScale: (0.5 + Math.random() * 0.28) * SIZE,    // billow a touch but stay small
        spin: (Math.random() - 0.5) * 1.2,
        tint: tan,
        blend: 'normal',
        peakAlpha: 0.16 + Math.random() * 0.1,           // subtle
      });
    }
  }

  /**
   * A blast bolt streaking from (fromX, fromY) to (toX, toY) — a comet of glow motes that all travel to
   * the target, tightening into a head, so it reads as a hurled projectile with a trail. Used for the
   * loss-damage blast (the assembled damage number hurled into the Resolve bar). The caller fires
   * `damageBurst` at the target when the bolt arrives (travel ≈ `blastTravelMs` below).
   */
  blastBolt(fromX: number, fromY: number, toX: number, toY: number): void {
    if (!this.ready) return;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const nx = -uy; // perpendicular, for trail spread
    const ny = ux;
    const TRAVEL = 0.34; // seconds to reach the target (no drag, so dist = speed × life)
    const head = dist / TRAVEL; // px/sec to arrive in TRAVEL
    const motes = 16;
    for (let i = 0; i < motes; i++) {
      const t = i / motes; // 0 = head, 1 = tail
      const speed = head * (1 - t * 0.35); // tail lags → a streak
      const off = (Math.random() - 0.5) * 26 * t; // tail spreads wider
      const warm = Math.random();
      const tint = warm < 0.4 ? 0xffffff : warm < 0.8 ? 0xffd24a : 0xff7a2a;
      this.spawn(this.glowTex!, {
        x: fromX + nx * off,
        y: fromY + ny * off,
        vx: ux * speed,
        vy: uy * speed,
        drag: 1,
        life: TRAVEL * 1000 * (1 - t * 0.25),
        fromScale: (0.6 - t * 0.35) * 1.1,
        toScale: 0.15,
        spin: 0,
        tint,
        blend: 'add',
        peakAlpha: 1 - t * 0.5,
      });
    }
  }

  /** Travel time (ms) of a `blastBolt` — the caller schedules `damageBurst` + the impact for this delay. */
  readonly blastTravelMs = 340;

  /**
   * A crimson impact burst at (x, y) — the damage landing on the Resolve bar. A hot white core + a red
   * shockwave + a spray of red/orange shards, additive so it punches over the UI. Pairs with `blastBolt`.
   */
  damageBurst(x: number, y: number): void {
    if (!this.ready) return;
    // white-hot core
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 240, fromScale: 0.5, toScale: 3, spin: 0,
      tint: 0xffd9c0, blend: 'add',
    });
    // crimson shockwave
    this.spawn(this.glowTex!, {
      x, y, vx: 0, vy: 0, drag: 1, life: 360, fromScale: 0.4, toScale: 3.4, spin: 0,
      tint: 0xe23b2e, blend: 'add',
    });
    // shards flung in all directions
    const shards = 22;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 380 + Math.random() * 620;
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.sparkTex!;
      const warm = Math.random();
      const tint = warm < 0.45 ? 0xff3b2e : warm < 0.8 ? 0xff8a3a : 0xffffff;
      this.spawn(tex, {
        x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.12,
        life: 360 + Math.random() * 360, fromScale: 0.7 + Math.random() * 0.8, toScale: 0.05,
        spin: (Math.random() - 0.5) * 12, rotation: a, tint, blend: 'add',
      });
    }
  }

  /**
   * The Discover flourish: golden, white-hot magic + sparkles erupt from screen center (cx, cy) and
   * shoot outward off every edge. Additive (reads white-hot over the dimmed board), ≤3s. Rendered on
   * the discover overlay's own burst layer — behind the cards/UI, above the dark backdrop.
   */
  discoverBurst(cx: number, cy: number): void {
    if (!this.ready) return;
    // central bloom — a big white-gold flash at the origin
    this.spawn(this.glowTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 700, fromScale: 0.5, toScale: 5.5, spin: 0,
      tint: 0xfff1c0, blend: 'add',
    });
    // glow motes — large soft orbs drifting outward, long-lived (the "magic")
    const motes = 16;
    for (let i = 0; i < motes; i++) {
      const a = (i / motes) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const sp = 220 + Math.random() * 340;
      this.spawn(this.glowTex!, {
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.72,
        life: 1500 + Math.random() * 900, fromScale: 0.6 + Math.random() * 0.8, toScale: 0.1,
        spin: 0, tint: Math.random() < 0.5 ? 0xffe9a8 : 0xfff6d8, blend: 'add', peakAlpha: 0.85,
      });
    }
    // sparkles — many fast shards flung radially, fast enough to reach the page edges
    const sparks = 50;
    for (let i = 0; i < sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 650 + Math.random() * 900; // fast → shoot off the sides
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.sparkTex!;
      const warm = Math.random();
      const tint = warm < 0.4 ? 0xffffff : warm < 0.8 ? 0xffe79a : 0xffc23a;
      this.spawn(tex, {
        x: cx + (Math.random() - 0.5) * 40,
        y: cy + (Math.random() - 0.5) * 40,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.86,
        life: 900 + Math.random() * 1500, fromScale: 0.5 + Math.random() * 0.9, toScale: 0.05,
        spin: (Math.random() - 0.5) * 10, rotation: a, tint, blend: 'add',
      });
    }
  }

  /**
   * Create or update the divine-shield bubble for `uid`, centered at (cx, cy) and sized to a unit
   * footprint of w×h (the card's rect). Idempotent: the first call spawns the bubble (with a grow-in);
   * later calls just retarget it (so it tracks the unit as it moves). The React layers call this for
   * every shielded unit whenever the shielded set or any position changes. No-op until the app is ready.
   * `mini` = the card is being dragged → shrink to a small trailing sparkle; when a `mini` bubble is next
   * set with `mini=false` (the card is placed), it coalesces/pops back to full size.
   */
  setShield(uid: string, cx: number, cy: number, w: number, h: number, mini = false): void {
    if (!this.ready || !this.shieldLayer) return;
    let b = this.shields.get(uid);
    if (!b) {
      const container = new Container();
      // A quad mesh the shield shader draws onto. The geometry's UVs are a clean 0..1, so the fragment maps
      // the sphere exactly (no filter-coordinate guessing). The container scales it to the card footprint.
      const shader = Shader.from({
        gl: { vertex: SHIELD_VERT, fragment: SHIELD_FRAG },
        resources: {
          shieldUniforms: {
            uTime: { value: 0, type: 'f32' },
            uAspect: { value: w / Math.max(1, h), type: 'f32' },
            uColor: { value: new Float32Array(SHIELD_GOLD_RGB), type: 'vec3<f32>' },
            uSeed: { value: (this.shields.size % 7) * 1.3, type: 'f32' }, // de-sync neighbours' pulses
          },
        },
      });
      const mesh = new Mesh({ geometry: this.shieldGeo!, shader });
      container.addChild(mesh);
      container.alpha = 0;
      this.shieldLayer.addChild(container);
      b = { container, mesh, shader, cx, cy, w, h, age: 0, formIn: 0, fadeOut: -1,
            mini, pop: -1, scaleMul: mini ? MINI_SCALE : 1 };
      this.shields.set(uid, b);
    } else {
      b.cx = cx; b.cy = cy; b.w = w; b.h = h;
      b.fadeOut = -1; // re-targeted while fading (shield re-gained) → cancel the fade
      // Dragged (mini) → placed (full): coalesce/pop the bubble back into existence (inverse of the break).
      if (b.mini && !mini) { b.pop = 0; this.shieldPop(cx, cy, w, h); }
      b.mini = mini;
    }
  }

  /** The placement coalesce: a bright central flash + a ring of sparkles rushing INWARD to the center —
   *  the inverse of the break's outward shrapnel. Fired when a dragged shield is set down. */
  private shieldPop(cx: number, cy: number, w: number, h: number): void {
    if (!this.ready) return;
    const rad = Math.max(w, h) * 0.5 * BUBBLE_MARGIN;
    // central flash that blooms as the bubble snaps in
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 240, fromScale: (rad / BUBBLE_TEX_R) * 0.35,
      toScale: (rad / BUBBLE_TEX_R) * 1.05, spin: 0, tint: 0xfff3c8, blend: 'add', peakAlpha: 0.8,
    });
    // sparkles starting on a ring and rushing inward to coalesce at the center
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const r0 = rad * 1.4;
      const speed = 360 + Math.random() * 260;
      this.spawn(this.sparkTex!, {
        x: cx + Math.cos(a) * r0, y: cy + Math.sin(a) * r0,
        vx: -Math.cos(a) * speed, vy: -Math.sin(a) * speed, // inward
        drag: 0.05, // decelerate hard as they reach the middle
        life: 240 + Math.random() * 120, fromScale: 0.8 + Math.random() * 0.5, toScale: 0.05,
        spin: 0, tint: 0xffe9a8, blend: 'add', peakAlpha: 0.95,
      });
    }
  }

  /** Gracefully fade out and remove a bubble whose shield was removed WITHOUT breaking (rare — e.g. a
   *  Reborn return overwrites keywords). A broken shield uses `breakShield` instead. */
  clearShield(uid: string): void {
    const b = this.shields.get(uid);
    if (b && b.fadeOut < 0) b.fadeOut = 0;
  }

  /** Show/hide ALL shield bubbles at once — used to suppress them behind a board-covering modal (Discover /
   *  Choose One sit below the FX canvas with a translucent backdrop, so bubbles would otherwise show over it). */
  setShieldsVisible(visible: boolean): void {
    if (this.shieldLayer) this.shieldLayer.visible = visible;
  }

  /**
   * The shield SHATTERS (a hit absorbed): a quick crack-flash + fracture lines, then a small explosion —
   * an energy shockwave ring, a spray of golden shrapnel shards, and a few energy motes. The persistent
   * bubble is removed immediately; the burst is fire-and-forget on the particle layer.
   */
  breakShield(uid: string): void {
    const b = this.shields.get(uid);
    if (!b) return;
    const { cx, cy, w, h } = b;
    b.shader.destroy();
    b.container.destroy({ children: true });
    this.shields.delete(uid);
    if (!this.ready) return;
    const rad = Math.max(w, h) * 0.5 * BUBBLE_MARGIN;

    // 1) CRACK — a bright white-gold flash at the bubble's footprint + a few fracture lines snapping across.
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 150, fromScale: rad / BUBBLE_TEX_R,
      toScale: (rad / BUBBLE_TEX_R) * 1.18, spin: 0, tint: 0xfff3c8, blend: 'add',
    });
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI;
      this.spawn(this.veinTex!, {
        x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 130, fromScale: (rad / 26) * 1.1, toScale: rad / 26,
        spin: 0, rotation: a, tint: 0xffffff, blend: 'add', peakAlpha: 0.95,
      });
    }

    // 2) SHOCKWAVE — two additive rings expanding past the bubble edge and fading (a bigger pop).
    this.spawn(this.rimTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 460, fromScale: (rad / BUBBLE_TEX_R) * 0.85,
      toScale: (rad / BUBBLE_TEX_R) * 2.1, spin: 0, tint: 0xffe27a, blend: 'add', peakAlpha: 0.95,
    });
    this.spawn(this.bubbleTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 300, fromScale: (rad / BUBBLE_TEX_R),
      toScale: (rad / BUBBLE_TEX_R) * 1.6, spin: 0, tint: 0xfff0c0, blend: 'add', peakAlpha: 0.7,
    });

    // 3) SHRAPNEL — golden shards flung radially out of the rim (reuses the pooled shard textures).
    const shards = 22;
    for (let i = 0; i < shards; i++) {
      const a = (i / shards) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const speed = 320 + Math.random() * 640;
      const tex = Math.random() < 0.5 ? this.shardRectTex! : this.shardTriTex!;
      const warm = Math.random();
      const tint = warm < 0.5 ? 0xffd24a : warm < 0.85 ? 0xffe9a8 : 0xfff6d8;
      this.spawn(tex, {
        x: cx + Math.cos(a) * rad * 0.7, y: cy + Math.sin(a) * rad * 0.7,
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.12,
        life: 420 + Math.random() * 360, fromScale: 0.9 + Math.random() * 0.7, toScale: 0.05,
        spin: (Math.random() - 0.5) * 10, rotation: a, tint, blend: 'add',
      });
    }

    // 4) ENERGY MOTES — soft glints drifting out, longer-lived, for the "energy" feel.
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 110 + Math.random() * 240;
      this.spawn(this.sparkTex!, {
        x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.5,
        life: 500 + Math.random() * 400, fromScale: 0.9 + Math.random() * 0.8, toScale: 0.05,
        spin: 0, tint: 0xffe9a8, blend: 'add', peakAlpha: 0.95,
      });
    }
  }

  /**
   * DEV: fire a big, slow, unmissable burst at the center of the screen and log full
   * diagnostics — proves the layer is alive + visible without needing a combat. Logged
   * fields tell us where it breaks if you still see nothing.
   */
  test(): void {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const c = this.app?.canvas;
    console.log('[pixiFx.test]', {
      ready: this.ready,
      hasApp: !!this.app,
      center: { cx, cy },
      win: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      drawingBuffer: c ? { w: c.width, h: c.height } : null,
      canvasCss: c ? { w: c.style.width, h: c.style.height } : null,
      screen: this.app ? { w: this.app.screen.width, h: this.app.screen.height } : null,
      hidden: document.hidden,
    });
    if (!this.ready) {
      console.warn('[pixiFx.test] not ready — overlay not initialised yet. Refresh the page.');
      return;
    }
    // A huge, slow flash so it's impossible to miss even if the normal effect is too subtle.
    this.spawn(this.glowTex!, {
      x: cx, y: cy, vx: 0, vy: 0, drag: 1, life: 1400, fromScale: 0.5, toScale: 6, spin: 0,
      tint: 0xffffff,
    });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const speed = 300;
      this.spawn(this.sparkTex!, {
        x: cx, y: cy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, drag: 0.3,
        life: 1200, fromScale: 2.5, toScale: 0.2, spin: 0, tint: 0xffd24a,
      });
    }
  }

  /** Pull a sprite from the pool (or make one), configure it as a live particle. */
  private spawn(
    tex: Texture,
    cfg: Omit<Particle, 'sprite' | 'peakAlpha' | 'gravity'> &
      { tint: number; blend?: BLEND_MODES; peakAlpha?: number; rotation?: number; gravity?: number },
  ): void {
    const layer = this.layer;
    if (!layer) return;
    const peakAlpha = cfg.peakAlpha ?? 1;
    const sprite = this.pool.pop() ?? new Sprite();
    sprite.texture = tex;
    sprite.anchor.set(0.5);
    sprite.blendMode = cfg.blend ?? 'add';
    sprite.tint = cfg.tint;
    sprite.alpha = peakAlpha;
    sprite.x = cfg.x;
    sprite.y = cfg.y;
    sprite.scale.set(cfg.fromScale);
    sprite.rotation = cfg.rotation ?? 0;
    sprite.visible = true;
    layer.addChild(sprite);
    this.live.push({
      sprite, x: cfg.x, y: cfg.y, vx: cfg.vx, vy: cfg.vy, drag: cfg.drag,
      life: cfg.life, maxLife: cfg.life, fromScale: cfg.fromScale, toScale: cfg.toScale, spin: cfg.spin, peakAlpha,
      gravity: cfg.gravity ?? 0,
    });
  }

  /** Per-frame: advance every live particle, recycle the dead. Bound method for ticker.add/remove. */
  private update = (ticker: Ticker): void => {
    const dtMs = ticker.deltaMS;
    const dt = dtMs / 1000;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.life -= dtMs;
      if (p.life <= 0) {
        p.sprite.visible = false;
        this.layer?.removeChild(p.sprite);
        this.pool.push(p.sprite);
        this.live.splice(i, 1);
        continue;
      }
      const t = 1 - p.life / p.maxLife; // 0 → 1 over the particle's life
      // frame-rate-independent exponential drag
      const dragF = Math.pow(p.drag, dt);
      p.vx *= dragF;
      p.vy *= dragF;
      p.vy += p.gravity * dt; // gravity after drag so it isn't damped the same frame (coins fall)
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const s = p.sprite;
      s.x = p.x;
      s.y = p.y;
      s.rotation += p.spin * dt;
      s.scale.set(p.fromScale + (p.toScale - p.fromScale) * t);
      s.alpha = p.peakAlpha * (1 - t * t); // ease-out fade from its peak (lingers, then drops)
    }

    // Persistent shield bubbles: advance the slow breathe + grow-in/fade, and sit on each unit's rect.
    for (const [uid, b] of this.shields) {
      b.age += dtMs;
      // grow-in (gain) and optional fade-out (graceful clear)
      const formT = Math.min(1, b.formIn / FORM_MS); // 0→1 ease-out
      b.formIn += dtMs;
      const formEase = 1 - (1 - formT) * (1 - formT);
      let life = formEase;                 // overall opacity envelope
      const extraScale = 1 + (1 - formEase) * 0.16; // start a touch large, settle
      if (b.fadeOut >= 0) {
        const fT = Math.min(1, b.fadeOut / FADE_MS);
        b.fadeOut += dtMs;
        life *= 1 - fT;
        if (fT >= 1) { b.shader.destroy(); b.container.destroy({ children: true }); this.shields.delete(uid); continue; }
      }
      // a subtle container size-breathe (the SHADER handles the internal energy/brightness pulse on uTime)
      const breatheScale = 1 + Math.sin((b.age / BREATHE_MS) * Math.PI * 2) * 0.04;
      // drag-mini / placement-pop size: the pop drives an ease-out-back overshoot from mini → full; otherwise
      // the size eases toward its target (full=1, dragging=MINI_SCALE) so pickup/drop shrink+grow smoothly.
      if (b.pop >= 0) {
        const popT = Math.min(1, b.pop / POP_MS);
        const k = popT - 1;
        const back = 1 + 3.6 * k * k * k + 2.6 * k * k; // ease-out-back — peaks ~+13% then settles to 1 (a clear snap)
        b.scaleMul = MINI_SCALE + (1 - MINI_SCALE) * back;
        b.pop += dtMs;
        if (popT >= 1) { b.pop = -1; b.scaleMul = 1; }
      } else {
        const target = b.mini ? MINI_SCALE : 1;
        b.scaleMul += (target - b.scaleMul) * Math.min(1, dt * 14);
      }
      // fit the BUBBLE_TEX_R quad to the unit footprint (non-uniform → ellipse)
      const sx = (b.w * 0.5 * BUBBLE_MARGIN) / BUBBLE_TEX_R;
      const sy = (b.h * 0.5 * BUBBLE_MARGIN) / BUBBLE_TEX_R;
      const grow = breatheScale * extraScale * b.scaleMul;
      b.container.x = b.cx;
      b.container.y = b.cy;
      b.container.scale.set(sx * grow, sy * grow);
      b.container.alpha = life; // form-in / fade / mini envelope; the shader owns its internal opacity
      // drive the shield shader
      const u = (b.shader.resources.shieldUniforms as { uniforms: Record<string, number> }).uniforms;
      u.uTime = b.age / 1000;
      u.uAspect = b.w / Math.max(1, b.h);
    }
  };

  /** A small bright dot with a soft edge — the spark. Generated once, tinted per particle. */
  private makeSparkTexture(app: Application): Texture {
    const g = new Graphics();
    // stacked translucent circles → a soft radial falloff (no per-pixel gradient needed)
    for (let r = 8; r >= 1; r--) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.18 });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A larger, softer glow — the impact flash. */
  private makeGlowTexture(app: Application): Texture {
    const g = new Graphics();
    for (let r = 40; r >= 2; r -= 2) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.05 });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A jagged spark shard: an elongated rectangle. Drawn pointing +X so a spawn rotation aligns it
   *  along the particle's travel direction (it streaks outward like flung debris). */
  private makeShardRectTexture(app: Application): Texture {
    const g = new Graphics();
    g.rect(-9, -2, 18, 4).fill({ color: 0xffffff }); // sharp-edged, no soft falloff
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A jagged spark shard: a triangle, also pointing +X. */
  private makeShardTriTexture(app: Application): Texture {
    const g = new Graphics();
    g.poly([8, 0, -6, 5, -6, -5]).fill({ color: 0xffffff });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A gold coin — dark rim, bright face, a light inner ring + a shine. Drawn opaque (normal blend)
   *  so it reads as a solid coin on the light board. */
  private makeCoinTexture(app: Application): Texture {
    const g = new Graphics();
    g.circle(0, 0, 11).fill({ color: 0x9a6a12 });                          // dark rim
    g.circle(0, 0, 9).fill({ color: 0xffc928 });                           // gold face
    g.circle(0, 0, 9).stroke({ width: 1.5, color: 0xfff0a8, alpha: 0.9 }); // bright inner ring
    g.ellipse(-3, -3.5, 3.2, 2).fill({ color: 0xfff6d0, alpha: 0.85 });    // shine highlight
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** The shield BODY — a soft translucent disc with a radial falloff (brightest mid, fading to the edge),
   *  tinted gold + drawn at low alpha per-sprite so the unit reads through it. Radius ~BUBBLE_TEX_R. */
  private makeBubbleTexture(app: Application): Texture {
    const g = new Graphics();
    for (let r = BUBBLE_TEX_R; r >= 2; r -= 2) g.circle(0, 0, r).fill({ color: 0xffffff, alpha: 0.03 });
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** The shield RIM — a bright soft ring near the bubble's edge (the glassy highlight), additive per-sprite. */
  private makeRimTexture(app: Application): Texture {
    const g = new Graphics();
    g.circle(0, 0, BUBBLE_TEX_R - 3).stroke({ width: 7, color: 0xffffff, alpha: 0.22 }); // soft halo
    g.circle(0, 0, BUBBLE_TEX_R - 3).stroke({ width: 3, color: 0xffffff, alpha: 0.6 });  // bright core ring
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }

  /** A shield energy VEIN — a thin soft streak (bright core + halo), drawn pointing +X so a rotation fans
   *  it across the bubble. Half-length ~26 so the break's fracture-line scaling (rad/26) reads right. */
  private makeVeinTexture(app: Application): Texture {
    const g = new Graphics();
    g.ellipse(0, 0, 26, 2.4).fill({ color: 0xffffff, alpha: 0.4 }); // soft halo
    g.ellipse(0, 0, 22, 1.1).fill({ color: 0xffffff, alpha: 0.95 }); // bright core
    const tex = app.renderer.generateTexture({ target: g, resolution: 2 });
    g.destroy();
    return tex;
  }
}

/** The singleton effects layer. The React `PixiFxLayer` drives its mount; the combat replay
 *  calls `pixiFx.impact(...)` at contact points. */
export const pixiFx = new FxController();

/** A second, independent FX layer mounted INSIDE the Discover overlay (behind the cards, above the dark
 *  backdrop) — so the discover burst reads white-hot over the dim without covering the UI. Its own app +
 *  canvas; attached when Discover opens, its canvas re-appended on each subsequent open. */
export const discoverFx = new FxController();

// DEV: expose for live effect tuning + manual firing from the console (mirrors the LungeTuner /
// SfxMixer dev affordances). Stripped from production by the static env check.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const w = window as unknown as { __pixiFx: FxController; __discoverFx: FxController; __shieldDemo: (loops?: number) => void };
  w.__pixiFx = pixiFx;
  w.__discoverFx = discoverFx;
  // DEV: drop a shield bubble at screen center (card-sized), hold it, then break it — repeats `loops`
  // times so the bubble look + the crack/explosion can be eyeballed and tuned without a real combat.
  w.__shieldDemo = (loops = 3): void => {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2, cw = 150, ch = 190;
    let n = 0;
    const cycle = (): void => {
      pixiFx.setShield('__demo', cx, cy, cw, ch);
      window.setTimeout(() => {
        pixiFx.breakShield('__demo');
        if (++n < loops) window.setTimeout(cycle, 900);
      }, 2600);
    };
    cycle();
  };
}
