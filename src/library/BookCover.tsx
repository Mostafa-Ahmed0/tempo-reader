import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { coverUrls } from './coverUrls';
import { coverPalette } from './logic';

// One shared IntersectionObserver for all covers: object URLs are only created for covers near the
// viewport, so a 300-book library does not decode 300 images up front.
type Callback = (visible: boolean) => void;
const callbacks = new WeakMap<Element, Callback>();
let observer: IntersectionObserver | null = null;

function observe(el: Element, cb: Callback): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    cb(true);
    return () => {};
  }
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) callbacks.get(e.target)?.(e.isIntersecting);
      },
      { rootMargin: '400px 0px' },
    );
  }
  callbacks.set(el, cb);
  observer.observe(el);
  return () => {
    callbacks.delete(el);
    observer?.unobserve(el);
  };
}

/** How long a cover may stay off-screen before its object URL reference is dropped. */
const OFFSCREEN_RELEASE_MS = 10_000;

/**
 * Object URL for a blob while `active`, from the shared ref-counted LRU cache (see coverUrls.ts).
 * Keyed on stable fields (bookId + size + type) because live queries hand us a new Blob instance on
 * every library change.
 */
function useCoverUrl(bookId: string, blob: Blob | undefined, active: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const blobRef = useRef(blob);
  blobRef.current = blob;
  const key = blob ? `${bookId}:${blob.size}:${blob.type}` : '';
  useEffect(() => {
    const b = blobRef.current;
    if (!active || !b || !key) {
      setUrl(null);
      return;
    }
    setUrl(coverUrls.acquire(key, b));
    return () => coverUrls.release(key);
  }, [key, active]);
  return url;
}

export interface BookCoverProps {
  bookId: string;
  title: string;
  author: string;
  cover?: Blob;
  className?: string;
  /** Smaller type for list thumbnails. */
  compact?: boolean;
}

/** Book cover image, or a generated typographic cover with a deterministic colour from the book id. */
export const BookCover = memo(function BookCover({ bookId, title, author, cover, className, compact }: BookCoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const hasCover = !!cover;
  useEffect(() => {
    const el = ref.current;
    if (!el || !hasCover) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // visible -> hold a URL; off-screen for a while -> let the cache reclaim it
    const stop = observe(el, (v) => {
      clearTimeout(timer);
      if (v) setVisible(true);
      else timer = setTimeout(() => setVisible(false), OFFSCREEN_RELEASE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [hasCover]);
  const url = useCoverUrl(bookId, cover, visible);
  useEffect(() => setFailed(false), [url]);

  const showImage = !!cover && !failed;
  const pal = coverPalette(bookId); // seeded by id: renaming a book keeps its cover
  const style = showImage
    ? undefined
    : ({ '--cv-from': pal.from, '--cv-to': pal.to, '--cv-ink': pal.ink, '--cv-rule': pal.rule } as CSSProperties);

  return (
    <div
      ref={ref}
      className={['tm-cover', showImage ? 'tm-cover--image' : `tm-cover--gen tm-cover--p${pal.pattern}`, compact && 'tm-cover--compact', className]
        .filter(Boolean)
        .join(' ')}
      style={style}
      aria-hidden="true"
    >
      {showImage ? (
        url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} /> : null
      ) : (
        <div className="tm-cover__gen">
          <span className="tm-cover__rule" />
          <span className="tm-cover__title">{title}</span>
          {author && !compact ? <span className="tm-cover__author">{author}</span> : null}
        </div>
      )}
    </div>
  );
});
