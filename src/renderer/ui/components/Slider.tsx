import { useState } from 'react';
import { Slider as S } from 'radix-ui';
import { cx } from '../cx';
import styles from './Slider.module.css';

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Fired once when the drag ends (for undoable commits). */
  onCommit?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Formats the drag bubble; defaults to the raw value. */
  format?: (value: number) => string;
  'aria-label'?: string;
  className?: string;
}

export function Slider({
  value,
  onChange,
  onCommit,
  min = 0,
  max = 1,
  step = 0.01,
  disabled,
  format = String,
  className,
  'aria-label': ariaLabel,
}: SliderProps) {
  const [dragging, setDragging] = useState(false);
  return (
    <S.Root
      className={cx(styles.root, className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => {
        if (v[0] !== undefined) onChange(v[0]);
      }}
      onValueCommit={(v) => {
        setDragging(false);
        if (v[0] !== undefined) onCommit?.(v[0]);
      }}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => setDragging(false)}
    >
      <S.Track className={styles.track}>
        <S.Range className={styles.range} />
      </S.Track>
      <S.Thumb className={styles.thumb} aria-label={ariaLabel}>
        {dragging && <span className={styles.bubble}>{format(value)}</span>}
      </S.Thumb>
    </S.Root>
  );
}
