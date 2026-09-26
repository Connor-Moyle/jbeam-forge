import type { ReactNode } from 'react';
import { Tabs as T } from 'radix-ui';
import { cx } from '../cx';
import styles from './Tabs.module.css';

export interface TabItem<V extends string = string> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  items: readonly TabItem<V>[];
  /** One panel per item value; only the active one renders. */
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
}

export function Tabs<V extends string = string>({ value, onChange, items, children, className, 'aria-label': ariaLabel }: TabsProps<V>) {
  return (
    <T.Root className={cx(styles.root, className)} value={value} onValueChange={(v) => onChange(v as V)}>
      <T.List className={styles.list} aria-label={ariaLabel}>
        {items.map((it) => (
          <T.Trigger key={it.value} value={it.value} disabled={it.disabled} className={styles.tab}>
            {it.label}
          </T.Trigger>
        ))}
      </T.List>
      {children}
    </T.Root>
  );
}

export function TabPanel({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <T.Content value={value} className={cx(styles.panel, className)}>
      {children}
    </T.Content>
  );
}
