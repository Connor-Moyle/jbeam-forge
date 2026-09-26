import type { ReactElement } from 'react';
import { ContextMenu as C } from 'radix-ui';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import styles from './ContextMenu.module.css';

export type ContextMenuItem =
  | { type?: 'item'; label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean; shortcut?: string }
  | { type: 'submenu'; label: string; icon?: LucideIcon; items: readonly ContextMenuItem[]; disabled?: boolean }
  | { type: 'separator' };

export interface ContextMenuProps {
  /** A function is called only when the menu opens (for large, dynamic menus). */
  items: readonly ContextMenuItem[] | (() => readonly ContextMenuItem[]);
  /** Single ref-forwarding element that opens the menu on right-click. */
  children: ReactElement;
}

function Items({ items }: { items: readonly ContextMenuItem[] }) {
  return items.map((it, i) => {
    if (it.type === 'separator') return <C.Separator key={`sep-${i}`} className={styles.separator} />;
    if (it.type === 'submenu') {
      return (
        <C.Sub key={`sub-${it.label}`}>
          <C.SubTrigger className={styles.item} disabled={it.disabled}>
            {it.icon && <it.icon size={iconSize('size-icon-sm')} aria-hidden />}
            <span className={styles.label}>{it.label}</span>
            <ChevronRight size={iconSize('size-icon-sm')} aria-hidden className={styles.subArrow} />
          </C.SubTrigger>
          <C.Portal>
            <C.SubContent className={styles.menu} sideOffset={2}>
              <Items items={it.items} />
            </C.SubContent>
          </C.Portal>
        </C.Sub>
      );
    }
    return (
      <C.Item key={it.label} className={cx(styles.item, it.danger && styles.danger)} disabled={it.disabled} onSelect={it.onSelect}>
        {it.icon && <it.icon size={iconSize('size-icon-sm')} aria-hidden />}
        <span className={styles.label}>{it.label}</span>
        {it.shortcut && <kbd className={styles.shortcut}>{it.shortcut}</kbd>}
      </C.Item>
    );
  });
}

/** Right-click menu (with nested submenus). Every item also needs a visible or keyboard path elsewhere. */
export function ContextMenu({ items, children }: ContextMenuProps) {
  return (
    <C.Root>
      <C.Trigger asChild>{children}</C.Trigger>
      <C.Portal>
        <C.Content className={styles.menu}>
          <Items items={typeof items === 'function' ? items() : items} />
        </C.Content>
      </C.Portal>
    </C.Root>
  );
}
