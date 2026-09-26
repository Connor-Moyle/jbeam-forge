import { useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cx } from '../cx';
import { iconSize } from '../tokens';
import styles from './Callout.module.css';

export type CalloutTone = 'info' | 'success' | 'warning' | 'danger';

export interface CalloutProps {
  tone?: CalloutTone;
  title?: ReactNode;
  children: ReactNode;
  /** Long-form detail kept behind an "ⓘ more" toggle. */
  more?: ReactNode;
  className?: string;
}

const ICONS: Record<CalloutTone, LucideIcon> = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};

export function Callout({ tone = 'info', title, children, more, className }: CalloutProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ICONS[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'note'} className={cx(styles.callout, styles[tone], className)}>
      <Icon className={styles.icon} size={iconSize('size-icon-sm')} aria-hidden />
      <div className={styles.content}>
        {title !== undefined && <div className={styles.title}>{title}</div>}
        <div className={styles.body}>{children}</div>
        {more !== undefined && (
          <>
            {expanded && <div className={styles.more}>{more}</div>}
            <button type="button" className={styles.moreToggle} aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
              <Info size={iconSize('size-icon-sm')} aria-hidden />
              <span>{expanded ? 'less' : 'more'}</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
