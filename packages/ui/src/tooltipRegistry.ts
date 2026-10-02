/**
 * THE TOOLTIP REGISTRY: every class that IS a hover tip, so `tooltipStyle.test.ts` can hold them to the one shared
 * look (tooltips.css, owner 2026-10-02).
 *
 * The rule the test enforces: a tip's own CSS rules may set its GEOMETRY and behaviour (position, width, delay,
 * show/hide) but never its paint (background, border colours, shadow, text colour, font family). The paint comes
 * from the shared skin's `--atip-*` tokens. A new tooltip either uses the shared `.atip` classes / `<TipPanel>`, or
 * adds its class here AND to the skin groups in tooltips.css.
 */

/** Hover-tip panels (the element that appears). Sub-parts (`questbadge-tip-reward`, `cv2-herotip-name`, ...) are
 *  covered through their parent's prefix. */
export const TIP_CLASSES = [
  'atip',
  'herotip',
  'questbadge-tip',
  'riftpill-tip',
  'riftbtn-tip',
  'runtrophy-tip',
  'lb-rune-tip',
  'cv2-rune-tip',
  'cv2-herotip',
  'goldtip',
  'tagtip',
  'sbtip',
  'frz-tip',
  'tvb-tip',
  'etb-tip',
  'rfb-tip',
  'kwbox',
  'inspect-buffs',
  'lobbyscout',
  'anc-pv',
  'opp-power-tip',
  'lobbymax-tip',
] as const;

/** Classes whose names look like a tip but are not a hover panel: the `.gtip` family marks the ELEMENT that owns a
 *  `data-tip` bubble (the bubble itself is its `::after`, checked separately), `rankbar-tip` is the glowing end of a
 *  progress bar, `hctip` is a hero card's always-visible blurb. */
export const NOT_TIP_CLASSES = ['gtip', 'gtip-down', 'gtip-end', 'rankbar-tip', 'hctip', 'baltipname', 'tiprow'] as const;

/**
 * Deliberate per-type paint that stays inside the unified frame, by exact selector:
 * - the End Combat label is the End Turn tip in its combat-done state, recoloured by the Combat Controls tuner
 *   (`--cc-end-*`) as a standing button label rather than a hover tip;
 * - a Rebirth keyword pill reads in Rebirth's blue fire colours (owner 2026-09-25).
 */
export const PAINT_EXCEPTIONS = [
  '.etbwrap.ready .etb-tip',
  // ...and the same End Combat label in the Gem plate HUD look (healthPills.css), matching the Skip / Summary buttons.
  ':root[data-hp-look="gem"] .etbwrap.ready .etb-tip',
  '.kwbox[data-kw="rebirth"]',
] as const;

/**
 * Tips that keep their OWN text sizes / padding (matched as a substring of the selector), each for a stated reason.
 * Everything else is sized by the 💬 Tooltips tuner's dials.
 * - `.etbwrap .etb-tip`: the End Turn tip's size, padding, line height and radius are owner-tuned dials in the End
 *   Turn tuner (endTurnConfig.ts), measured to make its two-line label fit beside the diamond (owner 2026-08-17).
 * - `.etbwrap.ready .etb-tip`: the End Combat label (Combat Controls tuner), a standing label, not a hover tip.
 * - `lobbyscout`: the scout card is a board report whose text is laid out by the Scout Card tuner's size dials.
 * - `anc-pv`: the Ancients preview card pages are measured by its own sizer (`--anc-k`).
 */
export const OWN_SIZE_EXCEPTIONS = [
  '.etbwrap .etb-tip',
  '.etbwrap.ready .etb-tip',
  'lobbyscout',
  'anc-pv',
] as const;

/**
 * THE UI THEME (owner 2026-10-02): every colour in a tooltip (tooltips.css) and in a Gem plate HUD pill rule
 * (healthPills.css, the `[data-hp-look="gem"]` rules) comes from the shared `--ui-*` tokens in uiTheme.css, so the
 * 🎨 UI Theme tuner recolours them all at once. `tooltipStyle.test.ts` fails a literal colour there, with these
 * deliberate exceptions:
 * - pure black / white SHADING (`rgba(0, 0, 0, a)`, `rgba(255, 255, 255, a)`, `#000`, `#fff`): inset rings, drop
 *   shadows, gloss and text shadows, which darken or lighten whatever theme sits under them;
 * - the selectors below, which carry STATE colours that must not follow the theme:
 *   - the opponent's Shop Tier number keeps the game-wide cream-and-gold Tier plaque (`--gold`, `--ink`);
 *   - a locked / coming-soon mode card or Gauntlet stage reads as disabled grey;
 *   - a cleared Gauntlet stage's edge is the "done" green;
 *   - the Rift mode card's edge is Rift's tier colour (`--tier-7`);
 *   - a hovered combat button's text goes to pure white (covered by the shading rule, listed for clarity).
 * The other HUD pill looks (Classic, Slate, Minimal) are alternatives behind the ❤️ HUD pills switch, not the
 * shipped Gem plate, and are not themed.
 */
export const GEM_COLOUR_EXCEPTIONS = [
  ':root[data-hp-look="gem"] .combatopp-tier-n',
  ':root[data-hp-look="gem"] .modecard.mclocked .mcname.hudpill-name',
  ':root[data-hp-look="gem"] .gslot:is([data-state=\'locked\'], [data-state=\'soon\']) .gslot-tag.hudpill-name',
  ':root[data-hp-look="gem"] .gslot[data-state=\'cleared\'] .gslot-tag.hudpill-name',
  ':root[data-hp-look="gem"] .mcframe[data-mode=\'rift\'] .mcname.hudpill-name',
] as const;
