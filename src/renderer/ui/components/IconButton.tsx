import type { ButtonHTMLAttributes, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import { Tooltip } from './Tooltip';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Required: used for the tooltip and aria-label (no unlabeled icon buttons). */
  label: string;
  shortcut?: string;
  /** Toggle buttons: sets aria-pressed and the active style. */
  active?: boolean;
  size?: 'md' | 'sm';
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon: Icon,
  label,
  shortcut,
  active,
  size = 'md',
  tooltipSide,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active}
        className={cx(styles.iconButton, size === 'sm' && styles.sm, active && styles.active, className)}
        {...rest}
      >
        <Icon size={iconSize(size === 'sm' ? 'size-icon-sm' : 'size-icon')} aria-hidden />
      </button>
    </Tooltip>
  );
}
