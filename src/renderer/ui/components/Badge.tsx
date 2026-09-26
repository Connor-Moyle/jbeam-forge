import type { ReactNode } from 'react';
import { cx } from '../cx';
import styles from './Badge.module.css';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  mono?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}

export function Badge({ tone = 'neutral', mono, children, className, title }: BadgeProps) {
  return (
    <span data-tone={tone} title={title} className={cx(styles.badge, styles[tone], mono && styles.mono, className)}>
      {children}
    </span>
  );
}
