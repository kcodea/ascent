/**
 * BEAM geometry — the pure strip generator behind the `beam` primitive, split out of the Pixi code the way
 * `lightningGeometry.ts` is split out of `lightning.ts`, so the maths is unit-testable with no renderer.
 *
 * A beam is a single straight quad STRIP from A(source) to B(target), `width` px wide, subdivided into
 * `segments` spans along its length. The subdivision exists so an optional `waver` can bow the beam with an
 * animated sine without rebuilding its topology. Unlike lightning there are no branches and no midpoint
 * displacement — the shape is deterministic from its endpoints (plus the `phase` the caller passes for waver),
 * so no seed is needed.
 *
 * `writeBeamMesh` lays the strip into pre-sized, never-resized buffers (the lightning/ribbon discipline): 2
 * verts per along-point (left/right of the spine), triangle-list indices, surplus index tail degenerated.
 * `uv.u` = along-fraction 0(source)→1(target) — ALSO the travel-reveal coordinate the shader gates on, so the
 * beam needs no third "born" attribute. `uv.v` = 0 on one edge, 1 on the other (shader carves the bright core).
 */

export interface BeamShape {
  /** Full glow-envelope width (px); the shader carves the bright core out of the middle. Default 18. */
  width?: number;
  /** Length subdivisions — more = smoother waver bow. Clamped to [1, BEAM_MAX_SEGMENTS]. Default 24. */
  segments?: number;
  /** Sinusoidal bow amplitude as a fraction of `width`. 0 = dead straight. Default 0.12. */
  waver?: number;
  /** Sine cycles along the beam for the waver bow. Default 2.5. */
  waverFreq?: number;
  /** Static arc bend: perpendicular displacement of the beam's midpoint as a fraction of its LENGTH, signed
   *  (the sign picks the bend direction). 0 = straight. Applied on top of the animated waver. Default 0. */
  arc?: number;
}

const TAU = Math.PI * 2;

/** Max length subdivisions — sizes the vertex buffers; the `segments` knob is capped here. */
export const BEAM_MAX_SEGMENTS = 48;
/** Vertices the position buffer must hold: (segments+1) along-points × 2 edge verts. */
export const BEAM_MAX_VERTS = (BEAM_MAX_SEGMENTS + 1) * 2;
/** Indices the buffer must hold: segments quads × 6 (triangle list). */
export const BEAM_MAX_INDICES = BEAM_MAX_SEGMENTS * 6;

export interface BeamMeshBuffers {
  /** 2 floats per vertex — x, y in the container's local space. */
  position: Float32Array;
  /** 2 floats per vertex — u (0 at source → 1 at target; reveal + core→tip gradient) and v (0/1 edge). */
  uv: Float32Array;
  /** Triangle-list indices; the unused tail is 0 (a zero-area triangle the rasteriser drops). */
  index: Uint32Array;
}

/** Allocate a full-capacity buffer set. Call once per instance; reuse every frame. */
export function makeBeamBuffers(): BeamMeshBuffers {
  return {
    position: new Float32Array(BEAM_MAX_VERTS * 2),
    uv: new Float32Array(BEAM_MAX_VERTS * 2),
    index: new Uint32Array(BEAM_MAX_INDICES),
  };
}

/**
 * Lay a beam strip from A(ax,ay) to B(bx,by) into `buf`. `phase` (radians) animates the waver bow; pass 0 for
 * a still beam. A zero-length beam (A≈B) writes nothing live (counts 0) rather than dividing by zero. Returns
 * live vertex/index counts; the index tail is zero-filled so a fixed index count never draws stale triangles.
 */
export function writeBeamMesh(
  buf: BeamMeshBuffers, ax: number, ay: number, bx: number, by: number, shape: BeamShape, phase: number,
): { vertexCount: number; indexCount: number } {
  const width = shape.width ?? 18;
  const waver = shape.waver ?? 0.12;
  const waverFreq = shape.waverFreq ?? 2.5;
  const arc = shape.arc ?? 0;
  const segs = Math.max(1, Math.min(BEAM_MAX_SEGMENTS, Math.round(shape.segments ?? 24)));

  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) { buf.index.fill(0); return { vertexCount: 0, indexCount: 0 }; }
  const dirx = dx / len, diry = dy / len;   // unit along
  const nx = -diry, ny = dirx;              // unit normal (perpendicular)
  const hw = Math.max(0.2, width * 0.5);
  const amp = waver * width;                // bow amplitude in px

  let v = 0, idx = 0;
  const n = segs + 1;
  for (let i = 0; i < n; i++) {
    const u = i / segs;                     // along-fraction 0→1
    // `endWindow` (sin πu) is 0 at both ends and peaks mid-beam, so the endpoints always meet their anchors.
    const endWindow = Math.sin(Math.PI * u);
    // A static arc bend (fraction of length) plus the animated waver, both windowed so the ends stay pinned.
    const arcBow = arc * len * endWindow;
    const bow = arcBow + amp * endWindow * Math.sin(u * waverFreq * TAU + phase);
    const sxp = ax + dirx * (len * u) + nx * bow;
    const syp = ay + diry * (len * u) + ny * bow;
    buf.position[v * 2] = sxp - nx * hw; buf.position[v * 2 + 1] = syp - ny * hw;   // left edge (v=0)
    buf.uv[v * 2] = u; buf.uv[v * 2 + 1] = 0; v++;
    buf.position[v * 2] = sxp + nx * hw; buf.position[v * 2 + 1] = syp + ny * hw;   // right edge (v=1)
    buf.uv[v * 2] = u; buf.uv[v * 2 + 1] = 1; v++;
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    buf.index[idx++] = a; buf.index[idx++] = a + 1; buf.index[idx++] = a + 2;
    buf.index[idx++] = a + 2; buf.index[idx++] = a + 1; buf.index[idx++] = a + 3;
  }
  buf.index.fill(0, idx); // degenerate the surplus so a fixed index count never draws stale triangles
  return { vertexCount: v, indexCount: idx };
}
