import type { ReactNode } from 'react';
import { Collapsible } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { useUiStore } from '@renderer/app/stores/ui';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import styles from './CollapsibleSection.module.css';

export interface CollapsibleSectionProps {
  /** Stable id; the open/closed state is remembered under it. */
  id: string;
  title: ReactNode;
  defaultOpen?: boolean;
  /** Right-aligned header slot (badges, icon buttons). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function CollapsibleSection({ id, title, defaultOpen = true, actions, children, className }: CollapsibleSectionProps) {
  const collapsed = useUiStore((s) => s.collapsed[id]);
  const setCollapsed = useUiStore((s) => s.setCollapsed);
  const open = collapsed === undefined ? defaultOpen : !collapsed;

  return (
    <Collapsible.Root open={open} onOpenChange={(o) => setCollapsed(id, !o)} className={cx(styles.section, className)}>
      <div className={styles.header}>
        <Collapsible.Trigger className={styles.trigger}>
          <ChevronRight className={cx(styles.chevron, open && styles.open)} size={iconSize('size-icon-sm')} aria-hidden />
          <span className={styles.title}>{title}</span>
        </Collapsible.Trigger>
        {actions !== undefined && <div className={styles.actions}>{actions}</div>}
      </div>
      <Collapsible.Content className={styles.content}>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
