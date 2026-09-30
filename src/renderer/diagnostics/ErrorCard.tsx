import { useState } from 'react';
import { ClipboardCopy, LayoutDashboard, RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@renderer/ui/components/Button';
import { iconSize } from '@renderer/ui/tokens';
import { cx } from '@renderer/ui/cx';
import { call } from './ipc';
import { errorReport, stackFrames } from './errorReport';
import styles from './ErrorCard.module.css';

export interface ErrorCardProps {
  title: string;
  error: Error;
  componentStack?: string | null;
  reloadLabel: string;
  onReload: () => void;
  onResetLayout?: () => void;
  /** Full-window variant for the root boundary. */
  fullscreen?: boolean;
}

/** The short report "Copy error" puts on the clipboard (with the app, OS and recent warnings added by main). */
export function formatErrorContext(error: Error, componentStack?: string | null, where = 'the app'): string {
  return errorReport({ where, error, componentStack });
}

export function ErrorCard({ title, error, componentStack, reloadLabel, onReload, onResetLayout, fullscreen }: ErrorCardProps) {
  const frames = stackFrames(error.stack, 4);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  const copy = () => {
    call('diagnostics:copy', { extra: formatErrorContext(error, componentStack, title) })
      .then(() => setCopied('done'))
      .catch(() => setCopied('failed'));
  };

  return (
    <div className={cx(styles.wrap, fullscreen && styles.fullscreen)} role="alert" data-testid="error-card">
      <div className={styles.card}>
        <div className={styles.header}>
          <TriangleAlert className={styles.icon} size={iconSize('size-icon')} aria-hidden />
          <span className={styles.title}>{title}</span>
        </div>
        <p className={styles.message}>{error.message || String(error)}</p>
        {frames.length > 0 && (
          <details className={styles.details}>
            <summary>Where it happened</summary>
            <pre className={styles.stack}>{frames.join('\n')}</pre>
          </details>
        )}
        <div className={styles.actions}>
          <Button icon={ClipboardCopy} onClick={copy}>
            {copied === 'done' ? 'Copied: paste it in your message' : copied === 'failed' ? 'Copy failed' : 'Copy error report'}
          </Button>
          {onResetLayout && (
            <Button icon={LayoutDashboard} onClick={onResetLayout}>
              Reset layout
            </Button>
          )}
          <Button variant="primary" icon={RotateCcw} onClick={onReload}>
            {reloadLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
