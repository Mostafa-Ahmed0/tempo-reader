import type { SVGProps } from 'react';

// 24x24 stroke icons (1.75px, round caps), drawn for this app.
const PATHS = {
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.75" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.75" y="5" width="3.75" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  back: <path d="M11 7 6 12l5 5M18 7l-5 5 5 5" />,
  forward: <path d="m13 7 5 5-5 5M6 7l5 5-5 5" />,
  home: <path d="M4.5 10.5 12 4.5l7.5 6V19a.5.5 0 0 1-.5.5h-4.5v-5.5h-5v5.5H5a.5.5 0 0 1-.5-.5Z" />,
  library: <path d="M5 4.5h3.5v15H5zM10.5 4.5H14v15h-3.5zM16 5.6l3.3-.9 3.2 14-3.3.8z" transform="translate(-1 0)" />,
  stats: <path d="M4 20h16M7 16.5V11M12 16.5V6M17 16.5v-8" />,
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="10" cy="17" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1 1 0 0 0 1 .8h7.2a1 1 0 0 0 1-.8L17.5 7M10.25 10.5v6M13.75 10.5v6" />,
  bookmark: <path d="M7 4.5h10a.5.5 0 0 1 .5.5v14.6l-5.5-3.8-5.5 3.8V5a.5.5 0 0 1 .5-.5Z" />,
  star: <path d="m12 4 2.47 5.01 5.53.8-4 3.9.94 5.5L12 16.62 7.06 19.2 8 13.7l-4-3.9 5.53-.8Z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  'chevron-left': <path d="M14.5 6 8.5 12l6 6" />,
  upload: <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 15v3.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V15" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  /** px; default 20 */
  size?: number;
  /** Accessible label. Without one the icon is decorative (aria-hidden). */
  title?: string;
}

export function Icon({ name, size = 20, title, className, ...rest }: IconProps) {
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
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {PATHS[name]}
    </svg>
  );
}
