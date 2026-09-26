import { useState } from 'react';
import { ClipboardCopy, LayoutDashboard, RotateCcw, TriangleAlert } from 'lucide-react';
import { Button } from '@renderer/ui/components/Button';
import { iconSize } from '@renderer/ui/tokens';
import { cx } from '@renderer/ui/cx';
import { call } from './ipc';
import { recentRendererErrors } from './globalHandlers';
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

export function formatErrorContext(error: Error, componentStack?: string | null): string {
  return [
    `Error: ${error.message}`,
    error.stack ?? '',
    componentStack ? `Component stack:${componentStack}` : '',
    'Recent renderer errors:',
    ...recentRendererErrors(),
  ]
    .filter(Boolean)
    .join('\n');
}

export function ErrorCard({ title, error, componentStack, reloadLabel, onReload, onResetLayout, fullscreen }: ErrorCardProps) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');

  const copy = () => {
    call('diagnostics:copy', { extra: formatErrorContext(error, componentStack).slice(0, 20_000) })
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
        {componentStack && (
          <details className={styles.details}>
            <summary>Component stack</summary>
            <pre className={styles.stack}>{componentStack.trim()}</pre>
          </details>
        )}
        <div className={styles.actions}>
          <Button icon={ClipboardCopy} onClick={copy}>
            {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy diagnostics'}
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
