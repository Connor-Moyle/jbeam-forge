import { useId, type ReactNode } from 'react';
import { Switch } from 'radix-ui';
import { cx } from '../cx';
import styles from './Toggle.module.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function Toggle({ checked, onChange, label, disabled, className, 'aria-label': ariaLabel }: ToggleProps) {
  const id = useId();
  return (
    <span className={cx(styles.row, disabled && styles.disabled, className)}>
      <Switch.Root
        id={id}
        className={styles.track}
        checked={checked}
        disabled={disabled}
        aria-label={label === undefined ? ariaLabel : undefined}
        onCheckedChange={onChange}
      >
        <Switch.Thumb className={styles.knob} />
      </Switch.Root>
      {label !== undefined && (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      )}
    </span>
  );
}
