// @vitest-environment jsdom
/**
 * THE RUNEFORGE ROW NEVER MOVES WHEN THE FREE RE-ROLL IS SPENT.
 *
 * Owner report 2026-09-22: "the runes move down when the player uses the free re-roll". The forge overlay
 * centres its panel vertically (`.discover-ov` is a `place-items: center` grid). The re-roll button used to
 * UNMOUNT once spent, so the `.forge-actions` footer collapsed to zero height, the panel shrank by the button
 * and the rune tablets re-centred lower on the click (measured +16.72px at 1400x760). The button now stays
 * mounted once spent - hidden, disabled and out of the tab order - so the footer keeps its box and the row
 * stays pinned (measured delta 0). jsdom lays nothing out, so this pins the STRUCTURAL guarantee the CSS
 * relies on: the footer holds the same button in both states, and the spent one is inert.
 */
import { afterAll, describe, expect, it } from "vitest";
import { createRun, type RunState } from "@game/sim";
import { RuneforgeOverlay } from "./Recruit";
import { mount, type Mounted } from "./renderedText.mount";

const forge = (extra: Partial<RunState> = {}): RunState =>
  ({ ...createRun(4242), runeforgeOffer: ["rune_warding", "rune_structure", "rune_slaying"], runeforgeDiscounts: [0, 0, 0], runeforgeRerolled: undefined, runeforgeRerollUsed: undefined, ...extra });

const noop = (): void => {};
const show = (m: Mounted, run: RunState): void => {
  m.render(
    <RuneforgeOverlay
      overlaysHeld={false} run={run} forgeMin={false} setForgeMin={noop}
      lockIn={null} lockInSlow={1} setLockIn={noop}
      runeLockInCue={null} cueRuneArrival={noop} startRuneLockIn={noop} dispatch={noop}
    />,
  );
};

describe("Runeforge free re-roll - the footer keeps its box once spent", () => {
  const m = mount(null);
  afterAll(() => m.unmount());

  it("live: the free re-roll is a real, enabled button in the footer", () => {
    show(m, forge());
    const btn = m.container.querySelector<HTMLButtonElement>(".forge-actions > button.forge-reroll");
    expect(btn).not.toBeNull();
    expect(btn!.disabled).toBe(false);
    expect(btn!.classList.contains("forge-reroll-spent")).toBe(false);
    expect(btn!.getAttribute("aria-hidden")).toBeNull();
    expect(btn!.textContent).toContain("Free");
  });

  it.each([
    ["runeforgeRerollUsed", { runeforgeRerollUsed: true } as Partial<RunState>],
    ["runeforgeRerolled", { runeforgeRerolled: true } as Partial<RunState>],
  ])("spent via %s: the SAME button stays mounted in the footer, hidden and inert", (_flag, extra) => {
    show(m, forge());
    const liveChildren = m.container.querySelector(".forge-actions")!.children.length;
    show(m, forge(extra));
    const footer = m.container.querySelector(".forge-actions")!;
    // The footer never empties - that collapse is exactly what dropped the rune row.
    expect(footer.children.length).toBe(liveChildren);
    const btn = footer.querySelector<HTMLButtonElement>("button.forge-reroll");
    expect(btn).not.toBeNull();
    expect(btn!.classList.contains("forge-reroll-spent")).toBe(true);
    expect(btn!.disabled).toBe(true);
    expect(btn!.getAttribute("aria-hidden")).toBe("true");
    expect(btn!.tabIndex).toBe(-1);
    expect(btn!.getAttribute("title")).toBeNull();
    // The tablets themselves are untouched by the flag.
    expect(m.container.querySelectorAll(".forge-cards .runecard").length).toBe(3);
  });
});
