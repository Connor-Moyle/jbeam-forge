import { describe, expect, it } from 'vitest';
import { vehicleLogReport } from '../../src/shared/beamng/logReport';

// Lines as the game writes them (from a tester's log, 0.39).
const LOG = [
  '410.100|D|libbeamng.default.init:111| spawning vehicle /vehicles/pickup/',
  '411.000|E|GELua.| Instability detected for vehicle ID: 111, jbeamFilename: "pickup"',
  '422.464|W|GELua.jbeam.prepareLinksDestructive|link target not found: beams/4226 > nodes/se6l id1:nil, id2:nil, partPath: /practice_car_body/practice_car_R_pickup_desert_suspension_R/practice_car_R_pickup_airbump_R - DATA DISCARDED',
  '423.130|W|engine::VehicleResourceContainer::getTSMeshByName| Mesh \'barstow_coolingfan_i6\' not found',
  '423.130|E|prop|Error while initializing prop: unable to find rigid mesh: barstow_coolingfan_i6',
  '423.308|E|MaterialList.mapMaterials|[NO-MATERIAL] Unable to find material mapping to: scintilla_main in unknown',
  '423.792|E|flexMesh|FLEXBODY ERROR on mesh practice_car_suspension_26: VY node not found',
  "40.928|E|GELua.jbeam.expressionParser.parse|   Error:     [string \"return var_brakestrength*8000\"]:1: attempt to perform arithmetic on global 'var_brakestrength' (a nil value)",
  '425.123|D|libbeamng.default.init:50687| spawning vehicle /vehicles/practice_car/',
  '425.389|W|libbeamng.jbeam.pushToPhysics:50687|zero size beam between nodes t1r and th1, beam details are:',
  '425.395|W|libbeamng.jbeam.pushToPhysics:50687|duplicated beam between nodes: f_fx3l and sef6l',
  '425.519|D|libbeamng.controller.init:50687|No main controller found, adding a dummy controller!',
  '426.759|E|GELua.| Instability detected for vehicle ID: 50687, jbeamFilename: "practice_car"',
].join('\n');

describe('what the game said about a car', () => {
  const r = vehicleLogReport(LOG, 'practice_car');
  const kinds = r.issues.map((i) => i.kind);

  it('finds the car’s load and groups the lines by cause, the breaking ones first', () => {
    expect(r.found).toBe(true);
    expect(kinds).toEqual(['no-controller', 'link', 'variable', 'flexbody', 'mesh', 'material', 'zero-beam', 'duplicate-beam', 'unstable']);
  });

  it('names what to jump to', () => {
    const by = (k: string) => r.issues.find((i) => i.kind === k)!;
    expect(by('link').nodes).toEqual(['se6l']);
    expect(by('link').parts).toContain('practice_car_R_pickup_airbump_R');
    expect(by('flexbody').meshes).toEqual(['practice_car_suspension_26']);
    expect(by('mesh').meshes).toEqual(['barstow_coolingfan_i6']);
    expect(by('material').materials).toEqual(['scintilla_main']);
    expect(by('variable').variables).toEqual(['$brakestrength']);
    expect(by('zero-beam').nodes).toEqual(['t1r', 'th1']);
    expect(by('unstable').count).toBe(1); // the pickup's instability isn't this car's
  });

  it('says when the car isn’t in the log', () => {
    expect(vehicleLogReport(LOG, 'etk800').found).toBe(false);
  });
});
