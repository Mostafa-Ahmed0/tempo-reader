import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** default 'secondary' (neutral surface button) */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Render only the icon (square button). Requires `aria-label`. */
  iconOnly?: boolean;
  children?: ReactNode;
}

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(' ');

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconOnly = false, className, type = 'button', children, ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 16 : size === 'lg' ? 22 : 18;
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', `btn--${variant}`, `btn--${size}`, iconOnly && 'btn--icon', className)}
      {...rest}
    >
      {icon ? <Icon name={icon} size={iconOnly ? iconSize + 2 : iconSize} /> : null}
      {iconOnly ? null : children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'icon' | 'iconOnly' | 'children'> {
  icon: IconName;
  /** Accessible name; also shown as a tooltip. */
  label: string;
}

/** Square, icon-only button. `label` becomes aria-label and title. Default variant 'ghost'. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', title, ...rest },
  ref,
) {
  return <Button ref={ref} icon={icon} iconOnly variant={variant} aria-label={label} title={title ?? label} {...rest} />;
});
