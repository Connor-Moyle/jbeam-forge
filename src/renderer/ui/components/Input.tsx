import type { InputHTMLAttributes, Ref } from 'react';
import { cx } from '../cx';
import styles from './Input.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /** Mono + tabular numerals for IDs and numeric values. */
  mono?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ invalid, mono, className, ref, ...rest }: InputProps) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(styles.input, mono && styles.mono, invalid && styles.invalid, className)}
      spellCheck={false}
      {...rest}
    />
  );
}
