// Reader-only icons, drawn in the same 24x24 / 1.75px round style as src/ui/Icon.
const PATHS = {
  minus: <path d="M5 12h14" />,
  'para-back': <path d="M19 6v12M15 7l-6 5 6 5M8 7l-5 5 5 5" transform="translate(1 0)" />,
  'para-forward': <path d="M5 6v12M9 7l6 5-6 5M16 7l5 5-5 5" transform="translate(-1 0)" />,
  'sentence-back': <path d="M14.5 6 8.5 12l6 6" />,
  'sentence-forward': <path d="m9.5 6 6 6-6 6" />,
  list: <path d="M9 6.5h10M9 12h10M9 17.5h10M5 6.5h.01M5 12h.01M5 17.5h.01" />,
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M10.5 10h.01M14 10h.01M17.5 10h.01M8 14.5h8" />
    </>
  ),
  restart: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3.7h3.7" />,
  'bookmark-plus': <path d="M7 4.5h10a.5.5 0 0 1 .5.5v14.6l-5.5-3.8-5.5 3.8V5a.5.5 0 0 1 .5-.5ZM12 8v5M9.5 10.5h5" />,
  bookmarks: <path d="M8 4.5h9a.5.5 0 0 1 .5.5v14.6L12.5 16 7.5 19.6V5a.5.5 0 0 1 .5-.5ZM5 7v13" />,
  sliders: <path d="M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4" />,
  // a page of text (switch to the page view)
  'page-view': <path d="M6.5 3.5h7.5l4 4v12.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM9 10h6M9 13.5h6M9 17h4" />,
  // one word between focus ticks (back to the word view)
  'word-view': <path d="M12 4v3.5M12 16.5V20M5.5 12h13" />,
} as const;

export type ReaderIconName = keyof typeof PATHS;

export function ReaderIcon({ name, size = 20 }: { name: ReaderIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="icon"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
