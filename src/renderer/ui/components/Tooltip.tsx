import type { ReactElement, ReactNode } from 'react';
import { Tooltip as T } from 'radix-ui';
import { numericToken } from '../tokens';
import styles from './Tooltip.module.css';

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={numericToken('delay-tooltip')} skipDelayDuration={numericToken('dur-slow')}>
      {children}
    </T.Provider>
  );
}

export interface TooltipProps {
  content: ReactNode;
  /** Keyboard shortcut shown in mono after the label, e.g. "Ctrl+K". */
  shortcut?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Must be a single element that forwards refs and props (e.g. a <button>). */
  children: ReactElement;
}

export function Tooltip({ content, shortcut, side = 'bottom', children }: TooltipProps) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={numericToken('space-1')} collisionPadding={numericToken('space-2')} className={styles.tooltip}>
          <span>{content}</span>
          {shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
