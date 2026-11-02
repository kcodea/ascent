/**
 * A MENU PAGE's SHELL CHROME (party home prototype, DEV only): the shell's one backdrop and the top nav, which
 * `MenuSidebar` renders instead of the left rail while the switch is on. The page's own content renders after it.
 */
import { PhBackdrop } from './PhBackdrop';
import { PhTopNav, type PhNavCurrent } from './PhTopNav';

export default function PhPageChrome({ current }: { current: PhNavCurrent }) {
  return (
    <>
      <div className="ph-pagebd" aria-hidden="true"><PhBackdrop /></div>
      <PhTopNav current={current} />
    </>
  );
}
