import { DOMAdapter, Shader } from 'pixi.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FX_SHADER_POOL_MAX,
  acquireShader,
  releaseShader,
  resetShaderPools,
  shaderPoolSize,
} from './shaderPool';

/**
 * The mesh-primitive shader pool's lifecycle contract, headless. `Shader.from` is pure string preprocessing
 * plus reflection bookkeeping — the compile/link this pool exists to avoid happens at DRAW time, which no
 * test reaches — so everything about WHICH object comes back, and in what state, is testable here.
 */
beforeAll(() => {
  const base = DOMAdapter.get();
  DOMAdapter.set({
    ...base,
    createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
  });
});

const VERT = /* glsl */ `#version 300 es
in vec2 aPosition;
void main(void) { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;
const FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 finalColor;
uniform float uOne;
uniform float uTwo;
void main(void) { finalColor = vec4(uOne, uTwo, 0.0, 1.0); }
`;

const KEY = 'test-pool';

const make = (): Shader =>
  Shader.from({
    gl: { vertex: VERT, fragment: FRAG },
    resources: { testUniforms: { uOne: { value: 0, type: 'f32' }, uTwo: { value: 0, type: 'f32' } } },
  });

const uniformsOf = (shader: Shader): Record<string, number> =>
  (shader.resources.testUniforms as { uniforms: Record<string, number> }).uniforms;

const reset = (one: number, two: number) => (shader: Shader): void => {
  const u = uniformsOf(shader);
  u.uOne = one;
  u.uTwo = two;
};

describe('shader pool', () => {
  beforeEach(() => {
    resetShaderPools();
  });

  it('reuses a released shader rather than building a new one', () => {
    const first = acquireShader(KEY, make, reset(1, 1));
    releaseShader(KEY, first);
    expect(shaderPoolSize(KEY)).toBe(1);
    expect(acquireShader(KEY, make, reset(2, 2))).toBe(first);
    expect(shaderPoolSize(KEY)).toBe(0);
  });

  it('runs the reset on EVERY acquire — pooled and fresh alike', () => {
    const fresh = acquireShader(KEY, make, reset(3, 4));
    expect(uniformsOf(fresh)).toMatchObject({ uOne: 3, uTwo: 4 });
    releaseShader(KEY, fresh);
    const recycled = acquireShader(KEY, make, reset(7, 8));
    expect(recycled).toBe(fresh);
    expect(uniformsOf(recycled)).toMatchObject({ uOne: 7, uTwo: 8 });
  });

  it('a make() that is never needed is never called', () => {
    const spy = vi.fn(make);
    releaseShader(KEY, make());
    acquireShader(KEY, spy, reset(0, 0));
    expect(spy).not.toHaveBeenCalled();
  });

  // A double release would put the same Shader in the pool twice, after which two live meshes share one
  // uniform group and overwrite each other's palette, clock and shaping every frame.
  it('release is idempotent — a second release is a no-op, not a second pool entry', () => {
    const shader = acquireShader(KEY, make, reset(0, 0));
    releaseShader(KEY, shader);
    releaseShader(KEY, shader);
    releaseShader(KEY, shader);
    expect(shaderPoolSize(KEY)).toBe(1);

    const a = acquireShader(KEY, make, reset(0, 0));
    const b = acquireShader(KEY, make, reset(0, 0));
    expect(b).not.toBe(a); // the pool must not have handed the same shader out twice
  });

  it('a released shader can be re-released after being acquired again', () => {
    const first = acquireShader(KEY, make, reset(0, 0));
    releaseShader(KEY, first);
    const second = acquireShader(KEY, make, reset(0, 0));
    expect(second).toBe(first);
    releaseShader(KEY, second); // the guard cleared on acquire, so this must land
    expect(shaderPoolSize(KEY)).toBe(1);
  });

  it('refuses an already-destroyed shader instead of pooling a corpse', () => {
    const shader = acquireShader(KEY, make, reset(0, 0));
    shader.destroy(false);
    releaseShader(KEY, shader);
    expect(shaderPoolSize(KEY)).toBe(0);
  });

  it('does not grow without bound', () => {
    const held = Array.from({ length: FX_SHADER_POOL_MAX + 3 }, () => acquireShader(KEY, make, reset(0, 0)));
    for (const s of held) releaseShader(KEY, s);
    expect(shaderPoolSize(KEY)).toBe(FX_SHADER_POOL_MAX);
  });

  it('keys are independent — one primitive’s pool never serves another’s', () => {
    const a = acquireShader('key-a', make, reset(0, 0));
    releaseShader('key-a', a);
    expect(shaderPoolSize('key-a')).toBe(1);
    expect(shaderPoolSize('key-b')).toBe(0);
    expect(acquireShader('key-b', make, reset(0, 0))).not.toBe(a);
  });
});
