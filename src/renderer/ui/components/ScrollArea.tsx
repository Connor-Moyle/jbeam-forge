import type { HTMLAttributes, Ref } from 'react';
import { cx } from '../cx';
import styles from './ScrollArea.module.css';

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  axis?: 'y' | 'x' | 'both';
  ref?: Ref<HTMLDivElement>;
}

/**
 * Scroll container with overlay-style scrollbars (thin, thumb visible on
 * hover; styled globally in base.css). Fills its parent.
 */
export function ScrollArea({ axis = 'y', className, ref, ...rest }: ScrollAreaProps) {
  return <div ref={ref} className={cx(styles.scroll, styles[axis], className)} {...rest} />;
}
