import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createEmptyProject } from '../../src/shared/project/io';
import { emptyEdits } from '../../src/shared/project/schema';
import { projectStore } from '../../src/renderer/app/stores/project';
import { useSetData } from '../../src/renderer/suspension/commands';
import { EngineBuilder, GearboxBuilder } from '../../src/renderer/powertrain/Builder';
import { TooltipProvider } from '../../src/renderer/ui/components/Tooltip';

const ENGINE = {
  v6_engine: {
    slotType: 'car_engine',
    mainEngine: { torque: [['rpm', 'torque'], [0, 0], [2000, 300], [4000, 400], [6000, 380]], idleRPM: 750, maxRPM: 6500, inertia: 0.1 },
    nodes: [['id', 'posX', 'posY', 'posZ'], { nodeWeight: 25 }, ['e1', 0, -1, 0.5], ['e2', 0, -1.2, 0.5]],
  },
};
const GEARBOX = { gb: { slotType: 'car_transmission', gearbox: { gearRatios: [-3.2, 0, 3.5, 2.0, 1.4, 1.0], friction: 2 } } };

beforeEach(() => {
  const doc = createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  doc.powertrain.engine = { setId: 'car/v6', name: 'V6', vehicle: 'Car', type: 'V6', sourceId: 'eng', tuning: {}, edits: emptyEdits() };
  doc.powertrain.gearbox = { setId: 'car/gb', name: '5-Speed', vehicle: 'Car', type: 'Manual', sourceId: 'gb', tuning: {}, edits: emptyEdits() };
  projectStore.getState().load(doc, 'C:/test.jbforge');
  useSetData.setState({ data: { 'car/v6': { parts: ENGINE, root: 'v6_engine', anchors: {} }, 'car/gb': { parts: GEARBOX, root: 'gb', anchors: {} } } });
});

const wrap = (ui: React.ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe('engine builder', () => {
  it('shows the spec, scales the curve and edits the game numbers, undoably', () => {
    wrap(<EngineBuilder />);
    expect(screen.getByText('400 Nm')).toBeInTheDocument();
    expect(screen.getByText('50 kg')).toBeInTheDocument();
    expect(screen.getAllByTestId('dyno-point')).toHaveLength(4);
    fireEvent.click(screen.getByText('+10%'));
    const edits = () => projectStore.getState().doc!.powertrain.engine!.edits;
    expect(edits().torque![2]).toEqual([4000, 440]);
    expect(screen.getByText('440 Nm')).toBeInTheDocument();
    // a game number: the idle speed
    const idle = screen.getByRole('spinbutton', { name: 'Idle speed' });
    fireEvent.change(idle, { target: { value: '900' } });
    fireEvent.blur(idle);
    expect(edits().fields['v6_engine/mainEngine/idleRPM']).toBe(900);
    projectStore.getState().undo();
    expect(edits().fields['v6_engine/mainEngine/idleRPM']).toBeUndefined();
  });

  it('revs the engine higher: curve stretched, rev limit moved with it', () => {
    wrap(<EngineBuilder />);
    const range = screen.getByRole('spinbutton', { name: 'Rev range' });
    fireEvent.change(range, { target: { value: '9000' } });
    fireEvent.blur(range);
    const edits = projectStore.getState().doc!.powertrain.engine!.edits;
    expect(edits.torque!.at(-1)).toEqual([9000, 380]);
    expect(edits.fields['v6_engine/mainEngine/maxRPM']).toBe(9750);
  });
});

describe('gearbox builder', () => {
  it('adds a gear and spaces them evenly', () => {
    wrap(<GearboxBuilder />);
    expect(screen.getAllByTestId('gear-row')).toHaveLength(6);
    fireEvent.click(screen.getByText('Add a gear'));
    const ratios = () => projectStore.getState().doc!.powertrain.gearbox!.edits.gearRatios!;
    expect(ratios()).toEqual([-3.2, 0, 3.5, 2.0, 1.4, 1.0, 0.82]);
    fireEvent.click(screen.getByTestId('gear-spacer-apply'));
    expect(ratios()).toHaveLength(7);
    expect(ratios()[2]).toBe(3.5);
    expect(ratios().at(-1)).toBeCloseTo(0.82);
  });
});
