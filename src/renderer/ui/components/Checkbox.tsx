import { useId, type ReactNode } from 'react';
import { Checkbox as C } from 'radix-ui';
import { Check, Minus } from 'lucide-react';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import styles from './Checkbox.module.css';

export interface CheckboxProps {
  checked: boolean | 'indeterminate';
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Checkbox({ checked, onChange, label, disabled, className, 'aria-label': ariaLabel }: CheckboxProps) {
  const id = useId();
  return (
    <span className={cx(styles.row, disabled && styles.disabled, className)}>
      <C.Root
        id={id}
        className={styles.box}
        checked={checked}
        disabled={disabled}
        aria-label={label === undefined ? ariaLabel : undefined}
        onCheckedChange={(v) => onChange(v === true)}
      >
        <C.Indicator className={styles.indicator}>
          {checked === 'indeterminate' ? <Minus size={iconSize('size-icon-sm')} aria-hidden /> : <Check size={iconSize('size-icon-sm')} aria-hidden />}
        </C.Indicator>
      </C.Root>
      {label !== undefined && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
    </span>
  );
}
