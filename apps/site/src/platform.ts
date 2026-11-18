export type Platform = 'windows' | 'other-desktop' | 'mobile';

const COPIED_LABEL = 'Link copied';
const COPY_BELOW_LABEL = 'Copy it from below';
const WINDOWS_ONLY_LABEL = 'Windows only for now';
const COPIED_MS = 2000;

/** Pure: classify a visitor from their user agent and touch points. */
export function detectPlatform(ua: string, maxTouchPoints: number): Platform {
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'mobile';
  // iPadOS reports a Mac user agent; only a touch screen gives it away.
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return 'mobile';
  if (/Windows/i.test(ua)) return 'windows';
  return 'other-desktop';
}

/** Replace only the label text node, so any icon or span inside the link survives. */
function setLabel(a: HTMLAnchorElement): void {
  const text = [...a.childNodes].find((n) => n.nodeType === 3 && n.nodeValue!.trim() !== '');
  if (text) text.nodeValue = WINDOWS_ONLY_LABEL;
  else a.prepend(WINDOWS_ONLY_LABEL);
}

export function applyPlatform(doc: Document, p: Platform): void {
  if (p === 'windows') return;
  doc.documentElement.classList.add(p === 'mobile' ? 'is-mobile' : 'is-other');

  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[data-download]')) setLabel(a);

  for (const b of doc.querySelectorAll<HTMLButtonElement>('[data-copy-link]')) {
    b.hidden = false;
    const original = b.textContent;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const shown = b.nextElementSibling?.matches('[data-copy-url]') ? (b.nextElementSibling as HTMLElement) : null;
    b.addEventListener('click', () => {
      const win = doc.defaultView!;
      const url = win.location.origin + win.location.pathname;
      // writeText is called inside the click itself: Safari only honours the user gesture synchronously. The
      // try catches an undefined clipboard (non-secure origin) or a synchronous throw into the same fallback.
      let p: Promise<void>;
      try {
        p = win.navigator.clipboard.writeText(url);
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        () => {
          b.textContent = COPIED_LABEL;
          clearTimeout(timer);
          timer = setTimeout(() => {
            b.textContent = original;
          }, COPIED_MS);
        },
        () => {
          // Clipboard refused: show the URL below the button, where it can be selected by hand.
          clearTimeout(timer);
          if (!shown) {
            b.textContent = url;
            return;
          }
          shown.textContent = url;
          shown.hidden = false;
          b.textContent = COPY_BELOW_LABEL;
        },
      );
    });
  }
}
