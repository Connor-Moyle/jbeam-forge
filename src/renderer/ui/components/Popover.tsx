import type { ReactElement, ReactNode } from 'react';
import { Popover as P } from 'radix-ui';
import { cx } from '../cx';
import { numericToken } from '../tokens';
import styles from './Popover.module.css';

export interface PopoverProps {
  /** Single ref-forwarding element (e.g. Button/IconButton). */
  trigger: ReactElement;
  children: ReactNode;
  title?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function Popover({ trigger, children, title, side = 'bottom', align = 'start', open, onOpenChange, className }: PopoverProps) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          side={side}
          align={align}
          sideOffset={numericToken('space-1')}
          collisionPadding={numericToken('space-2')}
          className={cx(styles.popover, className)}
        >
          {title !== undefined && <div className={styles.title}>{title}</div>}
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
