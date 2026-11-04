/**
 * A MENU PAGE's SHELL CHROME (party home prototype, DEV only): the top nav, which `MenuSidebar` renders instead of the left rail
 * while the switch is on. The backdrop and its page dim are `Game`'s (PhBackdrop.tsx): a page never brings its own.
 */
import { PhTopNav, type PhNavCurrent } from './PhTopNav';

export default function PhPageChrome({ current }: { current: PhNavCurrent }) {
  return (
    <PhTopNav current={current} />
  );
}
