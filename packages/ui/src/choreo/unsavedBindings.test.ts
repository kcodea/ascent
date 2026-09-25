import { beforeEach, describe, expect, it } from 'vitest';
import { bindingFor, clearBinding, hasUnsavedBindings, resetBindings, setBinding } from './bindings';

/**
 * The FX Library's "Save all edits" button (owner ask 2026-09-25) is lit only while the session holds binding
 * edits that bindings.json does not. By-card edits no longer write the file (each write reloaded the page), so
 * this is the one signal that something still needs saving.
 */
describe('hasUnsavedBindings', () => {
  beforeEach(() => resetBindings());

  it('is false with no session edits', () => {
    expect(hasUnsavedBindings()).toBe(false);
  });

  it('is true after an edit the file does not have, and the edit is live straight away', () => {
    setBinding('b2_oona', 'buffWave', { def: 'some-other-def', fanOut: 'buffed' });
    expect(hasUnsavedBindings()).toBe(true);
    expect(bindingFor('b2_oona', 'buffWave')?.def).toBe('some-other-def');
  });

  it('is false again when the edit is undone, or when it equals what the file already says', () => {
    setBinding('b2_oona', 'buffWave', { def: 'some-other-def', fanOut: 'buffed' });
    clearBinding('b2_oona', 'buffWave');
    expect(hasUnsavedBindings()).toBe(false);
    const committed = bindingFor('b2_oona', 'buffWave');
    expect(committed).not.toBeNull();
    setBinding('b2_oona', 'buffWave', committed);
    expect(hasUnsavedBindings()).toBe(false);
  });

  it('counts a tombstone (a slot cleared to play nothing) as an unsaved edit', () => {
    setBinding('b2_oona', 'buffWave', null);
    expect(hasUnsavedBindings()).toBe(true);
  });
});
