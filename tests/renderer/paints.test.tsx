import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MeshPhysicalMaterial, ShaderLib, UniformsUtils } from 'three';
import { createEmptyProject } from '../../src/shared/project/io';
import { projectStore } from '../../src/renderer/app/stores/project';
import { PaintsPanel } from '../../src/renderer/paint/PaintsPanel';
import { addPaint, applyScheme, deletePaint } from '../../src/renderer/paint/commands';
import { applyPaintShader, paintPreviewActive, paintUniforms, syncPreviewPaints } from '../../src/renderer/paint/preview';
import { presetByName } from '../../src/shared/paints/paints';
import { TooltipProvider } from '../../src/renderer/ui/components/Tooltip';

beforeEach(() => {
  const doc = createEmptyProject({ name: 'Test', slug: 'test' }, '0.1.0', new Date('2026-01-01T00:00:00Z'));
  doc.configs.push({ id: 'c1', name: 'Race', description: '', type: 'Custom', parts: {}, vars: {}, paints: [null, null, null] });
  projectStore.getState().load(doc, 'C:/test.jbforge');
});

const paints = () => projectStore.getState().doc!.paints;

describe('paint commands', () => {
  it('the first paint fills every slot; schemes set all three; deleting falls back', () => {
    const red = addPaint(presetByName('Signal Red')!);
    expect(paints().defaults).toEqual([red, red, red]);
    applyScheme('Rave');
    const names = paints().defaults.map((id) => paints().list.find((p) => p.id === id)!.name);
    expect(names).toEqual(['Neon Green', 'Hot Pink', 'Cyber Cyan']);
    // a configuration using a paint that's deleted goes back to the factory default
    const pink = paints().defaults[1]!;
    projectStore.getState().execute({ label: 't', apply: (d) => void (d.configs[0]!.paints[0] = pink) });
    deletePaint(pink);
    expect(projectStore.getState().doc!.configs[0]!.paints[0]).toBeNull();
    expect(paints().defaults[1]).toBe(red);
  });
});

describe('Paints panel', () => {
  it('adds presets and shows the slots', () => {
    render(
      <TooltipProvider>
        <PaintsPanel />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getAllByTestId('paint-preset').find((b) => b.textContent === 'Candy Purple')!);
    expect(paints().list.map((p) => p.name)).toEqual(['Candy Purple']);
    expect(screen.getAllByTestId('paint-row')).toHaveLength(1);
    expect(screen.getByTestId('paint-editor')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('paint-scheme')[0]!);
    expect(paints().list.length).toBe(4);
  });
});

describe('paint preview', () => {
  it('follows the project paints into the shared uniforms', () => {
    syncPreviewPaints(projectStore.getState().doc, null);
    expect(paintPreviewActive()).toBe(false);
    addPaint({ ...presetByName('Jet Black')!, color: [1, 0, 0] });
    syncPreviewPaints(projectStore.getState().doc, null);
    expect(paintPreviewActive()).toBe(true);
    expect(paintUniforms.paintColor.value[2]!.r).toBeCloseTo(1);
    expect(paintUniforms.paintColor.value[2]!.g).toBeCloseTo(0);
  });

  it('patches every shader chunk it needs (fails if three renames them)', () => {
    const m = new MeshPhysicalMaterial();
    applyPaintShader(m, null, null);
    const shader = { uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms), vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
    m.onBeforeCompile(shader as never, null as never);
    const f = shader.fragmentShader;
    expect(f).toContain('uniform vec3 paintColor[3];');
    expect(f).toContain('diffuseColor.rgb = paintColor[0] * paintW.r');
    expect(f).toContain('roughnessFactor = mix(');
    expect(f).toContain('metalnessFactor = mix(');
    expect(f).toContain('material.clearcoat = dot(paintW');
    expect(shader.uniforms).toHaveProperty('paintMask');
    expect(m.defines).toHaveProperty('USE_UV');
  });
});
