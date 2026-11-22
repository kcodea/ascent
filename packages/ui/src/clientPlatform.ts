/**
 * Which client a report came from (R-CRASH-REPORT-DESKTOP-01): the desktop exe (the Electron preload's bridge is there),
 * a phone (the lite-art path), or a desktop / laptop browser. Read by the crash and error reports and stored in
 * `client_crash_reports.platform` (a column generated from `payload.platform`).
 */
import { isDesktop } from './desktop';
import { LITE_ART } from './phoneArt';

export type ClientPlatform = 'desktop' | 'web' | 'phone';

export function clientPlatform(): ClientPlatform {
  try {
    if (isDesktop()) return 'desktop';
    return LITE_ART ? 'phone' : 'web';
  } catch { return 'web'; }
}

/** The build facts every report carries (`payload.app`; `app_version` is generated from `payload.app.version`). */
export function appInfo(): { version: string; sha: string; date: string; dirty: boolean } {
  return { version: __APP_VERSION__, sha: __BUILD_SHA__, date: __BUILD_DATE__, dirty: !!__BUILD_DIRTY__ };
}
