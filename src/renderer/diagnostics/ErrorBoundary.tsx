import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorCard } from './ErrorCard';
import { reportError } from './globalHandlers';
import { call } from './ipc';

interface BoundaryState {
  error: Error | null;
  componentStack: string | null;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * App-root boundary: replaces React's blank window with a recoverable card
 * (SPEC §3.6). Reload reloads the whole window.
 */
export class RootErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: toError(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError('root render error', error, info.componentStack ?? undefined);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private resetLayout = () => {
    call('layout:reset')
      .catch(() => undefined)
      .finally(() => window.location.reload());
  };

  override render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorCard
        fullscreen
        title="JBeam Forge hit an error"
        error={error}
        componentStack={componentStack}
        reloadLabel="Reload window"
        onReload={() => window.location.reload()}
        onResetLayout={this.resetLayout}
      />
    );
  }
}

interface PanelBoundaryProps {
  panelId: string;
  title: string;
  onResetLayout: () => void;
  children: ReactNode;
}

/**
 * Per-panel boundary: one broken panel shows an error card while every other
 * panel keeps working. Reload remounts just this panel.
 */
export class PanelErrorBoundary extends Component<PanelBoundaryProps, BoundaryState & { generation: number }> {
  override state = { error: null, componentStack: null, generation: 0 } as BoundaryState & { generation: number };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: toError(error) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError(`panel "${this.props.panelId}" render error`, error, info.componentStack ?? undefined);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  private remount = () => {
    this.setState((s) => ({ error: null, componentStack: null, generation: s.generation + 1 }));
  };

  override render() {
    const { error, componentStack, generation } = this.state;
    if (!error) return <PanelGeneration key={generation}>{this.props.children}</PanelGeneration>;
    return (
      <ErrorCard
        title={`${this.props.title} panel crashed`}
        error={error}
        componentStack={componentStack}
        reloadLabel="Reload panel"
        onReload={this.remount}
        onResetLayout={this.props.onResetLayout}
      />
    );
  }
}

/** Keyed wrapper so "Reload panel" remounts the subtree with fresh state. */
function PanelGeneration({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
