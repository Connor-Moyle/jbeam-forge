import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createEmptyProject, serializeProject } from '../../src/shared/project/io';
import { isDirty, projectStore } from '../../src/renderer/app/stores/project';
import { useDialogStore } from '../../src/renderer/app/stores/dialogs';
import { closeProject, newProject, openRecentProject, saveProject } from '../../src/renderer/project/actions';
import { NewModWizard, slugProblem } from '../../src/renderer/home/NewModWizard';
import { TooltipProvider } from '../../src/renderer/ui/components/Tooltip';

type Handler = (req: unknown) => unknown;
let handlers: Record<string, Handler>;

beforeEach(() => {
  handlers = {};
  vi.mocked(window.forge.invoke).mockImplementation(((channel: string, req: unknown) => {
    const h = handlers[channel];
    return Promise.resolve({ ok: true, value: h ? h(req) : undefined });
  }) as never);
  projectStore.getState().close();
});

afterEach(() => {
  vi.mocked(window.forge.invoke).mockReset();
  useDialogStore.setState({ unsaved: null, alert: null, newModOpen: false });
});

const meta = { name: 'Car', slug: 'car' };
const savedText = () => serializeProject(createEmptyProject(meta, '0.1.0', new Date('2026-01-01T00:00:00Z')));

describe('project lifecycle actions', () => {
  it('Save on a never-saved project goes through Save As and marks it clean', async () => {
    await newProject(meta);
    handlers['project:saveAs'] = () => 'C:/p/car.jbforge';
    expect(await saveProject()).toBe(true);
    expect(projectStore.getState().filePath).toBe('C:/p/car.jbforge');
    expect(isDirty(projectStore.getState())).toBe(false);
  });

  it('an edit made while the Save As dialog is open is not marked saved', async () => {
    await newProject(meta);
    handlers['project:saveAs'] = () => {
      projectStore.getState().execute({ label: 'during dialog', apply: (d) => void (d.meta.brand = 'Late') });
      return 'C:/p/car.jbforge';
    };
    expect(await saveProject()).toBe(true);
    expect(isDirty(projectStore.getState())).toBe(true);
  });

  it('Save on a saved project writes to its path', async () => {
    handlers['project:openRecent'] = () => ({ path: 'C:/p/car.jbforge', text: savedText() });
    await openRecentProject('C:/p/car.jbforge');
    projectStore.getState().execute({ label: 'x', apply: (d) => void (d.meta.brand = 'B') });
    let savedTo: unknown = null;
    handlers['project:save'] = (req) => {
      savedTo = (req as { path: string }).path;
      return undefined;
    };
    expect(await saveProject()).toBe(true);
    expect(savedTo).toBe('C:/p/car.jbforge');
    expect(isDirty(projectStore.getState())).toBe(false);
  });

  it('closing a dirty project asks first; Cancel keeps it open', async () => {
    await newProject(meta);
    const closing = closeProject();
    await vi.waitFor(() => expect(useDialogStore.getState().unsaved).not.toBeNull());
    useDialogStore.getState().answerUnsaved('cancel');
    expect(await closing).toBe(false);
    expect(projectStore.getState().doc).not.toBeNull();
  });

  it("closing a dirty project with Don't save discards it", async () => {
    await newProject(meta);
    const closing = closeProject();
    await vi.waitFor(() => expect(useDialogStore.getState().unsaved).not.toBeNull());
    useDialogStore.getState().answerUnsaved('discard');
    expect(await closing).toBe(true);
    expect(projectStore.getState().doc).toBeNull();
  });

  it('choosing Save in the prompt saves before proceeding (and aborts if saving is cancelled)', async () => {
    await newProject(meta);
    handlers['project:saveAs'] = () => null; // user cancels the save dialog
    const closing = closeProject();
    await vi.waitFor(() => expect(useDialogStore.getState().unsaved).not.toBeNull());
    useDialogStore.getState().answerUnsaved('save');
    expect(await closing).toBe(false);
    expect(projectStore.getState().doc).not.toBeNull();
  });

  it('a broken project file shows an alert and leaves the current state alone', async () => {
    handlers['project:openRecent'] = () => ({ path: 'C:/p/bad.jbforge', text: '{ nope' });
    expect(await openRecentProject('C:/p/bad.jbforge')).toBe(false);
    expect(useDialogStore.getState().alert?.title).toBe('Could not open project');
    expect(projectStore.getState().doc).toBeNull();
  });
});

describe('NewModWizard', () => {
  it('validates slugs', () => {
    expect(slugProblem('')).toBe('Required.');
    expect(slugProblem('My Car')).toMatch(/Lowercase/);
    expect(slugProblem('my_car')).toBeNull();
  });

  it('derives the slug until edited, then creates the project', async () => {
    const onClose = vi.fn();
    render(
      <TooltipProvider>
        <NewModWizard onClose={onClose} />
      </TooltipProvider>,
    );
    await userEvent.type(screen.getByTestId('newmod-name'), 'Sunburst Test');
    expect(screen.getByTestId('newmod-slug')).toHaveValue('sunburst_test');
    await userEvent.clear(screen.getByTestId('newmod-slug'));
    await userEvent.type(screen.getByTestId('newmod-slug'), 'test');
    await userEvent.type(screen.getByTestId('newmod-name'), ' 2');
    expect(screen.getByTestId('newmod-slug')).toHaveValue('test'); // no longer auto-derived
    await userEvent.click(screen.getByTestId('newmod-create'));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(projectStore.getState().doc?.meta).toMatchObject({ name: 'Sunburst Test 2', slug: 'test' });
  });

  it('keeps the remembered author when settings load after the wizard opened', async () => {
    const { useSettingsStore } = await import('../../src/renderer/app/stores/settings');
    useSettingsStore.setState({ settings: null });
    const updates: unknown[] = [];
    handlers['settings:update'] = (req) => {
      updates.push(req);
      return undefined;
    };
    render(
      <TooltipProvider>
        <NewModWizard onClose={() => undefined} />
      </TooltipProvider>,
    );
    act(() => useSettingsStore.setState({ settings: { version: 1, debugLogging: false, beamngInstallDir: null, beamngUserDir: null, author: 'Fatkiwi', focusGhostOpacity: 0.12, autoRenameMeshes: true, autoRenameDisplayNames: true } }));
    expect(screen.getByTestId('newmod-author')).toHaveValue('Fatkiwi');
    await userEvent.type(screen.getByTestId('newmod-name'), 'Car');
    await userEvent.click(screen.getByTestId('newmod-create'));
    await vi.waitFor(() => expect(projectStore.getState().doc?.meta.author).toBe('Fatkiwi'));
    expect(updates).toEqual([]); // the saved author was never overwritten
  });

  it('shows errors instead of creating when invalid', async () => {
    render(
      <TooltipProvider>
        <NewModWizard onClose={() => undefined} />
      </TooltipProvider>,
    );
    await userEvent.click(screen.getByTestId('newmod-create'));
    expect(screen.getByTestId('newmod-name')).toHaveAttribute('aria-invalid', 'true');
    expect(projectStore.getState().doc).toBeNull();
  });
});
