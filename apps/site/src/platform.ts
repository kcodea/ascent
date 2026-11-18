export type Platform = 'windows' | 'other-desktop' | 'mobile';

const COPIED_LABEL = 'Link copied';
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
    b.addEventListener('click', () => {
      const win = doc.defaultView!;
      const url = win.location.origin + win.location.pathname;
      // Wrapped so an undefined clipboard (non-secure origin) or a synchronous throw lands in the same fallback.
      Promise.resolve()
        .then(() => win.navigator.clipboard.writeText(url))
        .then(
        () => {
          b.textContent = COPIED_LABEL;
          clearTimeout(timer);
          timer = setTimeout(() => {
            b.textContent = original;
          }, COPIED_MS);
        },
        () => {
          // Clipboard refused: show the URL itself so it can be selected by hand.
          clearTimeout(timer);
          b.textContent = url;
        },
      );
    });
  }
}
