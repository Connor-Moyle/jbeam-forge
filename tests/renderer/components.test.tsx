import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Pencil, Inbox } from 'lucide-react';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  CollapsibleSection,
  EmptyState,
  IconButton,
  Input,
  Modal,
  NumberInput,
  Select,
  Slider,
  TabPanel,
  Tabs,
  Toggle,
  Tooltip,
  TooltipProvider,
  TreeRow,
} from '../../src/renderer/ui';
import { clampRound } from '../../src/renderer/ui/components/NumberInput';
import { useUiStore } from '../../src/renderer/app/stores/ui';

const withTooltips = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('Button', () => {
  it('renders variants as classes and defaults to type=button', () => {
    render(<Button variant="primary">Go</Button>);
    const btn = screen.getByRole('button', { name: 'Go' });
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn.className).toContain('primary');
  });

  it('does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is labelled, exposes toggle state, and shows its tooltip on hover', async () => {
    withTooltips(<IconButton icon={Pencil} label="Edit" shortcut="E" active />);
    const btn = screen.getByRole('button', { name: 'Edit' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    await userEvent.hover(btn);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Edit');
  });
});

describe('Input', () => {
  it('marks invalid state for assistive tech', () => {
    render(<Input aria-label="Slug" invalid defaultValue="Bad Slug" />);
    expect(screen.getByRole('textbox', { name: 'Slug' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('NumberInput', () => {
  function Harness({ initial = 5, onChange }: { initial?: number; onChange?: (n: number) => void }) {
    const [v, setV] = useState(initial);
    return (
      <NumberInput
        aria-label="Mass"
        value={v}
        min={0}
        max={100}
        step={1}
        precision={1}
        onChange={(n) => {
          setV(n);
          onChange?.(n);
        }}
      />
    );
  }

  it('commits typed values on Enter, clamped and rounded', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: 'Mass' });
    await userEvent.clear(input);
    await userEvent.type(input, '250.44{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(100);
    expect(input).toHaveValue('100.0');
  });

  it('reverts on Escape and on unparseable text', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: 'Mass' });
    await userEvent.clear(input);
    await userEvent.type(input, '42{Escape}');
    expect(input).toHaveValue('5.0');
    await userEvent.clear(input);
    await userEvent.type(input, 'abc{Enter}');
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('5.0');
  });

  it('steps with arrows, ×10 with Shift', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: 'Mass' });
    input.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith(6);
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('Enter without an edit does not re-round the value', async () => {
    const onChange = vi.fn();
    render(<NumberInput aria-label="Precise" value={12.345} precision={2} onChange={onChange} />);
    const input = screen.getByRole('spinbutton', { name: 'Precise' });
    input.focus();
    await userEvent.keyboard('{Enter}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clampRound handles bounds and precision', () => {
    expect(clampRound(1.23456, 0, 10, 2)).toBe(1.23);
    expect(clampRound(-5, 0, 10, 0)).toBe(0);
    expect(clampRound(11, 0, 10, 0)).toBe(10);
  });
});

describe('Checkbox and Toggle', () => {
  it('Checkbox toggles via its label', async () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} label="Symmetry" />);
    await userEvent.click(screen.getByText('Symmetry'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Checkbox renders indeterminate as mixed', () => {
    render(<Checkbox checked="indeterminate" onChange={() => undefined} aria-label="All" />);
    expect(screen.getByRole('checkbox', { name: 'All' })).toHaveAttribute('aria-checked', 'mixed');
  });

  it('Toggle is a switch and respects disabled', async () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Snap" disabled />);
    const sw = screen.getByRole('switch', { name: 'Snap' });
    expect(sw).toBeDisabled();
    await userEvent.click(sw);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Select', () => {
  it('shows the selected label and a placeholder when empty', () => {
    const opts = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ];
    const { rerender } = render(<Select aria-label="Pick" value="b" onChange={() => undefined} options={opts} />);
    expect(screen.getByRole('combobox', { name: 'Pick' })).toHaveTextContent('Beta');
    rerender(<Select aria-label="Pick" value={undefined} onChange={() => undefined} options={opts} placeholder="Choose" />);
    expect(screen.getByRole('combobox', { name: 'Pick' })).toHaveTextContent('Choose');
  });
});

describe('Slider', () => {
  it('changes with the keyboard and commits', async () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<Slider aria-label="Detail" value={0.5} min={0} max={1} step={0.1} onChange={onChange} onCommit={onCommit} />);
    screen.getByRole('slider', { name: 'Detail' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith(0.6);
    expect(onCommit).toHaveBeenCalledWith(0.6);
  });
});

describe('Tabs', () => {
  it('switches panels and skips disabled tabs', async () => {
    function T() {
      const [v, setV] = useState('a');
      return (
        <Tabs
          aria-label="Sections"
          value={v}
          onChange={setV}
          items={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
            { value: 'c', label: 'C', disabled: true },
          ]}
        >
          <TabPanel value="a">Panel A</TabPanel>
          <TabPanel value="b">Panel B</TabPanel>
        </Tabs>
      );
    }
    render(<T />);
    expect(screen.getByText('Panel A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(screen.getByText('Panel B')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'C' })).toBeDisabled();
  });
});

describe('CollapsibleSection', () => {
  it('remembers its open state in the ui store across remounts', async () => {
    const section = () => (
      <CollapsibleSection id="t.sec" title="Details">
        <p>Body</p>
      </CollapsibleSection>
    );
    const { unmount } = render(section());
    expect(screen.getByText('Body')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /details/i }));
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    expect(useUiStore.getState().collapsed['t.sec']).toBe(true);
    unmount();
    render(section());
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });
});

describe('TreeRow', () => {
  it('exposes tree semantics and handles keyboard', async () => {
    const onToggle = vi.fn();
    const onActivate = vi.fn();
    render(
      <div role="tree">
        <TreeRow label="Body" depth={0} expanded={false} onToggle={onToggle} onActivate={onActivate} selected count={3} />
      </div>,
    );
    const row = screen.getByRole('treeitem', { name: /body/i });
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).toHaveAttribute('aria-expanded', 'false');
    row.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onToggle).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('chevron click toggles without selecting', async () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    render(<TreeRow label="Door" depth={1} expanded onToggle={onToggle} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(onToggle).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaf rows have no aria-expanded', () => {
    render(<TreeRow label="Glass" depth={2} />);
    expect(screen.getByRole('treeitem')).not.toHaveAttribute('aria-expanded');
  });
});

describe('Badge, Callout, EmptyState', () => {
  it('Badge carries its tone', () => {
    render(<Badge tone="danger">3 errors</Badge>);
    expect(screen.getByText('3 errors')).toHaveAttribute('data-tone', 'danger');
  });

  it('Callout uses alert role for danger and hides long text behind "more"', async () => {
    render(
      <Callout tone="danger" more="Long explanation">
        Short
      </Callout>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Short');
    expect(screen.queryByText('Long explanation')).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: /more/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getByText('Long explanation')).toBeInTheDocument();
  });

  it('EmptyState renders a single action', async () => {
    const onClick = vi.fn();
    render(<EmptyState icon={Inbox} message="Nothing here" action={{ label: 'Import', onClick }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});

describe('Modal', () => {
  it('focuses the dialog (not the close button) and closes on Escape', async () => {
    const onOpenChange = vi.fn();
    withTooltips(<Modal open onOpenChange={onOpenChange} title="Delete part?" description="Undoable." />);
    const dialog = screen.getByRole('dialog', { name: 'Delete part?' });
    expect(dialog).toHaveAccessibleDescription('Undoable.');
    expect(dialog).toHaveFocus();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Tooltip', () => {
  it('renders content with a shortcut', async () => {
    withTooltips(
      <Tooltip content="Command palette" shortcut="Ctrl+K">
        <button type="button">open</button>
      </Tooltip>,
    );
    await act(async () => {
      await userEvent.hover(screen.getByRole('button', { name: 'open' }));
    });
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Command palette');
    expect(tip).toHaveTextContent('Ctrl+K');
  });
});
