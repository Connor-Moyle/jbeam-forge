import type { ReactNode } from 'react';
import { cx } from '../cx';
import styles from './Field.module.css';

export interface FieldProps {
  label: ReactNode;
  /** id of the control, so clicking the label focuses it. */
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Label + control + optional hint: the canonical form row. */
export function Field({ label, htmlFor, hint, children, className }: FieldProps) {
  return (
    <div className={cx(styles.field, className)}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      <div className={styles.control}>{children}</div>
      {hint !== undefined && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}

/** Caps section heading for grouping fields inside modals and panels. */
export function FieldGroup({ title, children, className }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx(styles.group, className)}>
      <h3 className={styles.groupTitle}>{title}</h3>
      {children}
    </section>
  );
}
