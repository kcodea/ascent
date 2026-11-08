// @vitest-environment jsdom
/**
 * R-PH-PROMPT-ALIGN-01 (owner 2026-11-08): the ranked confirmation sits centred over the Play column's START button,
 * not the middle of the window (the Play column is left of centre, so a window-centred prompt read as off-axis).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { PhRankedPrompt } from './PhPrompts';
import { mount, type Mounted } from '../renderedText.mount';

let ui: Mounted | null = null;
let start: HTMLElement | null = null;
afterEach(() => { ui?.unmount(); ui = null; start?.remove(); start = null; });

const rect = (left: number, width: number): DOMRect =>
  ({ left, width, top: 0, height: 40, right: left + width, bottom: 40, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;

const prompt = (): JSX.Element => (
  <PhRankedPrompt title="Ranked Lobby" text="t" warning={null} yes="Yes" no="No" closing={false} onYes={() => {}} onNo={() => {}} />
);

describe('ranked prompt aligns to START', () => {
  it('shifts the window so its centre sits over the START button centre', () => {
    start = document.createElement('button');
    start.className = 'ph-start';
    start.getBoundingClientRect = () => rect(300, 400); // centre 500
    document.body.appendChild(start);
    const orig = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.classList.contains('phk-dlgbox') ? rect(640, 640) : orig.call(this); // centre 960
    };
    try {
      ui = mount(prompt());
    } finally {
      HTMLElement.prototype.getBoundingClientRect = orig;
    }
    const box = document.querySelector<HTMLElement>('.phk-dlgbox')!;
    expect(box.style.left).toBe('-460px');
  });

  it('stays centred on the window when there is no START button', () => {
    ui = mount(prompt());
    expect(document.querySelector<HTMLElement>('.phk-dlgbox')!.style.left).toBe('');
  });
});
