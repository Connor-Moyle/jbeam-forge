import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { PanelErrorBoundary, RootErrorBoundary } from '../../src/renderer/diagnostics/ErrorBoundary';
import { formatErrorContext } from '../../src/renderer/diagnostics/ErrorCard';
import { recentRendererErrors } from '../../src/renderer/diagnostics/globalHandlers';

let shouldThrow = true;
function Bomb({ label }: { label: string }) {
  if (shouldThrow) throw new Error(`boom in ${label}`);
  return <p>{label} ok</p>;
}

function Counter() {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN((v) => v + 1)}>
      count {n}
    </button>
  );
}

describe('PanelErrorBoundary', () => {
  it('isolates a crash to its panel and remounts on reload', async () => {
    shouldThrow = true;
    const onReset = vi.fn();
    render(
      <>
        <PanelErrorBoundary panelId="a" title="Inspector" onResetLayout={onReset}>
          <Bomb label="A" />
        </PanelErrorBoundary>
        <PanelErrorBoundary panelId="b" title="Scene" onResetLayout={onReset}>
          <Counter />
        </PanelErrorBoundary>
      </>,
    );
    const card = screen.getByTestId('error-card');
    expect(card).toHaveTextContent('Inspector panel crashed');
    expect(card).toHaveTextContent('boom in A');
    // Sibling panel still works.
    await userEvent.click(screen.getByRole('button', { name: 'count 0' }));
    expect(screen.getByRole('button', { name: 'count 1' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(onReset).toHaveBeenCalledTimes(1);

    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Reload panel' }));
    expect(screen.queryByTestId('error-card')).not.toBeInTheDocument();
    expect(screen.getByText('A ok')).toBeInTheDocument();
  });

  it('records the error for diagnostics and shows the component stack', () => {
    shouldThrow = true;
    render(
      <PanelErrorBoundary panelId="x" title="X" onResetLayout={() => undefined}>
        <Bomb label="X" />
      </PanelErrorBoundary>,
    );
    expect(recentRendererErrors().some((l) => l.includes('boom in X'))).toBe(true);
    expect(screen.getByText('Where it happened')).toBeInTheDocument();
  });

  it('copy diagnostics sends the error context over IPC', async () => {
    shouldThrow = true;
    render(
      <PanelErrorBoundary panelId="y" title="Y" onResetLayout={() => undefined}>
        <Bomb label="Y" />
      </PanelErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Copy error report' }));
    const invoke = vi.mocked(window.forge.invoke);
    const [channel, req] = invoke.mock.calls.at(-1) as [string, { extra: string }];
    expect(channel).toBe('diagnostics:copy');
    expect(req.extra).toContain('boom in Y');
    expect(await screen.findByRole('button', { name: /^Copied/ })).toBeInTheDocument();
  });
});

describe('RootErrorBoundary', () => {
  it('replaces the blank window with a full-screen recovery card', () => {
    shouldThrow = true;
    render(
      <RootErrorBoundary>
        <Bomb label="root" />
      </RootErrorBoundary>,
    );
    expect(screen.getByTestId('error-card')).toHaveTextContent('JBeam Forge hit an error');
    expect(screen.getByRole('button', { name: 'Reload window' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset layout' })).toBeInTheDocument();
  });
});

describe('formatErrorContext', () => {
  it('is short: where, the message, the top frames and the innermost components', () => {
    const err = new Error('bad');
    err.stack = ['Error: bad', ...Array.from({ length: 60 }, (_, i) => `    at fn${i} (file:///C:/Program%20Files/JBeam%20Forge/resources/app.asar/out/renderer/assets/index-X1.js:${100 + i}:7)`)].join('\n');
    const components = Array.from({ length: 80 }, (_, i) => `\n    at Comp${i} (index-X1.js:1:1)`).join('');
    const text = formatErrorContext(err, components, 'Materials panel crashed');
    expect(text).toContain('Where: Materials panel crashed');
    expect(text).toContain('Error: bad');
    expect(text).toContain('fn0 (index-X1.js:100)');
    expect(text).not.toContain('fn20');
    expect(text).not.toContain('Program%20Files');
    expect(text).toContain('In: Comp0 < Comp1');
    expect(text).not.toContain('Comp10');
    expect(text.split('\n').length).toBeLessThan(25);
  });
});
