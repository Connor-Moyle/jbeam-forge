import { Select as S } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cx } from '../cx';
import { iconSize, numericToken } from '../tokens';
import styles from './Select.module.css';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  value: V | undefined;
  onChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function Select<V extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
}: SelectProps<V>) {
  return (
    <S.Root value={value} onValueChange={(v) => onChange(v as V)} disabled={disabled}>
      <S.Trigger id={id} aria-label={ariaLabel} className={cx(styles.trigger, className)}>
        <S.Value placeholder={placeholder} />
        <S.Icon className={styles.chevron}>
          <ChevronDown size={iconSize('size-icon-sm')} aria-hidden />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content className={styles.content} position="popper" sideOffset={numericToken('space-1')}>
          <S.Viewport className={styles.viewport}>
            {options.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled} className={styles.item}>
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className={styles.indicator}>
                  <Check size={iconSize('size-icon-sm')} aria-hidden />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
