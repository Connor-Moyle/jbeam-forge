import type { ReactElement } from 'react';
import { ContextMenu as C } from 'radix-ui';
import type { LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import styles from './ContextMenu.module.css';

export type ContextMenuItem =
  | { type?: 'item'; label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
  | { type: 'separator' };

export interface ContextMenuProps {
  items: readonly ContextMenuItem[];
  /** Single ref-forwarding element that opens the menu on right-click. */
  children: ReactElement;
}

/** Right-click menu. Every item also needs a visible or keyboard path elsewhere. */
export function ContextMenu({ items, children }: ContextMenuProps) {
  return (
    <C.Root>
      <C.Trigger asChild>{children}</C.Trigger>
      <C.Portal>
        <C.Content className={styles.menu}>
          {items.map((it, i) =>
            it.type === 'separator' ? (
              <C.Separator key={`sep-${i}`} className={styles.separator} />
            ) : (
              <C.Item key={it.label} className={cx(styles.item, it.danger && styles.danger)} disabled={it.disabled} onSelect={it.onSelect}>
                {it.icon && <it.icon size={iconSize('size-icon-sm')} aria-hidden />}
                <span className={styles.label}>{it.label}</span>
                {it.shortcut && <kbd className={styles.shortcut}>{it.shortcut}</kbd>}
              </C.Item>
            ),
          )}
        </C.Content>
      </C.Portal>
    </C.Root>
  );
}
