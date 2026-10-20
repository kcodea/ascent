/**
 * THE TUNED LOOK SHIPS (R-PRESENT-TUNED-01). Each `*Config.ts` below holds the owner's tuned defaults for one piece of
 * the UI and pushes them to CSS when its module loads (a top-level `apply…()` call: custom properties on `:root`,
 * and root classes such as `cgem-nobg`, which hides the mechanic medallion's backing circle). Their only other
 * importers are the DEV tuner panels, so without this file a production build never loads them and players see
 * the stylesheet's fallbacks instead of the tuned look.
 *
 * That is what happened on 2026-10-18: #2151 made the DEV menu (and with it every tuner panel) a DEV-only lazy
 * import, which was right for the panels, but these config modules went with it. In production the medallion's
 * CSS circle came back on every card (owner 2026-10-19: "we need to remove the css medallion circle from all
 * cards. why did that show back up?").
 *
 * This file imports the CONFIG modules only, never a panel: they are small and import nothing heavy. Game.tsx
 * imports it once, so they load exactly when the static DEV-menu import used to load them.
 * `tunedDefaults.test.ts` fails if a config module with a load-time apply is reachable only through a tuner.
 */
import './alignArcConfig';
import './buffDrawerConfig';
import './epicMedallionConfig';
import './freezeConfig';
import './gildedBadgeConfig';
import './glowConfig';
import './heroDuelConfig';
import './heroFxConfig';
import './lobbyPanelConfig';
import './lobbyRailLookConfig';
import './medallionConfig';
import './replayRailConfig';
import './runeforgeLookConfig';
import './scoutCardConfig';
import './secondPowerConfig';
import './spellMedallionConfig';
import './stepCounterConfig';
import './tavernUpConfig';
import './tribeColorConfig';
import './uiThemeConfig';
import './wardConfig';
