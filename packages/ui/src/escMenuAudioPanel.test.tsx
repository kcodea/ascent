// @vitest-environment jsdom
/**
 * THE AUDIO PANEL in Settings (owner ask 2026-09-23: *"an 'audio' button in the settings window that
 * expands/collapses these 3 channels with mute toggles for each"*). Pins: the section is ONE "Audio" button
 * (aria-expanded), collapsed by default; expanded it shows exactly three channel rows, Game sounds / Music /
 * Announcer, each a slider + a mute pill; a mute persists to its own localStorage key and applies live (the
 * slider disables, the value reads Off); the open state is remembered; no `title=` attribute anywhere in the
 * menu (the owner banned native tooltips); no player-facing em dash or double hyphen.
 *
 * Plus the store side of the announcer's persistence: `markAnnounced` records the line, and the Save & Quit
 * write (`flushSave`) carries the slice, keyed by the run seed, so a Continue never replays it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRun } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { EscMenu } from './EscMenu';
import { useGame } from './store';
import { isMuted, toggleMute } from './sfx';
import { isMusicMuted, toggleMusicMute } from './music';
import { getAnnouncerVolume, isAnnouncerMuted, setAnnouncerVolume, toggleAnnouncerMute } from './announcer';
import { announcedFor, type AnnouncedSlice } from './announcerSlice';

let ui: Mounted | null = null;
const press = (el: Element | null | undefined): void => {
  act(() => { el!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
};
const audioButton = (root: ParentNode): HTMLButtonElement | null =>
  [...root.querySelectorAll<HTMLButtonElement>('button.escbtn')].find((b) => b.querySelector('.ebl')?.textContent === 'Audio') ?? null;
const rows = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('#esc-audio-panel .escvol')];
const labelOf = (row: HTMLElement): string => row.querySelector('.evl')?.textContent ?? '';
const unmuteAll = (): void => {
  if (isMuted()) toggleMute();
  if (isMusicMuted()) toggleMusicMute();
  if (isAnnouncerMuted()) toggleAnnouncerMute();
};

beforeEach(() => {
  localStorage.clear();
  unmuteAll();
  useGame.setState({ showTitle: false, replaying: false, settingsOpen: false });
});
afterEach(() => {
  ui?.unmount();
  ui = null;
  unmuteAll();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the Audio panel', () => {
  it('is one "Audio" button, collapsed by default, that expands to exactly three channels', () => {
    ui = mount(<EscMenu onClose={() => {}} />);
    const btn = audioButton(ui.container);
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute('aria-expanded')).toBe('false');
    expect(ui.container.querySelector('#esc-audio-panel')).toBeNull();
    press(btn);
    expect(audioButton(ui.container)!.getAttribute('aria-expanded')).toBe('true');
    expect(rows(ui.container).map(labelOf)).toEqual(['Game sounds', 'Music', 'Announcer']);
    for (const row of rows(ui.container)) {
      expect(row.querySelector('input[type="range"]')).not.toBeNull();
      const mute = row.querySelector<HTMLButtonElement>('button.escmute');
      expect(mute).not.toBeNull();
      expect(mute!.getAttribute('aria-pressed')).toBe('false');
      expect(mute!.textContent).toBe('Mute');
    }
    press(audioButton(ui.container));
    expect(audioButton(ui.container)!.getAttribute('aria-expanded')).toBe('false');
    expect(ui.container.querySelector('#esc-audio-panel')).toBeNull();
  });

  it('remembers open / closed across a remount (localStorage)', () => {
    ui = mount(<EscMenu onClose={() => {}} />);
    press(audioButton(ui.container));
    expect(localStorage.getItem('ascent.audiopanel')).toBe('1');
    ui.unmount();
    ui = mount(<EscMenu onClose={() => {}} />);
    expect(audioButton(ui.container)!.getAttribute('aria-expanded')).toBe('true');
    expect(rows(ui.container)).toHaveLength(3);
  });

  it('each mute is its own persisted toggle: the slider disables, the value reads Off, the others are untouched', () => {
    ui = mount(<EscMenu onClose={() => {}} />);
    press(audioButton(ui.container));
    const [, music, announcer] = rows(ui.container) as [HTMLElement, HTMLElement, HTMLElement];
    press(announcer.querySelector('button.escmute'));
    expect(isAnnouncerMuted()).toBe(true);
    expect(localStorage.getItem('ascent.announcermuted')).toBe('1');
    expect(isMusicMuted()).toBe(false);
    expect(isMuted()).toBe(false);
    const row = rows(ui.container)[2]!;
    expect(row.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(true);
    expect(row.querySelector('.evv')!.textContent).toBe('Off');
    expect(row.querySelector('button.escmute')!.getAttribute('aria-pressed')).toBe('true');
    expect(row.querySelector('button.escmute')!.textContent).toBe('Muted');
    press(rows(ui.container)[2]!.querySelector('button.escmute'));
    expect(isAnnouncerMuted()).toBe(false);
    expect(localStorage.getItem('ascent.announcermuted')).toBe('0');
    press(music.querySelector('button.escmute'));
    expect(isMusicMuted()).toBe(true);
    expect(localStorage.getItem('ascent.musicmuted')).toBe('1');
    expect(isAnnouncerMuted()).toBe(false);
  });

  it('the Announcer slider drives its own persisted level (default 90)', () => {
    setAnnouncerVolume(0.9);
    ui = mount(<EscMenu onClose={() => {}} />);
    press(audioButton(ui.container));
    const row = rows(ui.container)[2]!;
    const slider = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    expect(slider.value).toBe('90');
    expect(slider.getAttribute('aria-label')).toBe('Announcer volume');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(slider, '35');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(getAnnouncerVolume()).toBeCloseTo(0.35);
    expect(localStorage.getItem('ascent.announcervol.v2')).toBe('0.35');
    expect(rows(ui.container)[2]!.querySelector('.evv')!.textContent).toBe('35');
    setAnnouncerVolume(0.9);
  });

  it('nothing native, nothing typographic: no title= anywhere, no em dash / double hyphen in the menu text', () => {
    ui = mount(<EscMenu onClose={() => {}} />);
    press(audioButton(ui.container));
    expect(ui.container.querySelectorAll('[title]')).toHaveLength(0);
    const text = ui.container.textContent ?? '';
    expect(text).not.toMatch(/—|--/);
  });
});

describe('the announced slice in the store', () => {
  it('markAnnounced records the line and Save & Quit persists it, keyed by the run seed', () => {
    const run = { ...createRun(777), mode: 'practice' as const };
    useGame.setState({ run, showTitle: false, replaying: false, announced: announcedFor(null, run.seed) });
    useGame.getState().markAnnounced('gameStart', 1);
    useGame.getState().markAnnounced('tierSix', 4);
    expect(useGame.getState().announced).toEqual({ seed: 777, fired: { gameStart: [1], tierSix: [4] }, count: 2 });
    useGame.getState().flushSave();
    const saved = JSON.parse(localStorage.getItem('ascent.save') ?? '{}') as { announced?: AnnouncedSlice };
    expect(saved.announced).toEqual({ seed: 777, fired: { gameStart: [1], tierSix: [4] }, count: 2 });
    // The boot path adopts a slice for its own seed and discards one for another run.
    expect(announcedFor(saved.announced, 777)).toEqual(saved.announced);
    expect(announcedFor(saved.announced, 778)).toEqual({ seed: 778, fired: {}, count: 0 });
  });
});
