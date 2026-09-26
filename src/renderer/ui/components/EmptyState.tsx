import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import { Button } from './Button';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon: LucideIcon;
  message: ReactNode;
  /** At most one action (SPEC §4.17). */
  action?: { label: string; onClick: () => void; icon?: LucideIcon };
  className?: string;
}

export function EmptyState({ icon: Icon, message, action, className }: EmptyStateProps) {
  return (
    <div data-testid="empty-state" className={cx(styles.container, className)}>
      <Icon className={styles.icon} size={iconSize('size-icon-lg')} aria-hidden />
      <div className={styles.message}>{message}</div>
      {action && (
        <Button size="sm" icon={action.icon} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
