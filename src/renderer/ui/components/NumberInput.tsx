import { useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../cx';
import { Input } from './Input';
import styles from './NumberInput.module.css';

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places shown when not editing. */
  precision?: number;
  unit?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
}

export function clampRound(n: number, min: number, max: number, precision: number): number {
  const clamped = Math.min(max, Math.max(min, n));
  const f = 10 ** precision;
  return Math.round(clamped * f) / f;
}

/**
 * Numeric field: edits as free text, commits on Enter/blur, Escape reverts,
 * ArrowUp/Down step (Shift ×10). Invalid text reverts rather than committing NaN.
 */
export function NumberInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision = 2,
  unit,
  disabled,
  id,
  className,
  'aria-label': ariaLabel,
}: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Enter/Escape already resolved the edit; the blur they trigger must not commit a stale draft.
  const skipBlurCommit = useRef(false);
  const shown = draft ?? value.toFixed(precision);

  const commit = (text: string) => {
    setDraft(null);
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed)) return;
    const next = clampRound(parsed, min, max, precision);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Only commit real edits: committing the formatted value would re-round it.
      if (draft !== null) commit(draft);
      skipBlurCommit.current = true;
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(null);
      skipBlurCommit.current = true;
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const base = Number.parseFloat(shown);
      const delta = (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1);
      const next = clampRound((Number.isFinite(base) ? base : value) + delta, min, max, precision);
      setDraft(null);
      if (next !== value) onChange(next);
    }
  };

  return (
    <span className={cx(styles.wrap, className)}>
      <Input
        id={id}
        mono
        inputMode="decimal"
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuenow={value}
        aria-valuemin={Number.isFinite(min) ? min : undefined}
        aria-valuemax={Number.isFinite(max) ? max : undefined}
        disabled={disabled}
        value={shown}
        className={cx(styles.input, unit !== undefined && styles.withUnit)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (skipBlurCommit.current) skipBlurCommit.current = false;
          else if (draft !== null) commit(draft);
        }}
        onKeyDown={onKeyDown}
      />
      {unit !== undefined && <span className={styles.unit}>{unit}</span>}
    </span>
  );
}
