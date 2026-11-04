/**
 * A MENU PAGE THAT IS LATE, OR NEVER COMES (party home prototype, DEV only; owner 2026-11-04). Pages load lazily. While one is
 * on its way the shell shows its steady backdrop and, only if the wait is long enough to notice, one quiet word: no spinner on
 * a fast load. If its chunk fails (a stale hash after a deploy) the page says so plainly, with a way out, instead of the app's
 * crash screen. Eager and styled inline, so it works before any lazy stylesheet has arrived.
 */
import { Component, Suspense, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';

/** Pages on screen (`PhPage` counts itself): the quiet word only shows while there are none. */
let pages = 0;
const subs = new Set<() => void>();
const ping = (): void => { for (const s of subs) s(); };
export function markPhPage(): () => void {
  pages++; ping();
  return () => { pages--; ping(); };
}
const subscribe = (l: () => void): (() => void) => { subs.add(l); return () => { subs.delete(l); }; };

const WAIT_MS = 350;
const CENTRE: CSSProperties = { position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', zIndex: 1 };
const LINE: CSSProperties = { color: '#d8e2f5', fontWeight: 600, textShadow: '0 1px 3px rgba(0, 0, 0, 0.8)' };

/** One quiet word, only after a noticeable wait, and only while no page has arrived. */
export function PhPageWait() {
  const count = useSyncExternalStore(subscribe, () => pages, () => pages);
  const [late, setLate] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setLate(true), WAIT_MS); return () => window.clearTimeout(t); }, []);
  if (!late || count > 0 || !document.documentElement.hasAttribute('data-ph-shell')) return null;
  return <div className="ph-pagewait" style={CENTRE}><span style={LINE}>Loading</span></div>;
}

function Failed({ onBack, nav }: { onBack?: () => void; nav?: ReactNode }) {
  const btn: CSSProperties = { minHeight: 44, padding: '0 22px', borderRadius: 999, border: '1px solid #c8953f', background: '#0d1a36', color: '#fff', fontWeight: 800 };
  return (
    <div className="lbpage ph-failhost">
      {nav}
      <div className="ph-pagefail" role="alert" style={{ ...CENTRE, pointerEvents: 'auto' }}>
        <div style={{ display: 'grid', justifyItems: 'center', gap: 16 }}>
          <span style={{ ...LINE, fontSize: 18 }}>This page did not load.</span>
          <span style={{ display: 'flex', gap: 12 }}>
            <button type="button" style={btn} onClick={() => window.location.reload()}>Try again</button>
            {onBack && <button type="button" style={btn} onClick={onBack}>Back to Play</button>}
          </span>
        </div>
      </div>
    </div>
  );
}

export class PhPageGuard extends Component<{ children: ReactNode; onBack?: () => void; nav?: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override render(): ReactNode {
    if (this.state.failed) return <Failed onBack={this.props.onBack} nav={this.props.nav} />;
    return <Suspense fallback={<PhPageWait />}>{this.props.children}</Suspense>;
  }
}
