import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import styles from './TreeRow.module.css';

export interface TreeRowProps {
  label: ReactNode;
  depth: number;
  /** undefined = leaf (no chevron, spacer keeps alignment). */
  expanded?: boolean;
  onToggle?: () => void;
  selected?: boolean;
  /** Greyed rows, e.g. ignored parts. */
  muted?: boolean;
  /** A CSS colour token reference, e.g. `var(--cat-body)`. */
  dotColor?: string;
  icon?: LucideIcon;
  count?: number;
  /** Hover-reveal action slot. */
  actions?: ReactNode;
  onSelect?: (e: MouseEvent<HTMLDivElement>) => void;
  /** Enter/Space. */
  onActivate?: () => void;
  onDoubleClick?: () => void;
  className?: string;
}

export function TreeRow({
  label,
  depth,
  expanded,
  onToggle,
  selected = false,
  muted = false,
  dotColor,
  icon: Icon,
  count,
  actions,
  onSelect,
  onActivate,
  onDoubleClick,
  className,
}: TreeRowProps) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // let action buttons handle their own keys
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate?.();
    } else if (e.key === 'ArrowRight' && expanded === false) {
      e.preventDefault();
      onToggle?.();
    } else if (e.key === 'ArrowLeft' && expanded === true) {
      e.preventDefault();
      onToggle?.();
    }
  };

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={expanded}
      tabIndex={0}
      className={cx(styles.row, selected && styles.selected, muted && styles.muted, className)}
      style={{ paddingLeft: `calc(var(--size-tree-indent) * ${depth} + var(--space-1))` }}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      {expanded === undefined ? (
        <span className={styles.chevronSpacer} />
      ) : (
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className={cx(styles.chevron, expanded && styles.chevronOpen)}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
        >
          <ChevronRight size={iconSize('size-icon-sm')} aria-hidden />
        </button>
      )}
      {dotColor !== undefined && <span className={styles.dot} style={{ background: dotColor }} aria-hidden />}
      {Icon && <Icon className={styles.icon} size={iconSize('size-icon-sm')} aria-hidden />}
      <span className={styles.label}>{label}</span>
      {count !== undefined && <span className={styles.count}>{count}</span>}
      {actions !== undefined && <span className={styles.actions}>{actions}</span>}
    </div>
  );
}
