// @vitest-environment jsdom
/**
 * R-TOUCH-KEYBOARD-01 (owner 2026-10-18): on touch, a focused text field is lifted to a big bar along the top of the
 * VISIBLE viewport (above the on-screen keyboard), with a 17 screen-px font so iOS never zooms; on a mouse device, or
 * with the touch UI off, nothing happens. Focus never moves, so each field keeps its own Enter / blur handlers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installTouchKeyboard, isTextField, LIFT_FONT, LIFT_H, LIFT_MAX_W, liftBox, toContainingBlock } from './touchKeyboard';

describe('which fields lift', () => {
  it('text-like inputs and textareas, not checkboxes, ranges or buttons', () => {
    const mk = (html: string): Element => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild!; };
    expect(isTextField(mk('<input>'))).toBe(true);
    expect(isTextField(mk('<input type="email">'))).toBe(true);
    expect(isTextField(mk('<textarea></textarea>'))).toBe(true);
    expect(isTextField(mk('<input type="range">'))).toBe(false);
    expect(isTextField(mk('<input type="checkbox">'))).toBe(false);
    expect(isTextField(mk('<button></button>'))).toBe(false);
  });
});

describe('the lifted box', () => {
  it('sits along the top of the visible viewport, clear of the safe area, LIFT_H tall', () => {
    const b = liftBox({ left: 0, top: 0, width: 844, height: 200 }, 59, 0, 0);
    expect(b.top).toBe(12);
    expect(b.height).toBe(LIFT_H);
    expect(b.left).toBeGreaterThanOrEqual(59);
    expect(b.left + b.width).toBeLessThanOrEqual(844 - 12);
  });
  it('follows a scrolled visual viewport (the keyboard pushed it), and caps its width on a tablet', () => {
    const b = liftBox({ left: 0, top: 300, width: 1180, height: 400 });
    expect(b.top).toBe(312);
    expect(b.width).toBe(LIFT_MAX_W);
    expect(b.left).toBeCloseTo((1180 - LIFT_MAX_W) / 2, 6);
  });
  it('converts screen px into a scaled containing block', () => {
    expect(toContainingBlock({ left: 112, top: 24, width: 72, height: 36 }, 100, 0, 0.36)).toEqual({ left: 12 / 0.36, top: 24 / 0.36, width: 200, height: 100 });
  });
  it('the lifted text is at least 16 screen px (iOS zooms the page in on anything smaller)', () => {
    expect(LIFT_FONT).toBeGreaterThanOrEqual(16);
  });
});

describe('the installer', () => {
  let off: (() => void) | null = null;
  afterEach(() => { off?.(); off = null; document.body.innerHTML = ''; });
  it('with the touch UI off (every mouse device) a focused field is untouched', () => {
    off = installTouchKeyboard(() => false);
    document.body.innerHTML = '<input id="i" style="width: 10px">';
    const i = document.getElementById('i') as HTMLInputElement;
    i.focus();
    expect(i.classList.contains('tkb-lifted')).toBe(false);
    expect(i.getAttribute('style')).toBe('width: 10px');
  });
  it('on touch it lifts on focus and restores the exact inline style on blur', () => {
    off = installTouchKeyboard(() => true);
    document.body.innerHTML = '<input id="i" style="width: 10px"><button id="b">x</button>';
    const i = document.getElementById('i') as HTMLInputElement;
    i.focus();
    expect(i.classList.contains('tkb-lifted')).toBe(true);
    expect(i.style.position).toBe('fixed');
    expect(document.documentElement.hasAttribute('data-touch-kb')).toBe(true);
    (document.getElementById('b') as HTMLButtonElement).focus();
    expect(i.classList.contains('tkb-lifted')).toBe(false);
    expect(i.getAttribute('style')).toBe('width: 10px');
    expect(document.documentElement.hasAttribute('data-touch-kb')).toBe(false);
  });
});
