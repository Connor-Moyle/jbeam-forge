import { describe, expect, it } from 'vitest';
import { jbeamMaterialRefs } from '../../src/shared/export/materialRefs';

describe('materials a part’s jbeam names that no mesh carries', () => {
  it('finds what a glow map switches between', () => {
    expect(
      jbeamMaterialRefs([
        { glowMap: { auto_P: { simpleFunction: 'auto_p', off: 'pessima_gauges', on: 'pessima_gauges_on' }, lights: { simpleFunction: 'lowbeam', off: 'lamps', on: 'lamps_on', on_intense: 'lamps_on_intense' } } },
      ]),
    ).toEqual(['lamps', 'lamps_on', 'lamps_on_intense', 'pessima_gauges', 'pessima_gauges_on']);
  });

  it('finds what a mesh’s material is swapped for, on a row or on the options before it', () => {
    expect(
      jbeamMaterialRefs([
        {
          flexbodies: [
            ['mesh', '[group]:', 'nonFlexMaterials'],
            ['disc', ['wheel_FR'], [], { pos: { x: 0, y: 0, z: 0 }, materialOverride: { scintilla_brakedisc_front: 'scintilla_brakedisc_front_R' } }],
            { materialOverride: [['scintilla_brakedisc_front', 'scintilla_brakedisc_front_L']] },
            ['disc', ['wheel_FL']],
          ],
        },
      ]),
    ).toEqual(['scintilla_brakedisc_front_L', 'scintilla_brakedisc_front_R']);
  });

  it('is empty for parts with neither', () => {
    expect(jbeamMaterialRefs([{ nodes: [['id', 'posX', 'posY', 'posZ']] }, {}])).toEqual([]);
  });
});
