import { useId, useRef, type ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { IconButton } from './IconButton';
import styles from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Right-aligned action row; put the single primary button last. */
  footer?: ReactNode;
  size?: 'sm' | 'md';
}

export function Modal({ open, onOpenChange, title, description, children, footer, size = 'md' }: ModalProps) {
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.backdrop} />
        <Dialog.Content
          ref={contentRef}
          className={cx(styles.modal, size === 'sm' ? styles.sm : styles.md)}
          aria-describedby={description === undefined ? undefined : descriptionId}
          // Focus the dialog itself: auto-focusing the close button would pop its tooltip.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current?.focus();
          }}
        >
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <IconButton icon={X} label="Close" size="sm" />
            </Dialog.Close>
          </header>
          {description !== undefined && (
            <Dialog.Description id={descriptionId} className={styles.description}>
              {description}
            </Dialog.Description>
          )}
          {children !== undefined && <div className={styles.body}>{children}</div>}
          {footer !== undefined && <footer className={styles.footer}>{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
