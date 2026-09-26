import type { Ref, TextareaHTMLAttributes } from 'react';
import { cx } from '../cx';
import inputStyles from './Input.module.css';
import styles from './Textarea.module.css';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}

/** Multi-line sibling of Input; same border, focus ring and invalid states. */
export function Textarea({ invalid, className, rows = 3, ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cx(inputStyles.input, styles.textarea, invalid && inputStyles.invalid, className)}
      {...rest}
    />
  );
}
