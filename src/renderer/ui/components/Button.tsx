import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import styles from './Button.module.css';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is limited to one per view (SPEC §4.17). */
  variant?: ButtonVariant;
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({ variant = 'default', size = 'md', icon: Icon, className, children, type = 'button', ref, ...rest }: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.button, styles[variant], size === 'sm' && styles.sm, className)}
      {...rest}
    >
      {Icon && <Icon size={iconSize('size-icon-sm')} aria-hidden />}
      {children !== undefined && <span className={styles.label}>{children}</span>}
    </button>
  );
}
