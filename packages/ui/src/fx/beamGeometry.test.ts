import { describe, expect, it } from 'vitest';
import {
  makeBeamBuffers, writeBeamMesh,
  BEAM_MAX_SEGMENTS, BEAM_MAX_VERTS, BEAM_MAX_INDICES,
} from './beamGeometry';

/** Midpoint of the two edge verts for along-point `i` — the spine position the shape was built around. */
const spineAt = (buf: ReturnType<typeof makeBeamBuffers>, i: number) => ({
  x: (buf.position[i * 4]! + buf.position[i * 4 + 2]!) / 2,
  y: (buf.position[i * 4 + 1]! + buf.position[i * 4 + 3]!) / 2,
});

describe('writeBeamMesh', () => {
  it('builds a strip of (segments+1)*2 vertices and segments*6 indices', () => {
    const buf = makeBeamBuffers();
    const { vertexCount, indexCount } = writeBeamMesh(buf, 0, 0, 100, 0, { segments: 24, waver: 0 }, 0);
    expect(vertexCount).toBe((24 + 1) * 2);
    expect(indexCount).toBe(24 * 6);
  });

  it('uv.u runs monotonically 0→1 along the beam and v alternates 0/1', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 0, 0, 100, 0, { segments: 4, waver: 0 }, 0);
    const us: number[] = [];
    for (let i = 0; i < (4 + 1) * 2; i++) { us.push(buf.uv[i * 2]!); expect(buf.uv[i * 2 + 1]).toBe(i % 2); }
    expect(us[0]).toBe(0);
    expect(us[us.length - 1]).toBeCloseTo(1);
    for (let i = 1; i < us.length; i++) expect(us[i]).toBeGreaterThanOrEqual(us[i - 1]!);
  });

  it('endpoints sit on A and B, offset only perpendicular by ±width/2', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 10, 20, 110, 20, { segments: 8, width: 18, waver: 0 }, 0);
    const first = spineAt(buf, 0), last = spineAt(buf, 8);
    expect(first.x).toBeCloseTo(10); expect(first.y).toBeCloseTo(20);
    expect(last.x).toBeCloseTo(110); expect(last.y).toBeCloseTo(20);
    expect(Math.abs(buf.position[1]! - buf.position[3]!)).toBeCloseTo(18); // straddle A by ±9 in y
  });

  it('a straight beam (waver 0) keeps every spine point colinear on A→B', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 0, 0, 100, 50, { segments: 12, waver: 0 }, 0);
    for (let i = 0; i <= 12; i++) { const s = spineAt(buf, i); expect(100 * s.y - 50 * s.x).toBeCloseTo(0, 2); }
  });

  it('waver bows interior spine points but pins both endpoints', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 0, 0, 100, 0, { segments: 12, width: 20, waver: 0.5, waverFreq: 1 }, Math.PI / 2);
    expect(spineAt(buf, 0).y).toBeCloseTo(0);
    expect(spineAt(buf, 12).y).toBeCloseTo(0);
    expect(Math.abs(spineAt(buf, 6).y)).toBeGreaterThan(1);
  });

  it('is safe for a zero-length beam (A==B): no verts, no NaNs', () => {
    const buf = makeBeamBuffers();
    const { vertexCount, indexCount } = writeBeamMesh(buf, 5, 5, 5, 5, { segments: 8 }, 0);
    expect(vertexCount).toBe(0); expect(indexCount).toBe(0);
    expect(buf.position.some((n) => Number.isNaN(n))).toBe(false);
  });

  it('clamps segments to the cap and never overruns the buffers', () => {
    const buf = makeBeamBuffers();
    const { vertexCount, indexCount } = writeBeamMesh(buf, 0, 0, 100, 0, { segments: 999 }, 0);
    expect(vertexCount).toBe((BEAM_MAX_SEGMENTS + 1) * 2);
    expect(vertexCount).toBeLessThanOrEqual(BEAM_MAX_VERTS);
    expect(indexCount).toBeLessThanOrEqual(BEAM_MAX_INDICES);
  });

  it('degenerates the unused index tail to 0', () => {
    const buf = makeBeamBuffers();
    writeBeamMesh(buf, 0, 0, 100, 0, { segments: 2, waver: 0 }, 0);
    for (let i = 2 * 6; i < BEAM_MAX_INDICES; i++) expect(buf.index[i]).toBe(0);
  });
});
