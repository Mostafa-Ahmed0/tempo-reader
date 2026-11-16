import type { SVGProps } from 'react';

/**
 * Extra 24x24 stroke icons used by the library / stats / settings pages, drawn in the same style as
 * src/ui/Icon (1.75px, round caps). Kept local so src/ui stays untouched.
 */
const PATHS = {
  grid: (
    <>
      <rect x="4.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="4.5" width="6" height="6" rx="1.2" />
      <rect x="4.5" y="13.5" width="6" height="6" rx="1.2" />
      <rect x="13.5" y="13.5" width="6" height="6" rx="1.2" />
    </>
  ),
  list: <path d="M9 6.5h10.5M9 12h10.5M9 17.5h10.5M4.75 6.5h.5M4.75 12h.5M4.75 17.5h.5" />,
  check: <path d="m5.5 12.5 4 4 9-9.5" />,
  edit: <path d="M5 19l1-4L15.5 5.5a2.1 2.1 0 0 1 3 3L9 18l-4 1ZM13.5 7.5l3 3" />,
  tag: (
    <>
      <path d="M4.5 12.3V5.5a1 1 0 0 1 1-1h6.8a1 1 0 0 1 .7.3l6.7 6.7a1 1 0 0 1 0 1.4l-6.8 6.8a1 1 0 0 1-1.4 0L4.8 13a1 1 0 0 1-.3-.7Z" />
      <circle cx="8.75" cy="8.75" r="1.25" />
    </>
  ),
  refresh: <path d="M5 12a7 7 0 0 1 12-4.9L19 9M19 4.5V9h-4.5M19 12a7 7 0 0 1-12 4.9L5 15M5 19.5V15h4.5" />,
  book: <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13.5H6.5A1.5 1.5 0 0 0 5 19V5.5ZM5 19a1.5 1.5 0 0 0 1.5 1.5H19M9 8h6" />,
  file: <path d="M7 3.5h6.5L18 8v12a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V3.5ZM13.5 3.5V8H18" />,
  alert: <path d="M12 8.5v4.5M12 16.2v.3M10.3 4.6 3.6 17a2 2 0 0 0 1.7 3h13.4a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z" />,
  download: <path d="M12 4.5v11M7.5 11l4.5 4.5 4.5-4.5M5 19.5h14" />,
  clipboard: (
    <>
      <path d="M9 5H7a1 1 0 0 0-1 1v13.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" />
      <rect x="9" y="3.5" width="6" height="3" rx="1" />
      <path d="M9.5 11h5M9.5 15h5" />
    </>
  ),
  sparkle: <path d="M12 3.5c.6 4.4 2.1 5.9 6.5 6.5-4.4.6-5.9 2.1-6.5 6.5-.6-4.4-2.1-5.9-6.5-6.5 4.4-.6 5.9-2.1 6.5-6.5ZM18.5 15.5c.25 1.8.7 2.25 2.5 2.5-1.8.25-2.25.7-2.5 2.5-.25-1.8-.7-2.25-2.5-2.5 1.8-.25 2.25-.7 2.5-2.5Z" />,
  'chevron-down': <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  flame: <path d="M12 20.5c3.6 0 6-2.4 6-5.6 0-3.9-3.2-5.6-4-9.4-2.3 1.6-3.4 3.8-3.1 6.2-1-.5-1.7-1.5-1.9-2.7C7.4 10.5 6 12.6 6 14.9c0 3.2 2.4 5.6 6 5.6Z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <path d="M12 8v4.25l2.75 1.75" />
    </>
  ),
  gauge: <path d="M4.5 16.5a7.5 7.5 0 1 1 15 0M12 16.5l3.5-5M4.5 16.5h1.5M18 16.5h1.5" />,
  words: <path d="M4.5 7h15M4.5 12h15M4.5 17h9" />,
  undo: <path d="M9 7.5 5 11.5l4 4M5.5 11.5H15a4 4 0 0 1 0 8h-2" />,
} as const;

export type XIconName = keyof typeof PATHS;

export interface XIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: XIconName;
  size?: number;
}

export function XIcon({ name, size = 20, className, ...rest }: XIconProps) {
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
      className={['icon', className].filter(Boolean).join(' ')}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
