/**
 * A MENU PAGE's SHELL CHROME (party home prototype, DEV only): the top nav, which `MenuSidebar` renders instead of the left rail
 * while the switch is on, and a static veil that dims the shell's one backdrop for reading. The backdrop itself is `Game`'s
 * (PhBackdrop.tsx): a page never brings its own.
 */
import { PhTopNav, type PhNavCurrent } from './PhTopNav';

export default function PhPageChrome({ current }: { current: PhNavCurrent }) {
  return (
    <>
      <div className="ph-pagebd" aria-hidden="true"><div className="ph-veil" /></div>
      <PhTopNav current={current} />
    </>
  );
}
